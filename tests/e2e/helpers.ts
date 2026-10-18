import { expect, type Page } from '@playwright/test';

export interface TestCredentials {
  username: string;
  password: string;
}

export function testCredentials(): TestCredentials {
  const username = process.env.E2E_ADMIN_USERNAME;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error(
      '缺少 E2E_ADMIN_USERNAME 或 E2E_ADMIN_PASSWORD；请通过 Playwright 配置启动测试服务',
    );
  }
  return { username, password };
}

export async function login(page: Page, credentials = testCredentials()) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: /继续向前$/ })).toBeVisible();
}

export async function openQuestionNav(page: Page) {
  const trigger = page.getByRole('button', { name: '打开答题卡', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  const nav = page.getByRole('navigation', { name: '题号导航' });
  await expect(nav).toBeVisible();
  return nav;
}

export async function closeQuestionNav(page: Page) {
  const close = page.getByRole('button', { name: '关闭题号导航', exact: true });
  if (await close.isVisible()) {
    await close.click();
    await expect(page.getByRole('dialog', { name: '选择题号' })).not.toBeVisible();
  }
}
