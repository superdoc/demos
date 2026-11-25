import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDemoAgentProxy } from './demo-agent-proxy.mjs';

// Keep the gallery's backend secret server-side in local development too.
export function createGalleryAgentGateway(env = process.env) {
  const proxy = createDemoAgentProxy({ fetch: () => new Response('Not found', { status: 404 }) });
  return async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!['/agent/api/', '/agent/projects/', '/agent/open/'].some((prefix) => pathname.startsWith(prefix))) return false;
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    headers.set('CF-Connecting-IP', request.socket.remoteAddress || 'unknown');
    const forwarded = new Request(`http://${request.headers.host}${request.url}`, { method: request.method, headers,
      ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: Readable.toWeb(request), duplex: 'half' }) });
    const upstream = await proxy.fetch(forwarded, env);
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
    else response.end();
    return true;
  };
}
