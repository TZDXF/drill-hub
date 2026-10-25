import { expect, test } from '@playwright/test';
import type { GradingProfile, ModelConnectionView, ProviderModel } from '@drill-hub/contracts';
import { login } from '#e2e/helpers';

test('评分配置支持更换模型、并发设置以及列表快速切换', async ({ page }) => {
  await login(page);
  const base = {
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    revision: 1,
  };
  const connection: ModelConnectionView = {
    ...base,
    id: 'test-connection',
    displayName: '测试供应商',
    protocol: 'chat_completions',
    baseUrl: 'https://provider.test/v1',
    enabled: true,
    configVersion: 1,
    apiKeyConfigured: true,
  };
  const models: ProviderModel[] = ['alpha', 'beta', 'unverified'].map((key) => ({
    ...base,
    id: `model-${key}`,
    connectionId: connection.id,
    modelKey: key,
    displayName: `${key} 模型`,
    enabled: true,
    contextWindow: 128000,
    maxTokens: 16384,
    reasoning: false,
    input: ['text'],
    costPerMillion: null,
  }));
  const profiles: GradingProfile[] = [];
  const writes: Record<string, unknown>[] = [];
  let nextId = 0;
  await page.route('**/api/v1/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      const data = path.endsWith('/model-adapters')
        ? [{ protocol: 'chat_completions', displayName: 'Chat Completions' }]
        : path.endsWith('/model-connections')
          ? [connection]
          : path.endsWith('/models')
            ? models
            : path.endsWith('/grading-profiles')
              ? profiles
              : null;
      if (data === null) return route.continue();
      return route.fulfill({ json: { data } });
    }
    if (!path.includes('/grading-profiles')) return route.continue();
    const body = request.postDataJSON() as Record<string, unknown>;
    writes.push(body);
    const source =
      request.method() === 'PATCH'
        ? profiles.find((profile) => path.endsWith(`/${profile.id}`))
        : undefined;
    const model = models.find((item) => item.id === body.providerModelId)!;
    const profile: GradingProfile = {
      ...base,
      id: `profile-${++nextId}`,
      providerModelId: model.id,
      modelIdSnapshot: model.modelKey,
      connectionVersionId: 'connection-version-1',
      concurrency: Number(body.concurrency ?? source?.concurrency ?? 2),
      timeoutMs: Number(body.timeoutMs ?? source?.timeoutMs ?? 30000),
      maxRetries: Number(body.maxRetries ?? source?.maxRetries ?? 2),
      isDefault: Boolean(body.isDefault ?? source?.isDefault ?? false),
    };
    if (source) expect(body.expectedRevision).toBe(source.revision);
    if (profile.isDefault)
      profiles.forEach((item) => {
        if (item.isDefault) {
          item.isDefault = false;
          item.revision += 1;
        }
      });
    profiles.unshift(profile);
    return route.fulfill({
      status: request.method() === 'POST' ? 201 : 200,
      json: { data: profile },
    });
  });

  await page.goto('/admin/settings/models');
  const alpha = page
    .locator('.list-card')
    .filter({ has: page.getByRole('heading', { name: 'alpha 模型', exact: true }) });
  const beta = page
    .locator('.list-card')
    .filter({ has: page.getByRole('heading', { name: 'beta 模型', exact: true }) });
  const unverified = page
    .locator('.list-card')
    .filter({ has: page.getByRole('heading', { name: 'unverified 模型', exact: true }) });
  await expect(page.getByRole('button', { name: '评分测试', exact: true })).toHaveCount(0);
  await expect(page.getByText('未运行评分测试', { exact: true })).toHaveCount(0);
  await expect(unverified.getByRole('button', { name: '设为评分模型', exact: true })).toBeEnabled();
  const layout = await alpha.evaluate((card) => ({
    bodyWidth: card.querySelector('.list-card__body')!.getBoundingClientRect().width,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  expect(layout.bodyWidth).toBeGreaterThan(100);
  expect(layout.overflow).toBe(false);
  await alpha.getByRole('button', { name: '设为评分模型', exact: true }).click();
  await expect(alpha.getByText('评分模型', { exact: true })).toBeVisible();
  expect(writes[0]).toMatchObject({
    providerModelId: 'model-alpha',
    concurrency: 2,
    isDefault: true,
  });

  await page.getByRole('tab', { name: /评分配置/ }).click();
  await expect(page.getByRole('columnheader', { name: '提示词版本' })).toHaveCount(0);
  await expect(page.locator('td[data-label="并发数"]')).toHaveText('2');
  await page.getByRole('button', { name: '新建配置', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新建评分配置', exact: true });
  await expect(dialog.getByLabel('并发数')).toHaveValue('2');
  await expect(dialog.getByLabel('提示词版本')).toHaveCount(0);
  await dialog.getByLabel('并发数').fill('0');
  await expect(dialog.getByRole('button', { name: '创建配置', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  await page.getByRole('button', { name: '编辑', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑评分配置', exact: true });
  await dialog.getByRole('combobox', { name: '评分模型' }).click();
  await page.getByRole('option', { name: /beta 模型/ }).click();
  await dialog.getByLabel('并发数').fill('4');
  await dialog.getByLabel('超时（毫秒）').fill('45000');
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes[1]).toMatchObject({
    providerModelId: 'model-beta',
    concurrency: 4,
    timeoutMs: 45000,
    expectedRevision: 1,
    isDefault: true,
  });
  expect(writes.every((body) => !('promptVersion' in body))).toBe(true);
  const defaultRow = page.getByRole('row').filter({ hasText: '默认评分' });
  await expect(defaultRow.getByText('beta', { exact: true })).toBeVisible();
  await expect(defaultRow.locator('[data-label="并发数"]')).toHaveText('4');

  await page.getByRole('tab', { name: '连接与模型' }).click();
  await expect(beta.getByText('评分模型', { exact: true })).toBeVisible();
  await alpha.getByRole('button', { name: '设为评分模型', exact: true }).click();
  await expect(alpha.getByText('评分模型', { exact: true })).toBeVisible();
  await expect(beta.getByText('评分模型', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: /评分配置/ }).click();
  await expect(defaultRow.getByText('alpha', { exact: true })).toBeVisible();
  await expect(defaultRow.locator('[data-label="并发数"]')).toHaveText('4');
  await expect(defaultRow.locator('[data-label="超时"]')).toHaveText('45000 ms');
});
