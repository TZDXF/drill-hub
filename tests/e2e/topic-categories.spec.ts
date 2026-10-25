import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { ApiResponse, Topic } from '@drill-hub/contracts';
import { login } from '#e2e/helpers';

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

async function expectLayout(page: Page, columns: number) {
  const tabs = page.getByRole('tablist', { name: '主题内容分类' }).getByRole('tab');
  const boxes = await Promise.all((await tabs.all()).map((tab) => tab.boundingBox()));
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    if (columns === 2) expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
  expect(boxes[1]!.y).toBe(boxes[0]!.y);
  expect(boxes[2]!.y).toBe(columns === 2 ? boxes[0]!.y + boxes[0]!.height + 8 : boxes[0]!.y);
  expect(boxes[3]!.y).toBe(boxes[2]!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

test('主题分类在手机上完整展示为四个触屏入口，切换内容并保留桌面标签交互', async ({
  page,
}, testInfo) => {
  await login(page);
  const csrfResponse = await page.request.get('/api/v1/auth/csrf');
  const {
    data: { csrfToken },
  } = await csrfResponse.json();
  const authorization = await post<{ token: string }>(
    page.request,
    '/me/agent-tokens',
    {
      name: `topic-categories-${randomUUID()}`,
      scopes: ['read', 'content:write', 'assessment:write'],
    },
    { 'X-CSRF-Token': csrfToken },
  );
  const headers = { Authorization: `Bearer ${authorization.token}` };
  const topic = await post<Topic>(
    page.request,
    '/agent/topics',
    { title: `数据库基础-${randomUUID().slice(0, 8)}` },
    headers,
  );
  await page.goto(`/topics/${topic.id}`);
  const categories = page.getByRole('tablist', { name: '主题内容分类' });
  const tabs = categories.getByRole('tab');
  await expect(tabs).toHaveCount(4);
  const emptyStates = ['还没有学习计划', '还没有阅读内容', '还没有练习', '还没有考试'];
  for (let index = 0; index < emptyStates.length; index++) {
    await expect(tabs.nth(index).locator('.topic-category__count')).toHaveText(/^0/);
    await tabs.nth(index).click();
    await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(
      page.getByRole('tabpanel').getByRole('heading', { name: emptyStates[index] }),
    ).toBeVisible();
  }

  await post(page.request, `/agent/topics/${topic.id}/plans`, { title: '分类测试计划' }, headers);
  await post(
    page.request,
    `/agent/topics/${topic.id}/contents`,
    {
      title: '分类测试阅读',
      bodyText: '用于验证阅读分类中的真实内容。',
    },
    headers,
  );
  const questions = await post<{ questionId: string }[]>(
    page.request,
    `/agent/topics/${topic.id}/questions/batch`,
    {
      items: [
        {
          type: 'true_false',
          stem: '分类可以切换',
          gradingMode: 'rule',
          gradingKey: { value: true },
        },
      ],
    },
    headers,
  );
  for (const kind of ['practice', 'exam'] as const) {
    await post(
      page.request,
      `/agent/topics/${topic.id}/assessments`,
      {
        title: kind === 'practice' ? '分类测试练习' : '分类测试考试',
        kind,
        ...(kind === 'exam' ? { durationSeconds: 600 } : {}),
        items: [{ questionId: questions[0]!.questionId, questionVersion: 1, maxScore: '10.00' }],
      },
      headers,
    );
  }
  await page.reload();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  const titles = ['分类测试计划', '分类测试阅读', '分类测试练习', '分类测试考试'];
  for (let index = 0; index < titles.length; index++) {
    await expect(tabs.nth(index).locator('.topic-category__count')).toHaveText(/^1/);
    await tabs.nth(index).click();
    await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(
      page.getByRole('tabpanel').getByRole('heading', { name: titles[index] }),
    ).toBeVisible();
    await expectLayout(page, testInfo.project.name === 'chromium-mobile' ? 2 : 4);
  }
  if (testInfo.project.name === 'chromium-mobile') {
    for (const width of [320, 390, 900]) {
      await page.setViewportSize({ width, height: 850 });
      await expectLayout(page, 2);
      await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    }
    await page.setViewportSize({ width: 390, height: 850 });
    await expectLayout(page, 2);
    await page.screenshot({
      path: testInfo.outputPath('topic-categories-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectLayout(page, 2);
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize({ width: 390, height: 850 });
    await expectLayout(page, 2);
  } else {
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  }
});
