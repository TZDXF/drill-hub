import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('设置页可导出学习数据快照', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '数据导出' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('settings-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^drill-hub-export-\d{4}-\d{2}-\d{2}\.json$/);
  const body = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    formatVersion: number;
    account: { username: string };
    topics: unknown[];
  };
  expect(body.formatVersion).toBe(1);
  expect(body.account.username).toBeTruthy();
  expect(Array.isArray(body.topics)).toBe(true);
});
