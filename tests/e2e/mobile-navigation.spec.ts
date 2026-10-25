import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('手机视口可通过底部导航切换页面', async ({ page }, testInfo) => {
  expect(testInfo.project.name).toBe('chromium-mobile');
  await login(page);

  await expect(page.locator('.topbar')).toBeHidden();
  const mobileNav = page.getByRole('navigation', { name: '手机主导航' });
  await expect(mobileNav).toBeVisible();
  await mobileNav.getByRole('link', { name: '主题', exact: true }).click();

  await expect(page).toHaveURL(/\/topics$/);
  await expect(page.getByRole('heading', { name: '学习主题' })).toBeVisible();
});

test('手机视口助手面板全屏覆盖并可关闭', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '学习助手' }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();
  // 手机上助手面板为全屏覆盖，铺满视口。
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBeGreaterThanOrEqual(350);

  await page.getByTestId('assistant-close').click();
  await expect(page.getByTestId('assistant-panel')).toBeHidden();
});

test('手机端我的页面展示可编辑的个人信息，并提供清晰的密码设置', async ({ page }) => {
  await login(page);
  await page.goto('/settings');

  await expect(page.getByRole('heading', { name: '我的', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '登录会话' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '学习服务器' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '答题后自动提交' })).toHaveCount(0);

  await page.getByRole('button', { name: '编辑个人信息', exact: true }).click();
  await expect(page.getByLabel('时区', { exact: true })).toHaveCount(0);
  await page.getByLabel('显示名称', { exact: true }).fill('移动端学习者');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('个人信息已更新', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-display')).toContainText('移动端学习者');

  const meResponse = await page.request.get('/api/v1/me');
  await expect(meResponse).toBeOK();
  expect((await meResponse.json()).data).not.toHaveProperty('timezone');

  await page.getByRole('link', { name: '修改密码', exact: true }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible();

  const newPassword = page.getByLabel('新密码', { exact: true });
  await expect(newPassword).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: '显示新密码', exact: true }).click();
  await expect(newPassword).toHaveAttribute('type', 'text');
  await newPassword.fill('abcd');
  await page.getByLabel('确认新密码', { exact: true }).fill('abce');
  await expect(page.getByText('两次输入的新密码不一致。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认修改', exact: true })).toBeDisabled();

  await page.getByRole('link', { name: '返回个人设置', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
