import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { ApiResponse, Content, Topic } from '@drill-hub/contracts';
import { login } from './helpers';

async function post<T>(
  request: APIRequestContext,
  path: string,
  data: unknown,
  headers: Record<string, string>,
) {
  const response = await request.post(`/api/v1${path}`, { data, headers });
  await expect(response).toBeOK();
  return ((await response.json()) as ApiResponse<T>).data;
}

async function createReading(page: Page, bodyText: string) {
  await login(page);
  const csrfResponse = await page.request.get('/api/v1/auth/csrf');
  const {
    data: { csrfToken },
  } = await csrfResponse.json();
  const authorization = await post<{ token: string }>(
    page.request,
    '/me/agent-tokens',
    { name: `reading-${randomUUID()}`, scopes: ['read', 'content:write'] },
    { 'X-CSRF-Token': csrfToken },
  );
  const headers = { Authorization: `Bearer ${authorization.token}` };
  const topic = await post<Topic>(
    page.request,
    '/agent/topics',
    { title: `阅读主题-${randomUUID()}` },
    headers,
  );
  const content = await post<Content>(
    page.request,
    `/agent/topics/${topic.id}/contents`,
    { title: '专注阅读', bodyText },
    headers,
  );
  return { content, topic, headers };
}

test('内容阅读页只展示正文，不提供阅读操作', async ({ page }) => {
  const { content, topic } = await createReading(page, '第一段阅读内容。\n\n第二段阅读内容。');
  const completionRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/tasks\/[^/]+\/complete$/.test(request.url())) {
      completionRequests.push(request.url());
    }
  });

  // 普通入口与缺少来源计划的入口都不展示阅读操作，也不完成任务。
  for (const query of ['', `?taskId=${randomUUID()}`]) {
    await page.goto(`/contents/${content.id}${query}`);
    await expect(page.getByRole('heading', { name: content.title, exact: true })).toBeVisible();
    await expect(page.locator('.reading-body p')).toHaveText([
      '第一段阅读内容。',
      '第二段阅读内容。',
    ]);
    await expect(page.getByRole('link', { name: '返回主题' })).toHaveAttribute(
      'href',
      `/topics/${topic.id}`,
    );
    await expect(page.getByRole('heading', { name: '阅读操作' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /完成本次阅读|任务已完成/ })).toHaveCount(0);
    await expect(page.locator('.reading-side, .reading-layout')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
  }
  expect(completionRequests).toEqual([]);
});

test('内容正文静态渲染 Markdown，长代码与表格不撑开页面', async ({ page }) => {
  const longCode = 'const message = "' + 'markdown-'.repeat(80) + '";';
  const wideCells = Array.from({ length: 10 }, (_, index) => `列 ${index + 1}`);
  const bodyText = [
    '# 正文一级标题',
    '',
    '## 学习要点',
    '',
    '这是 **重点**、*强调*、~~过时内容~~与 `inlineCode`。',
    '',
    '- 第一项',
    '- 第二项',
    '',
    '1. 第一步',
    '2. 第二步',
    '',
    '> 保持专注。',
    '',
    '[返回当前主题](/topics)',
    '',
    '[参考资料](https://example.com/docs)',
    '',
    '![示意图](/reading-markdown-image.svg)',
    '',
    '| 名称 | 说明 |',
    '| --- | --- |',
    '| 原子性 | 全部成功或回滚 |',
    '',
    `| ${wideCells.join(' | ')} |`,
    `| ${wideCells.map(() => '---').join(' | ')} |`,
    `| ${wideCells.map(() => '很长的表格内容'.repeat(8)).join(' | ')} |`,
    '',
    '```ts',
    longCode,
    '```',
    '',
    '**未闭合的强调',
  ].join('\n');
  const { content, headers } = await createReading(page, bodyText);
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(page.url()).origin) {
      externalRequests.push(request.url());
    }
  });
  await page.route('**/reading-markdown-image.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><rect width="1600" height="400" fill="#e5efea"/></svg>',
    }),
  );
  await page.goto(`/contents/${content.id}`);
  const body = page.locator('.reading-body');
  await expect(body.getByRole('heading', { name: '正文一级标题', level: 1 })).toBeVisible();
  await expect(body.getByRole('heading', { name: '学习要点', level: 2 })).toBeVisible();
  await expect(body.locator('strong')).toHaveText('重点');
  await expect(body.locator('em')).toHaveText('强调');
  await expect(body.locator('del')).toHaveText('过时内容');
  await expect(body.locator('ul > li')).toHaveText(['第一项', '第二项']);
  await expect(body.locator('ol > li')).toContainText(['第一步', '第二步']);
  await expect(body.locator('blockquote')).toHaveText('保持专注。');
  await expect(body.getByRole('link', { name: '返回当前主题' })).toHaveAttribute('href', '/topics');
  await expect(body.getByRole('table').first()).toContainText('全部成功或回滚');
  const image = body.getByRole('img', { name: '示意图' });
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty('naturalWidth', 1600);
  await expect(body.locator('pre code')).toHaveText(longCode);
  await expect(body.locator('p').last()).toHaveText('**未闭合的强调');
  await expect(body.getByRole('button', { name: /完成|标记|提交/ })).toHaveCount(0);
  expect(await body.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  expect(externalRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  // 更新后仍按原文保存，并渲染新正文，不残留旧 Markdown 节点。
  const updated = await page.request.patch(`/api/v1/agent/contents/${content.id}`, {
    headers,
    data: { expectedRevision: content.revision, bodyText: '## 更新后的正文\n\n普通段落。' },
  });
  await expect(updated).toBeOK();
  await page.reload();
  await expect(body.getByRole('heading', { name: '更新后的正文' })).toBeVisible();
  await expect(body.locator('strong, pre, table')).toHaveCount(0);
});

test('Markdown 阅读不执行脚本、事件处理器和危险链接', async ({ page }) => {
  const bodyText = [
    '## 安全阅读',
    '',
    '<script>window.__readingXss = true</script>',
    '',
    '<img src="/invalid-reading-image" onerror="window.__readingXss = true">',
    '',
    '<iframe srcdoc="<script>parent.__readingXss = true</script>"></iframe>',
    '',
    '[危险链接](javascript:window.__readingXss=true)',
    '',
    '[数据链接](data:text/html,unsafe)',
    '',
    '[文件链接](file:///etc/passwd)',
    '',
    '正文仍可正常阅读。',
  ].join('\n');
  const { content } = await createReading(page, bodyText);
  await page.goto(`/contents/${content.id}`);
  const body = page.locator('.reading-body');
  await expect(body.getByRole('heading', { name: '安全阅读' })).toBeVisible();
  await expect(body).toContainText('正文仍可正常阅读。');
  await expect(body.locator('script, iframe, [onerror], [onclick]')).toHaveCount(0);
  await expect(
    body.locator('a[href^="javascript:"], a[href^="data:"], a[href^="file:"]'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__readingXss'))).toBeUndefined();
});

test('内容正文本地渲染数学公式、Mermaid 图表与信息图', async ({ page }) => {
  const bodyText = [
    '## 渲染扩展',
    '',
    '行内公式 $E = mc^2$ 与块级公式：',
    '',
    '$$',
    '\\int_{a}^{b} f(x) dx = F(b) - F(a)',
    '$$',
    '',
    '```mermaid',
    'flowchart LR',
    '    A[开始] --> B{判断}',
    '    B -->|是| C[结束]',
    '```',
    '',
    '```infographic',
    'infographic list-row-simple-horizontal-arrow',
    'data',
    '  lists',
    '    - label 第一步',
    '      desc 开始',
    '    - label 第二步',
    '      desc 进行中',
    '    - label 第三步',
    '      desc 完成',
    '```',
  ].join('\n');
  const { content } = await createReading(page, bodyText);
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(page.url()).origin) {
      externalRequests.push(request.url());
    }
  });
  await page.goto(`/contents/${content.id}`);
  const body = page.locator('.reading-body');
  await expect(body.getByRole('heading', { name: '渲染扩展' })).toBeVisible();
  // KaTeX 行内与块级公式。
  await expect(body.locator('.katex').first()).toBeVisible();
  await expect(body.locator('.katex-display').first()).toBeVisible();
  // Mermaid 图表渲染为 SVG。
  await expect(body.locator('[data-stream-markdown="mermaid"] svg').first()).toBeVisible({
    timeout: 15000,
  });
  // 信息图渲染为 SVG。
  await expect(
    body.locator('[data-stream-markdown="infographic-preview"] svg').first(),
  ).toBeVisible({ timeout: 15000 });
  // 全部扩展依赖本地加载，不请求外部 CDN。
  expect(externalRequests).toEqual([]);
});
