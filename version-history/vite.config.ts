import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': process.env.BACKEND_URL || 'http://127.0.0.1:4191',
      '/collaboration': { target: process.env.BACKEND_URL || 'http://127.0.0.1:4191', ws: true },
    },
  },
  preview: {
    proxy: {
      '/api': process.env.BACKEND_URL || 'http://127.0.0.1:4191',
      '/collaboration': { target: process.env.BACKEND_URL || 'http://127.0.0.1:4191', ws: true },
    },
  },
});
