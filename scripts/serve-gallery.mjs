import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { createAgentService } from "../agent/service.mjs";
import { startSlackBot } from "../agent/slack.mjs";
import { createGalleryAgentGateway } from './demo-agent-gateway.mjs';

const root = path.resolve(import.meta.dirname, "..", "dist-gallery");
const port = Number(process.env.PORT || 4173);
const agentAssets = new Set(['/agent/gallery.js', '/agent/project.js', '/agent/agent.css']);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const agent = process.env.DEMO_AGENT_BACKEND_URL
  ? { handle: createGalleryAgentGateway(), close() {} }
  : await createAgentService();
let slack;
try { if (!process.env.DEMO_AGENT_BACKEND_URL) slack = await startSlackBot(agent); }
catch { console.error('Demo Bot Slack did not start. Check agent/SLACK.md and server-side Slack settings.'); }
const server = createServer(async (request, response) => {
  try {
    if (new URL(request.url, 'http://localhost').pathname === '/slack/events') {
      if (slack?.enabled) await slack.handle(request, response);
      else response.writeHead(503).end('Slack is not configured on this gallery.');
      return;
    }
    if (await agent.handle(request, response)) return;
    const requestUrl = new URL(request.url, "http://localhost");
    if (requestUrl.pathname === "/revisions" || requestUrl.pathname.startsWith("/revisions/")) {
      const destination = requestUrl.pathname.replace(/^\/revisions(?:\/|$)/, "/custom-word-editor/");
      response.writeHead(301, { Location: `${destination}${requestUrl.search}` }).end();
      return;
    }
    const pathname = decodeURIComponent(requestUrl.pathname);
    // The project shell is read from source too; keep its scripts and styles in sync.
    const assetRoot = agentAssets.has(pathname) ? path.resolve(root, '..', 'dist-landing') : root;
    let filePath = path.resolve(assetRoot, `.${pathname}`);

    if (filePath !== assetRoot && !filePath.startsWith(`${assetRoot}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    let fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      if (!pathname.endsWith("/")) {
        response.writeHead(308, { Location: `${requestUrl.pathname}/${requestUrl.search}` }).end();
        return;
      }
      filePath = path.join(filePath, "index.html");
      fileStat = await stat(filePath);
    }

    const headers = {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Accept-Ranges": "bytes",
    };
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);

    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), fileStat.size - 1) : fileStat.size - 1;

      if (start > end || start >= fileStat.size) {
        response.writeHead(416, { "Content-Range": `bytes */${fileStat.size}` }).end();
        return;
      }

      response.writeHead(206, {
        ...headers,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      });
      createReadStream(filePath, { start, end }).pipe(response);
      return;
    }

    response.writeHead(200, { ...headers, "Content-Length": fileStat.size });
    createReadStream(filePath).pipe(response);
  } catch {
    if (response.headersSent) response.destroy();
    else response.writeHead(404).end("Not found");
  }
}).listen(port, () => {
  console.log(`SuperDoc demo gallery: http://localhost:${port}`);
});
server.on('close', () => { agent.close(); void slack?.stop().catch(() => {}); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
