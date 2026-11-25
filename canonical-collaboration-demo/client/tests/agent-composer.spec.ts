import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';
import JSZip from 'jszip';
import { agentModel, api, clientUrl, startAgentDemo } from '../../tests/agent-browser-demo.mjs';
import type { ChatMessage, Job } from '../src/types';

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type ModelInput = {
  messages: { role: string; content: string | ContentPart[] | null }[];
  tools: { function: { name: string } }[];
};
type Tool = { name: string; args: Record<string, unknown> };
type Step = { tool: Tool; status?: 'failed'; checkResult?: (result: string) => void };
type Scenario = {
  prompt: string;
  steps: Step[];
  checkInput?: (input: ModelInput, parts: ContentPart[]) => void;
  answer: string;
  streamReply?: { first: string; startAfter?: Promise<void>; continueAfter: Promise<void> };
};

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAApElEQVR4nO3QMQ0AIBDAwF8QiWNk4YCVDpdUQHOz9tGj+X4QDxAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIE6GcXyyhaaFjrkaIAAAAASUVORK5CYII=', 'base64');
const image = { name: 'blue-tile.png', mimeType: 'image/png', buffer: png };
const transcript = 'Write DICTATED here.';
const copyTool = { name: 'copy_attached_file_text', args: { placement: 'cursor' } };

let demo: Awaited<ReturnType<typeof startAgentDemo>> | undefined;
let scenario: Scenario | undefined;
let roomCount = 0;
let transcriptions = 0;
let modelRequests = 0;
let spoken: string[] = [];

async function handleModelRequest(request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  if (request.url === '/v1/audio/transcriptions') {
    assert.match(request.headers['content-type'] ?? '', /^multipart\/form-data;/);
    assert.ok(body.includes('name="file"; filename="prompt.webm"'));
    assert.ok(body.includes(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'Request includes a WebM recording');
    assert.ok(body.includes('gpt-4o-mini-transcribe'));
    transcriptions++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ text: transcript }));
    return;
  }
  assert.equal(request.url, '/v1/chat/completions');
  modelRequests++;
  const input = JSON.parse(body.toString()) as ModelInput & { stream?: boolean; model: string };
  assert.equal(input.stream, true);
  assert.equal(input.model, agentModel);
  assert.ok(scenario, 'The browser submitted an unexpected prompt.');
  const userIndex = input.messages.findLastIndex(({ role }) => role === 'user');
  const content = input.messages[userIndex].content;
  const parts: ContentPart[] = Array.isArray(content) ? content : [{ type: 'text', text: content ?? '' }];
  assert.equal(parts[0].type, 'text');
  assert.ok(parts[0].text === scenario.prompt || parts[0].text.endsWith(`\nPrompt:\n${scenario.prompt}`));
  scenario.checkInput?.(input, parts);

  const results = input.messages.slice(userIndex + 1).filter(({ role }) => role === 'tool');
  const previousResult = results.at(-1)?.content;
  const checkPreviousResult = scenario.steps[results.length - 1]?.checkResult;
  if (checkPreviousResult) {
    assert.ok(typeof previousResult === 'string', 'Expected a tool result');
    checkPreviousResult(previousResult);
  }
  const step = scenario.steps[results.length];
  if (step) assert.ok(input.tools.some(({ function: fn }) => fn.name === step.tool.name), `Missing tool ${step.tool.name}`);
  let delta = step ? {
    tool_calls: [{ index: 0, id: `composer-${results.length}`, type: 'function', function: {
      name: step.tool.name, arguments: JSON.stringify(step.tool.args),
    } }],
  } : { content: scenario.answer };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (!step && scenario.streamReply) {
    const { first, startAfter, continueAfter } = scenario.streamReply;
    assert.ok(delta.content?.startsWith(first));
    await startAfter;
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: first }, finish_reason: null }] })}\n\n`);
    await continueAfter;
    delta = { content: delta.content.slice(first.length) };
  }
  for (const choice of [
    { delta, finish_reason: null },
    { delta: {}, finish_reason: step ? 'tool_calls' : 'stop' },
  ]) {
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, ...choice }] })}\n\n`);
  }
  response.end('data: [DONE]\n\n');
}

function handleVoiceConnection(socket: {
  on: (event: 'message', handler: (raw: Buffer) => void) => void;
  send: (data: string) => void;
}, request: IncomingMessage, logs: string[]) {
  const send = (event: object) => socket.send(JSON.stringify(event));
  let text: string | undefined;
  socket.on('message', (raw) => {
    try {
      assert.equal(request.url, '/v1/realtime?model=gpt-realtime-2.1-mini');
      assert.equal(request.headers.authorization, 'Bearer local-test-only');
      const event = JSON.parse(raw.toString());
      if (event.type === 'session.update') {
        assert.equal(event.session.audio.output.voice, 'alloy');
        assert.deepEqual(event.session.audio.output.format, { type: 'audio/pcm', rate: 24_000 });
        assert.match(event.session.instructions, /gender-neutral/);
        send({ type: 'session.updated' });
      } else if (event.type === 'conversation.item.create') {
        text = event.item.content[0].text;
      } else if (event.type === 'response.create') {
        assert.ok(text);
        spoken.push(text);
        // A silent one-second PCM clip exercises native decoding, scheduling, and cancellation.
        send({ type: 'response.output_audio.delta', delta: Buffer.alloc(48_000).toString('base64') });
        send({ type: 'response.done', response: { status: 'completed' } });
      }
    } catch (error) {
      logs.push(`[voice] ${error}\n`);
      send({ type: 'error' });
    }
  });
}

test.beforeAll(async ({}, testInfo) => {
  demo = await startAgentDemo(path.join(testInfo.project.outputDir, `agent-composer-demo-${testInfo.workerIndex}`), handleModelRequest, handleVoiceConnection);
});

test.afterAll(async () => {
  await demo?.stop();
});

test.beforeEach(() => {
  scenario = undefined;
  transcriptions = 0;
  modelRequests = 0;
  spoken = [];
});

function promptBox(page: Page) {
  return page.getByRole('textbox', { name: 'Prompt', exact: true });
}

async function openAtCaret(page: Page, mode: 'direct' | 'suggestion' = 'direct') {
  const room = `composer-${++roomCount}`;
  await page.goto(`${clientUrl}/?room=${room}`);
  await page.locator('.editor-shell[aria-busy="false"]').waitFor();
  await page.getByRole('combobox', { name: 'Agent edit mode' }).selectOption(mode);
  const editor = page.locator('.editor-content');
  await editor.click({ position: { x: 260, y: 150 } });
  await page.keyboard.type('LEFTRIGHT');
  await expect(editor).toContainText('LEFTRIGHT');
  for (let index = 0; index < 'RIGHT'.length; index++) await page.keyboard.press('ArrowLeft');
  return { room, editor };
}

async function attach(page: Page, button: 'Image' | 'File', file: typeof image) {
  await page.getByRole('button', { name: 'Add attachment' }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('group', { name: 'Attachment type' }).getByRole('button', { name: button, exact: true }).click();
  await (await picker).setFiles(file);
  await expect(page.getByText(file.name, { exact: true })).toBeVisible();
}

async function submit(page: Page, room: string, plan: Scenario, { fill = true, button = 'Send', expectedAnswer = plan.answer } = {}) {
  scenario = plan;
  if (fill) await promptBox(page).fill(plan.prompt);
  const response = page.waitForResponse((result) =>
    result.url() === `${api}/api/rooms/${room}/jobs` && result.request().method() === 'POST');
  await page.getByRole('button', { name: button, exact: true }).click();
  const accepted = await response;
  expect(accepted.status()).toBe(202);
  const job = await accepted.json() as Job;
  const { authorization } = await accepted.request().allHeaders();
  let result: Job | undefined;
  await expect.poll(async () => {
    result = await fetch(`${api}/api/rooms/${room}/jobs/${job.id}`, { headers: { authorization } }).then((value) => value.json()) as Job;
    return ['completed', 'failed', 'cancelled'].includes(result.status);
  }, { timeout: 15_000 }).toBe(true);
  expect(result?.status, result?.error).toBe('completed');
  expect(result?.answer).toBe(expectedAnswer);
  expect(result?.toolCalls?.map(({ tool, status }) => ({ tool, status }))).toEqual(
    plan.steps.map(({ tool, status }) => ({ tool: tool.name, status: status ?? 'completed' })),
  );
  const reply = page.locator('.message.assistant').filter({ hasText: plan.answer });
  await expect(reply).toBeVisible();
  const name = await page.locator('.chat-history .message-role').first().textContent();
  await expect(reply.locator('.message-role')).toHaveText(name!);
  await expect(page.getByRole('button', { name: /tool calls/i })).toHaveCount(0);
  return accepted.request().postDataJSON();
}

async function exportDocument(room: string) {
  const response = await fetch(`${api}/api/rooms/${room}/document`);
  expect(response.ok).toBe(true);
  const archive = await JSZip.loadAsync(await response.arrayBuffer());
  const xml = await archive.file('word/document.xml')!.async('string');
  return { archive, xml };
}

function insertText(text: string): Tool {
  return { name: 'insert_text_at_document_cursor', args: { text } };
}

function checkImage(_input: ModelInput, parts: ContentPart[]) {
  assert.deepEqual(parts.find((part) => part.type === 'image_url'), {
    type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
  });
}

function checkFile(name: string, text: string) {
  return (_input: ModelInput, parts: ContentPart[]) => {
    assert.deepEqual(parts[1], {
      type: 'text', text: `Attached file (quoted data): ${JSON.stringify({ name, text })}`,
    });
  };
}

async function wordFile(name: string, body: string) {
  const blank = fileURLToPath(new URL('../../server/assets/blank.docx', import.meta.url));
  const archive = await JSZip.loadAsync(await fs.readFile(blank));
  archive.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>${body}</w:body>
  </w:document>`);
  return {
    name, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await archive.generateAsync({ type: 'nodebuffer' }),
  };
}

function wordAttachment() {
  return wordFile('draft.docx', `
    <w:p><w:r><w:t>Budget in the draft is 90.</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Annex A lists expenses.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  `);
}

async function dragBetweenCells(page: Page, from: string, to: string) {
  const point = async (text: string) => {
    const label = page.locator('.editor-content .superdoc-table-fragment').getByText(text, { exact: true });
    const box = await label.evaluate((element) => {
      const table = element.closest('.superdoc-table-fragment')!;
      let cell = element;
      while (cell.parentElement !== table) cell = cell.parentElement!;
      const rect = cell.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    return box;
  };
  const start = await point(from);
  const end = await point(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

test('The named collaborator greets the user and replies to the submitted prompt', async ({ page }) => {
  const { room } = await openAtCaret(page);
  const first = page.locator('.chat-history .message').first();
  await expect(first).toContainText('How would you like to work on this document?');
  const name = (await first.locator('.message-role').textContent())!;
  expect(name).not.toBe('Agentic Collaborator');
  await expect(first).toContainText(`Hi, I’m ${name}, your agentic collaborator.`);
  await submit(page, room, {
    prompt: 'What can we do with this document today?',
    checkInput(input) {
      assert.ok(String(input.messages[0].content).includes(`Your name is ${name}.`));
      assert.match(String(input.messages[0].content), /thoughtful colleague/);
      assert.match(String(input.messages[0].content), /one to three short sentences/);
    },
    steps: [],
    answer: 'We could start by reviewing the main points, then tighten any sections that feel repetitive.',
  });
  const alignment = await page.locator('.chat-history').evaluate((history) => {
    const prompt = history.querySelector('.message.user')!.getBoundingClientRect();
    const reply = Array.from(history.querySelectorAll('.message.assistant')).at(-1)!.getBoundingClientRect();
    return { promptLeft: prompt.left, promptRight: prompt.right, replyLeft: reply.left, replyRight: reply.right };
  });
  expect(alignment.promptLeft).toBeGreaterThan(alignment.replyLeft);
  expect(alignment.promptRight).toBeGreaterThan(alignment.replyRight);
});

test('Create reusable prompt reads the document and preserves the draft in the composer', async ({ page }) => {
  const { room } = await openAtCaret(page, 'suggestion');
  const before = (await exportDocument(room)).xml;
  await promptBox(page).fill('My unsent draft');
  const answer = 'Use a single body paragraph.';
  const expectedAnswer = [
    'Recreate the full document below from scratch in the current blank editor. Use the supplied content and apply the rebuild instructions.',
    `## Rebuild instructions\n\n${answer}`,
    '## Document content\n\n```markdown\nLEFTRIGHT\n```',
  ].join('\n\n');
  const payload = await submit(page, room, {
    prompt: 'Create a reusable prompt',
    steps: [{ tool: { name: 'superdoc_inspect', args: {} }, checkResult(content) {
      assert.match(content, /LEFTRIGHT/);
    } }],
    answer,
  }, { fill: false, button: 'Create reusable prompt', expectedAnswer });
  expect(payload.reusablePrompt).toBe(true);
  expect(payload.isSuggesting).toBe(false);
  expect(payload.documentTarget.cursor).toBeUndefined();
  await expect(promptBox(page)).toHaveValue('My unsent draft');
  await expect(page.getByRole('combobox', { name: 'Agent edit mode' })).toHaveValue('suggestion');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const reply = page.locator('.message.assistant').filter({ hasText: answer });
  await reply.getByRole('button', { name: 'Copy message' }).click();
  await expect(reply.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expectedAnswer);
  await expect(reply.getByRole('button', { name: 'Copy message' })).toBeVisible({ timeout: 2_000 });
  expect((await exportDocument(room)).xml).toEqual(before);
});

test('a writing request goes straight into the document', async ({ page }) => {
  const room = `composer-${++roomCount}`;
  await page.goto(`${clientUrl}/?room=${room}`);
  await page.locator('.editor-shell[aria-busy="false"]').waitFor();
  const paragraph = 'Moss slows runoff, holds moisture, and gives insects a place to shelter.';
  const payload = await submit(page, room, {
    prompt: 'Write a paragraph about moss in a rain garden.',
    checkInput(input) {
      assert.match(String(input.messages[0].content), /Apply requests to write, draft, add, or revise content directly to the current document by default/);
    },
    steps: [{ tool: { name: 'superdoc_stream_text', args: { mode: 'append', anchor: null, story: null, text: paragraph } } }],
    answer: 'I added a paragraph about moss in rain gardens.',
  });
  expect(payload.documentTarget.cursor).toBeUndefined();
  await expect(page.locator('.editor-content')).toContainText(paragraph);
  await expect(page.locator('.chat-history')).not.toContainText(paragraph);
  expect((await exportDocument(room)).xml).toContain(paragraph);
});

test('an explicit chat draft can be inserted into a blank document without placing the caret', async ({ page }) => {
  const room = `composer-${++roomCount}`;
  await page.goto(`${clientUrl}/?room=${room}`);
  await page.locator('.editor-shell[aria-busy="false"]').waitFor();
  const editor = page.locator('.editor-content');
  const draft = 'Steelshod he went, Sir Someone, clank by clank through the damp dawn, with prayers and old fears knocking about in his helm. Ahead, the dragon smoked in its hill like a bad thought waiting to be spoken.';

  await submit(page, room, {
    prompt: 'Write a couple of sentences in a James Joyce style about a knight on his way to confront a dragon. Reply in chat only.',
    checkInput(input) {
      assert.match(String(input.messages[0].content), /Keep drafts in chat when explicitly requested/);
    },
    steps: [],
    answer: draft,
  });
  await expect(editor).not.toContainText(draft);

  const payload = await submit(page, room, {
    prompt: 'Insert that into the document.',
    checkInput(input) {
      assert.ok(input.messages.some(({ role, content }) => role === 'assistant' && content === draft));
      assert.ok(!input.tools.some(({ function: fn }) => fn.name === 'get_document_cursor' || fn.name === 'insert_text_at_document_cursor'));
      assert.match(String(input.messages[0].content), /Use superdoc_stream_text with mode "append", anchor null, and story null/);
    },
    steps: [{ tool: { name: 'superdoc_stream_text', args: { mode: 'append', anchor: null, story: null, text: draft } } }],
    answer: 'Inserted the two sentences.',
  });
  expect(payload.documentTarget.cursor).toBeUndefined();
  await expect(editor).toContainText(draft);
  const { xml } = await exportDocument(room);
  expect(xml).toContain(draft);
});

test('the wider composer has a visible, centered drag grip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${clientUrl}/?room=composer-${++roomCount}`);
  const panel = page.getByRole('complementary', { name: 'Agent chat' });
  const handle = panel.getByRole('separator', { name: 'Resize chat panel' });
  await expect(panel).toHaveCSS('width', '480px');
  const grip = await handle.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return { centered: parseFloat(style.top) === element.clientHeight / 2, height: parseFloat(style.height) };
  });
  expect(grip.centered).toBe(true);
  expect(grip.height).toBeGreaterThan(0);

  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 64, y, { steps: 4 });
  await page.mouse.up();
  await expect(panel).toHaveCSS('width', '544px');
  await page.setViewportSize({ width: 1080, height: 900 });
  await expect(panel).toHaveCSS('width', '400px');
});

test('“here” inserts a tracked suggestion between the characters at the document caret', async ({ page }) => {
  const { room, editor } = await openAtCaret(page, 'suggestion');
  await submit(page, room, {
    prompt: 'Add TRACKED here as a suggestion.',
    checkInput(input) {
      assert.match(String(input.messages[0].content), /“here,” “at my cursor,”.*captured document caret/);
    },
    steps: [{
      tool: { name: 'get_document_cursor', args: {} },
      checkResult(content) {
        const cursor = JSON.parse(content);
        assert.equal(cursor.target.start.blockId, cursor.address.nodeId);
        assert.deepEqual(cursor.target.end, cursor.target.start);
        assert.equal(cursor.target.start.offset, 'LEFT'.length);
      },
    }, { tool: insertText('TRACKED') }],
    answer: 'Added the suggestion at your caret.',
  });
  await expect(editor).toContainText('LEFTTRACKEDRIGHT');
  const { xml } = await exportDocument(room);
  expect(xml).toMatch(/LEFT<\/w:t>[\s\S]*?<w:ins\b[^>]*>[\s\S]*?>TRACKED<\/w:t>[\s\S]*?<\/w:ins>[\s\S]*?>RIGHT<\/w:t>/);
});

test('a selected-text prompt still edits the highlighted text', async ({ page }) => {
  const { room, editor } = await openAtCaret(page);
  await page.keyboard.press('Shift+Home');
  await expect(page.getByRole('region', { name: 'Selected text' })).toContainText('LEFT');
  const payload = await submit(page, room, {
    prompt: 'Replace only the highlighted word with SELECTED.',
    checkInput(_input, parts) {
      assert.equal(parts[0].type, 'text');
      assert.match(parts[0].text, /selected_document_text: "LEFT"/);
    },
    steps: [{ tool: { name: 'superdoc_stream_text', args: { mode: 'replace', anchor: 'LEFT', text: 'SELECTED' } } }],
    answer: 'Replaced the highlighted word.',
  });
  expect(payload.selectedText).toBe('LEFT');
  expect(payload.documentTarget.cursor).toBeUndefined();
  await expect(editor).toContainText('SELECTEDRIGHT');
});

async function openPreviewTable(page: Page) {
  const room = `composer-${++roomCount}`;
  const cell = (text: string, properties = '') =>
    `<w:tc><w:tcPr>${properties}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const file = await wordFile('preview.docx', `
    <w:p><w:r><w:t>Skip this. Before the table.</w:t></w:r></w:p>
    <w:tbl>
      <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
      <w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('Header A')}${cell('Header B', '<w:gridSpan w:val="2"/>')}</w:tr>
      <w:tr>${cell('Region A', '<w:vMerge w:val="restart"/>')}${cell('Budget B1')}${cell('Budget C1')}</w:tr>
      <w:tr>${cell('', '<w:vMerge/>')}${cell('Budget B2')}${cell('Budget C2')}</w:tr>
    </w:tbl>
    <w:p><w:r><w:t>After the table. Skip this too.</w:t></w:r></w:p>
  `);
  const body = new FormData();
  body.set('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.name);
  const uploaded = await fetch(`${api}/api/rooms/${room}/document`, { method: 'PUT', body });
  expect(uploaded.status).toBe(200);
  await page.goto(`${clientUrl}/?room=${room}`);
  await page.locator('.editor-shell[aria-busy="false"]').waitFor();
  return room;
}

test('the composer previews a selected table and a rectangular cell selection as tables', async ({ page }, testInfo) => {
  const room = await openPreviewTable(page);

  await dragBetweenCells(page, 'Header A', 'Budget C2');
  const preview = page.getByRole('region', { name: 'Selected table' });
  const table = preview.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('columnheader', { name: 'Header B' })).toHaveAttribute('colspan', '2');
  await expect(table.getByRole('cell', { name: 'Region A' })).toHaveAttribute('rowspan', '2');
  await expect(table.getByRole('row').nth(2).getByRole('cell')).toHaveText(['Budget B2', 'Budget C2']);
  await testInfo.attach('selected-table-preview', { body: await preview.screenshot(), contentType: 'image/png' });

  await dragBetweenCells(page, 'Budget B1', 'Budget C2');
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('cell')).toHaveText(['Budget B1', 'Budget C1', 'Budget B2', 'Budget C2']);
  await promptBox(page).fill('Summarize the selected budgets.');
  await expect(preview).toBeVisible();
  const payload = await submit(page, room, {
    prompt: 'Summarize the selected budgets.',
    steps: [],
    answer: 'Summarized the selected cells.',
  }, { fill: false });
  expect(payload.selectedText.match(/Budget [BC][12]/g)).toEqual(['Budget B1', 'Budget C1', 'Budget B2', 'Budget C2']);
  await preview.getByRole('button', { name: 'Clear selected table' }).click();
  await expect(preview).toHaveCount(0);
});

test('a selection across a table keeps the surrounding text and table in document order', async ({ page }) => {
  const room = await openPreviewTable(page);
  const point = (text: string, offset: number) => page.getByText(text, { exact: true }).and(page.locator('.editor-content .superdoc-text-run'))
    .evaluate((element, offset) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, offset);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    }, offset);

  const start = await point('Skip this. Before the table.', 'Skip this. '.length);
  const end = await point('After the table. Skip this too.', 'After the table.'.length);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 15 });
  await page.mouse.up();

  const preview = page.getByRole('region', { name: 'Selected text' });
  const table = preview.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('columnheader', { name: 'Header B' })).toHaveAttribute('colspan', '2');
  await expect(table.getByRole('cell', { name: 'Region A' })).toHaveAttribute('rowspan', '2');
  const blocks = preview.locator('.selection-preview-content').locator(':scope > *');
  await expect(blocks.nth(0)).toHaveText('Before the table.');
  await expect(blocks.nth(1)).toHaveRole('table');
  await expect(blocks.nth(2)).toHaveText('After the table.');
  await expect(preview).not.toContainText('Skip this');

  const payload = await submit(page, room, {
    prompt: 'Summarize the selected text and table.',
    steps: [],
    answer: 'Summarized the selected range.',
  });
  expect(payload.selectedText).toMatch(/Before the table\.[\s\S]+Budget C2[\s\S]+After the table\./);
  await expect(table).toBeVisible();
});

for (const [name, mimeType, text, prompt] of [
  ['notes.txt', 'text/plain', 'Keep café and tabs\tintact.\nSecond line.', 'Copy the entire text file verbatim at my cursor.'],
  ['notes.md', 'text/markdown', '## Weekend plan\n- First item\n- Second item', 'Paste the Markdown source here, preserving every line.'],
]) {
  test(`a ${name} prompt copies the exact attachment text at the caret`, async ({ page }) => {
    const { room, editor } = await openAtCaret(page);
    await attach(page, 'File', { name, mimeType, buffer: Buffer.from(text) });
    await submit(page, room, {
      prompt, steps: [{ tool: copyTool }], checkInput: checkFile(name, text), answer: 'Copied the attachment at your caret.',
    });
    await expect.poll(() => editor.innerText()).toContain(`LEFT${text}RIGHT`);
  });
}

test('a Word attachment prompt inserts its paragraphs and table text in order', async ({ page }) => {
  const { room, editor } = await openAtCaret(page);
  await attach(page, 'File', await wordAttachment());
  const text = 'Budget in the draft is 90.\nAnnex A lists expenses.';
  await submit(page, room, {
    prompt: 'Extract the entire Word file as plain text and insert it here.',
    steps: [{ tool: copyTool }], checkInput: checkFile('draft.docx', text), answer: 'Inserted the Word document text.',
  });
  await expect(page.locator('.message.user figure')).toHaveText('draft.docx');
  await expect.poll(() => editor.innerText()).toContain(`LEFT${text}RIGHT`);
});

test('a comparison prompt reads the live document and answers in chat without editing', async ({ page }) => {
  const { room } = await openAtCaret(page);
  await page.keyboard.type('Live budget is 120.');
  await expect.poll(async () => (await exportDocument(room)).xml).toContain('Live budget is 120.');
  const before = (await exportDocument(room)).xml;
  await attach(page, 'File', await wordAttachment());
  const answer = 'The draft budget is 90. The current document budget is 120.';
  await submit(page, room, {
    prompt: 'Compare the budgets in the attached Word file and the open document. Answer in chat.',
    checkInput: checkFile('draft.docx', 'Budget in the draft is 90.\nAnnex A lists expenses.'),
    steps: [{
      tool: { name: 'superdoc_inspect', args: { findText: 'Live budget is 120.', findLimit: 1 } },
      checkResult: (content) => assert.match(content, /Live budget is 120\./),
    }],
    answer,
  });
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  expect((await exportDocument(room)).xml).toBe(before);
});

test('an image insertion prompt embeds the attached bytes inline at the caret', async ({ page }) => {
  const { room } = await openAtCaret(page);
  await attach(page, 'Image', image);
  await submit(page, room, {
    prompt: 'Embed this image at my cursor with alt text “Blue tile”.', checkInput: checkImage,
    steps: [{ tool: { name: 'insert_attached_image', args: { placement: 'cursor', alt: 'Blue tile' } } }],
    answer: 'Embedded the image at your caret.',
  });
  const thumbnail = page.locator('.message.user').getByRole('img', { name: image.name });
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.reload();
  await expect(thumbnail).toBeVisible();

  const { archive, xml } = await exportDocument(room);
  expect(xml).toMatch(/LEFT<\/w:t>[\s\S]*?<w:drawing>[\s\S]*?descr="Blue tile"[\s\S]*?<\/w:drawing>[\s\S]*?>RIGHT<\/w:t>/);
  const media = archive.file(/^word\/media\/[^/]+$/);
  expect(media).toHaveLength(1);
  expect(await media[0].async('nodebuffer')).toEqual(png);
});

test('an image placement follow-up embeds the original image at the document start', async ({ page }) => {
  const { room } = await openAtCaret(page, 'suggestion');
  await attach(page, 'Image', image);
  await submit(page, room, {
    prompt: 'Insert this image.', checkInput: checkImage, steps: [],
    answer: 'Where should I insert the image?',
  });
  expect((await exportDocument(room)).archive.file(/^word\/media\/[^/]+$/)).toHaveLength(0);

  const request = await submit(page, room, {
    prompt: 'At the very top.', checkInput: checkImage,
    steps: [{ tool: { name: 'insert_attached_image', args: { placement: 'documentStart', alt: 'Blue tile' } } }],
    answer: 'Inserted the image at the top.',
  });
  expect(request.attachment).toBeUndefined();
  const { archive, xml } = await exportDocument(room);
  expect(xml).toMatch(/<w:ins\b[^>]*>[\s\S]*?<w:drawing>[\s\S]*?descr="Blue tile"[\s\S]*?<\/w:drawing>[\s\S]*?<\/w:ins>[\s\S]*?LEFTRIGHT/);
  const media = archive.file(/^word\/media\/[^/]+$/);
  expect(media).toHaveLength(1);
  expect(await media[0].async('nodebuffer')).toEqual(png);

  await submit(page, room, {
    prompt: 'What did you change?', steps: [], answer: 'I inserted the blue tile.',
    checkInput(input, parts) {
      assert.ok(!input.tools.some(({ function: tool }) => tool.name === 'insert_attached_image'));
      assert.ok(!parts.some(({ type }) => type === 'image_url'));
    },
  });
});

test('the submitted thumbnail survives when the server omits attachment previews', async ({ page }) => {
  const { room } = await openAtCaret(page);
  const roomUrl = `${api}/api/rooms/${room}`;
  const omitPreview = async (route: Route) => {
    const response = await route.fetch();
    const { attachmentPreview: _preview, ...job } = await response.json();
    await route.fulfill({ response, json: job });
  };
  await page.route(`${roomUrl}/jobs`, omitPreview);
  await page.route(`${roomUrl}/jobs/*`, omitPreview);
  await page.route(`${roomUrl}/jobs/*/events`, (route) => route.abort());
  await page.route(`${roomUrl}/chat`, async (route) => {
    const response = await route.fetch();
    const { messages } = await response.json();
    await route.fulfill({ response, json: { messages: messages.map(({ attachmentPreview, ...entry }: ChatMessage) => entry) } });
  });

  await attach(page, 'Image', image);
  await submit(page, room, {
    prompt: 'Confirm that the image is attached.',
    checkInput: checkImage,
    steps: [],
    answer: 'I received the blue tile.',
  });
  const thumbnail = page.locator('.message.user').getByRole('img', { name: image.name });
  await expect(thumbnail).toBeVisible();
  await page.reload();
  await expect(thumbnail).toBeVisible();
});

test('an image-description prompt inserts text at the caret', async ({ page }) => {
  const { room, editor } = await openAtCaret(page);
  await attach(page, 'Image', image);
  const description = 'The image is a solid blue square.';
  await submit(page, room, {
    prompt: 'Describe the attached image in one sentence here in the document.',
    checkInput: checkImage, steps: [{ tool: insertText(description) }], answer: 'Inserted the description.',
  });
  await expect(editor).toContainText(`LEFT${description}RIGHT`);
  const { xml } = await exportDocument(room);
  expect(xml).not.toContain('<w:drawing>');
});

test('a cursor prompt leaves the document alone when the captured paragraph has changed', async ({ page }) => {
  const { room, editor } = await openAtCaret(page);
  await page.route(`${api}/api/rooms/${room}/jobs`, async (route) => {
    try {
      await editor.click({ position: { x: 260, y: 150 } });
      await page.keyboard.press('End');
      await page.keyboard.type('!');
      await expect.poll(async () => (await exportDocument(room)).xml).toContain('LEFTRIGHT!');
    } finally {
      await route.continue();
    }
  }, { times: 1 });
  await submit(page, room, {
    prompt: 'Insert STALE at my cursor.',
    steps: [{
      tool: insertText('STALE'), status: 'failed',
      checkResult: (content) => assert.match(content, /paragraph at the caret changed/),
    }],
    answer: 'Place your caret and try again.',
  });
  await expect(editor).toContainText('LEFTRIGHT!');
  await expect(editor).not.toContainText('STALE');
});

test('New document offers blank and DOCX choices and the composer shows the configured model', async ({ page }) => {
  const { editor } = await openAtCaret(page);
  const mode = page.getByRole('combobox', { name: 'Agent edit mode' });
  await expect(mode).toHaveValue('direct');
  await expect(mode.getByRole('option', { name: 'Agent is reviewing' })).toHaveCount(1);
  await expect(mode.getByRole('option', { name: 'Agent is editing' })).toHaveCount(1);
  await expect(page.locator('.agent-composer-actions > button + .agent-composer-trailing > .agent-model')).toHaveText(agentModel);
  await expect(page.getByRole('button', { name: 'Dictate prompt' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Voice mode' })).toBeVisible();

  const files = page.getByRole('group', { name: 'File actions' });
  const newDocument = files.getByRole('button', { name: 'New document' });
  await expect(files.getByRole('button', { name: /delete document|replace document/i })).toHaveCount(0);
  await newDocument.click();
  const choices = page.getByRole('dialog', { name: 'New document' });
  await expect(choices.getByRole('button', { name: 'Start blank' })).toBeVisible();
  await expect(choices.getByRole('button', { name: 'Upload DOCX…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(choices).toBeHidden();
  await expect(newDocument).toBeFocused();
  await expect(editor).toContainText('LEFTRIGHT');

  await newDocument.click();
  await choices.getByRole('button', { name: 'Start blank' }).click();
  await expect(editor).not.toContainText('LEFTRIGHT');

  await newDocument.click();
  const picker = page.waitForEvent('filechooser');
  await choices.getByRole('button', { name: 'Upload DOCX…' }).click();
  await (await picker).setFiles(await wordAttachment());
  await expect(choices).toBeHidden();
  await expect(page.locator('.file-name')).toHaveText('draft.docx');
  await expect(editor).toContainText('Budget in the draft is 90.');
});

type VoiceFixture = {
  recordings: MediaStreamTrack[];
  playInput: () => void;
  starts: number;
  stops: number;
};

async function installVoiceFixture(page: Page) {
  await page.addInitScript(() => {
    const audio: VoiceFixture = { recordings: [], starts: 0, stops: 0, playInput() {} };
    (window as Window & { voiceFixture: VoiceFixture }).voiceFixture = audio;
    const startSource = AudioBufferSourceNode.prototype.start;
    const stopSource = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args) {
      audio.starts++;
      return startSource.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      audio.stops++;
      return stopSource.apply(this, args);
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const output = context.createMediaStreamDestination();
      oscillator.connect(gain).connect(output);
      gain.gain.value = 0;
      oscillator.start();
      const track = output.stream.getAudioTracks()[0];
      audio.recordings.push(track);
      const stop = track.stop.bind(track);
      track.stop = () => {
        if (track.readyState === 'ended') return;
        stop();
        void context.close();
      };
      audio.playInput = () => {
        const start = context.currentTime + 0.05;
        gain.gain.setValueAtTime(0.15, start);
        gain.gain.setValueAtTime(0, start + 0.35);
        gain.gain.setValueAtTime(0.15, start + 0.55);
        gain.gain.setValueAtTime(0, start + 0.95);
        performance.mark('final-mic-silence', { startTime: performance.now() + (start + 0.95 - context.currentTime) * 1000 });
      };
      return output.stream;
    };
  });
}

test('the butterfly is the only progress indicator and stays below the streamed reply', async ({ page }, testInfo) => {
  const { room } = await openAtCaret(page);
  const first = 'The opening gets to the point quickly.';
  const answer = `${first} The scope could be clearer.`;
  let startReply = () => {};
  let finish = () => {};
  const startAfter = new Promise<void>((resolve) => { startReply = resolve; });
  const continueAfter = new Promise<void>((resolve) => { finish = resolve; });
  const submission = submit(page, room, {
    prompt: 'Review the opening paragraph.', steps: [], answer,
    streamReply: { first, startAfter, continueAfter },
  });
  const reply = page.locator('.message-turn .message.assistant');
  const status = reply.getByRole('status');
  const wing = status.locator('.agent-butterfly-wing').first();
  try {
    await expect(status).toBeVisible();
    await expect(reply.locator('.message-markdown')).toHaveCount(0);
    await expect(wing).toHaveCSS('animation-name', 'agent-butterfly-flap');

    startReply();
    await expect(reply.getByText(first, { exact: true })).toBeVisible();
    await expect(reply.locator('.message-markdown + .agent-working')).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(wing).toHaveCSS('animation-name', 'none');
    await reply.screenshot({ path: testInfo.outputPath('working-butterfly.png') });
  } finally {
    startReply();
    finish();
  }
  await submission;
  expect(modelRequests).toBe(1);
  await expect(page.locator('.agent-working')).toHaveCount(0);
});

test('voice mode sends after a pause, speaks while the job runs, and listens again', async ({ page }) => {
  await installVoiceFixture(page);
  const { room, editor } = await openAtCaret(page);
  const firstSentence = 'I inserted the dictated words.';
  const answer = `${firstSentence} They’re between the original words.`;
  let releaseReply = () => {};
  const continueAfter = new Promise<void>((resolve) => { releaseReply = resolve; });
  scenario = {
    prompt: transcript, steps: [{ tool: insertText('DICTATED') }], answer,
    streamReply: { first: `${firstSentence} `, continueAfter },
  };
  const voice = page.getByRole('button', { name: 'Voice mode' });
  const tracks = () => page.evaluate(() => (window as Window & { voiceFixture: VoiceFixture }).voiceFixture
    .recordings.map((track) => track.readyState));
  try {
    await expect(voice).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await promptBox(page).fill('Keep this draft');
    const sent = page.waitForResponse((result) =>
      result.url() === `${api}/api/rooms/${room}/jobs` && result.request().method() === 'POST');
    await voice.click();
    await expect(voice).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(0, 0);
    await expect(voice).toHaveCSS('background-color', 'rgb(41, 100, 192)');
    await expect(voice).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.getByRole('status').filter({ hasText: /^Listening…$/ })).toBeVisible();
    await page.evaluate(() => (window as Window & { voiceFixture: VoiceFixture }).voiceFixture.playInput());
    const accepted = await sent;
    expect(accepted.status()).toBe(202);
    const silenceBeforeUpload = await page.evaluate((url) => {
      const silence = performance.getEntriesByName('final-mic-silence', 'mark')[0];
      const upload = performance.getEntriesByName(url, 'resource')[0];
      return upload.startTime - silence.startTime;
    }, `${api}/api/rooms/${room}/transcriptions`);
    expect(silenceBeforeUpload).toBeGreaterThanOrEqual(450);
    expect(silenceBeforeUpload).toBeLessThan(1_500);
    const job = await accepted.json() as Job;
    const speechUrl = `${api}/api/rooms/${room}/jobs/${job.id}/speech`;
    const body = JSON.stringify({ text: firstSentence });
    expect((await fetch(speechUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })).status).toBe(401);
    expect((await fetch(speechUrl, { method: 'POST', body, headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer 00000000-0000-4000-8000-000000000000',
    } })).status).toBe(404);
    await expect.poll(() => spoken).toEqual([firstSentence]);
    await expect(page.getByText('Working on it…', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    expect(await tracks()).toEqual(['ended']);
    expect(transcriptions).toBe(1);
    await expect(editor).toContainText('LEFTDICTATEDRIGHT');
    releaseReply();

    await expect(page.locator('.message.assistant').filter({ hasText: answer })).toBeVisible();
    await expect.poll(() => spoken).toEqual([firstSentence, 'They’re between the original words.']);
    expect(await tracks()).toEqual(['ended']);
    await expect(page.getByRole('status').filter({ hasText: 'is speaking' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Listening' })).toBeVisible();
    expect(await tracks()).toEqual(['ended', 'live']);
    await voice.click();
    await expect(voice).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(tracks).toEqual(['ended', 'ended']);
    await expect(promptBox(page)).toHaveValue('Keep this draft');
    await expect(page.locator('.message.user').filter({ hasText: transcript })).toBeVisible();
    await expect(page.locator('.message.assistant').filter({ hasText: answer })).toBeVisible();
    await submit(page, room, {
      prompt: 'Keep this draft', steps: [], answer: 'The draft is still here.',
    }, { fill: false });
    expect(spoken).toEqual([firstSentence, 'They’re between the original words.']);
    await page.reload();
    await expect(page.locator('.message.assistant').filter({ hasText: answer })).toBeVisible();
  } finally {
    releaseReply();
  }
});

test('turning off voice mode stops playback and keeps the reply in chat', async ({ page }) => {
  await installVoiceFixture(page);
  const { room } = await openAtCaret(page);
  const voice = page.getByRole('button', { name: 'Voice mode' });
  await voice.click();
  await expect(page.getByRole('status').filter({ hasText: 'Listening' })).toBeVisible();
  const answer = 'Here’s what I found.';
  let finish = () => {};
  const continueAfter = new Promise<void>((resolve) => { finish = resolve; });
  const submission = submit(page, room, {
    prompt: 'Review my document', steps: [], answer,
    streamReply: { first: '', continueAfter },
  });
  try {
    const reply = page.locator('.message-turn .message.assistant');
    await expect(reply.locator('.agent-working')).toBeVisible();
    await expect(reply.locator('.message-markdown')).toHaveCount(0);
    expect(spoken).toEqual([]);
  } finally {
    finish();
  }
  await submission;
  const audioState = () => page.evaluate(() => {
    const { recordings, starts, stops } = (window as Window & { voiceFixture: VoiceFixture }).voiceFixture;
    return { tracks: recordings.map((track) => track.readyState), starts, stops };
  });
  await expect.poll(audioState).toEqual({ tracks: ['ended'], starts: 1, stops: 0 });
  await voice.click();
  await expect(voice).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(audioState).toEqual({ tracks: ['ended'], starts: 1, stops: 1 });
  await expect(page.locator('.message.assistant').filter({ hasText: answer })).toBeVisible();
  expect(spoken).toEqual([answer]);
  expect(transcriptions).toBe(0);
});
