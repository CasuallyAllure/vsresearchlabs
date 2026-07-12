import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright smoke config — logged-out, read-only journeys only (see
 * tests/e2e/portal-smoke.spec.ts). No backend mutations, no auth, so this
 * runs the same whether or not Supabase env vars are configured locally.
 */
const PORT = Number(process.env.PORT ?? 5173);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
