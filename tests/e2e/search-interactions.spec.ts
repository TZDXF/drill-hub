import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('离开搜索页后迟到的响应不会修改新页面地址', async ({ page }) => {
  await login(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/search?**', async (route) => {
    await pending;
    await route.fulfill({
      json: {
        data: {
          query: '并发',
          results: [],
          counts: { topic: 0, content: 0, plan: 0, question: 0, assessment: 0 },
        },
      },
    });
  });
  await page.goto('/search');
  await page.getByLabel('搜索词').fill('并发');
  const request = page.waitForRequest('**/api/v1/search?**');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await request;
  await page.locator('a[href="/topics"]:visible').first().click();
  await expect(page).toHaveURL(/\/topics$/);
  const response = page.waitForResponse('**/api/v1/search?**');
  release();
  await (await response).finished();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/topics$/);
});

test('模型发现的模糊搜索显示高亮且批量取消只影响筛选结果', async ({ page }) => {
  await login(page);
  const base = {
    revision: 1,
    createdAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:00.000Z',
  };
  const connection = {
    ...base,
    id: 'discovery-connection',
    displayName: '测试供应商',
    protocol: 'chat_completions',
    baseUrl: 'https://provider.test/v1',
    enabled: true,
    configVersion: 1,
    apiKeyConfigured: true,
  };
  await page.route('**/api/v1/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/model-adapters')
      ? [{ protocol: 'chat_completions', displayName: 'Chat Completions' }]
      : path.endsWith('/model-connections')
        ? [connection]
        : path.endsWith('/models/discover')
          ? {
              models: [
                { modelKey: 'javascript-model', displayName: 'JavaScript 模型' },
                { modelKey: 'rust-model', displayName: 'Rust 模型' },
                { modelKey: 'existing', displayName: 'JavaScript 已有模型' },
              ],
            }
          : path.endsWith('/models')
            ? [
                {
                  ...base,
                  id: 'existing-model',
                  connectionId: connection.id,
                  modelKey: 'existing',
                  displayName: 'JavaScript 已有模型',
                  enabled: true,
                  contextWindow: null,
                  maxTokens: null,
                  reasoning: false,
                  input: ['text'],
                  costPerMillion: null,
                },
              ]
            : path.endsWith('/grading-profiles')
              ? []
              : null;
    if (data === null) return route.continue();
    return route.fulfill({ json: { data } });
  });
  await page.goto('/admin/settings/models');
  await page.getByRole('button', { name: '自动获取', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '自动获取模型', exact: true });
  await dialog.getByLabel('筛选模型').fill('javscript');
  await expect(dialog.locator('.model-discovery-row')).toHaveCount(2);
  expect(await dialog.locator('mark').count()).toBeGreaterThan(0);
  await expect(dialog.locator('.model-discovery-row--existing mark').first()).toBeVisible();
  await dialog.getByRole('button', { name: '取消全选', exact: true }).click();
  await expect(dialog.getByText('共 3 个模型，已选 1 个', { exact: true })).toBeVisible();
  await dialog.getByLabel('筛选模型').fill('');
  await expect(dialog.locator('.model-discovery-row')).toHaveCount(3);
  await expect(dialog.locator('mark')).toHaveCount(0);
  await expect(
    dialog.locator('.model-discovery-row', { hasText: 'Rust 模型' }).getByRole('checkbox'),
  ).toBeChecked();
});
