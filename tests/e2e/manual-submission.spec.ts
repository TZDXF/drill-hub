import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Assessment, AttemptView, Topic } from '@drill-hub/contracts';
import { login, post, agentHeaders } from '#e2e/helpers';

test('练习题保存答案后需手动交卷，页面不再提供自动提交选项', async ({ page }) => {
  await login(page);
  const headers = await agentHeaders(page.request, '手动交卷测试', [
    'read',
    'content:write',
    'assessment:write',
  ]);
  const topic = await post<Topic>(
    page.request,
    '/agent/topics',
    { title: `手动交卷-${randomUUID()}` },
    headers,
  );
  const questions = await post<{ questionId: string }[]>(
    page.request,
    `/agent/topics/${topic.id}/questions/batch`,
    {
      items: [
        {
          type: 'single_choice',
          stem: '选择数据库',
          gradingMode: 'rule',
          options: [
            { id: 'a', text: 'SQLite' },
            { id: 'b', text: '文本文件' },
          ],
          gradingKey: { optionId: 'a' },
        },
      ],
    },
    headers,
  );
  const assessment = await post<Assessment>(
    page.request,
    `/agent/topics/${topic.id}/assessments`,
    {
      kind: 'practice',
      title: '手动交卷练习',
      items: questions.map(({ questionId }) => ({
        questionId,
        questionVersion: 1,
        maxScore: '10.00',
      })),
    },
    headers,
  );

  await page.goto('/settings');
  await expect(page.getByRole('checkbox', { name: '答题后自动提交' })).toHaveCount(0);
  await expect(page.getByLabel('时区', { exact: true })).toHaveCount(0);

  await page.goto(`/assessments/${assessment.id}`);
  await page.getByRole('button', { name: '开始或继续' }).click();
  await expect(page).toHaveURL(/\/attempts\/[^/]+$/);
  const attemptId = new URL(page.url()).pathname.split('/').at(-1)!;
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().includes('/answers/'),
  );
  await page.getByLabel('A. SQLite', { exact: true }).check();
  await saved;
  await expect(page.getByLabel('A. SQLite', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '提交本题', exact: true })).toHaveCount(0);

  const attempt = (await (await page.request.get(`/api/v1/attempts/${attemptId}`)).json())
    .data as AttemptView;
  expect(attempt.items[0]).toMatchObject({
    answer: { optionId: 'a' },
    lockedAt: null,
    grade: null,
  });

  await page.getByRole('button', { name: '检查并交卷', exact: true }).first().click();
  await page.getByRole('button', { name: '确认交卷', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/attempts/${attemptId}/report$`));
  await expect(page.getByRole('region', { name: '成绩摘要' })).toBeVisible();
  await expect(page.locator('.report-item')).toHaveCount(0);
  await page.getByRole('button', { name: '查看题目', exact: true }).click();
  await expect(page.locator('.report-item')).toHaveCount(1);
});
