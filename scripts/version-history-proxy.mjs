// This module is also emitted into the Pages release as its advanced-mode Worker.
export function createVersionHistoryProxy(backendUrl, fetchBackend = fetch) {
  const backend = new URL(backendUrl);
  if (backend.protocol !== 'https:' || backend.username || backend.password
    || backend.pathname !== '/' || backend.search || backend.hash) {
    throw new Error('VERSION_HISTORY_BACKEND_URL must be an HTTPS origin');
  }
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const prefix = '/version-history';
      if (!url.pathname.startsWith(`${prefix}/api/`) && url.pathname !== `${prefix}/collaboration`) {
        return env.ASSETS.fetch(request);
      }
      const upstream = new URL(backend);
      upstream.pathname = url.pathname.slice(prefix.length);
      upstream.search = url.search;
      const forwarded = new Request(upstream, request);
      forwarded.headers.delete('host');
      // Return the upstream response intact, including WebSocket upgrades.
      return fetchBackend(new Request(forwarded, { redirect: 'manual' }));
    },
  };
}
