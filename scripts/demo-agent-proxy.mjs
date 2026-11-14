// Included in the gallery's existing Cloudflare Pages Worker.
export function createDemoAgentProxy(fallback, fetchBackend = fetch) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/agent/api/') && !url.pathname.startsWith('/agent/projects/')) return fallback.fetch(request, env);
      if (!env.DEMO_AGENT_BACKEND_URL || !env.DEMO_AGENT_PROXY_TOKEN) {
        return Response.json({ error: 'The demo agent is not configured on this gallery yet.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      const upstream = new URL(env.DEMO_AGENT_BACKEND_URL);
      if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) {
        return Response.json({ error: 'Invalid demo agent backend configuration.' }, { status: 503 });
      }
      upstream.pathname = url.pathname;
      upstream.search = url.search;
      const forwarded = new Request(upstream, request);
      forwarded.headers.delete('host');
      forwarded.headers.set('X-Demo-Agent-Token', env.DEMO_AGENT_PROXY_TOKEN);
      forwarded.headers.set('X-Demo-Client-IP', request.headers.get('CF-Connecting-IP') || 'unknown');
      try { return await fetchBackend(new Request(forwarded, { redirect: 'manual' })); }
      catch { return Response.json({ error: 'The demo agent is temporarily unavailable.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } }); }
    },
  };
}
