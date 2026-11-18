import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentService, LIMITS } from '../agent/service.mjs';
import { validateProject, projectFiles } from '../agent/project.mjs';
import { createDemoAgentProxy } from './demo-agent-proxy.mjs';
import { readGenerationResponse } from '../agent/progress.mjs';

const generated = { title: 'Review controls', summary: 'Edit and review a real document.', javascript: 'export async function setupDemo({ status }) { status.textContent = "Ready to review"; }', css: '#demo-output { color: blue; }', guidance: 'Try the controls. Next, add a DOCX upload and verify with your own document.' };
const noMatch = { acknowledgement: 'I’ll check for a review workflow you can start from.', message: 'I can put together review controls for your document.', canBuild: true, matches: [] };
const catalog = [{ id: 'review', title: 'Review', description: 'Track changes', liveDemoUri: '/review/', sourceUri: 'https://github.com/superdoc/demos' }];

async function fixture(t, options = {}) {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'demo-agent-'));
  const calls = [];
  let clock = Date.now();
  const settings = { dataDirectory, apiKey: 'test-key', catalog, now: () => clock,
    fetchOpenAI: async (_url, request) => {
      const call = JSON.parse(request.body); calls.push(call);
      const result = await options.answer?.(call) || (call.max_output_tokens === LIMITS.searchTokens ? noMatch : generated);
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
    }, ...options,
  };
  let service = await createAgentService(settings);
  const server = createServer(async (request, response) => { if (!await service.handle(request, response)) response.writeHead(404).end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  async function request(route, body, headers = {}) {
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  }
  t.after(async () => { service.close(); await new Promise((resolve) => server.close(resolve)); await rm(dataDirectory, { recursive: true, force: true }); });
  const search = async () => (await (await request('/agent/api/search', { prompt: 'Build a document review flow' })).json());
  const build = async () => { const { offer } = await search(); return (await (await request('/agent/api/projects', { offer })).json()); };
  async function ready(id) {
    for (let i = 0; i < 100; i++) {
      const project = await (await request(`/agent/api/projects/${id}`)).json();
      if (project.state !== 'building') return project;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('Project did not finish');
  }
  return { calls, request, search, build, ready, dataDirectory, advance: (ms) => { clock += ms; },
    restart: async (overrides = {}) => { service.close(); service = await createAgentService({ ...settings, ...overrides }); },
  };
}

test('search returns only real catalog matches and never starts a build for a match', async (t) => {
  const f = await fixture(t, { answer: () => ({ acknowledgement: 'I’ll check the review examples.', message: 'Try review', canBuild: false, matches: [{ id: 'review', reason: 'Tracks changes' }, { id: 'made-up', reason: 'bad' }, { id: 'review', reason: 'duplicate' }] }) });
  const result = await f.search();
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].liveDemoUri, '/review/');
  assert.equal(result.offer, null);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].reasoning, { effort: 'low' });
  assert.equal(f.calls[0].max_output_tokens, LIMITS.searchTokens);
  assert.equal(f.calls[0].store, false);
});

test('related demo suggestions do not suppress a requested build offer', async (t) => {
  const f = await fixture(t, { answer: (call) => call.max_output_tokens === LIMITS.searchTokens ? {
    ...noMatch, message: 'I can build the combined commenting workflow. Review is a useful starting point.',
    matches: [{ id: 'review', reason: 'Demonstrates part of the requested review workflow.' }],
  } : undefined });
  const response = await f.request('/agent/api/search', { prompt: 'Build a new demo with internal and external document comments.' });
  const result = await response.json();
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].id, 'review');
  assert.ok(result.offer);
  assert.equal(f.calls.length, 1); // Offering a build must not start generation.
  const build = await f.request('/agent/api/projects', { offer: result.offer });
  assert.equal(build.status, 202);
  assert.equal((await f.ready((await build.json()).id)).state, 'ready');
});

test('Moe streams a public acknowledgement before the final reply using one low-reasoning call', { timeout: 3000 }, async (t) => {
  let controller, call, calls = 0;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const reply = { acknowledgement: 'Let me check what you mean by ASCII animation.', message: 'What would you like the animation to do?', canBuild: false, matches: [] };
  const f = await fixture(t, { fetchOpenAI: async (_url, request) => {
    calls++; call = JSON.parse(request.body);
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const emit = (event) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  try {
    const response = await f.request('/agent/api/search', { prompt: 'ASCII animations' }, { Accept: 'application/x-ndjson' });
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    const reader = response.body.getReader();
    const text = JSON.stringify(reply);
    const split = text.indexOf(',"message"');
    emit({ type: 'response.reasoning_text.delta', delta: 'private reasoning must not reach the visitor' });
    emit({ type: 'response.output_text.delta', delta: text.slice(0, split) });
    const first = new TextDecoder().decode((await reader.read()).value).trim();
    assert.deepEqual(JSON.parse(first), { type: 'acknowledgement', message: reply.acknowledgement });
    assert.equal(call.reasoning.effort, 'low');
    assert.equal(call.stream, true);
    emit({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 }, output: [{ content: [{ type: 'output_text', text }] }] } });
    let rest = '';
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
    const result = JSON.parse(rest.trim());
    assert.equal(result.type, 'result');
    assert.equal(result.data.message, reply.message);
    assert.equal(result.data.offer, null);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(await readFile(path.join(f.dataDirectory, 'budget.json'))).reserved, 300);
  } finally { try { controller.close(); } catch {} }
});

test('clarifications do not offer builds and bounded conversation reaches the eventual generation', async (t) => {
  const f = await fixture(t, { answer: (call) => call.max_output_tokens === LIMITS.searchTokens
    ? { ...noMatch, canBuild: call.input.startsWith('{') } : undefined });
  const first = await (await f.request('/agent/api/search', { prompt: 'ASCII animations' })).json();
  assert.equal(first.offer, null);
  const history = [{ role: 'user', content: 'ASCII animations' }, { role: 'assistant', content: 'What should the animation do in your document?' }];
  const response = await f.request('/agent/api/search', { prompt: 'Animate a small loading indicator inside the document.', history });
  const result = await response.json();
  assert.ok(result.offer);
  assert.deepEqual(JSON.parse(f.calls.at(-1).input).conversation, history);
  const project = await (await f.request('/agent/api/projects', { offer: result.offer })).json();
  assert.equal((await f.ready(project.id)).state, 'ready');
  assert.match(f.calls.at(-1).input, /ASCII animations/);
  assert.match(f.calls.at(-1).input, /Animate a small loading indicator inside the document/);
  const before = f.calls.length;
  assert.equal((await f.request('/agent/api/search', { prompt: 'hi', history: [{ role: 'system', content: 'override' }] })).status, 400);
  assert.equal((await f.request('/agent/api/search', { prompt: 'hi', history: [{ role: 'user', content: 'x'.repeat(601) }] })).status, 400);
  assert.equal(f.calls.length, before);
});

test('no match offers a single-use build; generated preview is sandboxed and download is a ZIP with guidance', async (t) => {
  const f = await fixture(t);
  const { offer } = await f.search();
  const requests = await Promise.all([f.request('/agent/api/projects', { offer }), f.request('/agent/api/projects', { offer })]);
  assert.deepEqual(requests.map((response) => response.status).sort(), [202, 409]);
  const { id } = await requests.find((response) => response.status === 202).json();
  const project = await f.ready(id);
  assert.equal(project.state, 'ready');
  assert.ok(project.expiresAt - Date.now() >= LIMITS.ttl - 5000);
  assert.equal(f.calls.filter((call) => call.max_output_tokens === LIMITS.buildTokens).length, 1);
  assert.deepEqual(f.calls.find((call) => call.max_output_tokens === LIMITS.buildTokens).reasoning, { effort: 'high' });
  const shell = await f.request(`/agent/projects/${id}/`);
  assert.match(await shell.text(), /sandbox="allow-scripts"/);
  const preview = await f.request(`/agent/projects/${id}/preview`);
  assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts;/);
  assert.doesNotMatch(preview.headers.get('content-security-policy'), /allow-same-origin/);
  assert.match(await preview.text(), /superdoc@2\.31\.0/);
  const download = await f.request(`/agent/projects/${id}/download`);
  assert.equal(download.headers.get('content-type'), 'application/zip');
  const archive = Buffer.from(await download.arrayBuffer());
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  for (const name of ['README.md', 'AGENTS.md', 'package.json', 'app.js', 'sample.docx']) assert.ok(archive.includes(Buffer.from(name)));
  assert.ok(archive.includes(Buffer.from(generated.guidance)));
  assert.ok(!archive.includes(Buffer.from('test-key')));
});

test('streamed builds report real stages through the project API without exposing partial code or reasoning', async (t) => {
  let controller, calls = 0;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const f = await fixture(t, { fetchOpenAI: async (_url, request) => {
    calls++;
    const call = JSON.parse(request.body);
    if (call.max_output_tokens === LIMITS.searchTokens) return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(noMatch) }] }] });
    assert.equal(call.stream, true);
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  t.after(() => { try { controller.close(); } catch {} });
  const { id } = await f.build();
  async function expectProgress(expected) {
    for (let i = 0; i < 50; i++) {
      const project = await (await f.request(`/agent/api/projects/${id}`)).json();
      assert.equal(project.javascript, undefined);
      assert.ok(!JSON.stringify(project).includes('private reasoning'));
      if (project.progress === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail(`Missing progress: ${expected}`);
  }
  function emit(event) {
    const bytes = new TextEncoder().encode(`event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
    // Split event names, JSON, CRLF, and UTF-8 sequences across transport chunks.
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
  }
  emit({ type: 'response.created' });
  emit({ type: 'response.reasoning_text.delta', delta: 'private reasoning' });
  await expectProgress('Planning your demo…');
  const text = JSON.stringify(generated);
  const boundaries = ['javascript', 'css', 'guidance'].map((key) => text.indexOf(`"${key}"`));
  const parts = [text.slice(0, boundaries[0]), text.slice(boundaries[0], boundaries[1]), text.slice(boundaries[1], boundaries[2]), text.slice(boundaries[2])];
  const stages = ['Outlining your demo…', 'Writing your demo’s interactions…', 'Styling your demo…', 'Adding setup instructions and agent guidance…'];
  for (let i = 0; i < parts.length; i++) {
    emit({ type: 'response.output_text.delta', delta: parts[i] });
    await expectProgress(stages[i]);
  }
  emit({ type: 'response.completed', response: { status: 'completed', output: [{ content: [{ type: 'output_text', text }] }] } });
  assert.equal((await f.ready(id)).state, 'ready');
  assert.equal(calls, 2);
});

test('an interrupted generation stream cannot publish its partial output', async () => {
  const response = new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  await assert.rejects(readGenerationResponse(response, () => {}), /ended before completion/);
});

test('search and build token exhaustion produce distinct errors without automatic retries', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  for (const stage of ['search', 'build']) {
    let calls = 0;
    const f = await fixture(t, { fetchOpenAI: async (_url, request) => {
      calls++;
      const call = JSON.parse(request.body);
      if (stage === 'build' && call.max_output_tokens === LIMITS.searchTokens) {
        return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(noMatch) }] }] });
      }
      return Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
        usage: { output_tokens: call.max_output_tokens, output_tokens_details: { reasoning_tokens: call.max_output_tokens } } });
    } });
    if (stage === 'search') {
      const response = await f.request('/agent/api/search', { prompt: 'Find a demo' });
      assert.equal(response.status, 422);
      assert.match((await response.json()).error, /search token limit/);
      assert.equal(calls, 1);
    } else {
      const { id } = await f.build();
      const project = await f.ready(id);
      assert.equal(project.state, 'failed');
      assert.match(project.error, /build token limit/);
      assert.equal(calls, 2);
    }
  }
  assert.ok(warnings.some((line) => line.includes('"stage":"search"') && line.includes('"reason":"max_output_tokens"')));
  assert.ok(warnings.some((line) => line.includes('"stage":"build"') && line.includes('"reasoningTokens":12000')));
});

test('expiry blocks status, shell, preview, and download and culls the persisted project', async (t) => {
  const f = await fixture(t);
  const { id } = await f.build(); await f.ready(id);
  f.advance(LIMITS.ttl + 1);
  for (const route of [`/agent/api/projects/${id}`, `/agent/projects/${id}/`, `/agent/projects/${id}/preview`, `/agent/projects/${id}/download`]) {
    assert.equal((await f.request(route)).status, 410);
  }
  assert.ok(!(await readdir(f.dataDirectory)).includes(`${id}.json`));
});

test('ready projects and budget survive restart with their original expiry', async (t) => {
  const f = await fixture(t);
  const { id } = await f.build(); const project = await f.ready(id);
  await f.restart();
  const restored = await (await f.request(`/agent/api/projects/${id}`)).json();
  assert.equal(restored.expiresAt, project.expiresAt);
  assert.equal(restored.state, 'ready');
  const budget = JSON.parse(await readFile(path.join(f.dataDirectory, 'budget.json')));
  assert.ok(budget.reserved > LIMITS.searchTokens + LIMITS.buildTokens);
  await f.restart({ dailyTokens: budget.reserved });
  const callsBefore = f.calls.length;
  assert.equal((await f.request('/agent/api/search', { prompt: 'review again' })).status, 429);
  assert.equal(f.calls.length, callsBefore);
});

test('the daily allowance is reserved before API calls and applies across restarts', async (t) => {
  const f = await fixture(t, { dailyTokens: 1 });
  assert.equal((await f.request('/agent/api/search', { prompt: 'review' })).status, 429);
  assert.equal(f.calls.length, 0);
});

test('completed requests release unused reservations and persist actual input plus output usage', async (t) => {
  const f = await fixture(t, { dailyTokens: 12000, fetchOpenAI: async () => Response.json({
    status: 'completed', usage: { input_tokens: 180, output_tokens: 120, total_tokens: 300 },
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(noMatch) }] }],
  }) });
  for (let i = 0; i < 3; i++) assert.equal((await f.request('/agent/api/search', { prompt: 'review' })).status, 200);
  const budget = JSON.parse(await readFile(path.join(f.dataDirectory, 'budget.json')));
  assert.equal(budget.reserved, 900);
  assert.equal(budget.actualTokens, 900);
  await f.restart();
  assert.equal((await f.request('/agent/api/search', { prompt: 'review' })).status, 200);
  assert.equal(JSON.parse(await readFile(path.join(f.dataDirectory, 'budget.json'))).reserved, 1200);
});

test('incomplete responses with confirmed usage charge actual tokens rather than the whole reservation', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const f = await fixture(t, { fetchOpenAI: async () => Response.json({
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
    usage: { input_tokens: 100, output_tokens: 1400, total_tokens: 1500, output_tokens_details: { reasoning_tokens: 1400 } },
  }) });
  assert.equal((await f.request('/agent/api/search', { prompt: 'review' })).status, 422);
  const budget = JSON.parse(await readFile(path.join(f.dataDirectory, 'budget.json')));
  assert.equal(budget.reserved, 1500);
  assert.equal(budget.actualTokens, 1500);
});

test('in-flight requests still hold their allowance until confirmed usage arrives', async (t) => {
  const gate = Promise.withResolvers();
  let calls = 0;
  const completed = () => Response.json({ status: 'completed', usage: { input_tokens: 180, output_tokens: 120, total_tokens: 300 },
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(noMatch) }] }] });
  const f = await fixture(t, { dailyTokens: 12000, fetchOpenAI: async () => ++calls === 1 ? gate.promise : completed() });
  const first = f.request('/agent/api/search', { prompt: 'review' });
  try {
    for (let i = 0; !calls && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls, 1);
    assert.equal((await f.request('/agent/api/search', { prompt: 'review' })).status, 429);
    assert.equal(calls, 1);
  } finally { gate.resolve(completed()); }
  assert.equal((await first).status, 200);
  assert.equal((await f.request('/agent/api/search', { prompt: 'review' })).status, 200);
  assert.equal(JSON.parse(await readFile(path.join(f.dataDirectory, 'budget.json'))).reserved, 600);
});

test('settling yesterday’s request does not reduce today’s ledger', async (t) => {
  const gate = Promise.withResolvers();
  let calls = 0;
  const completed = () => Response.json({ status: 'completed', usage: { input_tokens: 180, output_tokens: 120, total_tokens: 300 },
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(noMatch) }] }] });
  const f = await fixture(t, { fetchOpenAI: async () => ++calls === 1 ? gate.promise : completed() });
  const yesterday = f.request('/agent/api/search', { prompt: 'review' });
  try {
    for (let i = 0; !calls && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls, 1);
    f.advance(24 * LIMITS.ttl);
    assert.equal((await f.request('/agent/api/search', { prompt: 'review' })).status, 200);
  } finally { gate.resolve(completed()); }
  assert.equal((await yesterday).status, 200);
  const budget = JSON.parse(await readFile(path.join(f.dataDirectory, 'budget.json')));
  assert.equal(budget.reserved, 300);
  assert.equal(budget.actualTokens, 300);
});

test('the server enforces concurrent build capacity without starting a third AI call', async (t) => {
  const gate = Promise.withResolvers();
  const f = await fixture(t, { answer: (call) => call.max_output_tokens === LIMITS.searchTokens ? noMatch : gate.promise });
  const projects = [];
  try {
    for (let i = 0; i < 2; i++) projects.push(await f.build());
    const { offer } = await f.search();
    assert.equal((await f.request('/agent/api/projects', { offer })).status, 429);
  } finally { gate.resolve(generated); }
  for (const project of projects) assert.equal((await f.ready(project.id)).state, 'ready');
  assert.equal(f.calls.filter((call) => call.max_output_tokens === LIMITS.buildTokens).length, 2);
});

test('per-IP search throttling cannot be bypassed with different session cookies', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 20; i++) assert.equal((await f.request('/agent/api/search', { prompt: 'review' }, { Cookie: `demo_agent=${i.toString(16).padStart(32, '0')}` })).status, 200);
  assert.equal((await f.request('/agent/api/search', { prompt: 'review' }, { Cookie: `demo_agent=${'f'.repeat(32)}` })).status, 429);
  assert.equal(f.calls.length, 20);
});

test('requests require a valid origin, bounded prompt, session-bound offer, and configured key', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/agent/api/search', { prompt: 'review' }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await f.request('/agent/api/search', { prompt: 'x'.repeat(LIMITS.prompt + 1) })).status, 400);
  const { offer } = await f.search();
  assert.equal((await f.request('/agent/api/projects', { offer }, { Cookie: `demo_agent=${'a'.repeat(32)}` })).status, 409);
  const missing = await fixture(t, { apiKey: '' });
  assert.equal((await missing.request('/agent/api/search', { prompt: 'review' })).status, 503);
});

test('oversized or syntactically invalid generated code fails without exposing a runnable preview', async (t) => {
  assert.throws(() => validateProject({ ...generated, javascript: 'export async function setupDemo( {' }));
  const f = await fixture(t, { answer: (call) => call.max_output_tokens === LIMITS.searchTokens ? noMatch : { ...generated, css: 'x'.repeat(LIMITS.codeBytes + 1) } });
  const { id } = await f.build();
  assert.equal((await f.ready(id)).state, 'failed');
  assert.equal((await f.request(`/agent/projects/${id}/preview`)).status, 409);
  assert.equal((await f.request(`/agent/projects/${id}/download`)).status, 409);
});

test('preview safely encodes generated HTML/script delimiters and scaffold contains no credentials', () => {
  const files = projectFiles({ ...generated, prompt: 'review', title: '<script>alert(1)</script>', css: '</style><script>alert(1)</script>' });
  assert.match(files['index.html'], /&lt;script&gt;/);
  assert.equal(typeof files['AGENTS.md'], 'string');
  assert.ok(Buffer.isBuffer(files['sample.docx']));
});

test('Pages proxy uses authenticated backend forwarding, preserves cookies, and leaves assets on Pages', async () => {
  const calls = [];
  const proxy = createDemoAgentProxy({ fetch: () => new Response('asset') }, async (request) => { calls.push(request); return new Response('backend', { headers: { 'Set-Cookie': 'demo_agent=123; HttpOnly' } }); });
  const env = { DEMO_AGENT_BACKEND_URL: 'https://agent.example', DEMO_AGENT_PROXY_TOKEN: 'proxy-secret' };
  const response = await proxy.fetch(new Request('https://demos.superdoc.dev/agent/api/search', { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.1', Origin: 'https://demos.superdoc.dev', Cookie: 'demo_agent=abc', 'X-Demo-Client-IP': 'spoofed' }, body: '{}' }), env);
  assert.equal(calls[0].url, 'https://agent.example/agent/api/search');
  assert.equal(calls[0].headers.get('x-demo-agent-token'), 'proxy-secret');
  assert.equal(calls[0].headers.get('x-demo-client-ip'), '192.0.2.1');
  assert.equal(calls[0].headers.get('cookie'), 'demo_agent=abc');
  assert.ok(response.headers.get('set-cookie'));
  assert.equal(await (await proxy.fetch(new Request('https://demos.superdoc.dev/agent/gallery.js'), env)).text(), 'asset');
  assert.equal((await proxy.fetch(new Request('https://demos.superdoc.dev/agent/api/health'), {})).status, 503);
});

test('follow-up requests build a new version from existing source and preserve the previous download', async (t) => {
  const revised = { ...generated, title: 'Improved review controls', javascript: 'export async function setupDemo({ status }) { status.textContent = "Updated controls"; }' };
  const f = await fixture(t, { answer: (call) => call.input.includes('followUpRequests') ? revised : undefined });
  const original = await f.build();
  const before = await f.ready(original.id);
  const budgetBefore = JSON.parse(await readFile(path.join(f.dataDirectory, 'budget.json'))).reserved;
  const response = await f.request(`/agent/api/projects/${original.id}/revisions`, { prompt: 'Fix the review button and add reset.' });
  assert.equal(response.status, 202);
  const next = await response.json();
  assert.notEqual(next.id, original.id);
  assert.equal((await f.ready(next.id)).state, 'ready');
  const input = JSON.parse(f.calls.at(-1).input);
  assert.equal(input.existingDemo.javascript, generated.javascript);
  assert.equal(input.originalRequest, 'Build a document review flow');
  assert.deepEqual(input.followUpRequests, ['Fix the review button and add reset.']);
  assert.deepEqual(f.calls.at(-1).reasoning, { effort: 'high' });
  const after = await (await f.request(`/agent/api/projects/${original.id}`)).json();
  assert.equal(after.title, before.title);
  assert.equal(after.expiresAt, before.expiresAt);
  const previousDownload = Buffer.from(await (await f.request(`/agent/projects/${original.id}/download`)).arrayBuffer());
  assert.ok(previousDownload.includes(Buffer.from(generated.javascript)));
  const updatedDownload = Buffer.from(await (await f.request(`/agent/projects/${next.id}/download`)).arrayBuffer());
  assert.ok(updatedDownload.includes(Buffer.from(revised.javascript)));
  assert.ok(updatedDownload.includes(Buffer.from('Fix the review button and add reset.')));
  assert.ok(JSON.parse(await readFile(path.join(f.dataDirectory, 'budget.json'))).reserved > budgetBefore);
});

test('a failed follow-up leaves the previous project ready and downloadable', async (t) => {
  const f = await fixture(t, { answer: (call) => call.input.includes('followUpRequests') ? { ...generated, javascript: 'invalid source' } : undefined });
  const { id } = await f.build(); await f.ready(id);
  const response = await f.request(`/agent/api/projects/${id}/revisions`, { prompt: 'Try a change' });
  const next = await response.json();
  assert.equal((await f.ready(next.id)).state, 'failed');
  assert.equal((await (await f.request(`/agent/api/projects/${id}`)).json()).state, 'ready');
  assert.equal((await f.request(`/agent/projects/${id}/download`)).status, 200);
});

test('a failed initial generation can be repaired with a follow-up prompt', async (t) => {
  let generations = 0;
  const f = await fixture(t, { answer: (call) => {
    if (call.max_output_tokens === LIMITS.searchTokens) return noMatch;
    return ++generations === 1 ? { ...generated, javascript: 'invalid source' } : generated;
  } });
  const { id } = await f.build();
  assert.equal((await f.ready(id)).state, 'failed');
  const response = await f.request(`/agent/api/projects/${id}/revisions`, { prompt: 'Simplify it and fix the syntax error.' });
  assert.equal(response.status, 202);
  assert.equal((await f.ready((await response.json()).id)).state, 'ready');
  const input = JSON.parse(f.calls.at(-1).input);
  assert.equal(input.existingDemo, null);
  assert.equal(typeof input.previousFailure, 'string');
});

test('follow-ups enforce origin, prompt bounds, expiry, and the existing build rate limit', async (t) => {
  const f = await fixture(t);
  const { id } = await f.build(); await f.ready(id);
  const route = `/agent/api/projects/${id}/revisions`;
  assert.equal((await f.request(route, { prompt: 'change' }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await f.request(route, { prompt: ' ' })).status, 400);
  assert.equal((await f.request(route, { prompt: 'x'.repeat(LIMITS.prompt + 1) })).status, 400);
  assert.equal((await f.request(route, { prompt: 'change' })).status, 429);
  const expiring = await fixture(t);
  const original = await expiring.build(); await expiring.ready(original.id);
  expiring.advance(LIMITS.ttl + 1);
  assert.equal((await expiring.request(`/agent/api/projects/${original.id}/revisions`, { prompt: 'change' })).status, 410);
});

test('project shell contains a progress line without a follow-up form or timer and preview does not repeat its heading', async (t) => {
  const f = await fixture(t);
  const { id } = await f.build(); await f.ready(id);
  const shell = await (await f.request(`/agent/projects/${id}/`)).text();
  assert.match(shell, /class="project-brand"[^>]*><img src="\/superdoc-logo.png"/);
  assert.match(shell, /id="project-progress"/);
  assert.doesNotMatch(shell, /project-refine|project-prompt|Continue building|Something not right/);
  assert.doesNotMatch(shell, /project-expiry|Expires in/);
  const preview = await (await f.request(`/agent/projects/${id}/preview`)).text();
  assert.doesNotMatch(preview, /id="demo-heading"|id="demo-intro"/);
  assert.match(projectFiles({ ...generated, prompt: 'review' })['index.html'], /id="demo-heading"/);
});
