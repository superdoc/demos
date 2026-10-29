import assert from 'node:assert/strict';
import test from 'node:test';
import { partialTextArguments, streamCompletion } from './reference-integration/agent/stream-completion.js';
import { createTextStream } from './reference-integration/native/stream-text.js';
import { streamingTools, nonStreamingTextActions } from './reference-integration/agent/streaming-policy.js';
import { createReferenceAgentAdapter } from './reference-integration/agent/reference-agent-adapter.js';

const chunk = (delta, finish_reason = null) => ({ choices: [{ delta, finish_reason }] });
const tool = (arguments_, first = false) => chunk({ tool_calls: [{ index: 0,
  ...(first ? { id: 'call_stream', type: 'function', function: { name: 'superdoc_stream_text', arguments: arguments_ } }
    : { function: { arguments: arguments_ } }) }] });

function fixture(chunks, controller = new AbortController()) {
  const updates = [];
  const text = [];
  const statuses = [];
  const writer = { async update(args) { updates.push(structuredClone(args)); }, async commit() {} };
  let request;
  const client = { chat: { completions: { async create(input) {
    request = input;
    return (async function* () { for (const event of chunks) yield event; })();
  } } } };
  const options = { signal: controller.signal, changeMode: 'tracked', document: { createTextStream(options) {
    assert.equal(options.changeMode, 'tracked'); return writer;
  } }, onTextDelta: (value) => text.push(value), onToolCall: (value) => statuses.push(value) };
  return { client, options, updates, text, statuses, writer, get request() { return request; } };
}

test('argument decoding handles every split point, escaped quotes, backslashes and Unicode', () => {
  const input = { mode: 'replace', anchor: 'Original "quote"', text: 'Café "quoted" \\ path 😀 and more' };
  const json = JSON.stringify(input);
  for (let split = 0; split <= json.length; split++) {
    const partial = partialTextArguments(json.slice(0, split));
    if (partial) {
      assert.equal(partial.mode, input.mode);
      assert.equal(partial.anchor, input.anchor);
      assert.ok(input.text.startsWith(partial.text));
      assert.doesNotMatch(partial.text, /[\uD800-\uDBFF]$/);
    }
  }
  assert.deepEqual(partialTextArguments(json), input);
  assert.equal(partialTextArguments('{"text":"untrusted prefix"'), undefined);
  assert.equal(partialTextArguments('{"mode":"replace","other":true,"text":"x'), undefined);
});

test('OpenAI text deltas reach the response callback immediately', async () => {
  const h = fixture([chunk({ content: 'Hello ' }), chunk({ content: 'world' }), chunk({}, 'stop')]);
  const result = await streamCompletion(h.client, { model: 'test' }, h.options);
  assert.deepEqual(h.text, ['Hello ', 'world']);
  assert.equal(result.choice.content, 'Hello world');
  assert.equal(h.request.stream, true);
  assert.equal(h.request.parallel_tool_calls, false);
});

test('document text streams before tool completion, and fragmented arguments reconstruct exactly', async () => {
  const json = JSON.stringify({ mode: 'append', anchor: null, text: 'A long streamed paragraph that arrives in several chunks and ends with "quotes".' });
  const events = [...json].map((letter, index) => tool(letter, index === 0));
  events.push(chunk({}, 'tool_calls'));
  const h = fixture(events);
  const result = await streamCompletion(h.client, {}, h.options);
  assert.ok(h.updates.length >= 2, 'Document must receive intermediate updates');
  assert.ok(h.updates[0].text.length < JSON.parse(json).text.length);
  assert.equal(result.choice.tool_calls[0].function.arguments, json);
  assert.equal(result.writers.get('call_stream'), h.writer);
  assert.equal(h.statuses.length, 1);
  assert.equal(h.statuses[0].status, 'generating');
});

test('interrupted and cancelled streams do not commit or silently report success', async () => {
  for (const finish of [undefined, 'length', 'content_filter']) {
    const events = [tool('{"mode":"append","anchor":null,"text":"Partial text', true)];
    if (finish) events.push(chunk({}, finish));
    const h = fixture(events);
    await assert.rejects(streamCompletion(h.client, {}, h.options), /stream ended before completion.*already streamed/);
    assert.equal(h.updates[0].text, 'Partial text');
  }
  const controller = new AbortController();
  const h = fixture([tool('{"mode":"append","anchor":null,"text":"Partial text', true), chunk({}, 'tool_calls')], controller);
  h.writer.update = async () => controller.abort(new Error('Stopped by user'));
  await assert.rejects(streamCompletion(h.client, {}, h.options), /Stopped by user/);
});

test('bibliography policy prevents early streaming mutations before tool dispatch', async () => {
  const h = fixture([tool('{"mode":"append","anchor":null,"text":"Fake bibliography"}', true), chunk({}, 'tool_calls')]);
  await streamCompletion(h.client, {}, { ...h.options, streamTextEnabled: false });
  assert.deepEqual(h.updates, []);
});

test('native writer replaces once then inserts only suffixes and verifies the target before each update', async () => {
  const writes = [];
  let current = 'Original passage';
  const point = (offset) => ({ kind: 'text', blockId: 'block', offset });
  const handle = {
    blocks: { async list() { return { revision: '7' }; } },
    query: { async match({ select }) {
      assert.equal(select.pattern, current);
      return { total: 1, items: [{ address: { kind: 'block', nodeType: 'paragraph', nodeId: 'block' },
        target: { kind: 'selection', start: point(0), end: point(current.length) } }] };
    } },
    async replace(args) { writes.push(['replace', args]); current = args.text; return { receipt: { success: true } }; },
    async insert(args) { writes.push(['insert', args]); current += args.value; return { receipt: { success: true } }; },
  };
  const stream = createTextStream(handle, { changeMode: 'tracked' });
  const args = { mode: 'replace', anchor: 'Original passage' };
  await stream.update({ ...args, text: 'New' });
  await stream.update({ ...args, text: 'New paragraph' });
  await stream.commit({ ...args, text: 'New paragraph.' });
  assert.deepEqual(writes.map(([kind, args]) => [kind, args.text ?? args.value]), [['replace', 'New'], ['insert', ' paragraph'], ['insert', '.']]);
  assert.ok(writes.every(([, args]) => args.changeMode === 'tracked' && args.expectedRevision === '7'));
  await assert.rejects(stream.update({ ...args, text: 'Changed prefix' }), /already streamed prefix/);
  await assert.rejects(stream.update({ ...args, text: 'New paragraph.\nAnother paragraph' }), /plain text/);
});

test('text-write alternatives are absent from the advertised actions without mutating the SDK schema', () => {
  const actions = [...nonStreamingTextActions, 'format_text', 'apply_style', 'create_table'];
  const original = { type: 'function', function: { name: 'superdoc_perform_action', description: 'Keep native table guidance.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: actions } } } } };
  const filtered = streamingTools([original])[0];
  assert.deepEqual(filtered.function.parameters.properties.action.enum, ['format_text', 'apply_style', 'create_table']);
  assert.deepEqual(original.function.parameters.properties.action.enum, actions);
  assert.match(filtered.function.description, /Keep native table guidance/);
});

test('stale non-streaming calls cannot bypass host policy; native structure and streaming still dispatch', async () => {
  const dispatched = [];
  const document = { async waitForReferences() {}, async citationSources() { return { items: [] }; },
    async dispatch(tool, args) { dispatched.push({ tool, args }); return { success: true }; } };
  const adapter = await createReferenceAgentAdapter({ document, toolkit: { tools: [], systemPrompt: '' }, prompt: 'Rewrite this.', changeMode: 'tracked' });
  for (const action of nonStreamingTextActions) {
    const result = await adapter.execute('superdoc_perform_action', { action, text: 'New text' });
    assert.equal(result.failed, true);
    assert.match(result.result.error, /must stream through superdoc_stream_text/);
  }
  assert.deepEqual(dispatched, []);
  await adapter.execute('superdoc_stream_text', { mode: 'replace', anchor: 'Original', text: 'New text' });
  await adapter.execute('superdoc_perform_action', { action: 'apply_style', headingLevel: 1 });
  assert.equal(dispatched.length, 2);
  assert.ok(dispatched.every(({ args }) => args.changeMode === 'tracked'));
});

test('new paragraphs beside existing text stream into a newly created block', async () => {
  for (const [mode, kind] of [['paragraphBefore', 'before'], ['paragraphAfter', 'after']]) {
    const calls = [];
    let current = 'Existing paragraph';
    const oldBlock = { kind: 'block', nodeType: 'paragraph', nodeId: 'old' };
    const newBlock = { kind: 'block', nodeType: 'paragraph', nodeId: 'new' };
    const handle = {
      blocks: { async list() { return { revision: '4' }; } },
      query: { async match({ select, within }) {
        assert.equal(select.pattern, current);
        const address = within ? newBlock : oldBlock;
        return { total: 1, items: [{ address, target: { kind: 'selection', start: { kind: 'text', blockId: address.nodeId, offset: 0 }, end: { kind: 'text', blockId: address.nodeId, offset: current.length } } }] };
      } },
      create: { async paragraph(args) { calls.push(args); current = args.text; return { success: true, paragraph: newBlock }; } },
      async insert(args) { calls.push(args); current += args.value; return { receipt: { success: true } }; },
    };
    const writer = createTextStream(handle, { changeMode: 'tracked' });
    await writer.update({ mode, anchor: 'Existing paragraph', text: 'New' });
    await writer.commit({ mode, anchor: 'Existing paragraph', text: 'New paragraph' });
    assert.deepEqual(calls[0].at, { kind, target: oldBlock });
    assert.equal(calls[1].target.start.blockId, 'new');
    assert.equal(calls[1].value, ' paragraph');
    assert.equal(current, 'New paragraph');
  }
});
