import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('设置页不展示或请求登录会话管理', async ({ page }) => {
  const sessionRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/me/sessions')) {
      sessionRequests.push(request.url());
    }
  });
  await login(page);
  await page.goto('/settings');
  await expect(page.locator('.page-header h1')).toBeVisible();
  await expect(page.getByRole('region', { name: '登录会话' })).toHaveCount(0);
  expect(sessionRequests).toEqual([]);
});
