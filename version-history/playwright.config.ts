import { defineConfig } from '@playwright/test';

const backendPort = Number(process.env.VH_TEST_BACKEND_PORT ?? 4193);
const frontendPort = Number(process.env.VH_TEST_FRONTEND_PORT ?? 4194);
const development = process.env.VH_TEST_DEV === '1';
const frontendCommand = development
  ? `BACKEND_URL=http://127.0.0.1:${backendPort} pnpm dev:client --host 127.0.0.1 --port ${frontendPort} --strictPort`
  : `BASE_PATH=/version-history/ pnpm build && BASE_PATH=/version-history/ BACKEND_URL=http://127.0.0.1:${backendPort} pnpm preview --host 127.0.0.1 --port ${frontendPort} --strictPort`;

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  workers: 1,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [{
    command: `PORT=${backendPort} DATA_DIRECTORY=./artifacts/changes-api-test-server node server/server.mjs`,
    url: `http://127.0.0.1:${backendPort}/api/health`,
    reuseExistingServer: !process.env.CI,
  }, {
    command: frontendCommand,
    url: `http://127.0.0.1:${frontendPort}${development ? '/' : '/version-history/'}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  }],
});
