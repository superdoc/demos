import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextStream } from './reference-integration/native/stream-text.js';

function fixture(initial = 'Lead Original passage tail') {
  const blocks = new Map([['target', initial], ['other', 'Other paragraph']]);
  const attempts = [];
  const applied = [];
  let revision = 1;
  let beforeWrite;
  const address = (id) => ({ kind: 'block', nodeType: 'paragraph', nodeId: id });
  const point = (id, offset) => ({ kind: 'text', blockId: id, offset });
  const edit = (id, text) => { blocks.set(id, text); revision++; };

  function write(kind, args) {
    attempts.push({ kind, args });
    beforeWrite?.(kind, args);
    if (args.expectedRevision !== undefined && args.expectedRevision !== String(revision)) {
      return { receipt: { success: false, failure: { code: 'REVISION_MISMATCH', message: 'Revision changed before applying the write.' } } };
    }
    if (kind === 'paragraph') {
      const id = `new-${applied.length}`;
      edit(id, args.text);
      applied.push({ kind, args });
      return { success: true, paragraph: address(id) };
    }
    const { start, end } = args.target;
    const current = blocks.get(start.blockId);
    edit(start.blockId, current.slice(0, start.offset) + (args.text ?? args.value) + current.slice(end.offset));
    applied.push({ kind, args });
    return { receipt: { success: true } };
  }

  const handle = {
    blocks: { async list() { return { revision: String(revision) }; } },
    query: { async match({ select, within, limit }) {
      if (within && !blocks.has(within.nodeId)) throw Object.assign(new Error('Block deleted'), { code: 'TARGET_NOT_FOUND' });
      const items = [];
      for (const [id, text] of blocks) {
        if (within && id !== within.nodeId) continue;
        let from = 0;
        while (from < text.length) {
          const offset = text.indexOf(select.pattern, from);
          if (offset < 0) break;
          items.push({ address: address(id), target: { kind: 'selection', start: point(id, offset), end: point(id, offset + select.pattern.length) } });
          from = offset + 1;
        }
      }
      return { total: items.length, items: items.slice(0, limit) };
    } },
    async replace(args) { return write('replace', args); },
    async insert(args) { return write('insert', args); },
    create: { async paragraph(args) { return write('paragraph', args); } },
  };
  return { handle, blocks, attempts, applied, edit, onWrite(callback) { beforeWrite = callback; } };
}

const replacement = (text) => ({ mode: 'replace', anchor: 'Original passage', text });

test('typing before the generated passage moves the streaming insertion point without losing user text', async () => {
  const f = fixture();
  const writer = createTextStream(f.handle, { changeMode: 'tracked' });
  await writer.update(replacement('New'));
  f.edit('target', 'User typed: ' + f.blocks.get('target'));
  await writer.commit(replacement('New paragraph'));
  assert.equal(f.blocks.get('target'), 'User typed: Lead New paragraph tail');
  assert.equal(f.applied.length, 2);
  assert.equal(f.applied[1].args.target.start.offset, 'User typed: Lead New'.length);
  assert.ok(f.applied.every(({ args }) => args.changeMode === 'tracked'));
});

test('revision conflicts re-read the target and revision, then apply each suffix exactly once', async () => {
  const f = fixture();
  const writer = createTextStream(f.handle, { changeMode: 'direct' });
  await writer.update(replacement('New'));
  f.onWrite(() => {
    f.onWrite(undefined);
    f.edit('other', 'Human changed another paragraph.');
    f.edit('target', 'Moved: ' + f.blocks.get('target'));
  });
  await writer.commit(replacement('New paragraph'));
  assert.equal(f.blocks.get('target'), 'Moved: Lead New paragraph tail');
  assert.equal(f.blocks.get('other'), 'Human changed another paragraph.');
  assert.equal(f.attempts.length, 3);
  assert.equal(f.applied.length, 2);
  assert.notEqual(f.attempts[1].args.expectedRevision, f.attempts[2].args.expectedRevision);
  assert.notEqual(f.attempts[1].args.target.start.offset, f.attempts[2].args.target.start.offset);
});

test('a thrown confirmed revision conflict is also safe to retry', async () => {
  const f = fixture();
  f.onWrite(() => {
    f.onWrite(undefined);
    throw Object.assign(new Error('Rejected before mutation'), { code: 'REVISION_MISMATCH' });
  });
  await createTextStream(f.handle, { changeMode: 'direct' }).commit(replacement('New'));
  assert.equal(f.blocks.get('target'), 'Lead New tail');
  assert.equal(f.attempts.length, 2);
  assert.equal(f.applied.length, 1);
});

test('timeouts and other uncertain failures are never retried', async () => {
  for (const code of ['ETIMEDOUT', 'HOST_DISCONNECTED', 'COMMAND_FAILED', undefined]) {
    const f = fixture();
    f.onWrite(() => { throw Object.assign(new Error('expected-revision stale does not match current revision 2.'), { code }); });
    await assert.rejects(createTextStream(f.handle, { changeMode: 'direct' }).update(replacement('New')));
    assert.equal(f.attempts.length, 1);
    assert.equal(f.applied.length, 0);
  }
});

test('persistent revision conflicts pause after a bounded number of attempts', async () => {
  const f = fixture();
  f.onWrite(() => f.edit('other', f.blocks.get('other') + '.'));
  const writer = createTextStream(f.handle, { changeMode: 'direct' });
  await assert.rejects(writer.update(replacement('New')), { code: 'STREAM_DOCUMENT_BUSY' });
  assert.equal(f.attempts.length, 5);
  assert.equal(f.applied.length, 0);
  assert.equal(f.blocks.get('target'), 'Lead Original passage tail');
  f.onWrite(undefined);
  await assert.rejects(writer.update(replacement('New')), { code: 'STREAM_DOCUMENT_BUSY' });
  assert.equal(f.attempts.length, 5);
});

test('editing, deleting or duplicating the generated passage pauses without overwriting user text', async () => {
  for (const text of ['Lead Human edited this tail', 'Lead tail', 'Lead New and New tail']) {
    const f = fixture();
    const writer = createTextStream(f.handle, { changeMode: 'direct' });
    await writer.update(replacement('New'));
    f.edit('target', text);
    await assert.rejects(writer.update(replacement('New paragraph')), { code: 'STREAM_TARGET_CHANGED' });
    assert.equal(f.blocks.get('target'), text);
    assert.equal(f.applied.length, 1);
  }
});

test('a deleted target block never redirects the stream to an identical quote elsewhere', async () => {
  const f = fixture();
  f.onWrite(() => {
    f.onWrite(undefined);
    f.blocks.delete('target');
    f.edit('other', 'Original passage');
  });
  await assert.rejects(createTextStream(f.handle, { changeMode: 'direct' }).update(replacement('New')), { code: 'STREAM_TARGET_CHANGED' });
  assert.equal(f.blocks.get('other'), 'Original passage');
  assert.equal(f.applied.length, 0);
  assert.equal(f.attempts.length, 1);
});

test('final completion checks for a target edit even when the last chunk was already applied', async () => {
  const f = fixture();
  const writer = createTextStream(f.handle, { changeMode: 'direct' });
  await writer.update(replacement('New'));
  f.edit('target', 'Lead Human edit tail');
  await assert.rejects(writer.commit(replacement('New')), { code: 'STREAM_TARGET_CHANGED' });
  assert.equal(f.blocks.get('target'), 'Lead Human edit tail');
  assert.equal(f.applied.length, 1);
});

test('cancellation during conflict backoff stops before another write attempt', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.onWrite(() => {
    f.edit('other', 'Human typing');
    setTimeout(() => controller.abort(), 0);
  });
  await assert.rejects(createTextStream(f.handle, { changeMode: 'direct', signal: controller.signal }).update(replacement('New')), { name: 'AbortError' });
  assert.equal(f.attempts.length, 1);
  assert.equal(f.applied.length, 0);
});

test('paragraph creation conflicts do not create duplicate paragraphs', async () => {
  const f = fixture();
  f.onWrite(() => {
    f.onWrite(undefined);
    f.edit('other', 'Human typing');
  });
  await createTextStream(f.handle, { changeMode: 'tracked' }).commit({ mode: 'paragraphAfter', anchor: 'Original passage', text: 'New paragraph' });
  assert.equal(f.attempts.length, 2);
  assert.equal(f.applied.length, 1);
  assert.equal([...f.blocks.values()].filter((text) => text === 'New paragraph').length, 1);
});
