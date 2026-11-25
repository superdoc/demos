import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAgentService } from './service.mjs';
import { startSlackBot } from './slack.mjs';

if (process.env.NODE_ENV === 'production' && (!process.env.DEMO_AGENT_PROXY_TOKEN || !process.env.DEMO_AGENT_ORIGINS)) {
  throw new Error('Production requires DEMO_AGENT_PROXY_TOKEN and DEMO_AGENT_ORIGINS');
}
const service = await createAgentService();
let slack;
try { slack = await startSlackBot(service); }
catch { console.error('Demo Bot Slack did not start. Check agent/SLACK.md and server-side Slack settings.'); }
const assets = { '/agent/gallery.js': ['gallery.js', 'text/javascript'], '/agent/project.js': ['project.js', 'text/javascript'], '/agent/agent.css': ['agent.css', 'text/css'], '/superdoc-logo.png': ['../superdoc-logo.png', 'image/png'] };
const server = createServer(async (request, response) => {
  if (new URL(request.url, 'http://localhost').pathname === '/slack/events') {
    if (slack?.enabled) await slack.handle(request, response);
    else response.writeHead(503).end('Slack is not configured.');
    return;
  }
  if (await service.handle(request, response)) return;
  const asset = assets[new URL(request.url, 'http://localhost').pathname];
  if (!asset) { response.writeHead(404).end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
  response.end(await readFile(new URL(`../dist-landing/agent/${asset[0]}`, import.meta.url)));
});
server.listen(Number(process.env.PORT || 4180), () => console.log(`Demo agent: http://localhost:${server.address().port}`));
server.on('close', () => { service.close(); void slack?.stop().catch(() => {}); });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
