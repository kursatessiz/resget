import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end suite for the public pages. It drives the full stack
 * (built API + built-and-started Next.js app) against a seeded Postgres
 * database; see docs/CICD_GUIDE.md "web-e2e" for how CI runs it.
 */

const WEB_PORT = 3000;
const API_PORT = 4000;
const baseURL = `http://localhost:${WEB_PORT}`;
const apiURL = `http://localhost:${API_PORT}`;

/** DATABASE_URL must point at an already migrated and seeded database; there is no safe local default. */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL must be set to run the web e2e suite (a migrated, seeded Postgres database). See docs/CICD_GUIDE.md.',
  );
}

// Throwaway defaults so the suite works locally without extra setup; CI sets its own values explicitly.
const jwtSecret = process.env.JWT_SECRET ?? 'web-e2e-throwaway-secret-0123456789abcdef';
const otpTestCode = process.env.OTP_TEST_CODE ?? '482915';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A preinstalled Chromium (sandboxes that must not download browsers); CI leaves this unset.
    launchOptions: process.env.PW_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  // Turkish is the base language and the scenarios select elements by their
  // Turkish labels, so the browser asks for Turkish unless a test overrides it.
  projects: [
    // Signs the owner in once; see e2e/owner.setup.ts.
    { name: 'setup', testMatch: /owner\.setup\.ts/, use: { ...devices['Desktop Chrome'], locale: 'tr-TR' } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], locale: 'tr-TR' }, dependencies: ['setup'] },
  ],
  // Both servers start fresh for every run so they always bind to the
  // DATABASE_URL this run was given, never to a stale process.
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: path.resolve(__dirname, '../api'),
      url: `${apiURL}/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: databaseUrl,
        JWT_SECRET: jwtSecret,
        OTP_TEST_CODE: otpTestCode,
        DOMAIN_VERIFIER: 'MOCK',
        AI_PROVIDER: 'MOCK',
        META_PROVIDER: 'MOCK',
        PUBLIC_APP_URL: baseURL,
        PUBLIC_API_URL: apiURL,
        CORS_ORIGIN: baseURL,
      },
    },
    {
      // `next build` runs here so the config is self-contained, as long as
      // @resget/shared is already built (the CI job's "Build" step).
      command: `pnpm exec next build && pnpm exec next start -p ${WEB_PORT}`,
      cwd: __dirname,
      url: `${baseURL}/`,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        API_INTERNAL_URL: apiURL,
        // Universal link files are served once the store identifiers are set (docs/MOBIL.md).
        IOS_APP_IDENTIFIER: 'ABCDE12345.com.resget.app',
        ANDROID_CERT_FINGERPRINTS:
          '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5',
      },
    },
  ],
});
