import { randomBytes } from 'node:crypto';
import { access, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// No browser, cookies or provider key. --build explicitly accepts any offered build.
export async function requestDemo({ url, token, prompt, build = false, output,
  fetchBackend = fetch, pollInterval = 2000, signal = AbortSignal.timeout(300000), onProgress = () => {} }) {
  const origin = new URL(url);
  const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use an HTTPS backend origin (HTTP localhost is allowed for testing).');
  if (!token) throw new Error('Set DEMO_BOT_TOKEN to the backend access credential.');
  if (output) {
    try { await access(output); throw new Error('The output file already exists. Choose a new filename.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!(await stat(path.dirname(path.resolve(output)))).isDirectory()) throw new Error('The output directory does not exist.');
  }
  const session = randomBytes(16).toString('hex');
  function endpoint(route) {
    const target = new URL(route, origin);
    if (target.origin !== origin.origin) throw new Error('The backend returned an unexpected link origin.');
    return target;
  }
  async function api(route, body) {
    const response = await fetchBackend(endpoint(route), { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Demo-Agent-Session': session,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal, redirect: 'error' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Demo Bot request failed (${response.status}).`);
    return data;
  }
  const result = await api('/agent/api/search', { prompt });
  if (!build || !result.offer) {
    if (output) throw new Error(result.message || 'No build was offered. Request a focused new demo to download its generated project.');
    return { message: result.message, matches: result.matches, buildAvailable: Boolean(result.offer) };
  }
  const project = await api('/agent/api/projects', { offer: result.offer });
  let status;
  do {
    status = await api(`/agent/api/projects/${project.id}`);
    if (status.state === 'failed') throw new Error(status.error || 'The demo build failed.');
    if (!['ready', 'building'].includes(status.state)) throw new Error('Unexpected project state.');
    onProgress(status.progress || status.state);
    if (status.state === 'building') await delay(pollInterval, undefined, { signal });
  } while (status.state !== 'ready');
  const links = await api(`/agent/api/projects/${project.id}/links`, {});
  // Validate links before returning them or contacting a download destination.
  const previewUrl = endpoint(links.previewUrl).href, downloadUrl = endpoint(links.downloadUrl).href;
  if (output) {
    // The ZIP URL authorizes only this download; never send the backend credential to it.
    const response = await fetchBackend(downloadUrl, { signal, redirect: 'error' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/zip')) throw new Error('The project download failed.');
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.readUInt32LE(0) !== 0x04034b50) throw new Error('The backend did not return a ZIP archive.');
    await writeFile(output, archive, { flag: 'wx', mode: 0o600 });
  }
  return { id: project.id, title: status.title, previewUrl, downloadUrl, previewExpiresAt: links.previewExpiresAt, expiresAt: links.expiresAt, ...(output ? { output } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2); const options = {};
    while (args.length) {
      const flag = args.shift();
      if (flag === '--build') options.build = true;
      else if (['--prompt', '--output'].includes(flag) && args[0] && !args[0].startsWith('--')) options[flag.slice(2)] = args.shift();
      else throw new Error('Usage: node scripts/request-demo.mjs --prompt "Build a focused demo..." [--build] [--output demo.zip]');
    }
    if (!options.prompt) throw new Error('Provide --prompt.');
    console.log(JSON.stringify(await requestDemo({ ...options,
      url: process.env.DEMO_BOT_URL || 'https://demo-bot-int-production.up.railway.app', token: process.env.DEMO_BOT_TOKEN,
      onProgress: (message) => console.error(message),
    }), null, 2));
  } catch (error) { console.error(error.code === 'EEXIST' ? 'The output file already exists. Choose a new filename.' : error.message); process.exitCode = 1; }
}
