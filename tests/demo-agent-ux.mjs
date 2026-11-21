// Run with `pnpm --dir tests run test:agent` after installing the tests package
// and Chromium. A synthetic provider keeps this check free of API charges.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createAgentService, LIMITS } from '../agent/service.mjs';

const root = path.resolve(import.meta.dirname, '..');
const generated = {
  title: 'Document text example', summary: 'Read the actual SuperDoc sample document.',
  javascript: 'export async function setupDemo({readText,output,status}) { output.textContent = await readText(); status.textContent = "Verified"; }',
  css: '#demo-output { color: #1355ff; }', guidance: 'A small document text example. Verify with your own DOCX before extending it.',
};
const answer = { acknowledgement: 'I’m checking the document examples you can start from.', message: 'I can create a focused document text example for you. Template Builder is also a useful starting point.', canBuild: true, matches: [{ id: 'template', reason: 'Start with an existing document workflow.' }] };
const complete = (value) => ({ status: 'completed', usage: { total_tokens: 300 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

export default async function check({ browser, artifacts }) {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'demo-bot-ux-'));
  const searchGate = Promise.withResolvers(), buildGate = Promise.withResolvers();
  let configured = false, searches = 0, builds = 0;
  const errors = [];
  const service = await createAgentService({ dataDirectory, apiKey: 'synthetic-key',
    catalog: [{ id: 'template', title: 'Template Builder', description: 'Document fields', packageDirectory: 'template-builder-document-api-v2-demo', liveDemoUri: '/template-builder/', sourceUri: 'https://github.com/superdoc/demos' }],
    fetchOpenAI: async (_url, request) => {
      const call = JSON.parse(request.body);
      if (call.max_output_tokens === LIMITS.searchTokens) {
        searches++;
        assert.ok(call.instructions.includes('Template Builder'));
        assert.ok(call.instructions.includes('context')); // Real setup guides are included in the catalog.
        if (searches > 1) {
          const previous = JSON.parse(call.input).conversation;
          assert.match(previous[1].content, /Demos discussed: Template Builder/);
          return Response.json(complete({ acknowledgement: 'Let’s discuss the example.', message: 'A focused document interaction is easier for reviewers to understand than extra dashboard controls.', canBuild: false, matches: [] }));
        }
        return searchGate.promise;
      }
      builds++;
      return buildGate.promise;
    },
  });
  const server = createServer(async (request, response) => {
    if (request.url === '/agent/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ configured })); return;
    }
    if (await service.handle(request, response)) return;
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const filename = path.resolve(root, 'dist-landing', '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(path.join(root, 'dist-landing') + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const contents = await readFile(filename);
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(filename)] || 'application/octet-stream' }).end(contents);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin); await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('.agent').isVisible(), false);
    configured = true; await page.reload();
    const prompt = page.locator('#agent-prompt');
    await prompt.waitFor({ state: 'visible' });
    assert.equal(await prompt.getAttribute('placeholder'), 'Describe the demo you’re looking for');
    const composer = page.locator('.agent-form');
    const before = await composer.boundingBox();
    assert.ok(before.width >= 740);
    await prompt.focus();
    assert.ok(Math.abs((await composer.boundingBox()).height - before.height) <= 1, 'Focus must not expand the composer');
    await prompt.fill('Read document text\nShow the result\nKeep the editor usable\nMake it reusable');
    const typed = await prompt.boundingBox();
    assert.ok(typed.height > 56, 'Typing multiple lines must grow the input');
    const send = await page.locator('.agent-submit').boundingBox();
    const expanded = await composer.boundingBox();
    assert.ok(expanded.y + expanded.height - send.y - send.height <= 14, 'Send stays at the bottom');
    assert.ok(expanded.x + expanded.width - send.x - send.width <= 14, 'Send stays on the right');
    await prompt.fill('A short line\n'.repeat(35));
    assert.equal(Math.round((await prompt.boundingBox()).height), 216);
    assert.equal(await prompt.evaluate((node) => getComputedStyle(node).overflowY), 'auto');
    await prompt.fill('Build a document text example');
    await prompt.press('Enter');
    await page.locator('.agent-search-steps li').nth(2).waitFor();
    assert.equal(await page.locator('.agent-search-steps li').count(), 3);
    assert.equal(await page.locator('.agent-search-steps li[data-state="active"]').count(), 1);
    assert.equal(builds, 0, 'Searching must not generate a demo');
    await page.screenshot({ path: path.join(artifacts, 'search-progress.png') });
    const text = JSON.stringify(answer);
    searchGate.resolve(new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: complete(answer) })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }));
    const build = page.getByRole('button', { name: 'Build this demo' });
    await build.waitFor();
    assert.equal(await page.locator('.agent-search-steps li[data-state="complete"]').count(), 3);
    const lastMatch = await page.locator('.agent-match').last().boundingBox();
    assert.ok((await build.boundingBox()).y - lastMatch.y - lastMatch.height >= 24, 'Build action needs breathing room below suggestions');
    await page.screenshot({ path: path.join(artifacts, 'gallery-desktop.png') });
    const nextPage = context.waitForEvent('page');
    await build.click();
    const project = await nextPage;
    project.on('pageerror', (error) => errors.push(error.message));
    await project.waitForURL(/\/agent\/projects\/[a-f0-9]{32}/);
    assert.equal(await page.locator('.agent-build-options').count(), 0);
    await project.getByRole('heading', { name: 'Creating a custom demo for you' }).waitFor();
    assert.equal(await project.locator('.project-description').isVisible(), false);
    assert.equal(await project.locator('#project-download').getAttribute('aria-disabled'), 'true');
    assert.equal(await project.locator('.project-loader').isVisible(), true);
    assert.notEqual(await project.locator('.project-butterfly').evaluate((node) => getComputedStyle(node).animationName), 'none');
    await project.screenshot({ path: path.join(artifacts, 'building-desktop.png') });
    await project.emulateMedia({ reducedMotion: 'reduce' });
    for (const selector of ['.project-butterfly', '.project-butterfly-wings', '.project-wave-trail']) assert.equal(await project.locator(selector).evaluate((node) => getComputedStyle(node).animationName), 'none');
    await project.setViewportSize({ width: 390, height: 844 });
    await project.screenshot({ path: path.join(artifacts, 'building-mobile.png') });
    assert.equal(await project.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    buildGate.resolve(Response.json(complete(generated)));
    const frame = project.frameLocator('#project-preview');
    await frame.locator('#demo-status').filter({ hasText: 'Verified' }).waitFor({ timeout: 30000 });
    assert.match(await frame.locator('#demo-output').innerText(), /SuperDoc playground/);
    assert.equal(await project.locator('#project-message').isVisible(), false);
    assert.equal(await project.locator('#project-download').getAttribute('aria-disabled'), 'false');
    const download = await context.request.get(project.url() + 'download');
    assert.equal(download.status(), 200);
    assert.equal(download.headers()['content-type'], 'application/zip');
    // Slack handoffs use the same claim page and browser session guard.
    const projectId = new URL(project.url()).pathname.split('/')[3];
    const ownerCookie = (await context.cookies(project.url())).find((cookie) => cookie.name === 'demo_agent');
    const handoff = await service.createHandoff(projectId, ownerCookie.value);
    const recipient = await browser.newContext();
    try {
      const claim = await recipient.newPage();
      await claim.goto(origin + handoff);
      await claim.getByRole('button', { name: 'Open demo' }).waitFor();
      assert.equal((await recipient.request.get(origin + `/agent/api/projects/${projectId}`)).status(), 404);
      await claim.screenshot({ path: path.join(artifacts, 'private-handoff.png') });
      const submitted = claim.waitForResponse((reply) => reply.request().method() === 'POST');
      await claim.getByRole('button', { name: 'Open demo' }).click();
      const submittedResponse = await submitted;
      if (submittedResponse.status() !== 303) assert.fail(`Claim failed: ${await submittedResponse.text()}; Origin: ${submittedResponse.request().headers().origin}`);
      await claim.waitForURL(origin + `/agent/projects/${projectId}/`, { waitUntil: 'domcontentloaded' });
      assert.equal((await recipient.request.get(origin + `/agent/projects/${projectId}/download`)).status(), 200);
      const outsider = await browser.newContext();
      try { assert.equal((await outsider.request.get(origin + handoff)).status(), 410); }
      finally { await outsider.close(); }
    } finally { await recipient.close(); }
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await prompt.focus();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (width === 390) await page.screenshot({ path: path.join(artifacts, 'gallery-mobile.png') });
    }
    await prompt.fill('Can we discuss how that example would work for reviewers?'); await prompt.press('Enter');
    await page.locator('.agent-message').first().filter({ hasText: 'A focused document interaction' }).waitFor();
    assert.equal(await page.locator('.agent-message').first().locator('.agent-match, .agent-build-options').count(), 0);
    assert.equal(builds, 1, 'Discussion must not generate another project');
    await page.route('**/agent/api/search', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The service is temporarily unavailable.' }) }));
    await prompt.fill('Keep this draft after an error'); await prompt.press('Enter');
    await page.locator('.agent-message[data-error]').waitFor();
    assert.equal(await prompt.inputValue(), 'Keep this draft after an error');
    assert.equal(await prompt.evaluate((node) => node.readOnly), false);
    assert.deepEqual(errors, []);
    assert.equal(searches, 2); assert.equal(builds, 1);
    console.log(JSON.stringify({ composer: 'focus stable; grows to 216px; arrow anchored', search: 'three real phases; no automatic build', cta: 'spacing verified; first click opens preview', loading: 'butterfly wave; mobile; reduced motion', preview: 'real editor text and ZIP', errors: 'draft retained', browser: browser.version() }));
  } finally {
    searchGate.resolve(Response.json(complete(answer))); buildGate.resolve(Response.json(complete(generated)));
    await context.close(); service.close(); server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const artifacts = await mkdtemp(path.join(tmpdir(), 'demo-bot-ux-proof-'));
  try { await check({ browser, artifacts }); console.log(`Screenshots: ${artifacts}`); }
  finally { await browser.close(); }
}
