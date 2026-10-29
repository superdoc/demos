import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ReferenceDocument, createReferenceToolkit, prepareReferenceDocument,
  createReferenceAgent, createReferenceAgentAdapter } from '../server/src/reference-integration/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function files(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(child));
    else result.push(child);
  }
  return result;
}

test('portable server and browser imports stay within their own module boundaries', async () => {
  for (const area of ['server', 'client']) {
    const base = path.join(root, area, 'src/reference-integration');
    for (const file of await files(base)) {
      if (!/\.(?:js|ts|tsx)$/.test(file)) continue;
      const source = await fs.readFile(file, 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\s*\(|new URL\(\s*)['"](\.[^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(file), match[1]);
        assert.ok(target.startsWith(base + path.sep), `${file} escapes to ${target}`);
        if (target.includes('${')) continue;
        const candidates = [target, target + '.ts', target + '.tsx', target + '.js'];
        assert.ok((await Promise.all(candidates.map((p) => fs.access(p).then(() => true, () => false)))).some(Boolean), `Missing ${target}`);
      }
      assert.doesNotMatch(source, /from ['"](?:.*\/)?(?:config|logging|api|Topbar|ChatPanel)(?:\.[jt]sx?)?['"]/);
      assert.doesNotMatch(source, /localhost:|\.document-pane|\.editor-shell/);
    }
  }
});

test('portable registration composes all four custom tools and preserves native dispatch', async () => {
  const native = { type: 'function', function: { name: 'native_test' } };
  let dispatched;
  const core = { tools: [native], systemPrompt: 'Native instructions.', dispatch: (...args) => { dispatched = args; return 'native-result'; } };
  const toolkit = createReferenceToolkit(core);
  assert.deepEqual(toolkit.tools.map((t) => t.function.name), ['native_test', 'superdoc_insert_footnote', 'superdoc_insert_citation', 'superdoc_references', 'superdoc_bibliographies', 'superdoc_stream_text']);
  assert.match(toolkit.systemPrompt, /sectionEnd/);
  const handle = {};
  const document = new ReferenceDocument({ id: 'test', filename: 'test.docx', path: 'unused', handle, toolkit: core, importedCitations: { records: [], style: 'APA' } });
  assert.equal(await document.dispatch('native_test', { value: 1 }), 'native-result');
  assert.deepEqual(dispatched, [handle, 'native_test', { value: 1 }]);
  assert.throws(() => document.dispatch('superdoc_insert_footnote', { content: 'x' }), /anchor/i);
  assert.throws(() => createReferenceAgent({ getToolkit: () => toolkit }), /client/);
});

test('portable source mutations serialize and stale queued requests cannot replace a newer revision', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-reference-test-'));
  const input = path.join(directory, 'working.docx');
  await fs.copyFile(path.join(root, 'server/assets/blank.docx'), input);
  let current = await fs.readFile(input);
  let revision = 1;
  let applied = 0;
  const importedCitations = await prepareReferenceDocument(input);
  const handle = {
    citations: { sources: { list: async () => ({ evaluatedRevision: String(revision) }) } },
    save: async ({ out }) => fs.writeFile(out, current),
    replaceFile: async (bytes) => { current = bytes; applied++; revision++; },
    close: async () => {},
  };
  const document = new ReferenceDocument({ id: 'synthetic', filename: 'working.docx', path: input, handle,
    toolkit: { dispatch: () => { throw new Error('Custom tools must not use native dispatch.'); } }, importedCitations });
  const create = (title, expectedRevision) => document.dispatch('superdoc_references', {
    action: 'create', type: 'report', fields: { title, year: '2026', corporateAuthor: 'Synthetic Organization' }, expectedRevision,
  });
  try {
    const first = create('First report', '1');
    const stale = create('Stale report', '1');
    assert.equal(document.referenceBusy, true);
    const [a, b] = await Promise.allSettled([first, stale]);
    assert.equal(a.status, 'fulfilled');
    assert.equal(a.value.success, true);
    assert.equal(b.status, 'rejected');
    assert.match(b.reason.message, /document changed/i);
    assert.equal(applied, 1);
    assert.equal(document.referenceBusy, false);
    await create('Second report', '2');
    const catalog = await document.citationSources();
    assert.deepEqual(catalog.items.map((source) => source.fields.title), ['First report', 'Second report']);
    assert.equal(catalog.evaluatedRevision, '3');
  } finally {
    await document.waitForReferences();
    await document.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('an existing agent loop gets fresh context and host-enforced modes through the shared adapter', async () => {
  let revision = '1';
  const calls = [];
  const document = {
    waitForReferences: async () => {},
    citationSources: async () => ({ items: [{ sourceId: 'saved-report', fields: { title: 'Saved report' } }],
      evaluatedRevision: revision, bibliographyStyle: 'APA' }),
    dispatch: async (tool, args) => { calls.push({ tool, args }); return { success: true, evaluatedRevision: '2' }; },
  };
  const toolkit = createReferenceToolkit({ tools: [], systemPrompt: 'Host native toolkit.' });
  const adapter = await createReferenceAgentAdapter({ document, toolkit, prompt: 'Insert a citation.', changeMode: 'tracked' });
  assert.equal(adapter.tools, toolkit.tools);
  assert.match(adapter.systemPrompt, /changeMode=tracked/);
  assert.match(adapter.contextMessage.content, /saved-report/);
  assert.equal(JSON.parse(adapter.contextMessage.content.split('\n')[1]).evaluatedRevision, '1');
  const args = { sourceId: 'saved-report', expectedRevision: '1', changeMode: 'direct' };
  const receipt = await adapter.execute('superdoc_insert_citation', args);
  assert.equal(receipt.failed, false);
  assert.equal(calls[0].args.changeMode, 'tracked');
  assert.equal(args.changeMode, 'direct', 'Do not mutate host-owned arguments.');
  revision = '2';
  const next = await createReferenceAgentAdapter({ document, toolkit, prompt: 'Add a footnote.', changeMode: 'direct' });
  assert.equal(JSON.parse(next.contextMessage.content.split('\n')[1]).evaluatedRevision, '2');
  await next.execute('superdoc_insert_footnote', JSON.stringify({ content: 'Note', changeMode: 'tracked' }));
  assert.equal(calls[1].args.changeMode, 'direct');
  await assert.rejects(createReferenceAgentAdapter({ document, toolkit, prompt: '', changeMode: 'invented' }), /host must supply/);
});

test('the shared adapter stops repeated failures across inspections and preserves saved-reference receipts', async () => {
  const document = {
    waitForReferences: async () => {},
    citationSources: async () => ({ items: [], evaluatedRevision: '1', bibliographyStyle: 'APA' }),
    dispatch: async (tool) => {
      if (tool === 'superdoc_references') return { success: true, action: 'create',
        source: { sourceId: 'report', fields: { title: 'Saved report' } } };
      if (tool === 'superdoc_inspect') return { revision: '2' };
      throw new Error('Anchor is ambiguous.');
    },
  };
  const toolkit = createReferenceToolkit({ tools: [], systemPrompt: '' });
  const adapter = await createReferenceAgentAdapter({ document, toolkit, prompt: 'Create and insert a citation.', changeMode: 'tracked' });
  await adapter.execute('superdoc_references', { action: 'create', fields: { title: 'Saved report' } });
  const first = await adapter.execute('superdoc_insert_citation', { sourceId: 'report', expectedRevision: '1' });
  assert.equal(first.failed, true);
  assert.equal(first.stop, undefined);
  await adapter.execute('superdoc_inspect', {});
  const second = await adapter.execute('superdoc_insert_citation', { sourceId: 'report', expectedRevision: '2' });
  assert.equal(second.stop, 'repeated_failure');
  assert.match(second.message, /Saved reference "Saved report"/);
  assert.doesNotMatch(second.message, /Inserted citation/);
  assert.match(adapter.interruptionReport('turn_limit'), /Saved reference "Saved report"/);
});
