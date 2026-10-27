import { expect, test } from '@playwright/test';
import type { ApiResponse, SessionView } from '@drill-hub/contracts';
import { login, testCredentials } from '#e2e/helpers';

test('设置页按服务端会话渠道和创建时间展示，并可撤销其他会话', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '会话管理仅在桌面布局显示');
  await login(page);
  const mobileLogin = await page.request.post('/api/v1/auth/mobile/login', {
    data: testCredentials(),
  });
  expect(mobileLogin.ok()).toBeTruthy();
  const response = await page.request.get('/api/v1/me/sessions');
  expect(response.ok()).toBeTruthy();
  const sessions = ((await response.json()) as ApiResponse<SessionView[]>).data;
  const current = sessions.find((session) => session.current);
  const mobile = sessions.find((session) => session.channel === 'mobile' && !session.current);
  expect(current?.channel).toBe('web');
  expect(mobile).toBeDefined();

  await page.goto('/settings');
  const section = page.getByRole('region', { name: '登录会话' });
  const webRow = section.locator('.settings-session-row').filter({ hasText: 'Web 浏览器' });
  const mobileRow = section.locator('.settings-session-row').filter({ hasText: 'Android' });
  await expect(webRow.filter({ hasText: '当前' })).toHaveCount(1);
  await expect(
    webRow.filter({ hasText: '当前' }).getByRole('button', { name: '撤销' }),
  ).toBeDisabled();
  await expect(mobileRow).toHaveCount(1);
  const createdAt = await page.evaluate(
    (value) =>
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value)),
    mobile!.createdAt,
  );
  await expect(mobileRow).toContainText(`创建于 ${createdAt}`);
  await expect(mobileRow).not.toContainText('最近使用');
  await mobileRow.getByRole('button', { name: '撤销' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '撤销会话' }).click();
  await expect(mobileRow).toHaveCount(0);
  const after = (
    (await (await page.request.get('/api/v1/me/sessions')).json()) as ApiResponse<SessionView[]>
  ).data;
  expect(after.some((session) => session.id === mobile!.id)).toBe(false);
});
