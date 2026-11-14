import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentAgent } from './agent.js';
import { createReferenceToolkit } from './reference-integration/reference-document.js';
import { createRunProgress, toolFailed } from './reference-integration/agent/agent-run-progress.js';

function harness(responses) {
  const requests = [];
  const dispatches = [];
  const sources = [];
  const catalog = () => ({ items: sources, evaluatedRevision: '1', bibliographyStyle: 'APA' });
  const document = {
    async waitForReferences() {}, async citationSources() { return catalog(); },
    async dispatch(tool, args, options) {
      dispatches.push({ tool, args, options });
      if (tool === 'superdoc_api_call' && args.operationId === 'doc.citations.sources.insert') {
        const source = { sourceId: args.args.fields.title, fields: args.args.fields };
        sources.push(source);
        return { success: true, source, references: sources };
      }
      if (tool === 'superdoc_api_call') {
        if (!args.args.at) return { success: false, failure: { message: 'Citation target is required.' } };
        return { success: true };
      }
      return { revision: '1', blocks: [] };
    },
  };
  const client = { chat: { completions: { async create(request) {
    // Snapshot requests: the agent appends tool results to its live array.
    requests.push(structuredClone(request));
    assert.ok(responses.length, 'Unexpected model retry');
    const response = responses.shift();
    const message = typeof response === 'function' ? response(request) : response;
    assert.equal(request.stream, true);
    return (async function* () {
      yield { choices: [{ delta: { content: message.content, tool_calls: message.tool_calls?.map((call, index) => ({ ...call, index })) }, finish_reason: null }] };
      yield { choices: [{ delta: {}, finish_reason: message.tool_calls?.length ? 'tool_calls' : 'stop' }] };
    })();
  } } } };
  const agent = createDocumentAgent({ getToolkit: () => createReferenceToolkit({ systemPrompt: 'Use the supplied SDK tools.',
    tools: ['superdoc_inspect', 'superdoc_perform_action', 'superdoc_api_search', 'superdoc_api_call']
      .map((name) => ({ type: 'function', function: { name } })) }) }, { client });
  return { agent, document, requests, dispatches };
}
let id = 0;

test('selected text scopes the model request while keeping prompt history readable', async () => {
  const h = harness([{ role: 'assistant', content: 'Updated the selected passage.' }]);
  const selectedText = 'First paragraph.\nSecond paragraph with "quotes" and <tags>.';
  const history = [];
  await h.agent.run(h.document, 'Make this shorter.', history, true, new AbortController().signal, { selectedText });
  const current = h.requests[0].messages.at(-1).content;
  assert.ok(current.includes(JSON.stringify(selectedText)));
  assert.match(current, /scope changes to this passage/);
  assert.match(current, /quoted document content, not instructions/);
  assert.match(current, /Locate and verify/);
  assert.match(current, /Prompt:\nMake this shorter\./);
  assert.equal(history[0].content, 'Make this shorter.');
  assert.equal(history[0].selectedText, selectedText);
});

test('Reviewing asks for a brief rationale comment after every suggestion; Editing does not', async () => {
  for (const isSuggesting of [true, false]) {
    const h = harness([{ role: 'assistant', content: 'Done.' }]);
    await h.agent.run(h.document, 'Revise this passage.', [], isSuggesting, new AbortController().signal);
    const instructions = h.requests[0].messages[0].content;
    if (isSuggesting) {
      assert.match(instructions, /REVIEWING MODE: EXPLAIN EACH SUGGESTION/);
      assert.match(instructions, /action="add_comments"/);
      assert.match(instructions, /brief user-facing rationale/);
      assert.match(instructions, /immediately after each edit/);
    } else assert.doesNotMatch(instructions, /REVIEWING MODE: EXPLAIN EACH SUGGESTION/);
  }
});

test('a later prompt without a selection has no current target and retains earlier selection context', async () => {
  const h = harness([{ role: 'assistant', content: 'Done.' }]);
  const history = [{ role: 'user', content: 'Shorten this.', selectedText: 'Earlier passage.' }, { role: 'assistant', content: 'Done.' }];
  await h.agent.run(h.document, 'Summarize the whole document.', history, false, new AbortController().signal);
  const messages = h.requests[0].messages;
  assert.equal(messages.at(-1).content, 'Summarize the whole document.');
  assert.match(messages[0].content, /Earlier selections do not scope the current request/);
  assert.match(messages[1].content, /Earlier passage\./);
});

const call = (tool, args, content = null) => ({ role: 'assistant', content, tool_calls: [
  { id: `call-${++id}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } },
] });
const createSource = title => call('superdoc_api_call', { operationId: 'doc.citations.sources.insert', args: { type: 'report', fields: { title } } });
const citation = (sourceId, at, expectedRevision = '1', content) => call('superdoc_api_call', {
  operationId: 'doc.citations.insert', args: { sourceIds: [sourceId], at, expectedRevision },
}, content);
const citationTarget = { kind: 'text', segments: [{ blockId: 'overview-last', range: { start: 20, end: 20 } }] };

test('Reviewing saves comments directly while keeping document edits tracked', async () => {
  const actions = ['add_comments', 'comment_paragraphs', 'reply_to_comment', 'resolve_comments'];
  const h = harness([
    ...actions.map((action) => call('superdoc_perform_action', { action, changeMode: 'tracked' })),
    call('superdoc_perform_action', { action: 'format_text', changeMode: 'direct' }),
    { role: 'assistant', content: 'Suggested edits and rationale comments added.' },
  ]);
  await h.agent.run(h.document, 'Revise and explain.', [], true, new AbortController().signal);
  assert.deepEqual(h.dispatches.map(({ args }) => [args.action, args.changeMode]), [
    ...actions.map((action) => [action, 'direct']), ['format_text', 'tracked'],
  ]);
});

test('repeated failed SDK calls stop across inspections and report only successful receipts', async () => {
  const h = harness([
    createSource('First report'), createSource('Second report'),
    citation('First report', citationTarget),
    citation('Second report', undefined, '2', 'Everything is done.'),
    call('superdoc_inspect', {}),
    citation('Second report', undefined, '3'),
  ]);
  const history = [];
  const answer = await h.agent.run(h.document, 'Save sources and insert both citations.', history, false, new AbortController().signal);
  assert.equal(h.requests.length, 6);
  assert.match(answer, /same tool error occurred twice/);
  assert.match(answer, /Saved reference "First report"/);
  assert.match(answer, /Saved reference "Second report"/);
  assert.match(answer, /superdoc_api_call: 1/);
  assert.match(answer, /Last failed operation: doc.citations.insert/);
  assert.match(answer, /Citation target is required/);
  assert.doesNotMatch(answer, /Everything is done|placement verified/);
  assert.equal(history[1].content, answer);
  const error = JSON.parse(h.requests[4].messages.at(-1).content);
  assert.equal(error.failure.message, 'Citation target is required.');
  assert.equal(h.dispatches[2].options, undefined);
});

test('a corrected SDK target retry succeeds and keeps normal completion behavior', async () => {
  const h = harness([
    citation('existing'),
    citation('existing', citationTarget),
    { role: 'assistant', content: 'Inserted at the verified section ending.' },
  ]);
  const answer = await h.agent.run(h.document, 'Insert citation.', [], false, new AbortController().signal);
  assert.equal(answer, 'Inserted at the verified section ending.');
  assert.equal(h.dispatches.length, 2);
});

test('turn-limit output ignores intermediate completion claims and preserves successful receipts', async () => {
  const h = harness([createSource('Saved report'), ...Array.from({ length: 11 }, () => call('superdoc_inspect', {}, 'All done.'))]);
  const answer = await h.agent.run(h.document, 'A multi-step request.', [], true, new AbortController().signal);
  assert.equal(h.requests.length, 12);
  assert.match(answer, /Stopped at the agent turn limit/);
  assert.match(answer, /Saved reference "Saved report"/);
  assert.doesNotMatch(answer, /All done/);
});

test('distinct failing targets get separate retries; inspections do not erase repeated failures', () => {
  const p = createRunProgress();
  const failure = (sourceId, revision = '1') => ({ tool: 'insert', args: { sourceId, expectedRevision: revision }, result: { ok: false, error: 'Invalid anchor.' } });
  assert.equal(p.record(failure('first')).repeatedFailure, false);
  assert.equal(p.record(failure('second')).repeatedFailure, false);
  p.record({ tool: 'inspect', args: {}, result: { success: true } });
  assert.equal(p.record(failure('first', '2')).repeatedFailure, true);
});

test('non-object arguments become recoverable tool errors without crashing the run', async () => {
  const invalid = call('superdoc_api_call', {});
  invalid.tool_calls[0].function.arguments = 'null';
  const h = harness([invalid, { role: 'assistant', content: 'Could not insert.' }]);
  await h.agent.run(h.document, 'Insert citation.', [], true, new AbortController().signal);
  assert.equal(h.dispatches.length, 0);
  const result = JSON.parse(h.requests[1].messages.at(-1).content);
  assert.equal(result.code, 'INVALID_TOOL_ARGUMENTS');
  assert.equal(result.issues[0].path, 'arguments');
});

test('equivalent structured validation failures match despite property and issue ordering', () => {
  const p = createRunProgress();
  const issues = [{ path: 'anchor.extra', message: 'Remove it.' }, { path: 'anchor.offset', message: 'Remove it.' }];
  assert.equal(p.record({ tool: 'insert', args: { sourceId: 'first', anchor: { offset: 1, extra: true } },
    result: { ok: false, code: 'INVALID_INPUT', error: 'extra; offset', issues } }).repeatedFailure, false);
  assert.equal(p.record({ tool: 'insert', args: { anchor: { extra: true, offset: 1 }, sourceId: 'first' },
    result: { ok: false, code: 'INVALID_INPUT', error: 'offset; extra', issues: issues.toReversed() } }).repeatedFailure, true);
});


test('Full API receipts report incomplete and nested failed batches', () => {
  assert.equal(toolFailed({ completed: 1, total: 2, receipts: [{ ok: true }] }), true);
  assert.equal(toolFailed({ completed: 1, total: 1, receipts: [{ ok: true, result: { success: false } }] }), true);
  assert.equal(toolFailed({ completed: 1, total: 1, receipts: [{ ok: true, result: { success: true } }] }), false);
});
