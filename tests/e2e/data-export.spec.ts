import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('设置页可导出学习数据快照', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '数据备份与导出' })).toBeVisible();
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
  await expect(page.locator('.settings-export-card__status')).toContainText('下载已开始');
  await expect(page.locator('.settings-export-card__status')).toContainText(
    download.suggestedFilename(),
  );
  await expect(page.getByTestId('settings-export')).toBeEnabled();
});

test('导出失败时显示内联错误并可直接重试', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  await page.route('**/api/v1/me/export', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'EXPORT_FAILED', message: '测试导出失败' },
        meta: {},
      }),
    });
  });

  await page.getByTestId('settings-export').click();
  await expect(page.getByRole('alert')).toContainText('操作失败（EXPORT_FAILED）');
  await expect(page.getByTestId('settings-export')).toHaveText('重新导出');

  await page.unroute('**/api/v1/me/export');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('settings-export').click();
  await downloadPromise;
  await expect(page.locator('.settings-export-card__status')).toContainText('下载已开始');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
