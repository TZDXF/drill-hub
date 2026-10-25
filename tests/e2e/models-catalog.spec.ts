import { expect, test } from '@playwright/test';
import type { ModelCatalogMatch, ModelConnectionView, ProviderModel } from '@drill-hub/contracts';
import { login } from '#e2e/helpers';

const base = {
  createdAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
  revision: 1,
};
const connection: ModelConnectionView = {
  ...base,
  id: 'catalog-connection',
  displayName: '目录测试供应商',
  protocol: 'chat_completions',
  baseUrl: 'https://provider.test/v1',
  enabled: true,
  configVersion: 1,
  apiKeyConfigured: true,
};
const match: ModelCatalogMatch = {
  providerId: 'provider-a',
  providerName: '供应商 A',
  modelId: 'model_name',
  name: '目录模型',
  contextWindow: 128000,
  maxTokens: 8192,
  reasoning: true,
  input: ['text', 'image'],
  costPerMillion: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
};

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/model-adapters')
      ? [{ protocol: 'chat_completions', displayName: 'Chat Completions' }]
      : path.endsWith('/model-connections')
        ? [connection]
        : path.endsWith('/models') || path.endsWith('/grading-profiles')
          ? []
          : null;
    if (route.request().method() !== 'GET' || data === null) return route.fallback();
    return route.fulfill({ json: { data } });
  });
});

test('默认参数直接按模型 ID 获取，合并去重带前缀查询并保留供应商模型 ID', async ({ page }) => {
  const queries: string[] = [];
  const prefixed = { ...match, modelId: 'free/model_name', name: '完整 ID 模型' };
  const otherProvider = { ...match, providerId: 'provider-b', providerName: '供应商 B' };
  await page.route('**/api/v1/admin/models-catalog?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q')!;
    queries.push(query);
    return route.fulfill({
      json: { data: query === 'free/model_name' ? [prefixed, match] : [match, otherProvider] },
    });
  });
  const models: ProviderModel[] = [];
  await page.route(`**/api/v1/admin/model-connections/${connection.id}/models`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: models } });
    const body = route.request().postDataJSON() as ProviderModel;
    expect(body).toMatchObject({
      modelKey: 'free/model_name',
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: true,
      input: ['text', 'image'],
      costPerMillion: match.costPerMillion,
    });
    const model = {
      ...body,
      ...base,
      id: 'catalog-model',
      connectionId: connection.id,
      enabled: true,
    };
    models.push(model);
    return route.fulfill({ status: 201, json: { data: model } });
  });

  await page.goto('/admin/settings/models');
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '添加模型 ID', exact: true });
  const fetchButton = dialog.getByRole('button', { name: '获取', exact: true });
  await expect(dialog.locator('#catalog-query')).toHaveCount(0);
  await expect(fetchButton).toBeDisabled();
  await dialog.getByLabel('模型 ID', { exact: true }).fill('free/model_name');
  await fetchButton.click();
  const candidates = dialog.locator('.model-dialog__matches li');
  await expect(candidates).toHaveCount(3);
  expect([...queries].sort()).toEqual(['free/model_name', 'model_name']);
  await expect(candidates.nth(0)).toContainText('完整 ID 模型');
  await expect(candidates.nth(1)).toContainText('供应商 A');
  await expect(candidates.nth(2)).toContainText('供应商 B');
  await candidates.nth(1).getByRole('button').click();
  await expect(dialog.getByLabel('模型 ID', { exact: true })).toHaveValue('free/model_name');
  await expect(dialog.getByLabel('上下文窗口（tokens）')).toHaveValue('128000');
  await expect(dialog.getByLabel('最大输出（tokens）')).toHaveValue('8192');
  await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .locator('.provider-model-card')
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: '编辑模型', exact: true });
  await expect(dialog.locator('.model-dialog__matches li')).toHaveCount(0);
  await dialog.getByRole('button', { name: '获取', exact: true }).click();
  await expect(dialog.locator('.model-dialog__matches li')).toHaveCount(3);
  expect([...queries].sort()).toEqual([
    'free/model_name',
    'free/model_name',
    'model_name',
    'model_name',
  ]);
});

test('默认参数支持无前缀、空结果、部分失败，并忽略模型 ID 改变后的旧结果', async ({ page }) => {
  const queries: string[] = [];
  let releaseOldQuery: (() => void) | undefined;
  const oldQuery = new Promise<void>((resolve) => {
    releaseOldQuery = resolve;
  });
  await page.route('**/api/v1/admin/models-catalog?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q')!;
    queries.push(query);
    if (query === 'free/vendor/model_name')
      return route.fulfill({
        status: 502,
        json: { error: { code: 'MODEL_CATALOG_UNAVAILABLE', message: '目录请求失败' } },
      });
    if (query === 'old_model') await oldQuery;
    return route.fulfill({ json: { data: query === 'unknown_model' ? [] : [match] } });
  });

  await page.goto('/admin/settings/models');
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加模型 ID', exact: true });
  const key = dialog.getByLabel('模型 ID', { exact: true });
  const fetchButton = dialog.getByRole('button', { name: '获取', exact: true });
  const candidates = dialog.locator('.model-dialog__matches li');
  await key.fill('model_name');
  await fetchButton.click();
  await expect(candidates).toHaveCount(1);
  expect(queries).toEqual(['model_name']);

  await key.fill('unknown_model');
  await expect(candidates).toHaveCount(0);
  await fetchButton.click();
  await expect(dialog.getByText('models.dev 中没有匹配的模型，可以手动填写参数。')).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await expect(dialog.getByText('models.dev 中没有匹配的模型，可以手动填写参数。')).toHaveCount(0);

  await key.fill('free/vendor/model_name');
  await fetchButton.click();
  await expect(candidates).toHaveCount(1);
  expect(queries.slice(-2).sort()).toEqual(['free/vendor/model_name', 'model_name']);
  await expect(page.getByText('获取 models.dev 目录失败', { exact: true })).toBeVisible();

  await key.fill('old_model');
  await fetchButton.click();
  await expect.poll(() => queries.at(-1)).toBe('old_model');
  await key.fill('unknown_model');
  await fetchButton.click();
  await expect(dialog.getByText('models.dev 中没有匹配的模型，可以手动填写参数。')).toBeVisible();
  const oldResponse = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get('q') === 'old_model',
  );
  releaseOldQuery!();
  await oldResponse;
  await expect(candidates).toHaveCount(0);
  await expect(fetchButton).toBeEnabled();
});
