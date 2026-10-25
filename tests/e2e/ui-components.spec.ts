import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('Reka 下拉、滚动区域与通知组件协同工作', async ({ page }, testInfo) => {
  await login(page);

  if (testInfo.project.name === 'chromium-desktop') {
    await expect(page.locator('.sidebar-nav-scroll .app-scroll-area__viewport')).toBeVisible();
  } else {
    await expect(page.getByRole('navigation', { name: '手机主导航' })).toBeVisible();
  }
  await page.goto('/history');
  await expect(
    page.getByRole('heading', { name: '学习历史', exact: true, level: 1 }),
  ).toBeVisible();

  const kind = page.getByRole('combobox', { name: '类型' });
  await kind.click();
  await expect(page.getByRole('option', { name: '练习', exact: true })).toBeVisible();
  await page.getByRole('option', { name: '练习', exact: true }).click();
  await expect(kind).toContainText('练习');

  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(page.locator('.app-toast--error')).toHaveCount(0);
});
