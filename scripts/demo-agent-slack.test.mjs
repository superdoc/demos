import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentService, LIMITS } from '../agent/service.mjs';
import { createSlackBot, createSlackHttpHandler, slackPublicOrigin, startSlackBot } from '../agent/slack.mjs';

const generated = { title: 'Word count', summary: 'Read document text.', javascript: 'export async function setupDemo({status}) { status.textContent="Ready"; }', css: '#demo-output{color:blue}', guidance: 'Verify the count with a real document.' };
const answer = { acknowledgement: 'I’ll check the examples.', message: 'I can build a word count demo.', canBuild: true, matches: [{ id: 'review', reason: 'An editor example.' }] };
const response = (result) => Response.json({ status: 'completed', usage: { total_tokens: 300 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });

async function fixture(t, options = {}) {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'demo-slack-'));
  let clock = Date.now(), counter = 0;
  const calls = [], sent = [], updates = [], ephemerals = [];
  const service = await createAgentService({ dataDirectory, apiKey: 'test-key', now: () => clock,
    catalog: [{ id: 'review', title: 'Review', description: 'Review a document', liveDemoUri: '/review/', sourceUri: 'https://github.com/superdoc/demos' }],
    fetchOpenAI: async (_url, request) => { const call = JSON.parse(request.body); calls.push(call); return response(call.max_output_tokens === LIMITS.searchTokens ? (options.answer || answer) : generated); },
    ...options.service,
  });
  const client = { chat: {
    postMessage: async (body) => { const item = { ...body, ts: `${++counter}.000` }; sent.push(item); return item; },
    update: async (body) => { updates.push(body); return body; },
    postEphemeral: async (body) => { ephemerals.push(body); return body; },
  }, conversations: { open: async () => { if (options.noDM) throw new Error('DM unavailable'); return { channel: { id: 'DPRIVATE' } }; } } };
  const server = createServer(async (request, reply) => { if (!await service.handle(request, reply)) reply.writeHead(404).end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const settings = { service, client, teamId: 'TTEAM', botUserId: 'UBOT', publicUrl: origin, now: () => clock, autoPoll: false, log() {}, ...options.bot };
  let bot = await createSlackBot(settings);
  t.after(async () => { await bot.close();
    // Let admitted asynchronous builds finish before removing their storage.
    for (let i = 0; i < 200; i++) {
      const files = (await readdir(dataDirectory)).filter((name) => /^[a-f0-9]{32}\.json$/.test(name));
      const projects = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(dataDirectory, name), 'utf8'))));
      if (projects.every((project) => project.state !== 'building')) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    service.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(dataDirectory, { recursive: true, force: true }); });
  async function say({ user = 'UOWNER', channel = 'DDM', team = 'TTEAM', content = 'Build a word count demo', id = `EV${++counter}`, ts = `${counter}.001`, thread, kind = 'message', ...extra } = {}) {
    await bot.onMessage({ body: { team_id: team, event_id: id }, event: { user, channel, text: content, ts, ...(thread ? { thread_ts: thread } : {}), channel_type: channel.startsWith('D') ? 'im' : 'channel', ...extra }, kind });
    const result = updates.at(-1);
    const offer = result?.blocks?.flatMap((block) => block.elements || []).find((element) => element.action_id === 'demo_bot_build')?.value;
    return offer ? { action: { value: offer }, body: { user: { id: user }, team: { id: team }, channel: { id: channel }, message: { ts: result.ts } } } : null;
  }
  async function browser(route, { method = 'GET', cookie = '', origin: source = origin } = {}) {
    return fetch(origin + route, { method, redirect: 'manual', headers: { Origin: source, Cookie: cookie, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, ...(method === 'POST' ? { body: '' } : {}) });
  }
  const state = async () => JSON.parse(await readFile(path.join(dataDirectory, 'slack-state.json'), 'utf8'));
  async function build() {
    const offer = await say(); await bot.onBuild(offer);
    const jobs = Object.values((await state()).jobs);
    assert.equal(jobs.length, 1);
    for (let i = 0; i < 100; i++) {
      const project = JSON.parse(await readFile(path.join(dataDirectory, `${jobs[0].id}.json`), 'utf8'));
      if (project.state !== 'building') return jobs[0];
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('Build did not finish');
  }
  return { service, client, calls, sent, updates, ephemerals, origin, dataDirectory, say, state, browser, build,
    get bot() { return bot; }, advance(ms) { clock += ms; },
    restart: async () => { await bot.close(); bot = await createSlackBot(settings); },
  };
}

test('DMs and explicit channel mentions reuse catalog search without automatically building', async (t) => {
  const f = await fixture(t);
  await f.say({ channel: 'CCHAN' }); // Ordinary channel chatter is outside the subscription/handler.
  await f.say({ bot_id: 'BOTHER' });
  await f.say({ subtype: 'message_changed' });
  assert.equal(f.calls.length, 0);
  const offer = await f.say({ channel: 'CCHAN', kind: 'mention', content: '<@UBOT> Build a word count demo', ts: '123.456' });
  assert.ok(offer.action.value);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].reasoning.effort, 'low');
  assert.equal(f.sent.at(-1).thread_ts, '123.456');
  const result = f.updates.at(-1);
  assert.equal(result.blocks[1].accessory.url, 'https://demos.superdoc.dev/review/');
  assert.ok(!JSON.stringify(result).includes('xoxb-'));
});

test('only the requester can consume an offer; double clicks do not create another build', async (t) => {
  const f = await fixture(t);
  const offer = await f.say();
  await f.bot.onBuild({ ...offer, body: { ...offer.body, user: { id: 'UOTHER' } } });
  assert.equal(f.calls.length, 1);
  assert.match(f.ephemerals.at(-1).text, /requester/);
  await f.bot.onBuild(offer); await f.bot.onBuild(offer);
  assert.equal(f.calls.filter((call) => call.max_output_tokens === LIMITS.buildTokens).length, 1);
  assert.equal(f.calls.at(-1).reasoning.effort, 'high');
  assert.ok(f.updates.some((item) => item.channel === 'DPRIVATE' && item.blocks?.some((block) => block.type === 'actions')));
});

test('private delivery is checked before a paid build; delivery failures do not generate code', async (t) => {
  const f = await fixture(t, { noDM: true });
  await f.bot.onBuild(await f.say());
  assert.equal(f.calls.length, 1);
  assert.match(f.ephemerals.at(-1).text, /private message/);
});

test('event deduplication and bounded conversation survive restarts and isolate people/threads', async (t) => {
  const f = await fixture(t);
  await f.say({ id: 'EVRETRY', content: 'First request' });
  await f.restart();
  await f.say({ id: 'EVRETRY', content: 'First request' });
  assert.equal(f.calls.length, 1);
  await f.say({ content: 'Second request' });
  await f.say({ content: 'Third request' });
  assert.equal(JSON.parse(f.calls.at(-1).input).conversation.length, 4);
  await f.say({ user: 'UOTHER', content: 'Separate request' });
  assert.equal(f.calls.at(-1).input, 'Separate request');
  await f.say({ channel: 'CCHAN', kind: 'mention', thread: '888.001', content: 'Separate thread' });
  assert.equal(f.calls.at(-1).input, 'Separate thread');
  const budget = JSON.parse(await readFile(path.join(f.dataDirectory, 'budget.json'), 'utf8'));
  assert.equal(budget.actualTokens, 1500);
});

test('workspace and optional allowlists filter invocations before provider calls', async (t) => {
  const f = await fixture(t, { bot: { allowedUsers: ['UALLOWED'], allowedChannels: ['CALLOWED'] } });
  await f.say();
  await f.say({ user: 'UALLOWED', team: 'TOTHER' });
  await f.say({ user: 'UALLOWED', channel: 'COTHER', kind: 'mention' });
  assert.equal(f.calls.length, 0);
  await f.say({ user: 'UALLOWED', channel: 'CALLOWED', kind: 'mention' });
  await f.say({ user: 'UALLOWED' }); // Allowed users can always DM.
  assert.equal(f.calls.length, 2);
});

test('a browser handoff is not consumed by GET/unfurls, requires a valid origin, and binds one browser', async (t) => {
  const f = await fixture(t);
  const job = await f.build();
  const a = await f.browser(job.link), b = await f.browser(job.link);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.headers.get('referrer-policy'), 'strict-origin');
  const cookieA = a.headers.get('set-cookie').split(';')[0], cookieB = b.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.browser(`/agent/api/projects/${job.id}`, { cookie: cookieA })).status, 404);
  assert.equal((await f.browser(job.link, { method: 'POST', cookie: cookieA, origin: 'https://other.example' })).status, 403);
  const claim = await f.browser(job.link, { method: 'POST', cookie: cookieA });
  assert.equal(claim.status, 303); assert.equal(claim.headers.get('location'), `/agent/projects/${job.id}/`);
  assert.equal((await f.browser(job.link, { method: 'POST', cookie: cookieB })).status, 410);
  assert.equal((await f.browser(job.link, { cookie: cookieA })).status, 303);
  for (const route of [`/agent/api/projects/${job.id}`, `/agent/projects/${job.id}/`, `/agent/projects/${job.id}/preview`, `/agent/projects/${job.id}/download`]) {
    assert.equal((await f.browser(route, { cookie: cookieA })).status, 200);
    assert.equal((await f.browser(route, { cookie: cookieB })).status, 404);
  }
  await f.bot.poll();
  assert.match(f.updates.at(-1).text, /ready/);
  assert.equal(f.updates.at(-1).channel, 'DPRIVATE');
  const ready = f.updates.at(-1);
  const buttons = ready.blocks.flatMap((block) => block.elements || []);
  const download = buttons.find((button) => button.text?.text === 'Download ZIP');
  assert.ok(ready.text.includes(download.url)); // HTTP agents can read URLs from plain Slack text.
  assert.ok(ready.text.includes('Live preview:'));
  const zip = await fetch(download.url); // No cookies, credentials or browser claim.
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
});

test('pending Slack notifications resume with the same owner session after restart', async (t) => {
  const f = await fixture(t);
  const job = await f.build();
  await f.restart(); await f.bot.poll();
  assert.match(f.updates.at(-1).text, /ready/);
  assert.equal(f.updates.at(-1).channel, 'DPRIVATE');
  assert.equal(Object.keys((await f.state()).jobs).length, 0);
});

test('handoff links expire, can be refreshed only by their Slack owner, and retain project expiry', async (t) => {
  const f = await fixture(t);
  const job = await f.build();
  f.advance(600001);
  assert.equal((await f.browser(job.link)).status, 410);
  const body = { user: { id: 'UOWNER' }, team: { id: 'TTEAM' }, channel: { id: 'DPRIVATE' }, message: {} };
  await f.bot.onLink({ body: { ...body, user: { id: 'UOTHER' } }, action: { value: job.id } });
  assert.match(f.ephemerals.at(-1).text, /not found/);
  await f.bot.onLink({ body, action: { value: job.id } });
  const link = f.sent.at(-1).blocks[0].accessory.url;
  assert.notEqual(new URL(link).pathname, job.link);
  assert.equal((await f.browser(new URL(link).pathname)).status, 200);
  f.advance(LIMITS.ttl);
  assert.equal((await f.browser(new URL(link).pathname)).status, 410);
});

test('Slack uses the same daily allowance and never exposes or formats generated text as Slack commands', async (t) => {
  const limited = await fixture(t, { service: { dailyTokens: 1 } });
  await limited.say();
  assert.equal(limited.calls.length, 0);
  assert.match(limited.updates.at(-1).text, /daily token allowance/);
  const f = await fixture(t, { answer: { ...answer, message: '<!channel> <@UOTHER> & do something', canBuild: false } });
  await f.say();
  const sent = f.updates.at(-1);
  assert.ok(!sent.text.includes('<!channel>'));
  assert.equal(sent.blocks[0].text.type, 'plain_text');
  assert.equal(sent.unfurl_links, false);
  assert.equal(sent.link_names, false);
});

test('signed HTTP Slack events reject forged/stale payloads and acknowledge before work', async (t) => {
  const f = await fixture(t);
  assert.equal((await startSlackBot(f.service, { env: {} })).enabled, false);
  const calls = [], signingSecret = 'test-signing-secret';
  const bot = { onMessage: async (args) => { calls.push(args); }, onBuild: async (args) => { calls.push(args); }, onLink: async () => {} };
  const server = createServer(createSlackHttpHandler({ bot, signingSecret }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/slack/events`;
  async function post(body, { timestamp = String(Math.floor(Date.now() / 1000)), secret = signingSecret, form = false, raw } = {}) {
    raw ??= form ? new URLSearchParams({ payload: JSON.stringify(body) }).toString() : JSON.stringify(body);
    const signature = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex');
    return fetch(url, { method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', 'X-Slack-Signature': signature, 'X-Slack-Request-Timestamp': timestamp }, body: raw });
  }
  assert.equal((await post({ type: 'url_verification', challenge: 'hello' }, { secret: 'forged' })).status, 401);
  assert.equal((await post({}, { timestamp: '1000000000' })).status, 401);
  assert.deepEqual(await (await post({ type: 'url_verification', challenge: 'hello' })).json(), { challenge: 'hello' });
  assert.equal((await post({}, { raw: '{bad json' })).status, 400);
  assert.equal(calls.length, 0);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  bot.onMessage = async (args) => { calls.push(args); await pending; };
  const event = { type: 'event_callback', team_id: 'TTEAM', event_id: 'EHTTP', event: { type: 'app_mention', text: 'hello' } };
  assert.equal((await post(event)).status, 200); // Does not wait for the handler/model.
  release();
  assert.equal(calls[0].kind, 'mention');
  assert.equal((await post({ type: 'block_actions', actions: [{ action_id: 'demo_bot_build', value: 'offer' }] }, { form: true })).status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[1].action.value, 'offer');
  assert.equal((await post({}, { raw: 'x'.repeat(65537) })).status, 413);
});

test('HTTP Slack startup validates workspace and uses the Web API without a socket', async (t) => {
  const f = await fixture(t);
  class FakeClient {
    constructor() { this.chat = f.client.chat; this.conversations = f.client.conversations; this.auth = { test: async () => ({ team_id: 'TTEAM', user_id: 'UBOT' }) }; }
  }
  const env = { DEMO_AGENT_SLACK_ENABLED: '1', SLACK_BOT_TOKEN: 'xoxb-test', SLACK_SIGNING_SECRET: 'test-secret', SLACK_TEAM_ID: 'TTEAM', DEMO_AGENT_PUBLIC_URL: f.origin };
  const bot = await startSlackBot(f.service, { env, WebClient: FakeClient });
  assert.equal(bot.enabled, true);
  assert.equal(typeof bot.handle, 'function');
  await bot.stop();
  await assert.rejects(startSlackBot(f.service, { env: { ...env, SLACK_TEAM_ID: 'TOTHER' }, WebClient: FakeClient }), /different workspace/);
});

test('the Slack manifest and public origin enforce a bounded single-workspace integration', async () => {
  const manifest = JSON.parse(await readFile(new URL('../agent/slack-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.display_information.name, 'Demo Bot');
  assert.equal(manifest.settings.socket_mode_enabled, false);
  assert.deepEqual(manifest.settings.event_subscriptions.bot_events, ['app_mention', 'message.im', 'message.channels', 'message.groups']);
  assert.deepEqual(manifest.oauth_config.scopes.bot, ['app_mentions:read', 'chat:write', 'im:history', 'im:write', 'channels:history', 'groups:history']);
  assert.equal(slackPublicOrigin('http://localhost:4173'), 'http://localhost:4173');
  for (const url of ['http://public.example', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com/?key=secret']) assert.throws(() => slackPublicOrigin(url));
});

test('catalog examples use the gallery host while generated previews and ZIPs use the backend host', async (t) => {
  const catalog = JSON.parse(await readFile(new URL('../demos.json', import.meta.url), 'utf8'));
  const f = await fixture(t, { service: { catalog }, answer: { ...answer, canBuild: false,
    matches: [{ id: 'template-builder-api-v2', reason: 'Prepare and fill document templates.' }] } });
  await f.say({ content: 'Find the existing Template Builder demo' });
  assert.equal(f.updates.at(-1).blocks[1].accessory.url, 'https://demos.superdoc.dev/builder/');
  assert.equal(f.calls.length, 1);
  const generated = await fixture(t, { bot: { galleryUrl: 'https://other-gallery.example' } });
  await generated.say();
  assert.equal(generated.updates.at(-1).blocks[1].accessory.url, 'https://other-gallery.example/review/');
  await generated.build(); await generated.bot.poll();
  const links = generated.updates.at(-1).blocks.flatMap((block) => block.elements || []).filter((button) => button.url);
  assert.deepEqual(links.map((link) => link.text.text), ['Open live preview', 'Download ZIP']);
  assert.ok(links.every((link) => new URL(link.url).origin === generated.origin));
});

test('channel thread replies continue the same user conversation without another mention and ignore unrelated chatter', async (t) => {
  const f = await fixture(t);
  await f.say({ channel: 'CCHAN', kind: 'mention', ts: '111.001', content: 'Find an editor demo for our review workflow' });
  await f.say({ channel: 'CCHAN', thread: '111.001', content: 'How does that example handle editing?' });
  const input = JSON.parse(f.calls.at(-1).input);
  assert.equal(input.conversation[0].content, 'Find an editor demo for our review workflow');
  assert.match(input.conversation[1].content, /Review/);
  assert.equal(input.request, 'How does that example handle editing?');
  assert.equal(f.sent.at(-1).thread_ts, '111.001');
  const before = f.calls.length;
  await f.say({ channel: 'CCHAN', content: 'ordinary channel message' });
  await f.say({ channel: 'CCHAN', thread: '999.001', content: 'different thread' });
  await f.say({ user: 'UOTHER', channel: 'CCHAN', thread: '111.001', content: 'another person without an invocation' });
  assert.equal(f.calls.length, before);
  await f.restart();
  await f.say({ channel: 'CCHAN', thread: '111.001', content: 'And how would we adapt it?' });
  assert.equal(JSON.parse(f.calls.at(-1).input).conversation.length, 4);
  f.advance(LIMITS.ttl + 1);
  await f.say({ channel: 'CCHAN', thread: '111.001', content: 'expired discussion' });
  assert.equal(f.calls.length, before + 1);
});

test('DM replies to either the bot or initial user message retain the original context across restart', async (t) => {
  const f = await fixture(t);
  await f.say({ ts: '222.001', content: 'I need a document review example' });
  const botThread = f.sent.at(-1).ts;
  await f.restart();
  await f.say({ thread: botThread, content: 'Can we discuss that first?' });
  assert.equal(JSON.parse(f.calls.at(-1).input).conversation[0].content, 'I need a document review example');
  await f.say({ thread: '222.001', content: 'Does it work for my reviewers?' });
  assert.equal(JSON.parse(f.calls.at(-1).input).conversation.length, 4);
  assert.match(JSON.parse(f.calls.at(-1).input).conversation[1].content, /Review/);
});

test('mention and message subscriptions cannot generate duplicate responses for one Slack message', async (t) => {
  const f = await fixture(t);
  await f.say({ channel: 'CCHAN', kind: 'mention', ts: '333.001', id: 'EMENTION' });
  await f.say({ channel: 'CCHAN', thread: '333.001', ts: '334.001', kind: 'message', id: 'EMESSAGE' });
  await f.say({ channel: 'CCHAN', thread: '333.001', ts: '334.001', kind: 'mention', id: 'EDUPLICATE' });
  assert.equal(f.calls.length, 2);
});

test('refining a discussion invalidates old offers and a completed build remains part of its private conversation', async (t) => {
  const f = await fixture(t);
  const old = await f.say({ content: 'Build a document review example' });
  await f.say({ content: 'Before building, let’s discuss the reviewer workflow' });
  await f.bot.onBuild(old);
  assert.equal(f.calls.filter((call) => call.max_output_tokens === LIMITS.buildTokens).length, 0);
  assert.match(f.ephemerals.at(-1).text, /expired/);
  const job = await f.build(); await f.bot.poll();
  await f.say({ channel: 'DPRIVATE', thread: job.ts, content: 'How can I extend that example?' });
  const input = JSON.parse(f.calls.at(-1).input);
  assert.ok(input.conversation.some((entry) => entry.content.includes('now built: Word count')));
  assert.ok(!JSON.stringify(input.conversation).includes('/agent/open/'));
  assert.ok(!JSON.stringify(input.conversation).includes('/download/'));
});
