import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { csrfHeaders, login, testCredentials } from '#e2e/helpers';

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

test('桌面设置页移除账号与授权，修改密码弹窗支持校验、关闭和清空', async ({ page, isMobile }) => {
  test.skip(isMobile, '仅调整桌面端密码入口');
  await login(page);
  await page.goto('/settings');
  await expect(page.getByRole('region', { name: '账号与授权' })).toHaveCount(0);
  const trigger = page.getByRole('button', { name: '修改密码', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '修改密码', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  await dialog.getByLabel('新密码', { exact: true }).fill('temporary-password');
  await dialog.getByRole('button', { name: '显示新密码', exact: true }).click();
  await expect(dialog.getByLabel('新密码', { exact: true })).toHaveAttribute('type', 'text');
  await dialog.getByLabel('确认新密码', { exact: true }).fill('different-password');
  await expect(dialog.getByRole('alert')).toHaveText('两次输入的新密码不一致。');
  await expect(dialog.getByRole('button', { name: '确认修改', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByLabel('当前密码', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('新密码', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('确认新密码', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('新密码', { exact: true })).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings$/);
});

test('桌面密码弹窗可修改密码，成功后要求使用新密码登录', async ({ page, isMobile }) => {
  test.skip(isMobile, '仅调整桌面端密码入口');
  await login(page);
  const credentials = {
    username: `password_e2e_${randomBytes(6).toString('hex')}`,
    password: testCredentials().password,
  };
  const created = await page.request.post('/api/v1/admin/users', {
    headers: await csrfHeaders(page.request),
    data: credentials,
  });
  await expect(created).toBeOK();
  const logout = await page.request.post('/api/v1/auth/logout', {
    headers: await csrfHeaders(page.request),
    data: {},
  });
  await expect(logout).toBeOK();
  await login(page, credentials);
  await page.goto('/settings');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '修改密码', exact: true });
  const newPassword = `Changed!${randomBytes(16).toString('hex')}`;
  await dialog.getByLabel('当前密码', { exact: true }).fill(credentials.password);
  await dialog.getByLabel('新密码', { exact: true }).fill(newPassword);
  await dialog.getByLabel('确认新密码', { exact: true }).fill(newPassword);
  await dialog.getByRole('button', { name: '确认修改', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?changed=1$/);
  await expect(page.getByText('密码已修改', { exact: true })).toBeVisible();
  await login(page, { ...credentials, password: newPassword });
});
