import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { login, testCredentials } from '#e2e/helpers';

test('审计时间筛选使用 Reka 日期时间选择并正确提交、清空和重置', async ({ page }) => {
  await login(page);
  await page.goto('/admin/audit');
  await expect(
    page.getByRole('heading', { name: '审计日志', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('input[type="datetime-local"]:not([aria-hidden="true"])')).toHaveCount(
    0,
  );

  const selectTime = async (label: string, day: string, hour: string, minute: string) => {
    const picker = page.getByRole('group', { name: label, exact: true });
    await picker.getByRole('button', { name: '选择日期时间', exact: true }).click();
    const calendar = page.getByRole('dialog', { name: '选择日期时间', exact: true });
    const cell = calendar
      .locator('[data-reka-calendar-cell-trigger]:not([data-outside-view])')
      .filter({ hasText: new RegExp(`^${day}$`) });
    await expect(cell).toBeInViewport();
    const date = (await cell.getAttribute('data-value'))!.slice(0, 10);
    await cell.click();
    await expect(calendar).toBeHidden();
    for (const [part, value] of [
      ['hour', hour],
      ['minute', minute],
    ]) {
      const segment = picker.locator(`[data-reka-date-field-segment="${part}"]`);
      await segment.focus();
      await segment.pressSequentially(value);
      await expect(segment).toHaveText(value);
    }
    return page.evaluate((value) => new Date(value).toISOString(), `${date}T${hour}:${minute}:00`);
  };
  const from = await selectTime('开始时间', '10', '09', '15');
  const until = await selectTime('结束时间（不含）', '12', '18', '45');
  const applyFilters = async (kind: string) => {
    const response = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/v1/admin/${kind}-logs`,
    );
    await page.getByRole('button', { name: '应用筛选', exact: true }).click();
    const result = await response;
    expect(result.ok()).toBeTruthy();
    return new URL(result.url()).searchParams;
  };
  const query = await applyFilters('audit');
  expect(query.get('from')).toBe(from);
  expect(query.get('until')).toBe(until);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );

  const fromField = page.getByRole('group', { name: '开始时间', exact: true });
  const untilField = page.getByRole('group', { name: '结束时间（不含）', exact: true });
  await fromField.locator('..').getByRole('button', { name: '清空日期时间' }).click();
  await expect(fromField.locator('[data-reka-date-field-segment="day"]')).toHaveAttribute(
    'data-placeholder',
  );
  const clearedQuery = await applyFilters('audit');
  expect(clearedQuery.has('from')).toBe(false);
  expect(clearedQuery.get('until')).toBe(until);

  const resetResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/admin/audit-logs',
  );
  await page.getByRole('button', { name: '重置', exact: true }).click();
  const resetQuery = new URL((await resetResponse).url()).searchParams;
  expect(resetQuery.has('from')).toBe(false);
  expect(resetQuery.has('until')).toBe(false);
  await expect(page.getByRole('button', { name: '清空日期时间' })).toHaveCount(0);
  await expect(untilField.locator('[data-reka-date-field-segment="day"]')).toHaveAttribute(
    'data-placeholder',
  );
});

test('管理员审计页提供三类日志、筛选、分页和移动布局', async ({ page }, testInfo) => {
  await login(page);
  const csrfToken = (await (await page.request.get('/api/v1/auth/csrf')).json()).data.csrfToken;
  const username = `audit_e2e_${randomBytes(6).toString('hex')}`;
  const created = await page.request.post('/api/v1/admin/users', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { username, password: testCredentials().password },
  });
  expect(created.ok()).toBeTruthy();
  const userId = (await created.json()).data.id;
  await page.request.get('/api/v1/not-found-audit?token=must-not-be-logged');
  await page.request.post('/api/v1/auth/mobile/login', {
    data: { username, password: 'Wrong-password-not-logged-42!' },
  });

  for (let index = 0; index < 22; index += 1) await page.request.get('/api/v1/health');
  await page.goto('/admin/audit');
  await expect(
    page.getByRole('heading', { name: '审计日志', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: '操作审计', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByLabel('关键词', { exact: true }).fill(userId);
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  const operation = page.getByRole('table', { name: '操作审计记录' });
  await expect(operation).toContainText('user.created');
  await expect(operation).toContainText(userId);
  await expect(operation.locator('mark')).toContainText([userId]);
  await page.getByLabel('关键词', { exact: true }).fill('尚未应用的关键词');
  await expect(operation.locator('mark')).toContainText([userId]);
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重置', exact: true }).click();

  await page.getByRole('tab', { name: '接口日志', exact: true }).click();
  const api = page.getByRole('table', { name: '接口访问记录' });
  await expect(api).toBeVisible();
  const next = page.getByRole('button', { name: '下一页', exact: true });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByRole('navigation', { name: '日志分页' })).toContainText('第 2 /');
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByLabel('关键词', { exact: true }).fill('/api/[unmatched]');
  await page.getByLabel('HTTP 状态码', { exact: true }).fill('404');
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂无匹配日志' })).toBeVisible();
  await expect(page.getByText('must-not-be-logged')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('audit-api.png'), fullPage: true });
  await page.getByRole('button', { name: '重置', exact: true }).click();

  await page.getByRole('tab', { name: '登录日志', exact: true }).click();
  await page.getByLabel('关键词', { exact: true }).fill(username);
  await page.getByLabel('登录结果', { exact: true }).click();
  await page.getByRole('option', { name: '登录失败', exact: true }).click();
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  const logins = page.getByRole('table', { name: '登录记录' });
  await expect(logins).toContainText(username);
  await expect(logins.locator('mark').first()).toHaveText(username);
  await expect(logins).toContainText('登录失败');
  await expect(logins).toContainText('INVALID_CREDENTIALS');
  await expect(logins).not.toContainText('Wrong-password-not-logged-42!');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBeFalsy();
  await page.screenshot({ path: testInfo.outputPath('audit-login.png'), fullPage: true });
  await page.getByLabel('关键词', { exact: true }).fill('audit-log-no-match-unique');
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂无匹配日志' })).toBeVisible();
});

test('管理员可进入审计页，桌面提供导航且普通用户不能访问', async ({ page }, testInfo) => {
  await login(page);
  if (testInfo.project.name.includes('mobile')) {
    // 当前移动外壳隐藏顶部菜单，直接打开管理路由验证权限。
    await page.goto('/admin/audit');
  } else {
    await page.getByRole('link', { name: '审计日志', exact: true }).click();
  }
  await expect(page).toHaveURL(/\/admin\/audit$/);
  const csrfToken = (await (await page.request.get('/api/v1/auth/csrf')).json()).data.csrfToken;
  const username = `audit_plain_${randomBytes(6).toString('hex')}`;
  const password = testCredentials().password;
  expect(
    (
      await page.request.post('/api/v1/admin/users', {
        headers: { 'X-CSRF-Token': csrfToken },
        data: { username, password },
      })
    ).ok(),
  ).toBeTruthy();
  await page.context().clearCookies();
  await login(page, { username, password });
  await page.goto('/admin/audit');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: '审计日志', exact: true })).toHaveCount(0);
  for (const kind of ['audit', 'api', 'login']) {
    expect((await page.request.get(`/api/v1/admin/${kind}-logs`)).status()).toBe(403);
  }
});
