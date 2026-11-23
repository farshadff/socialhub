import { defineConfig, devices } from '@playwright/test';

const acceptanceBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-out/test-results',
  reporter: [['html', { outputFolder: 'e2e-out/playwright-report' }]],
  fullyParallel: !acceptanceBaseURL,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: acceptanceBaseURL ?? 'http://localhost:8000',
    trace: 'on-first-retry',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/acceptance.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'acceptance',
      testMatch: '**/acceptance.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: acceptanceBaseURL ?? 'http://localhost:8000' },
    },
  ],
  webServer: acceptanceBaseURL ? undefined : {
    command: 'npm start',
    url: 'http://localhost:8000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
