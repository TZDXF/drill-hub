import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('主题搜索支持拼写容错、中文目标高亮、空结果与清除搜索', async ({ page }, testInfo) => {
  await login(page);
  await page.route('**/api/v1/topics?**', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: 'javascript',
            title: 'JavaScript Patterns',
            goalText: '理解常用设计模式',
            revision: 1,
            createdAt: '2026-10-28T00:00:00.000Z',
            updatedAt: '2026-10-28T00:00:00.000Z',
            archivedAt: null,
          },
          {
            id: 'database',
            title: '数据库学习',
            goalText: '理解事务与并发控制',
            revision: 1,
            createdAt: '2026-10-28T00:00:00.000Z',
            updatedAt: '2026-10-28T00:00:00.000Z',
            archivedAt: null,
          },
        ],
      },
    }),
  );
  await page.goto('/topics');
  const field = page.getByRole('searchbox', { name: '搜索主题', exact: true });
  await expect(page.locator('.topic-card')).toHaveCount(2);
  await field.fill('javscript');
  await expect(page.locator('.topic-card')).toHaveCount(1);
  await expect(page.locator('.topic-card h2')).toHaveText('JavaScript Patterns');
  expect(await page.locator('.topic-card mark').count()).toBeGreaterThan(0);
  await field.fill('并发');
  await expect(page.locator('.topic-card')).toHaveCount(1);
  await expect(page.locator('.topic-card p mark')).toHaveText('并发');
  await page.screenshot({ path: testInfo.outputPath('topic-search.png'), fullPage: true });
  await field.fill('完全不存在的关键词');
  await expect(page.getByRole('heading', { name: '没有匹配的结果' })).toBeVisible();
  await page.locator('.empty-state').getByRole('button', { name: '清除搜索' }).click();
  await expect(field).toHaveValue('');
  await expect(page.locator('.topic-card')).toHaveCount(2);
  await expect(page.locator('mark')).toHaveCount(0);
});
