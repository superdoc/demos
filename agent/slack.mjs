import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { LIMITS } from './service.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const validId = (value) => typeof value === 'string' && /^[A-Z0-9]{2,40}$/.test(value);
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (value) => ({ type: 'plain_text', text: String(value).slice(0, 2800), emoji: false });
const section = (value) => ({ type: 'section', text: text(value) });
const linkButton = (label, url) => ({ type: 'button', action_id: 'demo_bot_open', text: text(label), url });
const publicError = (error) => error.status ? error.message.replace('This network', 'Your Slack account') : 'Demo Bot could not finish that request. Please try again.';

export function slackPublicOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Set DEMO_AGENT_PUBLIC_URL to the gallery or agent origin'); }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('DEMO_AGENT_PUBLIC_URL must be an HTTPS origin (HTTP localhost is allowed for development)');
  return url.origin;
}

// Uses the existing service instance: gallery and Slack share one token ledger,
// generation queue and project store. No browser cookies are exposed to Slack.
export async function createSlackBot({ service, client, teamId, botUserId, publicUrl, allowedUsers = [], allowedChannels = [], now = Date.now, pollInterval = 3000, autoPoll = true, log = () => console.error('Demo Bot Slack operation failed.') }) {
  if (!validId(teamId) || !validId(botUserId)) throw new Error('Slack workspace and bot identity are required');
  const origin = slackPublicOrigin(publicUrl);
  const filename = path.join(service.dataDirectory, 'slack-state.json');
  let state;
  try { state = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  state ||= { secret: randomBytes(32).toString('hex'), seen: {}, contexts: {}, offers: {}, jobs: {} };
  if (!/^[a-f0-9]{64}$/.test(state.secret) || !state.seen || !state.contexts || !state.offers || !state.jobs) throw new Error('Invalid Slack state');
  let writes = Promise.resolve(), polling = false, closed = false;
  const busy = new Set();
  function prune() {
    for (const bucket of ['seen', 'contexts', 'offers', 'jobs']) for (const [key, entry] of Object.entries(state[bucket])) if (entry.expiresAt <= now()) delete state[bucket][key];
    for (const [bucket, maximum] of [['seen', 2000], ['contexts', 200], ['offers', 200]]) {
      const entries = Object.entries(state[bucket]);
      for (const [key] of entries.slice(0, Math.max(0, entries.length - maximum))) delete state[bucket][key];
    }
  }
  function save() {
    prune();
    const snapshot = JSON.stringify(state);
    const operation = writes.then(async () => {
      const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
      try { await writeFile(temporary, snapshot, { mode: 0o600 }); await rename(temporary, filename); }
      finally { await rm(temporary, { force: true }); }
    });
    writes = operation.catch(() => {});
    return operation;
  }
  await save();
  const caller = (user) => ({
    session: createHmac('sha256', state.secret).update(`${teamId}:${user}`).digest('hex').slice(0, 32),
    identity: digest(`slack:${teamId}:${user}`),
  });
  function permitted(team, user, channel, direct) {
    return team === teamId && validId(user) && validId(channel) && user !== botUserId
      && (!allowedUsers.length || allowedUsers.includes(user))
      && (direct || !allowedChannels.length || allowedChannels.includes(channel));
  }
  async function once(value) {
    prune(); const key = digest(value);
    if (state.seen[key]) return false;
    state.seen[key] = { expiresAt: now() + 24 * LIMITS.ttl };
    await save(); return true;
  }
  const message = (channel, thread, value, blocks) => ({ channel, ...(thread ? { thread_ts: thread } : {}), text: escape(value).slice(0, 3000), ...(blocks ? { blocks } : {}), unfurl_links: false, unfurl_media: false, link_names: false, parse: 'none' });
  const update = (channel, ts, value, blocks = [section(value)]) => client.chat.update({ ...message(channel, null, value, blocks), ts });
  const ephemeral = (channel, user, value) => client.chat.postEphemeral({ channel, user, text: escape(value), link_names: false, parse: 'none' });
  const absolute = (route) => new URL(route, origin).href;
  function resultBlocks(result) {
    const blocks = [section(result.message)];
    for (const match of result.matches) {
      const url = new URL(match.liveDemoUri, origin);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      blocks.push({ ...section(`${match.title}\n${match.reason}`), accessory: linkButton('Open demo', url.href) });
    }
    if (result.offer) blocks.push({ type: 'actions', elements: [{ type: 'button', action_id: 'demo_bot_build', text: text('Build this demo'), style: 'primary', value: result.offer }] });
    return blocks;
  }
  async function onMessage({ event, body = {}, context = {}, kind = 'message' }) {
    const team = body.team_id || context.teamId;
    const direct = event.channel_type === 'im';
    if (closed || event.bot_id || event.subtype || !event.user || (kind !== 'mention' && !direct)
      || !permitted(team, event.user, event.channel, direct)) return;
    const thread = event.thread_ts || (direct ? undefined : event.ts);
    const key = digest(`${team}:${event.user}:${event.channel}:${thread || 'dm'}`);
    if (!await once(`message:${body.event_id || `${team}:${event.channel}:${event.ts}`}`)) return;
    if (busy.has(key)) { await ephemeral(event.channel, event.user, 'Please wait for the current reply, then send your next message.'); return; }
    busy.add(key);
    let pending;
    try {
      const prompt = String(event.text || '').replaceAll(`<@${botUserId}>`, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').trim();
      if (!prompt || prompt.length > LIMITS.prompt) {
        await client.chat.postMessage(message(event.channel, thread, `Describe the SuperDoc demo you need in 1–${LIMITS.prompt} characters. I can find an example or offer to build a focused one.`)); return;
      }
      pending = await client.chat.postMessage(message(event.channel, thread, 'Thinking…'));
      const result = await service.search({ prompt, history: state.contexts[key]?.history || [] }, caller(event.user));
      state.contexts[key] = { history: [...(state.contexts[key]?.history || []), { role: 'user', content: prompt.slice(0, 600) }, { role: 'assistant', content: result.message.slice(0, 600) }].slice(-4), expiresAt: now() + LIMITS.ttl };
      if (result.offer) state.offers[result.offer] = { user: event.user, team, channel: event.channel, ts: pending.ts, expiresAt: now() + 600000 };
      await save();
      await update(event.channel, pending.ts, result.message, resultBlocks(result));
    } catch (error) {
      log();
      try {
        if (pending?.ts) await update(event.channel, pending.ts, publicError(error));
        else await client.chat.postMessage(message(event.channel, thread, publicError(error)));
      } catch { log(); }
    } finally { busy.delete(key); }
  }
  const projectBlocks = (job, status) => [
    section(status.state === 'ready' ? `${status.title}\n${status.summary}` : `Creating a custom demo for you.\n${status.progress || 'This usually takes a minute or two.'}`),
    { type: 'actions', elements: [linkButton(status.state === 'ready' ? 'Open preview & download' : 'Open build progress', absolute(job.link)), { type: 'button', action_id: 'demo_bot_link', text: text('Get a fresh private link'), value: job.id }] },
    { type: 'context', elements: [text('Private browser link · Open it within 10 minutes · Project expires one hour after it is ready')] },
  ];
  async function poll() {
    if (polling || closed) return;
    polling = true;
    try {
      for (const [id, job] of Object.entries(state.jobs)) {
        try {
          const status = service.projectStatus(id, caller(job.user).session);
          if (status.state === 'building') {
            if (status.progress !== job.progress) { await update(job.channel, job.ts, `Demo Bot: ${status.progress}`, projectBlocks(job, status)); job.progress = status.progress; await save(); }
          } else {
            if (status.state === 'ready') await update(job.channel, job.ts, `Your demo is ready: ${status.title}`, projectBlocks(job, status));
            else await update(job.channel, job.ts, status.error || 'The demo could not be built. Send a new request to try a smaller feature.');
            delete state.jobs[id]; await save();
          }
        } catch (error) {
          if (error.status) {
            try { await update(job.channel, job.ts, publicError(error)); delete state.jobs[id]; await save(); } catch { log(); }
          } else log();
        }
      }
    } finally { polling = false; }
  }
  async function onBuild({ body, action }) {
    const user = body.user?.id, team = body.team?.id, channel = body.channel?.id;
    if (!permitted(team, user, channel, channel?.startsWith('D'))) return;
    const offer = state.offers[action.value];
    if (!offer || offer.expiresAt <= now() || offer.user !== user || offer.team !== team || offer.channel !== channel || offer.ts !== body.message?.ts) {
      await ephemeral(channel, user, 'This offer belongs to its requester or has expired. Send your own message to Demo Bot for a fresh offer.'); return;
    }
    if (!await once(`build:${action.value}`)) return;
    delete state.offers[action.value]; await save();
    let pending, dm;
    try {
      // Confirm private delivery before spending any generation allowance.
      dm = (await client.conversations.open({ users: user })).channel.id;
      pending = await client.chat.postMessage(message(dm, null, 'Creating a custom demo for you. This usually takes a minute or two.'));
      const project = await service.startProject(action.value, caller(user));
      const link = await service.createHandoff(project.id, caller(user).session);
      const status = service.projectStatus(project.id, caller(user).session);
      state.jobs[project.id] = { id: project.id, user, channel: dm, ts: pending.ts, link, progress: status.progress, expiresAt: status.expiresAt };
      await save();
      await update(channel, body.message.ts, 'Your build has started. I sent a private preview link in a direct message.');
      await update(dm, pending.ts, 'Creating your custom demo. Open the private link to follow along.', projectBlocks(state.jobs[project.id], status));
      if (autoPoll) void poll();
    } catch (error) {
      log();
      if (pending?.ts) await update(dm, pending.ts, publicError(error)).catch(log);
      else await ephemeral(channel, user, 'I could not send you a private message. Allow DMs from this app and try a fresh offer.').catch(log);
    }
  }
  async function onLink({ body, action }) {
    const user = body.user?.id, team = body.team?.id, channel = body.channel?.id;
    if (!permitted(team, user, channel, true) || !channel.startsWith('D') || !/^[a-f0-9]{32}$/.test(action.value || '')) return;
    try {
      const link = await service.createHandoff(action.value, caller(user).session);
      await client.chat.postMessage(message(channel, body.message?.thread_ts, 'Your fresh private preview link is ready.', [{ ...section('Open this link within 10 minutes. It connects the project to this browser.'), accessory: linkButton('Open demo', absolute(link)) }]));
    } catch (error) { await ephemeral(channel, user, publicError(error)).catch(log); }
  }
  const timer = autoPoll ? setInterval(() => void poll().catch(log), pollInterval) : null;
  timer?.unref();
  if (autoPoll) void poll(); // Resume pending project notifications after a process restart.
  return { onMessage, onBuild, onLink, poll, close: async () => { closed = true; clearInterval(timer); await writes; } };
}

// Slack signs the exact raw body; authenticate before parsing or acknowledging.
export function createSlackHttpHandler({ bot, signingSecret, now = Date.now, log = () => console.error('Demo Bot Slack HTTP operation failed.') }) {
  return async function handle(request, response) {
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (request.method !== 'POST') { send(405, { error: 'POST required.' }); return; }
    const timestamp = request.headers['x-slack-request-timestamp'];
    const signature = request.headers['x-slack-signature'];
    if (!/^\d{10}$/.test(timestamp || '') || Math.abs(now() / 1000 - Number(timestamp)) > 300 || !/^v0=[a-f0-9]{64}$/.test(signature || '')) { send(401, { error: 'Invalid Slack signature.' }); return; }
    let raw, body;
    try {
      let length = 0; const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 65536) { send(413, { error: 'Request too large.' }); return; }
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks);
      const expected = 'v0=' + createHmac('sha256', signingSecret).update(`v0:${timestamp}:`).update(raw).digest('hex');
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) { send(401, { error: 'Invalid Slack signature.' }); return; }
      const type = request.headers['content-type'] || '';
      if (type.startsWith('application/json')) body = JSON.parse(raw.toString());
      else if (type.startsWith('application/x-www-form-urlencoded')) body = JSON.parse(new URLSearchParams(raw.toString()).get('payload'));
      else { send(415, { error: 'Unsupported content type.' }); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    } catch { send(400, { error: 'Invalid Slack payload.' }); return; }
    if (body.type === 'url_verification' && typeof body.challenge === 'string') { send(200, { challenge: body.challenge }); return; }
    // Acknowledge before any Slack API calls or generation work (Slack's 3s deadline).
    send(200, { ok: true });
    void Promise.resolve().then(async () => {
      if (body.type === 'event_callback' && ['app_mention', 'message'].includes(body.event?.type)) {
        await bot.onMessage({ body, event: body.event, kind: body.event.type === 'app_mention' ? 'mention' : 'message' });
      } else if (body.type === 'block_actions' && body.actions?.length === 1) {
        const action = body.actions[0];
        if (action.action_id === 'demo_bot_build') await bot.onBuild({ body, action });
        if (action.action_id === 'demo_bot_link') await bot.onLink({ body, action });
      }
    }).catch(log);
  };
}

export async function startSlackBot(service, { env = process.env, WebClient } = {}) {
  if (env.DEMO_AGENT_SLACK_ENABLED !== '1') return { enabled: false, stop: async () => {} };
  if (!env.SLACK_BOT_TOKEN?.startsWith('xoxb-') || !env.SLACK_SIGNING_SECRET) throw new Error('Slack requires SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET');
  const publicUrl = slackPublicOrigin(env.DEMO_AGENT_PUBLIC_URL);
  const Client = WebClient || (await import('@slack/web-api')).WebClient;
  // Never log provider payloads, message contents, tokens, or API response bodies.
  const logger = { debug() {}, info() {}, warn() {}, error() { console.error('Demo Bot Slack transport error.'); }, setLevel() {}, getLevel() { return 'error'; }, setName() {} };
  const client = new Client(env.SLACK_BOT_TOKEN, { logger, retryConfig: { retries: 2 } });
  const auth = await client.auth.test();
  if (env.SLACK_TEAM_ID && auth.team_id !== env.SLACK_TEAM_ID) throw new Error('Slack token belongs to a different workspace');
  const bot = await createSlackBot({ service, client, teamId: auth.team_id, botUserId: auth.user_id, publicUrl,
    allowedUsers: (env.SLACK_ALLOWED_USERS || '').split(',').map((id) => id.trim()).filter(Boolean),
    allowedChannels: (env.SLACK_ALLOWED_CHANNELS || '').split(',').map((id) => id.trim()).filter(Boolean),
  });
  console.log('Demo Bot Slack HTTP events enabled.');
  return { enabled: true, handle: createSlackHttpHandler({ bot, signingSecret: env.SLACK_SIGNING_SECRET }), stop: () => bot.close() };
}
