import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.test.ts',
  // Pre-flight sweep kills orphans from a prior crashed run; teardown is the
  // post-run backstop. Together with the in-process cap in helpers/registry.ts
  // they guarantee the suite can never leave a pile of VS Code windows behind.
  globalSetup: require.resolve('./test/e2e/global-setup'),
  globalTeardown: require.resolve('./test/e2e/global-teardown'),
  // VS Code launches must be serial — concurrent Electron instances race on
  // user-data-dir, focus, and keyboard input driving the palette.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Retries stay enabled — the instance cap in helpers/registry.ts makes them
  // safe (a retry can never push past 2 live windows), so they buy launch
  // resilience at no blast-radius cost.
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
});
