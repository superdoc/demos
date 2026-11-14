import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'agent-presence.spec.ts',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
});
