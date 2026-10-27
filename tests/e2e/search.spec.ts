import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Content, Topic } from '@drill-hub/contracts';
import { login, post, agentHeaders } from '#e2e/helpers';

test('站内搜索能定位主题内容并跳转阅读', async ({ page }) => {
  await login(page);
  const headers = await agentHeaders(page.request, `search-${randomUUID()}`, [
    'read',
    'content:write',
  ]);
  const marker = `MVCC并发控制-${randomUUID().slice(0, 8)}`;
  const topic = await post<Topic>(
    page.request,
    '/agent/topics',
    { title: `搜索主题-${randomUUID().slice(0, 8)}`, goalText: '理解并发' },
    headers,
  );
  const content = await post<Content>(
    page.request,
    `/agent/topics/${topic.id}/contents`,
    { title: '并发阅读材料', bodyText: `本节讲解${marker}的实现方式。` },
    headers,
  );
  await page.goto('/search');
  await page.getByLabel('搜索词').fill('并发控制');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const result = page.locator('.list-card', { hasText: marker });
  await expect(result).toBeVisible();
  await expect(result).toContainText('并发阅读材料');
  await result.click();
  await expect(page).toHaveURL(new RegExp(`/contents/${content.id}$`));
  await expect(page.getByRole('heading', { name: '并发阅读材料' })).toBeVisible();
});

test('无结果与类型过滤给出明确反馈', async ({ page }) => {
  await login(page);
  await page.goto('/search');
  await page.getByLabel('搜索词').fill(`不存在的关键词-${randomUUID()}`);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '没有匹配的结果' })).toBeVisible();
});
