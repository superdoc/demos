import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const backend = process.env.BACKEND_URL || 'http://127.0.0.1:4191';
// Optional verification of local Orbit changes. Normal builds use the pinned
// npm prerelease; local artifacts stay outside this public repository.
const localBuild = process.env.SUPERDOC_LOCAL_ES;
const localSource = process.env.SUPERDOC_LOCAL_SOURCE;
if (!!localBuild !== !!localSource) throw new Error('Set both SUPERDOC_LOCAL_ES and SUPERDOC_LOCAL_SOURCE for a local SuperDoc build');
const publicRoot = localSource ? path.resolve(localSource, '../..') : '';
const proxy = {
  '/version-history/api': { target: backend, rewrite: (path: string) => path.slice('/version-history'.length) },
  '/version-history/collaboration': { target: backend, ws: true, rewrite: (path: string) => path.slice('/version-history'.length) },
  '/api': backend,
  '/collaboration': { target: backend, ws: true },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: localBuild && localSource ? [
      { find: /^superdoc$/, replacement: path.join(localBuild, 'superdoc.es.js') },
      { find: 'superdoc/style.css', replacement: path.join(localBuild, 'style.css') },
      { find: 'superdoc/ui/react', replacement: path.join(localBuild, 'ui-react.es.js') },
      { find: 'superdoc/ui', replacement: path.join(localBuild, 'ui.es.js') },
      { find: 'vue', replacement: path.join(localSource, 'node_modules/vue/dist/vue.runtime.esm-bundler.js') },
    ] : [],
  },
  optimizeDeps: {
    exclude: ['superdoc'],
    // SuperDoc's React UI imports this CommonJS shim. Prebundle it even though
    // the parent package is excluded, so browsers receive named ESM exports.
    include: ['superdoc > use-sync-external-store/shim'],
  },
  base: process.env.BASE_PATH || './',
  server: { proxy, ...(localBuild && localSource ? { fs: { allow: [process.cwd(), localBuild, publicRoot] } } : {}) },
  preview: { proxy },
});
