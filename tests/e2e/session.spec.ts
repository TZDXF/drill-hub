import { expect, test } from '@playwright/test';
import { login, testCredentials } from '#e2e/helpers';

test('退出登录后无法继续访问受保护页面，并可重新登录', async ({ page }, testInfo) => {
  await login(page);

  if (testInfo.project.name === 'chromium-mobile') {
    await page
      .getByRole('navigation', { name: '手机主导航' })
      .getByRole('link', { name: '我的', exact: true })
      .click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
  } else {
    await page.locator('.user-trigger').click();
    await page.getByRole('menuitem', { name: '退出登录' }).click();
  }
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();

  await page.goto('/topics');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();

  const credentials = testCredentials();
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect(page.getByRole('heading', { name: '学习主题', level: 1 })).toBeVisible();
});
