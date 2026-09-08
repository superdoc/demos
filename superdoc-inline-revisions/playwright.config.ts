import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://127.0.0.1:4188',
    viewport: { width: 1440, height: 960 },
  },
  webServer: {
    command: 'pnpm preview --host 127.0.0.1 --port 4188',
    url: 'http://127.0.0.1:4188',
    reuseExistingServer: true,
  },
});
