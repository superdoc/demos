import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';
import JSZip from 'jszip';
import { api, clientUrl, startAgentDemo } from '../../tests/agent-browser-demo.mjs';
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
};

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAApElEQVR4nO3QMQ0AIBDAwF8QiWNk4YCVDpdUQHOz9tGj+X4QDxAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIE6GcXyyhaaFjrkaIAAAAASUVORK5CYII=', 'base64');
const image = { name: 'blue-tile.png', mimeType: 'image/png', buffer: png };
const transcript = 'Write DICTATED here.';
const copyTool = { name: 'copy_attached_file_text', args: { placement: 'cursor' } };

let demo: Awaited<ReturnType<typeof startAgentDemo>> | undefined;
let scenario: Scenario | undefined;
let roomCount = 0;
let transcriptions = 0;

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
  assert.ok(scenario, 'The browser should submit only after Send is clicked.');
  const input = JSON.parse(body.toString()) as ModelInput;
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
  const delta = step ? {
    tool_calls: [{ index: 0, id: `composer-${results.length}`, type: 'function', function: {
      name: step.tool.name, arguments: JSON.stringify(step.tool.args),
    } }],
  } : { content: scenario.answer };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const choice of [
    { delta, finish_reason: null },
    { delta: {}, finish_reason: step ? 'tool_calls' : 'stop' },
  ]) {
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, ...choice }] })}\n\n`);
  }
  response.end('data: [DONE]\n\n');
}

test.beforeAll(async ({}, testInfo) => {
  demo = await startAgentDemo(path.join(testInfo.project.outputDir, `agent-composer-demo-${testInfo.workerIndex}`), handleModelRequest);
});

test.afterAll(async () => {
  await demo?.stop();
});

test.beforeEach(() => {
  scenario = undefined;
  transcriptions = 0;
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

async function submit(page: Page, room: string, plan: Scenario, { fill = true } = {}) {
  scenario = plan;
  if (fill) await promptBox(page).fill(plan.prompt);
  const response = page.waitForResponse((result) =>
    result.url() === `${api}/api/rooms/${room}/jobs` && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
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
  expect(result?.answer).toBe(plan.answer);
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

test('dictation stops after silence and leaves a prompt that can be submitted', async ({ page }) => {
  await page.addInitScript(() => {
    // Feed a real MediaStream with a short pause and a final silence into the recorder.
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const output = context.createMediaStreamDestination();
      oscillator.connect(gain).connect(output);
      const start = context.currentTime + 0.1;
      gain.gain.setValueAtTime(0, 0);
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.setValueAtTime(0, start + 0.35);
      gain.gain.setValueAtTime(0.15, start + 0.55);
      gain.gain.setValueAtTime(0, start + 0.95);
      oscillator.start();
      oscillator.stop(start + 0.95);
      performance.mark('final-mic-silence', { startTime: performance.now() + (start + 0.95 - context.currentTime) * 1000 });
      return output.stream;
    };
  });
  const { room, editor } = await openAtCaret(page);
  const jobs: string[] = [];
  page.on('request', (request) => { if (request.url().endsWith('/jobs') && request.method() === 'POST') jobs.push(request.url()); });
  await page.getByRole('button', { name: 'Dictate prompt' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Listening' })).toBeVisible();
  await expect(promptBox(page)).toHaveValue(transcript, { timeout: 8_000 });
  await expect(page.getByRole('button', { name: 'Dictate prompt' })).toBeEnabled();
  expect(transcriptions).toBe(1);
  const silenceBeforeUpload = await page.evaluate((url) => {
    const silence = performance.getEntriesByName('final-mic-silence', 'mark')[0];
    const upload = performance.getEntriesByName(url, 'resource')[0];
    return upload.startTime - silence.startTime;
  }, `${api}/api/rooms/${room}/transcriptions`);
  expect(silenceBeforeUpload).toBeGreaterThanOrEqual(350);
  expect(silenceBeforeUpload).toBeLessThan(1_500);
  expect(jobs).toHaveLength(0);
  await expect(editor).toContainText('LEFTRIGHT');
  await submit(page, room, {
    prompt: transcript, steps: [{ tool: insertText('DICTATED') }], answer: 'Inserted the dictated words.',
  }, { fill: false });
  await expect(editor).toContainText('LEFTDICTATEDRIGHT');
});
