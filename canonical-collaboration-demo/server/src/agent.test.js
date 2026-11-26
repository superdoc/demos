import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentAgent } from './agent.js';
import { createReferenceToolkit } from './reference-integration/reference-document.js';
import { createRunProgress, toolFailed } from './reference-integration/agent/agent-run-progress.js';
import { explicitlyReadOnly, isRelativePassageEdit } from './agent-turn-policy.js';

function harness(responses, { client: responsesClient, model = 'gpt-5-mini' } = {}) {
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
      .map((name) => ({ type: 'function', function: { name } })) }) }, { client: responsesClient ?? client, model });
  return { agent, document, requests, dispatches };
}
let id = 0;

test('read-only and relative edit guards respect complete instructions and compound requests', () => {
  for (const prompt of [
    'Remember this clause for later.',
    'In chat only, give me a possible rewrite.',
    'Check whether the gate clause is bold.',
    'What did you remember about the clause, including its formatting?',
  ]) assert.equal(explicitlyReadOnly(prompt), true, prompt);
  for (const prompt of [
    'Remember this clause for later and delete it.',
    'Check whether it is bold and fix it if needed.',
    'Write a paragraph containing “in chat only”.',
    'Insert this sentence: “Do not edit the document.”',
  ]) assert.equal(explicitlyReadOnly(prompt), false, prompt);
  for (const prompt of ['Make it bold.', 'Delete it.', 'Rewrite that clause to “The gate opens at dawn.”']) {
    assert.equal(isRelativePassageEdit(prompt), true, prompt);
  }
  for (const prompt of ['Make every mention bold.', 'Make it bold and add a table.', 'Should we make it bold?']) {
    assert.equal(isRelativePassageEdit(prompt), false, prompt);
  }
});

test('a read-only chat request blocks streamed edits and any native batch containing a write', async () => {
  const h = harness([
    (request) => {
      assert.ok(!request.tools.some(({ function: { name } }) => name === 'superdoc_stream_text' || name === 'superdoc_perform_action'));
      return call('superdoc_api_call', { calls: [
        { operationId: 'doc.getText', args: {} },
        { operationId: 'doc.delete', args: {} },
      ] });
    },
    call('superdoc_stream_text', { mode: 'append', anchor: null, story: null, text: 'Unrequested edit' }),
    { content: 'Here is a possible rewrite for your review.' },
  ]);
  h.document.createTextStream = () => assert.fail('Read-only turns must not create a writer.');
  const answer = await h.agent.run(h.document, 'In chat only, give me a possible rewrite.', [], false, new AbortController().signal);
  assert.equal(answer, 'Here is a possible rewrite for your review.');
  assert.deepEqual(h.dispatches, []);
});

test('saved passages stay private to a chat and reset when the document is replaced', async () => {
  const save = call('document_memory', { operation: 'save', name: 'Payment', quote: null, placement: null });
  const recall = call('document_memory', { operation: 'recall', name: null, quote: null, placement: null });
  const checkRecall = (names) => (request) => {
    const result = JSON.parse(request.messages.at(-1).content);
    assert.deepEqual(result.saved.map(({ name }) => name), names);
    return { content: names.length ? 'I saved Payment.' : 'Nothing has been saved.' };
  };
  const h = harness([
    save, { content: 'Saved Payment.' },
    recall, checkRecall([]),
    recall, checkRecall(['Payment']),
    recall, checkRecall([]),
  ]);
  h.document.generation = 1;
  h.document.findAgentPassage = async (text, selection) => {
    assert.equal(text, 'Pay at dusk.');
    assert.deepEqual(selection, { blockId: 'block', start: 0, end: 12 });
    return { text };
  };
  h.document.readAgentPassage = async ({ text }) => ({ text, inline: { bold: true }, mixed: [] });
  const first = [];
  const second = [];
  const signal = new AbortController().signal;
  await h.agent.run(h.document, 'Remember this clause for later.', first, false, signal, {
    selectedText: 'Pay at dusk.',
    documentTarget: { selection: { blockId: 'block', start: 0, end: 12 } },
  });
  await h.agent.run(h.document, 'What did you remember?', second, false, signal);
  await h.agent.run(h.document, 'What did you remember?', first, false, signal);
  h.document.generation++;
  await h.agent.run(h.document, 'What did you remember?', first, false, signal);
  assert.deepEqual(h.dispatches, []);
});

test('a relative revision stays in chat after a chat-only draft', async () => {
  const h = harness([(request) => {
    assert.match(request.messages[0].content, /Apply this follow-up to that draft in chat/);
    assert.ok(!request.tools.some(({ function: { name } }) => name === 'superdoc_stream_text'));
    return { content: '**Pay at dusk.**' };
  }]);
  const history = [
    { role: 'user', content: 'In chat only, write a payment clause.' },
    { role: 'assistant', content: 'Pay at dusk.' },
  ];
  const answer = await h.agent.run(h.document, 'Make it bold.', history, false, new AbortController().signal);
  assert.equal(answer, '**Pay at dusk.**');
  assert.deepEqual(h.dispatches, []);
});

test('GPT-5.5 uses medium reasoning with image input and preserves reasoning across streamed document tool calls', async () => {
  const requests = [];
  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'encrypted-test-context' };
  const commentary = { type: 'message', role: 'assistant', phase: 'commentary', content: [] };
  const toolCall = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'superdoc_inspect', arguments: '{}' };
  const client = { responses: { async *create(request) {
    requests.push(request);
    if (requests.length === 1) {
      yield { type: 'response.output_item.added', output_index: 1, item: commentary };
      yield { type: 'response.output_text.delta', output_index: 1, delta: 'I’ll inspect the document.' };
      yield { type: 'response.output_item.added', output_index: 2, item: { ...toolCall, arguments: '' } };
      yield { type: 'response.function_call_arguments.delta', output_index: 2, delta: '{' };
      yield { type: 'response.output_item.done', output_index: 2, item: toolCall };
      yield { type: 'response.completed', response: { output: [reasoning, commentary, toolCall] } };
    } else {
      yield { type: 'response.output_text.delta', output_index: 0, delta: 'Here’s the comparison.' };
      yield { type: 'response.completed', response: { output: [] } };
    }
  } } };
  const h = harness([], { client, model: 'gpt-5.5' });
  const image = 'data:image/png;base64,dGVzdA==';
  const history = [];
  const deltas = [];
  await h.agent.run(h.document, 'Compare the image with the document.', history, false, new AbortController().signal, {
    attachment: { kind: 'image', src: image, name: 'image.png' },
    onTextDelta: (delta) => deltas.push(delta),
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].reasoning, { effort: 'medium' });
  assert.equal(requests[0].store, false);
  assert.deepEqual(requests[0].include, ['reasoning.encrypted_content']);
  assert.ok(requests[0].tools.some((tool) => tool.type === 'function' && tool.name === 'superdoc_inspect'));
  assert.deepEqual(requests[0].input.at(-1).content.at(-1), { type: 'input_image', image_url: image, detail: 'auto' });
  assert.deepEqual(requests[1].input.slice(-4, -1), [reasoning, commentary, toolCall]);
  assert.equal(requests[1].input.at(-1).type, 'function_call_output');
  assert.equal(requests[1].input.at(-1).call_id, toolCall.call_id);
  assert.deepEqual(h.dispatches.map(({ tool }) => tool), ['superdoc_inspect']);
  assert.deepEqual(deltas, ['Here’s the comparison.']);
  assert.equal(history.at(-1).content, 'Here’s the comparison.');
});

test('a reusable prompt reads the document and cannot mutate it through a tool call', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { default: JSZip } = await import('jszip');
  const snapshot = new JSZip();
  snapshot.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/><w:color w:val="008000"/></w:rPr><w:t>Dragon</w:t></w:r></w:p></w:body></w:document>');
  const source = 'Sir Eamon walked east.\n\n| Passage | Armory |\n|---|---|\n| Dragon | Sword |\n\n1. Draw the sword.\n2. Return west.';
  const h = harness([
    (request) => {
      assert.equal(request.tool_choice.function.name, 'superdoc_inspect');
      assert.deepEqual(request.tools.map(({ function: fn }) => fn.name), [
        'superdoc_inspect', 'superdoc_api_search', 'superdoc_api_call',
      ]);
      assert.ok(!request.messages.some(({ content }) => content === 'Earlier private chat.'));
      return call('superdoc_inspect', {});
    },
    (request) => {
      const inspection = JSON.parse(request.messages.at(-1).content);
      assert.equal(inspection.markdown, source);
      assert.deepEqual(inspection.inlineFormatting, {
        runs: [{ part: 'document.xml', text: 'Dragon', styles: { b: true, color: '008000' } }],
      });
      return call('superdoc_api_call', { calls: [
        { operationId: 'doc.blocks.list', args: {} },
        { operationId: 'doc.tables.delete', args: {} },
      ] });
    },
    call('superdoc_stream_text', { mode: 'append', anchor: null, story: null, text: 'Unrequested edit' }),
    { content: 'Preserve the dungeon map and end at the armory choices.' },
  ]);
  const dispatch = h.document.dispatch;
  h.document.dispatch = (tool, args, options) => args.operationId === 'doc.getMarkdown' ? source : dispatch(tool, args, options);
  h.document.save = async (filename) => writeFile(filename, await snapshot.generateAsync({ type: 'nodebuffer' }));
  h.document.createTextStream = () => assert.fail('A reusable prompt must never stream text into the document.');
  const history = [{ role: 'user', content: 'Earlier private chat.' }];
  const answer = await h.agent.run(h.document, 'Create a reusable prompt', history, false, new AbortController().signal, { reusablePrompt: true });
  assert.match(answer, /^Recreate the full document below from scratch/);
  assert.ok(answer.includes('Preserve the dungeon map and end at the armory choices.'));
  assert.ok(answer.includes(source));
  assert.deepEqual(h.dispatches.map(({ tool }) => tool), ['superdoc_inspect']);
  assert.equal(history.at(-1).content, answer);
});

test('a repeated formatting rule guides later edits without repeating the completed edit', async () => {
  const format = { action: 'format_text', targetText: 'dragon', bold: true, color: '#008000' };
  const text = 'The dragon circled the tower.';
  const selector = { kind: 'nodeId', nodeId: 'new-paragraph' };
  const original = 'Make every mention of dragon bold and green.';
  const followup = "Make sure you do that for every mention of dragon, just like you've done for Sir Eamon.";
  const h = harness([
    call('superdoc_perform_action', format),
    { content: 'I made all three mentions of “dragon” bold and green.' },
    (request) => {
      const [system, user, assistant] = request.messages;
      assert.match(system.content, /acknowledge it as guidance for future edits\. Do not repeat the edit/);
      assert.match(system.content, /asks to check or verify existing formatting, inspect it and report/);
      assert.equal(user.content, original);
      assert.match(assistant.content, /all three mentions/);
      return { content: 'I’ll keep future mentions of “dragon” bold and green.' };
    },
    (request) => {
      assert.ok(request.messages.some(({ role, content }) => role === 'user' && content === followup));
      assert.match(request.messages[0].content, /apply it to new or changed text/);
      return call('superdoc_stream_text', { mode: 'append', anchor: null, text });
    },
    call('superdoc_perform_action', { ...format, selector }),
    { content: 'Formatted “dragon” in the new sentence.' },
  ]);
  const history = [];
  const signal = new AbortController().signal;
  await h.agent.run(h.document, original, history, false, signal);
  await h.agent.run(h.document, followup, history, false, signal);
  assert.equal(h.dispatches.length, 1);
  await h.agent.run(h.document, `Append a paragraph that says “${text}”`, history, false, signal);
  assert.deepEqual(h.dispatches.map(({ tool }) => tool), [
    'superdoc_perform_action', 'superdoc_stream_text', 'superdoc_perform_action',
  ]);
  assert.equal(h.dispatches[1].args.text, text);
  assert.deepEqual(h.dispatches[2].args, { ...format, selector, changeMode: 'direct' });
});

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
  assert.match(answer, /I couldn’t finish this request/);
  assert.match(answer, /Saved reference "First report"/);
  assert.match(answer, /Saved reference "Second report"/);
  assert.doesNotMatch(answer, /superdoc_api_call|doc\.citations\.insert|Citation target is required/);
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
  assert.match(answer, /I couldn’t finish this request/);
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

test('a DOCX attachment can be copied verbatim at the captured cursor without echoing the text through the model', async () => {
  const { readFile } = await import('node:fs/promises');
  const { readAttachment } = await import('./agent-input.js');
  const docx = await readFile(new URL('../assets/contract.docx', import.meta.url));
  const attachment = readAttachment({ name: 'contract.docx', kind: 'file', base64: docx.toString('base64') });
  const cursor = { blockId: 'cursor-paragraph', offset: 14, paragraph: '[]' };
  const h = harness([{
    tool_calls: [{ id: 'copy', type: 'function', function: {
      name: 'copy_attached_file_text', arguments: '{"placement":"cursor"}',
    } }],
  }, { content: 'Copied.' }]);
  h.document.insertAgentText = async (text, target, changeMode, placement) => {
    assert.match(text, /^Mutual Agreement for Document Excellence\nA Manifesto/);
    assert.match(text, /SuperDoc’s Approach/);
    assert.deepEqual(target, cursor);
    assert.equal(changeMode, 'tracked');
    assert.equal(placement, 'cursor');
    return { success: true };
  };
  const history = [];
  await h.agent.run(h.document, 'Copy the attached file here.', history, true, new AbortController().signal, {
    attachment, documentTarget: { id: 'current', generation: 1, cursor },
  });
  const request = h.requests[0];
  assert.ok(request.tools.some(({ function: fn }) => fn.name === 'get_document_cursor'));
  assert.match(request.messages.at(-1).content[1].text, /Attached file \(quoted data\)/);
  assert.deepEqual(history[0], { role: 'user', content: 'Copy the attached file here.' });
});
