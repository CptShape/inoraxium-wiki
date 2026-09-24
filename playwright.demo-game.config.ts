import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/demo-game',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5178/inoraxium-wiki/',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    screenshot: 'only-on-failure',
  },
  outputDir: '.artifacts/demo-game/tests',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort',
    url: 'http://127.0.0.1:5178/inoraxium-wiki/',
    reuseExistingServer: !process.env.CI,
  },
});
