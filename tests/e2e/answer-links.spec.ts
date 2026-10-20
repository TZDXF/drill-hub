import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type {
  AnswerLinkCreated,
  ApiResponse,
  Assessment,
  LearningPlan,
  Topic,
} from '@drill-hub/contracts';
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

test('Agent 临时答题链接可在未登录浏览器中直接作答和查看报告', async ({ page, browser }) => {
  await login(page);
  const csrf = (await (await page.request.get('/api/v1/auth/csrf')).json()).data.csrfToken;
  const authorization = await post<{ token: string }>(
    page.request,
    '/me/agent-tokens',
    {
      name: '免登录答题测试',
      scopes: ['read', 'content:write', 'assessment:write'],
    },
    { 'X-CSRF-Token': csrf },
  );
  const headers = { Authorization: `Bearer ${authorization.token}` };
  const topic = await post<Topic>(
    page.request,
    '/agent/topics',
    { title: `免登录答题-${randomUUID()}` },
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
      title: `免登录练习-${randomUUID()}`,
      items: questions.map(({ questionId }) => ({
        questionId,
        questionVersion: 1,
        maxScore: '10.00',
      })),
    },
    headers,
  );
  const plan = await post<LearningPlan>(
    page.request,
    `/agent/topics/${topic.id}/plans`,
    {
      title: '临时链接学习计划',
      phases: [
        {
          title: '练习阶段',
          tasks: [{ title: '完成免登录练习', kind: 'practice', targetId: assessment.id }],
        },
      ],
    },
    headers,
  );
  const link = await post<AnswerLinkCreated>(
    page.request,
    `/agent/assessments/${assessment.id}/answer-links`,
    { expiresInSeconds: 3600 },
    headers,
  );

  expect(link.taskId).toBe(plan.phases[0]!.tasks[0]!.id);

  const anonymous = await browser.newContext();
  try {
    const answerPage = await anonymous.newPage();
    await answerPage.goto(link.answerUrl);
    await expect(answerPage).toHaveURL(/\/answer#/);
    await expect(answerPage.getByRole('heading', { name: '选择数据库' })).toBeVisible();
    await expect(answerPage.getByText('免登录', { exact: true })).toBeVisible();

    const saved = answerPage.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().includes('/public/answer/attempt/items/'),
    );
    await answerPage.getByLabel('B. 文本文件', { exact: true }).check();
    await saved;

    // Ongoing link attempts must lead to a read-only report, never the personal answer page.
    await page.goto('/history');
    const ongoingEntry = page.getByRole('link').filter({
      has: page.getByRole('heading', { name: assessment.title, exact: true }),
    });
    await expect(ongoingEntry).toBeVisible();
    await expect(ongoingEntry.getByText('作答中', { exact: true })).toHaveText('作答中');
    await expect(ongoingEntry).toHaveAttribute('href', /\/attempts\/[^/]+\/report$/);
    await ongoingEntry.click();
    await expect(page).toHaveURL(/\/attempts\/[^/]+\/report$/);
    const ownerReportUrl = page.url();
    await page.goto(ownerReportUrl.replace(/\/report$/, ''));
    await expect(page).toHaveURL(ownerReportUrl);
    await expect(
      page.getByText('临时链接作答记到链接所属用户名下；登录后只能只读查看，不能修改链接答案。'),
    ).toBeVisible();

    await answerPage.getByRole('button', { name: '检查并交卷', exact: true }).first().click();
    await answerPage.getByRole('button', { name: '确认交卷', exact: true }).click();
    await expect(answerPage).toHaveURL(/\/answer\/report#/);
    await expect(answerPage.getByText('最终得分')).toBeVisible();
    const reportItem = answerPage.locator('.report-item');
    await expect(reportItem).toHaveCount(0);
    const reportTrigger = answerPage.getByRole('button', { name: '打开答题卡' });
    const reportNav = answerPage.getByRole('navigation', { name: '题号导航' });
    if (answerPage.viewportSize()!.width <= 780) {
      await expect(reportTrigger).toBeVisible();
      await expect(reportNav).not.toBeVisible();
    } else {
      await expect(reportTrigger).not.toBeVisible();
      await expect(reportNav).toBeVisible();
    }
    await answerPage.getByRole('button', { name: '查看题目', exact: true }).click();
    await expect(answerPage).toHaveURL(/report\?question=1#/);
    await answerPage.reload();
    await expect(reportItem).toHaveCount(1);
    const wrongOption = reportItem.locator('.answer-option', { hasText: '文本文件' });
    const correctOption = reportItem.locator('.answer-option', { hasText: 'SQLite' });
    await expect(wrongOption).toHaveClass(/selected/);
    await expect(wrongOption).toHaveClass(/wrong/);
    await expect(wrongOption).toHaveCSS('border-color', 'rgb(162, 60, 53)');
    await expect(correctOption).toHaveClass(/correct/);
    await expect(correctOption).toHaveCSS('border-color', 'rgb(55, 107, 78)');
    await expect(reportItem.getByText('你的答案', { exact: true })).toHaveCount(0);
    await expect(reportItem.getByText('本题得分', { exact: true })).toHaveCount(0);

    // The publisher can find the anonymous submission without its temporary secret.
    await page.goto('/history');
    const historyEntry = page
      .getByRole('link')
      .filter({ has: page.getByRole('heading', { name: assessment.title, exact: true }) });
    await expect(historyEntry).toBeVisible();
    await expect(historyEntry.getByText('临时链接作答 · 只读', { exact: true })).toBeVisible();
    await expect(historyEntry.getByText('已完成', { exact: true })).toHaveText('已完成');
    await historyEntry.click();
    await expect(page).toHaveURL(/\/attempts\/[^/]+\/report$/);
    await expect(page.getByText('最终得分')).toBeVisible();
    await expect(
      page.getByText('临时链接作答记到链接所属用户名下；登录后只能只读查看，不能修改链接答案。'),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText('最终得分')).toBeVisible();
    // Link submission must also complete the owner's uniquely matching plan task.
    await page.goto(`/topics/${topic.id}/plans/${plan.id}`);
    const taskRow = page.locator('.task-row').filter({ hasText: '完成免登录练习' });
    await expect(taskRow.getByText('已完成', { exact: true })).toBeVisible();
    await page.reload();
    await expect(taskRow.getByText('已完成', { exact: true })).toBeVisible();
  } finally {
    await anonymous.close();
  }
});
