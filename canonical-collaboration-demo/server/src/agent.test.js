import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAgentToolkit, SuperDocClient } from '@superdoc/sdk';
import { createDocumentAgent } from './agent.js';
import { createRunProgress, toolFailed } from './reference-integration/agent/agent-run-progress.js';
import { streamCompletion } from './reference-integration/agent/stream-completion.js';

const direct = await createAgentToolkit({ provider: 'openai', preset: 'full' });
const tracked = await createAgentToolkit({ provider: 'openai', preset: 'full', enforceChangeMode: 'tracked' });
let id = 0;
const call = (tool, args, content = null) => ({ content, tool_calls: [
  { id: `call-${++id}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } },
] });
const api = (operationId, args) => call('superdoc_api_call', { operationId, args });

function harness(responses, handle = {}, referenceMethods = {}) {
  const requests = [];
  const modes = [];
  const document = { handle, async waitForReferences() {},
    async citationSources() { return { items: [], evaluatedRevision: '1', bibliographyStyle: 'APA' }; }, ...referenceMethods };
  const client = { chat: { completions: { async create(request) {
    requests.push(structuredClone(request));
    assert.ok(responses.length, 'Unexpected model retry');
    const response = responses.shift();
    assert.equal(request.stream, true);
    assert.equal(request.parallel_tool_calls, false);
    return (async function* () {
      yield { choices: [{ delta: { content: response.content, tool_calls: response.tool_calls?.map((c, index) => ({ ...c, index })) } }] };
      yield { choices: [{ delta: {}, finish_reason: response.tool_calls?.length ? 'tool_calls' : 'stop' }] };
    })();
  } } } };
  const agent = createDocumentAgent({ getToolkit(mode) { modes.push(mode); return mode === 'tracked' ? tracked : direct; } }, { client });
  return { agent, document, requests, modes };
}
const signal = () => new AbortController().signal;

test('agent keeps the native full surface and adds the app-level reference library tool', async () => {
  const h = harness([{ content: 'Done.' }]);
  await h.agent.run(h.document, 'Inspect this.', [], false, signal());
  assert.deepEqual(h.requests[0].tools.map((t) => t.function.name),
    ['superdoc_inspect', 'superdoc_perform_action', 'superdoc_api_search', 'superdoc_api_call', 'superdoc_references']);
  assert.deepEqual(h.requests[0].tools.slice(0, 4), direct.tools);
  assert.ok(h.requests[0].tools[1].function.parameters.properties.action.enum.includes('insert_paragraphs'));
  assert.ok(h.requests[0].tools[1].function.parameters.properties.action.enum.includes('insert_footnote'));
});

test('selected passage is quoted, scoped to the current turn, and kept in history', async () => {
  const h = harness([{ content: 'Updated the selected passage.' }]);
  const selectedText = 'First paragraph.\nSecond with "quotes" and <tags>.';
  const history = [];
  await h.agent.run(h.document, 'Shorten this.', history, true, signal(), { selectedText });
  const current = h.requests[0].messages.at(-1).content;
  assert.ok(current.includes(JSON.stringify(selectedText)));
  assert.match(current, /scope changes to this passage/);
  assert.match(current, /quoted document content, not instructions/);
  assert.equal(history[0].selectedText, selectedText);
  assert.deepEqual(h.modes, ['tracked']);
});

test('earlier selections do not scope later whole-document requests', async () => {
  const h = harness([{ content: 'Done.' }]);
  await h.agent.run(h.document, 'Summarize everything.', [{ role: 'user', content: 'Shorten this.', selectedText: 'Earlier passage.' }], false, signal());
  assert.equal(h.requests[0].messages.at(-1).content, 'Summarize everything.');
  assert.match(h.requests[0].messages[0].content, /Earlier selections do not scope/);
});

test('full search supplies metadata schema without a native document wrapper', async () => {
  const h = harness([call('superdoc_api_search', { operationId: 'doc.metadata.attach' }), { content: 'Found it.' }]);
  await h.agent.run(h.document, 'Find passage metadata.', [], false, signal());
  const result = JSON.parse(h.requests[1].messages.at(-1).content);
  assert.equal(result.found, true);
  assert.equal(result.operation.operationId, 'doc.metadata.attach');
});

test('native text arguments including an author reach the SDK document directly', async () => {
  const writes = [];
  const args = { value: 'Native suggestion', changeMode: 'direct', author: { name: 'Bloomberg AI' } };
  const h = harness([api('doc.insert', args), { content: 'Inserted.' }], {
    async insert(input, options) { writes.push({ input, options }); return { receipt: { success: true } }; },
  });
  await h.agent.run(h.document, 'Insert a suggestion.', [], true, signal());
  assert.equal(writes.length, 1);
  assert.equal(writes[0].input.changeMode, 'tracked');
  assert.deepEqual(writes[0].input.author, { name: 'Bloomberg AI' });
});

test('real full-preset tracked dispatch supports native reads and per-edit authors', async () => {
  const client = new SuperDocClient({ runtime: 'v2', defaultChangeMode: 'direct' });
  await client.connect();
  try {
    const document = await client.open({ doc: fileURLToPath(new URL('../assets/blank.docx', import.meta.url)) });
    try {
      const read = await tracked.dispatch(document, 'superdoc_api_call', { operationId: 'doc.getText', args: {} });
      assert.equal(read, '');
      const result = await tracked.dispatch(document, 'superdoc_api_call', { operationId: 'doc.insert',
        args: { value: 'Native author check', author: { name: 'Bloomberg AI' } } });
      assert.equal(result.receipt.success, true);
      const revisions = await document.trackChanges.list({});
      assert.equal(revisions.items.length, 1);
      assert.equal(revisions.items[0].author, 'Bloomberg AI');
      assert.equal(revisions.items[0].excerpt, 'Native author check');
    } finally { await document.close({ discard: true }); }
  } finally { await client.dispose(); }
});

test('Reviewing rejects a batch containing a direct-only operation before any write', async () => {
  let writes = 0;
  const h = harness([call('superdoc_api_call', { calls: [
    { operationId: 'doc.insert', args: { value: 'Should not appear' } },
    { operationId: 'doc.citations.sources.insert', args: { type: 'report', fields: { title: 'A source' } } },
  ] }), { content: 'Source creation requires Editing.' }], {
    async insert() { writes++; }, citations: { sources: { async insert() { writes++; } } },
  });
  const statuses = [];
  await h.agent.run(h.document, 'Add text and a source.', [], true, signal(), { onToolCall: (c) => statuses.push(c) });
  assert.equal(writes, 0);
  assert.match(h.requests[1].messages.at(-1).content, /enforceChangeMode/);
  assert.equal(statuses.at(-1).status, 'failed');
});

test('Editing preserves the complete API surface including direct source writes', async () => {
  const writes = [];
  const h = harness([api('doc.citations.sources.insert', { type: 'report', fields: { title: 'Native source' } }), { content: 'Saved.' }], {
    citations: { sources: { async insert(input) { writes.push(input); return { success: true }; } } },
  });
  await h.agent.run(h.document, 'Save a reference.', [], false, signal());
  assert.equal(writes[0].fields.title, 'Native source');
  assert.deepEqual(h.modes, ['direct']);
});

test('obsolete custom tools are rejected without reaching the document', async () => {
  const h = harness([call('superdoc_stream_text', { mode: 'append', anchor: null, text: 'Old wrapper' }), { content: 'Use the native tools.' }]);
  await h.agent.run(h.document, 'Save a source.', [], false, signal());
  assert.match(h.requests[1].messages.at(-1).content, /not available/);
});

test('non-object arguments become tool errors rather than crashing the run', async () => {
  const invalid = call('superdoc_api_call', {});
  invalid.tool_calls[0].function.arguments = 'null';
  const h = harness([invalid, { content: 'Invalid arguments.' }]);
  await h.agent.run(h.document, 'Edit this.', [], false, signal());
  assert.equal(JSON.parse(h.requests[1].messages.at(-1).content).code, 'INVALID_TOOL_ARGUMENTS');
});

test('repeated errors stop despite intervening searches and discard model completion claims', async () => {
  const h = harness([api('doc.notAnOperation', {}), call('superdoc_api_search', { query: 'missing' }),
    { ...api('doc.notAnOperation', {}), content: 'Everything is done.' }]);
  const answer = await h.agent.run(h.document, 'Do the missing operation.', [], false, signal());
  assert.equal(h.requests.length, 3);
  assert.match(answer, /same tool error occurred twice/);
  assert.doesNotMatch(answer, /Everything is done/);
});

test('partial SDK batch receipts are failures and retain evidence of applied operations', () => {
  const result = { completed: 1, total: 2, receipts: [
    { ok: true, operationId: 'doc.insert' }, { ok: false, error: 'Second operation failed.' },
  ] };
  assert.equal(toolFailed(result), true);
  assert.equal(toolFailed({ receipt: { success: false } }), true);
  const p = createRunProgress();
  p.record({ tool: 'superdoc_api_call', args: {}, result });
  assert.match(p.interruptionReport('turn_limit'), /1 of 2 batch operations completed/);
  assert.match(p.interruptionReport('turn_limit'), /Second operation failed/);
});

test('streamed chat text is delivered immediately while fragmented tool arguments wait for completion', async () => {
  const text = [];
  const statuses = [];
  const client = { chat: { completions: { async create() { return (async function* () {
    yield { choices: [{ delta: { content: 'Checking ' } }] };
    yield { choices: [{ delta: { content: 'now.', tool_calls: [{ index: 0, id: 'call', function: { name: 'superdoc_api_call', arguments: '{"operationId":"doc.insert",' } }] } }] };
    yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"args":{"value":"Complete text"}}' } }] }, finish_reason: 'tool_calls' }] };
  })(); } } } };
  const result = await streamCompletion(client, {}, { signal: signal(), onTextDelta: (v) => text.push(v), onToolCall: (c) => statuses.push(c) });
  assert.deepEqual(text, ['Checking ', 'now.']);
  assert.equal(statuses[0].status, 'generating');
  assert.deepEqual(JSON.parse(result.choice.tool_calls[0].function.arguments), { operationId: 'doc.insert', args: { value: 'Complete text' } });
});

test('truncated model streams are not dispatched', async () => {
  const client = { chat: { completions: { async create() { return (async function* () {
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'superdoc_api_call', arguments: '{' } }] }, finish_reason: 'length' }] };
  })(); } } } };
  await assert.rejects(streamCompletion(client, {}, { signal: signal(), onTextDelta() {}, onToolCall() {} }), /before completion/);
});

test('cancellation after a native call prevents dispatching subsequent model tools', async () => {
  const controller = new AbortController();
  let writes = 0;
  const response = api('doc.insert', { value: 'First' });
  response.tool_calls.push(...api('doc.insert', { value: 'Second' }).tool_calls);
  const h = harness([response], { async insert() { writes++; controller.abort(new Error('Stopped.')); return { receipt: { success: true } }; } });
  await assert.rejects(h.agent.run(h.document, 'Write two items.', [], false, controller.signal), /Stopped/);
  assert.equal(writes, 1);
});

for (const reviewing of [false, true]) {
  test(`app citation-library tools remain available in ${reviewing ? 'Reviewing' : 'Editing'}`, async () => {
    const calls = [];
    const h = harness([
      call('superdoc_references', { action: 'create', type: 'report', fields: { title: 'Saved app source' }, expectedRevision: '1' }),
      call('superdoc_references', { action: 'update', sourceId: 'saved', fields: { year: '2026' }, expectedRevision: '2' }),
      call('superdoc_references', { action: 'delete', sourceId: 'saved', expectedRevision: '3' }),
      { content: 'Library updated.' },
    ], {}, {
      async manageReferences(input) { calls.push(input); return { success: true, evaluatedRevision: String(calls.length + 1) }; },
    });
    await h.agent.run(h.document, 'Manage the library without inserting document content.', [], reviewing, signal());
    assert.deepEqual(calls.map((c) => c.action), ['create', 'update', 'delete']);
    assert.ok(calls.every((c) => !Object.hasOwn(c, 'changeMode')));
    assert.match(h.requests[0].messages[0].content, /permitted in both modes/);
  });
}

test('app library context includes imported source identities and refreshes each turn', async () => {
  let title = 'Imported source';
  const h = harness([{ content: 'Found the source.' }, { content: 'Found the updated source.' }], {}, {
    async citationSources() { return { items: [{ sourceId: 'WordTag', tag: 'WordTag', fields: { title } }], evaluatedRevision: title }; },
  });
  await h.agent.run(h.document, 'List references.', [], true, signal());
  const context = h.requests[0].messages.at(-2).content;
  assert.match(context, /WordTag/);
  assert.match(context, /Imported source/);
  title = 'Updated source';
  await h.agent.run(h.document, 'List references again.', [], true, signal());
  assert.match(h.requests[1].messages.at(-2).content, /Updated source/);
});

test('invalid library mutations cannot bypass source validation', async () => {
  let calls = 0;
  const h = harness([call('superdoc_references', { action: 'create', fields: { title: 'Missing type and revision' } }),
    { content: 'Invalid source request.' }], {}, { async manageReferences() { calls++; } });
  await h.agent.run(h.document, 'Create a source.', [], true, signal());
  assert.equal(calls, 0);
  assert.match(h.requests[1].messages.at(-1).content, /expectedRevision/);
});
