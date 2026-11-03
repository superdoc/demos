import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.BACKEND_URL || 'http://127.0.0.1:4191';
const proxy = {
  '/version-history/api': { target: backend, rewrite: (path: string) => path.slice('/version-history'.length) },
  '/version-history/collaboration': { target: backend, ws: true, rewrite: (path: string) => path.slice('/version-history'.length) },
  '/api': backend,
  '/collaboration': { target: backend, ws: true },
};

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || './',
  server: { proxy },
  preview: { proxy },
});
