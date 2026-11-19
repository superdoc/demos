import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentToolkit } from '@superdoc/sdk';
import { ReferenceDocument, createReferenceToolkit } from './reference-integration/reference-document.js';
import { createReferenceAgentAdapter } from './reference-integration/agent/reference-agent-adapter.js';

const sdk = await createAgentToolkit({ provider: 'openai', preset: 'full' });
const at = { kind: 'text', segments: [{ blockId: 'body', range: { start: 12, end: 12 } }] };

async function harness(changeMode) {
  const writes = [];
  const handle = {
    blocks: { list: async () => ({ total: 1, blocks: [{ nodeId: 'body', text: 'Exact phrase in the document.' }] }) },
    footnotes: {
      list: async () => ({ total: writes.filter((write) => write.kind === 'footnote').length }),
      insert: async (args) => { writes.push({ kind: 'footnote', args }); return { success: true, footnote: { id: 'note' } }; },
    },
    citations: {
      sources: { list: async () => ({ evaluatedRevision: '1', total: 1, items: [{ sourceId: 'saved', type: 'book', fields: { title: 'Saved source' } }] }) },
      insert: async (args) => { writes.push({ kind: 'citation', args }); return { success: true }; },
    },
  };
  const document = new ReferenceDocument({ id: 'native-test', filename: 'test.docx', path: 'unused', handle, toolkit: sdk,
    importedCitations: { records: [], style: 'APA' } });
  const adapter = await createReferenceAgentAdapter({ document, toolkit: createReferenceToolkit(sdk),
    prompt: 'Insert the requested reference.', changeMode });
  return { adapter, writes };
}

test('Full toolkit advertises native reference capabilities with streaming as the only custom tool', async () => {
  const { adapter } = await harness('direct');
  assert.deepEqual(adapter.tools.map((tool) => tool.function.name), [
    'superdoc_inspect', 'superdoc_perform_action', 'superdoc_api_search', 'superdoc_api_call',
    'superdoc_stream_text',
  ]);
  const actions = adapter.tools.find((tool) => tool.function.name === 'superdoc_perform_action');
  assert.ok(actions.function.parameters.properties.action.enum.includes('insert_footnote'));
  assert.doesNotMatch(adapter.systemPrompt + JSON.stringify(adapter.tools), /superdoc_insert_(citation|footnote)|superdoc_references|superdoc_bibliographies/);
  for (const operationId of ['doc.citations.insert', 'doc.footnotes.insert']) {
    const search = await adapter.execute('superdoc_api_search', { operationId });
    assert.equal(search.failed, false);
    assert.equal(search.result.operation.operationId, operationId);
  }
});

test('footnote helper dispatches through the real Full preset with the host mode', async () => {
  for (const changeMode of ['direct', 'tracked']) {
    const { adapter, writes } = await harness(changeMode);
    const result = await adapter.execute('superdoc_perform_action', {
      action: 'insert_footnote', anchorText: 'Exact phrase', content: 'A native note.',
      changeMode: changeMode === 'tracked' ? 'direct' : 'tracked',
    });
    assert.equal(result.failed, false);
    assert.deepEqual(writes, [{ kind: 'footnote', args: { type: 'footnote', content: 'A native note.', at, changeMode } }]);
  }
});

test('citations dispatch to the native API in Editing and refuse unsupported tracked insertion before writing', async () => {
  for (const changeMode of ['direct', 'tracked']) {
    const { adapter, writes } = await harness(changeMode);
    const result = await adapter.execute('superdoc_api_call', {
      operationId: 'doc.citations.insert', args: { sourceIds: ['saved'], at, changeMode: 'direct' },
    });
    if (changeMode === 'direct') {
      assert.equal(result.failed, false);
      assert.deepEqual(writes, [{ kind: 'citation', args: { sourceIds: ['saved'], at, changeMode: 'direct' } }]);
    } else {
      assert.equal(result.failed, true);
      assert.match(result.result.error, /refused under enforceChangeMode/);
      assert.deepEqual(writes, []);
    }
  }
});

test('footnotes also dispatch through API call with enforced tracked mode', async () => {
  const { adapter, writes } = await harness('tracked');
  const result = await adapter.execute('superdoc_api_call', {
    operationId: 'doc.footnotes.insert', args: { type: 'footnote', content: 'A native note.', at, changeMode: 'direct' },
  });
  assert.equal(result.failed, false);
  assert.deepEqual(writes, [{ kind: 'footnote', args: { type: 'footnote', content: 'A native note.', at, changeMode: 'tracked' } }]);
});

test('a tracked batch cannot write a footnote before an unsupported citation insertion', async () => {
  const { adapter, writes } = await harness('tracked');
  const result = await adapter.execute('superdoc_api_call', { calls: [
    { operationId: 'doc.footnotes.insert', args: { type: 'footnote', content: 'Note.', at } },
    { operationId: 'doc.citations.insert', args: { sourceIds: ['saved'], at } },
  ] });
  assert.equal(result.failed, true);
  assert.deepEqual(writes, []);
});

test('a source update remains successful if its subsequent formatting refresh fails', async () => {
  let title = 'Before';
  const handle = { citations: { sources: {
    list: async () => ({ evaluatedRevision: title, total: 1, items: [{ sourceId: 'saved', type: 'book', fields: { title } }] }),
    update: async ({ patch }) => { title = patch.title; return { success: true }; },
  } }, save: async () => { throw new Error('Formatting export failed.'); } };
  const document = new ReferenceDocument({ id: 'source-update', filename: 'unused.docx', path: 'unused', handle, toolkit: sdk,
    importedCitations: { records: [], style: 'APA' } });
  const result = await document.manageReferences({ action: 'update', sourceId: 'saved', fields: { title: 'After' }, expectedRevision: 'Before' });
  assert.equal(result.success, true);
  assert.equal(result.source.fields.title, 'After');
  assert.match(result.formattingWarning, /metadata was saved/);
});
