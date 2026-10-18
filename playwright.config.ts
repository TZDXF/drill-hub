import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4179';
const username = process.env.E2E_ADMIN_USERNAME ?? `e2e_${randomBytes(8).toString('hex')}`;
const password = process.env.E2E_ADMIN_PASSWORD ?? `E2e!${randomBytes(24).toString('base64url')}`;
const encryptionKey = process.env.E2E_ENCRYPTION_KEY ?? randomBytes(32).toString('hex');

const e2eEnv = {
  E2E_BASE_URL: baseURL,
  E2E_ADMIN_USERNAME: username,
  E2E_ADMIN_PASSWORD: password,
  E2E_ENCRYPTION_KEY: encryptionKey,
  E2E_LOGIN_RATE_LIMIT_MAX: '100',
};

Object.assign(process.env, e2eEnv);

const webServerEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm build && pnpm exec tsx scripts/e2e-server.ts',
    url: `${baseURL}/api/v1/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: webServerEnv,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile-navigation\.spec\.ts/,
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
