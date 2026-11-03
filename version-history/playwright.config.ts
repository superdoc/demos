import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  workers: 1,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:4194',
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [{
    command: 'PORT=4193 DATA_DIRECTORY=./artifacts/test-server node server/server.mjs',
    url: 'http://127.0.0.1:4193/api/health',
    reuseExistingServer: !process.env.CI,
  }, {
    command: 'BASE_PATH=/version-history/ pnpm build && BASE_PATH=/version-history/ BACKEND_URL=http://127.0.0.1:4193 pnpm preview --host 127.0.0.1 --port 4194 --strictPort',
    url: 'http://127.0.0.1:4194/version-history/',
    reuseExistingServer: !process.env.CI,
  }],
});
