import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type {
  ApiResponse,
  Assessment,
  AttemptReport,
  AttemptView,
  Dashboard,
  AnswerLinkCreated,
  GradingJob,
  LearningPlan,
  Topic,
  WrongQuestionListItem,
} from '@drill-hub/contracts';
import { login, openQuestionNav } from './helpers';

async function seed(page: Page, kind: 'practice' | 'exam' = 'practice') {
  await login(page);
  const csrf = (
    (await (await page.request.get('/api/v1/auth/csrf')).json()) as ApiResponse<{
      csrfToken: string;
    }>
  ).data.csrfToken;
  async function post<T>(path: string, data: unknown, headers: Record<string, string>) {
    const response = await page.request.post(`/api/v1${path}`, { data, headers });
    await expect(response).toBeOK();
    return ((await response.json()) as ApiResponse<T>).data;
  }
  const { token } = await post<{ token: string }>(
    '/me/agent-tokens',
    {
      name: `用途回归-${randomUUID()}`,
      scopes: ['read', 'content:write', 'assessment:write'],
    },
    { 'X-CSRF-Token': csrf },
  );
  const headers = { Authorization: `Bearer ${token}` };
  const topic = await post<Topic>('/agent/topics', { title: `作答用途-${randomUUID()}` }, headers);
  const questions = await post<{ questionId: string }[]>(
    `/agent/topics/${topic.id}/questions/batch`,
    {
      items: [
        {
          type: 'single_choice',
          stem: '用途回归：选择数据库',
          gradingMode: 'rule',
          options: [
            { id: 'a', text: 'SQLite' },
            { id: 'b', text: '普通文本文件' },
          ],
          gradingKey: { optionId: 'a' },
        },
      ],
    },
    headers,
  );
  const assessment = await post<Assessment>(
    `/agent/topics/${topic.id}/assessments`,
    {
      kind,
      title: `用途回归-${kind}-${randomUUID()}`,
      ...(kind === 'exam' ? { durationSeconds: 600 } : {}),
      items: [{ questionId: questions[0]!.questionId, questionVersion: 1, maxScore: '10.00' }],
    },
    headers,
  );
  const plan = await post<LearningPlan>(
    `/agent/topics/${topic.id}/plans`,
    {
      title: '用途回归计划',
      phases: [
        { title: '学习阶段', tasks: [{ title: '完成作答', kind, targetId: assessment.id }] },
      ],
    },
    headers,
  );
  const taskId = plan.phases[0]!.tasks[0]!.id;
  const readReport = async (id: string) => {
    const response = await page.request.get(`/api/v1/attempts/${id}/report`);
    await expect(response).toBeOK();
    return ((await response.json()) as ApiResponse<AttemptReport>).data;
  };
  const readPlan = async () => {
    const response = await page.request.get(`/api/v1/topics/${topic.id}/plans`);
    await expect(response).toBeOK();
    return ((await response.json()) as ApiResponse<LearningPlan[]>).data.find(
      (item) => item.id === plan.id,
    )!;
  };
  const start = async (purpose: AttemptView['purpose'] = 'learning') => {
    await page.goto(`/assessments/${assessment.id}?taskId=${taskId}&planId=${plan.id}`);
    await expect(page.getByLabel('作答用途', { exact: true })).toContainText('正式作答');
    if (purpose === 'test') {
      await page.getByLabel('作答用途', { exact: true }).click();
      await page.getByRole('option', { name: '测试作答', exact: true }).click();
    }
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/assessments/${assessment.id}/attempts`),
    );
    await page.getByRole('button', { name: '开始或继续', exact: true }).click();
    const response = await started;
    expect(response.request().postDataJSON()).toEqual({ purpose, taskId });
    const attempt = ((await response.json()) as ApiResponse<AttemptView>).data;
    await expect(page.getByRole('heading', { name: '用途回归：选择数据库' })).toBeVisible();
    return attempt;
  };
  return {
    assessment,
    taskId,
    start,
    readReport,
    readPlan,
    questionId: questions[0]!.questionId,
    post,
    headers,
  };
}

async function submit(page: Page) {
  await page.getByRole('button', { name: '检查并交卷', exact: true }).first().click();
  await page.getByRole('button', { name: '确认交卷', exact: true }).click();
  await expect(page).toHaveURL(/\/report(?:\?|$)/);
  await expect(page.getByRole('region', { name: '成绩摘要' })).toBeVisible();
}

test('测试作答可继续答题、交卷并评分，但不增加学习统计、错题和计划完成度', async ({ page }) => {
  const { start, readReport, readPlan, questionId } = await seed(page);
  const before = (
    (await (await page.request.get('/api/v1/dashboard')).json()) as ApiResponse<Dashboard>
  ).data;
  const attempt = await start('test');
  await expect(
    page.getByText('测试作答：可正常答题、交卷与评分，不计入学习统计、错题及计划进度。'),
  ).toBeVisible();
  await page.getByLabel('普通文本文件', { exact: true }).check();
  await page.getByRole('link', { name: '作答详情', exact: true }).click();
  await page.getByRole('link', { name: '继续作答', exact: true }).click();
  await expect(page.getByLabel('普通文本文件', { exact: true })).toBeChecked();
  await expect(page.getByLabel('SQLite', { exact: true })).toBeEnabled();
  await submit(page);
  const report = await readReport(attempt.id);
  expect(report).toMatchObject({
    isFinal: true,
    unansweredCount: 0,
    awardedScore: '0.00',
    attempt: { purpose: 'test', taskId: attempt.taskId, status: 'completed', voidedAt: null },
  });
  expect(report.attempt.items[0]).toMatchObject({
    answerStatus: 'answered',
    gradingStatus: 'completed',
    grade: { source: 'rule', score: '0.00' },
  });
  const after = (
    (await (await page.request.get('/api/v1/dashboard')).json()) as ApiResponse<Dashboard>
  ).data;
  expect(after.completedAttempts).toBe(before.completedAttempts);
  expect((await readPlan()).phases[0]!.tasks[0]!.status).toBe('todo');
  const wrong = (
    (await (await page.request.get('/api/v1/wrong-questions')).json()) as ApiResponse<
      WrongQuestionListItem[]
    >
  ).data;
  expect(wrong.some((item) => item.questionId === questionId)).toBe(false);
  await page.goto('/history');
  await page.getByLabel('用途', { exact: true }).click();
  await page.getByRole('option', { name: '测试作答', exact: true }).click();
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  const entry = page
    .locator('.list-card')
    .filter({ has: page.getByRole('heading', { name: attempt.title, exact: true }) });
  await expect(entry.getByText('测试作答', { exact: true })).toBeVisible();
  await page.getByLabel('用途', { exact: true }).click();
  await page.getByRole('option', { name: '正式作答', exact: true }).click();
  await expect(entry).toHaveCount(0);
});

for (const kind of ['practice', 'exam'] as const) {
  test(`正式${kind === 'exam' ? '考试' : '练习'}全空交卷：系统判空且${kind === 'exam' ? '完成' : '不完成'}计划任务`, async ({
    page,
  }) => {
    const { start, readReport, readPlan } = await seed(page, kind);
    const attempt = await start();
    expect(attempt.items[0]).toMatchObject({
      answerStatus: 'unanswered',
      gradingStatus: 'not_started',
      grade: null,
    });
    await submit(page);
    const report = await readReport(attempt.id);
    expect(report).toMatchObject({
      isFinal: true,
      unansweredCount: 1,
      awardedScore: '0.00',
      pendingMaxScore: '0.00',
    });
    expect(report.attempt.items[0]).toMatchObject({
      answerStatus: 'unanswered',
      gradingStatus: 'completed',
      grade: { source: 'system', score: '0.00', feedback: '未作答' },
    });
    expect((await readPlan()).phases[0]!.tasks[0]!.status).toBe(
      kind === 'exam' ? 'completed' : 'in_progress',
    );
    const summary = page.getByRole('region', { name: '成绩摘要' });
    await expect(summary.getByText('未作答题数')).toBeVisible();
    const nav = await openQuestionNav(page);
    const unanswered = nav.getByRole('button', { name: '第 1 题，未作答', exact: true });
    await expect(unanswered).not.toHaveClass(/correct|wrong/);
    await unanswered.click();
    await expect(page.getByText('答案状态：未作答', { exact: true })).toBeVisible();
    await expect(page.getByText('系统判空 · 未作答', { exact: true })).toBeVisible();
  });
}

test('作废需要原因与当前版本，冲突后重新确认；作废记录只读且可筛选', async ({ page }) => {
  const { start, readReport } = await seed(page);
  const attempt = await start();
  await page.getByRole('link', { name: '作答详情', exact: true }).click();
  await page.getByRole('button', { name: '作废作答', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认作废本次作答？', exact: true });
  const confirm = dialog.getByRole('button', { name: '确认作废', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('作废原因（必填，最多 4000 字）').fill('   ');
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole('textbox')).toHaveAttribute('maxlength', '4000');
  await dialog.getByRole('textbox').fill('  误开练习，保留作废历史  ');
  const voidPath = `**/api/v1/attempts/${attempt.id}/void`;
  await page.route(
    voidPath,
    (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'REVISION_CONFLICT', message: '记录已更新，请重新确认' },
          meta: {},
        }),
      }),
    { times: 1 },
  );
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('作废失败', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '作废作答', exact: true }).click();
  const voided = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/attempts/${attempt.id}/void`),
  );
  await confirm.click();
  const response = await voided;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toEqual({
    expectedRevision: expect.any(Number),
    reason: '误开练习，保留作废历史',
  });
  await expect(page.getByText('已作废 · 只读', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '继续作答', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '作废作答', exact: true })).toHaveCount(0);
  const report = await readReport(attempt.id);
  expect(report.attempt).toMatchObject({
    voidedAt: expect.any(String),
    voidedBy: expect.any(String),
    voidReason: '误开练习，保留作废历史',
  });
  await page.goto(`/attempts/${attempt.id}`);
  await expect(page).toHaveURL(`/attempts/${attempt.id}/report`);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '交卷', exact: true })).toHaveCount(0);
  await page.goto('/history');
  await page.getByLabel('作废状态', { exact: true }).click();
  await page.getByRole('option', { name: '已作废', exact: true }).click();
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  const entry = page
    .locator('.list-card')
    .filter({ has: page.getByRole('heading', { name: attempt.title, exact: true }) });
  await expect(entry.getByText('已作废', { exact: true })).toBeVisible();
  await expect(entry).toHaveAttribute('href', `/attempts/${attempt.id}/report`);
  await page.getByLabel('作废状态', { exact: true }).click();
  await page.getByRole('option', { name: '未作废', exact: true }).click();
  await expect(entry).toHaveCount(0);
});

test('测试答题链接在会话创建前提示用途，持链接者作答归属所属用户', async ({ page, browser }) => {
  const { assessment, taskId, post, headers } = await seed(page);
  const link = await post<AnswerLinkCreated>(
    `/agent/assessments/${assessment.id}/answer-links`,
    {
      expiresInSeconds: 3600,
      purpose: 'test',
      taskId,
    },
    headers,
  );
  expect(link).toMatchObject({ purpose: 'test', taskId });
  const anonymous = await browser.newContext();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const answerPage = await anonymous.newPage();
    await answerPage.route('**/api/v1/public/answer/attempt', async (route) => {
      await gate;
      await route.continue();
    });
    const started = answerPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/public/answer/attempt'),
    );
    await answerPage.goto(link.answerUrl);
    await expect(
      answerPage.getByText('测试作答：可正常答题、交卷与评分，不计入学习统计、错题及计划进度。'),
    ).toBeVisible();
    await expect(answerPage.getByRole('heading', { name: '用途回归：选择数据库' })).toHaveCount(0);
    release();
    const attempt = ((await (await started).json()) as ApiResponse<AttemptView>).data;
    expect(attempt).toMatchObject({ purpose: 'test', taskId, source: 'answer_link' });
    await expect(
      answerPage.getByText(
        '持链接者的作答会记到链接所属用户名下；测试作答不计入学习统计、错题和计划进度。请勿转发给他人。',
      ),
    ).toBeVisible();
    await expect(answerPage.getByRole('button', { name: '作废作答', exact: true })).toHaveCount(0);
  } finally {
    release();
    await anonymous.close();
  }
});

test('评分运维展示作废取消状态，不能恢复已取消任务', async ({ page }) => {
  await login(page);
  const cancelled: GradingJob = {
    id: 'cancelled-job',
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    revision: 2,
    ownerId: 'owner-one',
    attemptId: 'voided-attempt',
    itemId: 'item-one',
    generation: 1,
    profileId: null,
    status: 'cancelled',
    attemptCount: 0,
    nextRunAt: '2026-10-18T00:00:00.000Z',
    leaseExpiresAt: null,
    lastErrorCode: null,
  };
  await page.route('**/api/v1/admin/grading-jobs', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [cancelled], meta: {} }),
    }),
  );
  await page.goto('/admin/grading');
  await expect(page.getByText('已取消（作答作废）', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复任务', exact: true })).toHaveCount(0);
});

for (const fromDetail of [false, true]) {
  test(`错题${fromDetail ? '详情' : '列表'}可选择测试用途重练`, async ({ page }) => {
    const { start, questionId } = await seed(page);
    await start();
    await page.getByLabel('普通文本文件', { exact: true }).check();
    await submit(page);
    await page.goto(fromDetail ? `/wrong-questions/${questionId}` : '/wrong-questions');
    await page.getByLabel('作答用途', { exact: true }).click();
    await page.getByRole('option', { name: '测试作答', exact: true }).click();
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/wrong-question-practices'),
    );
    if (fromDetail) {
      await page.getByRole('button', { name: '开始重练', exact: true }).click();
    } else {
      await page
        .locator('.list-card')
        .filter({ has: page.locator(`a[href="/wrong-questions/${questionId}"]`) })
        .getByRole('button', { name: '重练', exact: true })
        .click();
    }
    const response = await started;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toMatchObject({ purpose: 'test' });
    const attempt = ((await response.json()) as ApiResponse<AttemptView>).data;
    expect(attempt.purpose).toBe('test');
    await expect(page.getByRole('heading', { name: '用途回归：选择数据库' })).toBeVisible();
    await expect(page.getByLabel('SQLite', { exact: true })).toBeEnabled();
  });
}
