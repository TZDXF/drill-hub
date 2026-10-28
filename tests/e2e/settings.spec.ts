import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('设置页隐藏页头描述，学习服务器仅展示名称与地址', async ({ page, isMobile }) => {
  await login(page);
  await page.goto('/settings');

  await expect(page.locator('.page-header h1')).toHaveText(isMobile ? '我的' : '我的设置');
  await expect(page.locator('.page-header p')).toHaveCount(0);

  const server = page.locator('section[aria-labelledby="server-title"]');
  if (isMobile) {
    await expect(server).toHaveCount(0);
    return;
  }

  await expect(server).toBeVisible();
  await expect(server.locator('dt')).toHaveText(['名称', '地址']);
  await expect(server).not.toContainText('实例');
  await expect(server).not.toContainText('API 主版本');
  await expect(server.locator('p')).toHaveCount(0);
});
