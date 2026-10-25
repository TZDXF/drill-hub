import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { ApiResponse, Assessment, Topic } from '@drill-hub/contracts';
import { login, openQuestionNav } from '#e2e/helpers';

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

for (const kind of ['practice', 'exam'] as const) {
  test(`${kind} 切换单选题不复用旧选项控件，往返和刷新保留各题答案`, async ({ page }) => {
    await login(page);
    const csrfResponse = await page.request.get('/api/v1/auth/csrf');
    const {
      data: { csrfToken },
    } = await csrfResponse.json();
    const authorization = await post<{ token: string }>(
      page.request,
      '/me/agent-tokens',
      {
        name: `choice-switching-${randomUUID()}`,
        scopes: ['read', 'content:write', 'assessment:write'],
      },
      { 'X-CSRF-Token': csrfToken },
    );
    const headers = { Authorization: `Bearer ${authorization.token}` };
    const topic = await post<Topic>(
      page.request,
      '/agent/topics',
      { title: `单选题切换-${randomUUID()}` },
      headers,
    );
    const questions = await post<{ questionId: string }[]>(
      page.request,
      `/agent/topics/${topic.id}/questions/batch`,
      {
        items: [
          {
            type: 'single_choice',
            stem: '请选择关系型数据库',
            options: [
              { id: 'a', text: 'SQLite' },
              { id: 'b', text: '文本文件' },
            ],
            gradingMode: 'rule',
            gradingKey: { optionId: 'a' },
          },
          {
            type: 'single_choice',
            stem: '请选择事务性质',
            options: [
              { id: 'a', text: '随机性' },
              { id: 'b', text: '原子性' },
              { id: 'c', text: '无序性' },
            ],
            gradingMode: 'rule',
            gradingKey: { optionId: 'b' },
          },
        ],
      },
      headers,
    );
    const assessment = await post<Assessment>(
      page.request,
      `/agent/topics/${topic.id}/assessments`,
      {
        kind,
        title: '单选题切换回归',
        ...(kind === 'exam' ? { durationSeconds: 600 } : {}),
        items: questions.map(({ questionId }) => ({
          questionId,
          questionVersion: 1,
          maxScore: '10.00',
        })),
      },
      headers,
    );

    await page.goto(`/assessments/${assessment.id}`);
    await page.getByRole('button', { name: '开始或继续' }).click();
    await page.getByLabel('A. SQLite', { exact: true }).check();
    const firstRadio = await page.getByLabel('A. SQLite', { exact: true }).elementHandle();
    expect(firstRadio).not.toBeNull();
    await page.getByRole('button', { name: '下一题', exact: true }).click();
    await expect(page.getByRole('heading', { name: '请选择事务性质' })).toBeVisible();
    // 相同的选项 ID 不应跨题复用控件或延续旧选中态的 CSS 过渡。
    expect(await firstRadio!.evaluate((element) => element.isConnected)).toBe(false);
    await expect(page.locator('.answer-option__text')).toHaveText([
      'A. 随机性',
      'B. 原子性',
      'C. 无序性',
    ]);
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
    await page.getByLabel('B. 原子性', { exact: true }).check();
    const secondRadio = await page.getByLabel('B. 原子性', { exact: true }).elementHandle();
    expect(secondRadio).not.toBeNull();

    const questionNav = await openQuestionNav(page);
    await questionNav.getByRole('button', { name: '第 1 题，已作答', exact: true }).click();
    await expect(page.getByRole('heading', { name: '请选择关系型数据库' })).toBeVisible();
    expect(await secondRadio!.evaluate((element) => element.isConnected)).toBe(false);
    await expect(page.locator('.answer-option__text')).toHaveText(['A. SQLite', 'B. 文本文件']);
    await expect(page.getByLabel('A. SQLite', { exact: true })).toBeChecked();
    await expect(page.getByLabel('B. 文本文件', { exact: true })).not.toBeChecked();

    await page.getByRole('button', { name: '下一题', exact: true }).click();
    await expect(page.locator('.answer-option__text')).toHaveText([
      'A. 随机性',
      'B. 原子性',
      'C. 无序性',
    ]);
    await expect(page.getByLabel('B. 原子性', { exact: true })).toBeChecked();
    await expect(page.getByLabel('A. 随机性', { exact: true })).not.toBeChecked();
    await expect(page).toHaveURL(/\?question=2$/);
    await page.reload();
    await expect(page.getByRole('heading', { name: '请选择事务性质' })).toBeVisible();
    await expect(page.getByLabel('B. 原子性', { exact: true })).toBeChecked();
    await openQuestionNav(page);
    await questionNav.getByRole('button', { name: '第 1 题，已作答', exact: true }).click();
    await expect(page.getByLabel('A. SQLite', { exact: true })).toBeChecked();
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);
    await firstRadio!.dispose();
    await secondRadio!.dispose();
  });
}
