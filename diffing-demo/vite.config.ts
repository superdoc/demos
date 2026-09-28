import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: './',
  // Prebundling relocates SuperDoc and breaks the v2 worker's import.meta.url
  // asset resolution during development.
  optimizeDeps: {
    exclude: ['superdoc'],
  },
});
