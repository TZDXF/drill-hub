import { expect, test } from '@playwright/test';
import type { TokenUsageReport, TokenUsageTotals } from '@drill-hub/contracts';
import { login } from '#e2e/helpers';

function fixture(days = 30, empty = false): TokenUsageReport {
  const zero: TokenUsageTotals = {
    calls: 0,
    failedCalls: 0,
    unknownUsageCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  const totals: TokenUsageTotals = empty
    ? zero
    : {
        calls: 3,
        failedCalls: 1,
        unknownUsageCalls: 1,
        promptTokens: 1200,
        completionTokens: 300,
        totalTokens: 1500,
      };
  const end = Date.parse('2026-10-19T00:00:00.000Z');
  const daily = Array.from({ length: days }, (_, index) => ({
    ...(index === days - 1 ? totals : zero),
    date: new Date(end - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  }));
  return {
    days,
    utcOffsetMinutes: 480,
    fromDate: daily[0]!.date,
    toDate: daily.at(-1)!.date,
    totals,
    daily,
    models: empty
      ? []
      : [{ ...totals, connectionId: 'connection-visible-id', modelKey: 'example-grading-model' }],
  };
}

test('用量页可从设置进入，展示空状态并读取真实会话接口', async ({ page }) => {
  await login(page);
  const response = await page.request.get('/api/v1/me/token-usage?days=7&utcOffsetMinutes=480');
  await expect(response).toBeOK();
  expect((await response.json()).data.daily).toHaveLength(7);
  await page.route('**/api/v1/me/token-usage?**', (route) =>
    route.fulfill({
      json: { data: fixture(30, true), meta: {} },
    }),
  );
  await page.goto('/settings');
  await page.getByRole('main').getByRole('link', { name: 'Token 用量', exact: true }).click();
  await expect(page).toHaveURL(/\/token-usage$/);
  await expect(
    page.getByRole('heading', { name: 'Token 用量', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '这个时间段暂无模型调用' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '统计口径' })).toBeVisible();
});

test('用量页展示汇总趋势与模型，支持范围和全站切换且不横向溢出', async ({ page }, testInfo) => {
  await login(page);
  const requests: string[] = [];
  await page.route(/\/api\/v1\/(me|admin)\/token-usage\?/, (route) => {
    requests.push(route.request().url());
    const days = Number(new URL(route.request().url()).searchParams.get('days'));
    return route.fulfill({ json: { data: fixture(days), meta: {} } });
  });
  await page.goto('/token-usage');
  const stats = page.getByRole('region', { name: 'Token 用量概览' });
  await expect(stats).toContainText('1,500');
  await expect(page.getByText('用量未知 1 次', { exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: '模型用量排行' })).toContainText(
    'example-grading-model',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('token-usage.png'), fullPage: true });
  await page.getByLabel('统计范围', { exact: true }).click();
  await page.getByRole('option', { name: '最近 7 天', exact: true }).click();
  await expect(
    page.getByRole('list', { name: '每日 Token 趋势' }).getByRole('listitem'),
  ).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByText('查看每日明细', { exact: true }).click();
  await expect(page.getByRole('table', { name: '每日用量明细' })).toBeVisible();
  await page.getByLabel('用量归属', { exact: true }).click();
  await page.getByRole('option', { name: '全站用量', exact: true }).click();
  await expect.poll(() => requests.at(-1)).toContain('/admin/token-usage?days=7');
  await expect(stats).toContainText('1,500');
  await page.getByLabel('统计范围', { exact: true }).click();
  await page.getByRole('option', { name: '最近 90 天', exact: true }).click();
  await expect(
    page.getByRole('list', { name: '每日 Token 趋势' }).getByRole('listitem'),
  ).toHaveCount(90);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('用量读取失败可重试，并忽略切换筛选前的迟到响应', async ({ page }) => {
  await login(page);
  let count = 0;
  await page.route('**/api/v1/me/token-usage?**', (route) => {
    count += 1;
    return count === 1
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'UNAVAILABLE', message: '测试暂不可用' }, meta: {} },
        })
      : route.fulfill({ json: { data: fixture(), meta: {} } });
  });
  await page.goto('/token-usage');
  await expect(page.getByRole('heading', { name: '用量统计读取失败' })).toBeVisible();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Token 用量概览' })).toContainText('1,500');
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/me/token-usage?**', async (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get('days'));
    if (days === 7) await pending;
    await route.fulfill({ json: { data: fixture(days), meta: {} } });
  });
  await page.getByLabel('统计范围', { exact: true }).click();
  await page.getByRole('option', { name: '最近 7 天', exact: true }).click();
  await page.getByLabel('统计范围', { exact: true }).click();
  await page.getByRole('option', { name: '最近 90 天', exact: true }).click();
  await expect(
    page.getByRole('list', { name: '每日 Token 趋势' }).getByRole('listitem'),
  ).toHaveCount(90);
  const lateResponse = page.waitForResponse((response) =>
    response.url().includes('/me/token-usage?days=7&'),
  );
  release!();
  await lateResponse;
  await expect(
    page.getByRole('list', { name: '每日 Token 趋势' }).getByRole('listitem'),
  ).toHaveCount(90);
});
