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
  await expect(result.locator('mark')).toHaveText('并发控制');
  await page.getByLabel('搜索词').fill('尚未提交的搜索');
  await expect(result.locator('mark')).toHaveText('并发控制');
  await result.click();
  await expect(page).toHaveURL(new RegExp(`/contents/${content.id}$`));
  await expect(page.getByRole('heading', { name: '并发阅读材料' })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('搜索词')).toHaveValue('并发控制');
  await expect(result.locator('mark')).toHaveText('并发控制');
});

test('标题和摘要高亮安全处理符号、HTML、大小写及深浅主题', async ({ page }, testInfo) => {
  await login(page);
  const query = 'C++ <img src=x onerror=alert(1)>';
  await page.route('**/api/v1/search?**', (route) =>
    route.fulfill({
      json: {
        data: {
          query,
          counts: { topic: 1, content: 0, question: 0, plan: 0, assessment: 0 },
          results: [
            {
              id: 'safe-search-result',
              topicId: 'safe-search-result',
              resourceType: 'topic',
              title: `学习 ${query}`,
              snippet: `${query.toLowerCase()} 与 ${query}`,
              archived: false,
              revision: 1,
              createdAt: '2026-10-28T00:00:00.000Z',
              updatedAt: '2026-10-28T00:00:00.000Z',
            },
          ],
        },
      },
    }),
  );
  await page.goto('/search');
  await page.getByLabel('搜索词').fill(query);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const result = page.locator('.list-card');
  await expect(result.locator('mark')).toHaveText([query, query.toLowerCase(), query]);
  await expect(result.locator('img, script')).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const colors = await result
      .locator('mark')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      });
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(colors.background).not.toBe(colors.color);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`search-${theme}.png`), fullPage: true });
  }
});

test('搜索失败可以重试，并明确提示截断后的结果数量', async ({ page }) => {
  await login(page);
  let fail = true;
  await page.route('**/api/v1/search?**', (route) =>
    route.fulfill(
      fail
        ? {
            status: 503,
            json: { error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } },
          }
        : {
            json: {
              data: {
                query: '测试',
                counts: { topic: 51, content: 0, question: 0, plan: 0, assessment: 0 },
                results: [
                  {
                    id: 'test',
                    topicId: 'test',
                    resourceType: 'topic',
                    title: '测试主题',
                    snippet: null,
                    archived: false,
                    revision: 1,
                    createdAt: '2026-10-28T00:00:00.000Z',
                    updatedAt: '2026-10-28T00:00:00.000Z',
                  },
                ],
              },
            },
          },
    ),
  );
  await page.goto('/search');
  await expect(page.getByRole('button', { name: '搜索', exact: true })).toBeDisabled();
  await page.getByLabel('搜索词').fill('测试');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '搜索失败' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '输入关键词开始搜索' })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.search-summary')).toContainText('共 51 条结果');
  await expect(page.locator('.search-summary')).toContainText('当前显示前 1 条');
});

test('无结果与类型过滤给出明确反馈', async ({ page }) => {
  await login(page);
  await page.goto('/search');
  await page.getByLabel('搜索词').fill(`不存在的关键词-${randomUUID()}`);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '没有匹配的结果' })).toBeVisible();
});
