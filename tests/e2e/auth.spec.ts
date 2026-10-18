import { expect, test } from '@playwright/test';
import { testCredentials } from './helpers';

test('错误凭据显示提示，正确凭据可进入真实首页', async ({ page }) => {
  const credentials = testCredentials();
  await page.goto('/login');

  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill('wrong-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.app-toast').filter({ hasText: '登录失败' })).toContainText(
    '用户名或密码错误',
  );
  await page.getByRole('button', { name: '关闭通知' }).click();

  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: /继续向前$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近作答' })).toBeVisible();
});
