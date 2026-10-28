import { expect, test } from '@playwright/test';
import type { GradingProfile, ModelConnectionView, ProviderModel } from '@drill-hub/contracts';
import { login } from '#e2e/helpers';

test('模型列表支持快速切换评分模型和删除模型', async ({ page }) => {
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
    if (request.method() === 'DELETE' && path.includes('/provider-models/')) {
      const id = path.split('/').pop();
      const index = models.findIndex((model) => model.id === id);
      if (index >= 0) models.splice(index, 1);
      return route.fulfill({ json: { data: { deleted: true, id } } });
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
  await expect(page.getByRole('tab', { name: /评分配置/ })).toHaveCount(0);
  await unverified.getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除模型', exact: true });
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(unverified).toHaveCount(0);
  expect(models.map((model) => model.id)).not.toContain('model-unverified');
});
