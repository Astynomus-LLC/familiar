import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  use: { baseURL: 'http://localhost:3210', headless: true },
  webServer: {
    command: 'npx tsx test/browser-server.ts',
    url: 'http://localhost:3210',
    reuseExistingServer: false,
  },
  reporter: 'list',
});
