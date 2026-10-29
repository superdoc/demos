import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentAgent } from './agent.js';
import { citationTool, citationInput } from './reference-integration/tools/citation-tool.js';
import { footnoteTool } from './reference-integration/tools/footnote-tool.js';
import { createRunProgress } from './reference-integration/agent/agent-run-progress.js';

function harness(responses) {
  const requests = [];
  const dispatches = [];
  const sources = [];
  const catalog = () => ({ items: sources, evaluatedRevision: '1', bibliographyStyle: 'APA' });
  const document = {
    async waitForReferences() {}, async citationSources() { return catalog(); },
    async dispatch(tool, args) {
      dispatches.push({ tool, args });
      if (tool === 'superdoc_references') {
        const source = { sourceId: args.fields.title, fields: args.fields };
        sources.push(source);
        return { success: true, source, references: sources };
      }
      if (tool === citationTool.function.name) {
        const { anchor } = citationInput(args);
        return { success: true, resolvedAnchor: { ...anchor, verified: true } };
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
  const agent = createDocumentAgent({ getToolkit: () => ({ systemPrompt: 'Use the supplied tools.', tools: [citationTool, footnoteTool] }) }, { client });
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
const createSource = (title) => call('superdoc_references', { action: 'create', type: 'report', fields: { title }, expectedRevision: '1' });
const citation = (sourceId, anchor, expectedRevision = '1', content) => call('superdoc_insert_citation', { sourceId, anchor, expectedRevision }, content);

test('repeated invalid anchors stop across inspections and report only successful mutations', async () => {
  const h = harness([
    createSource('First report'), createSource('Second report'),
    citation('First report', { kind: 'sectionEnd', sectionHeading: 'Overview' }),
    citation('Second report', { kind: 'sectionEnd' }, '2', 'Everything is done.'),
    call('superdoc_inspect', {}),
    citation('Second report', { kind: 'sectionEnd' }, '3'),
  ]);
  const history = [];
  const answer = await h.agent.run(h.document, 'Save sources and insert both citations.', history, true, new AbortController().signal);
  assert.equal(h.requests.length, 6);
  assert.match(answer, /same tool error occurred twice/);
  assert.match(answer, /Saved reference "First report"/);
  assert.match(answer, /Saved reference "Second report"/);
  assert.match(answer, /Inserted citation for "First report" at the end of "Overview" \(placement verified\)/);
  assert.match(answer, /Last failed operation: Insert citation for "Second report"/);
  assert.match(answer, /anchor.sectionHeading: Required non-empty string/);
  assert.doesNotMatch(answer, /Everything is done|Inserted citation for "Second report"/);
  assert.equal(history[1].content, answer);
  const error = JSON.parse(h.requests[4].messages.at(-1).content);
  assert.equal(error.code, 'INVALID_REFERENCE_ANCHOR');
  assert.equal(error.recovery.inspectRequired, false);
});

test('a corrected anchor retry succeeds and keeps normal completion behavior', async () => {
  const h = harness([
    citation('existing', { kind: 'sectionEnd' }),
    citation('existing', { kind: 'sectionEnd', sectionHeading: 'Overview' }),
    { role: 'assistant', content: 'Inserted at the verified section ending.' },
  ]);
  const answer = await h.agent.run(h.document, 'Insert citation.', [], true, new AbortController().signal);
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
  const invalid = call('superdoc_insert_citation', {});
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
