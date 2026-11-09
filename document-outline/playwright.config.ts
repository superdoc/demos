import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: { baseURL: "http://127.0.0.1:4188", trace: "retain-on-failure" },
  webServer: {
    command: "npm run build && npm run preview -- --port 4188 --strictPort",
    url: "http://127.0.0.1:4188",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
