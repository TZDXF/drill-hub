import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { ApiResponse, Assessment, Content, LearningPlan, Topic } from '@drill-hub/contracts';
import { login } from './helpers';

async function createPlan(page: Page, kind: 'reading' | 'practice' | 'exam') {
  await login(page);
  const csrfResponse = await page.request.get('/api/v1/auth/csrf');
  const csrf = (await csrfResponse.json()).data.csrfToken as string;
  async function post<T>(path: string, data: unknown, headers: Record<string, string>) {
    const response = await page.request.post(`/api/v1${path}`, { data, headers });
    await expect(response).toBeOK();
    return ((await response.json()) as ApiResponse<T>).data;
  }
  const { token } = await post<{ token: string }>(
    '/me/agent-tokens',
    {
      name: `plan-navigation-${randomUUID()}`,
      scopes: ['read', 'content:write', 'assessment:write', 'archive:write'],
    },
    { 'X-CSRF-Token': csrf },
  );
  const headers = { Authorization: `Bearer ${token}` };
  const topic = await post<Topic>('/agent/topics', { title: `计划返回-${randomUUID()}` }, headers);
  let targetId: string;
  if (kind === 'reading') {
    const content = await post<Content>(
      `/agent/topics/${topic.id}/contents`,
      { title: '阶段阅读内容', bodyText: '阅读后应返回来源计划。' },
      headers,
    );
    targetId = content.id;
  } else {
    const questions = await post<{ questionId: string }[]>(
      `/agent/topics/${topic.id}/questions/batch`,
      {
        items: [
          {
            type: 'true_false',
            stem: '应当返回来源计划',
            gradingMode: 'rule',
            gradingKey: { value: true },
          },
        ],
      },
      headers,
    );
    const assessment = await post<Assessment>(
      `/agent/topics/${topic.id}/assessments`,
      {
        kind,
        title: '阶段评估',
        ...(kind === 'exam' ? { durationSeconds: 600 } : {}),
        items: [{ questionId: questions[0]!.questionId, questionVersion: 1, maxScore: '10.00' }],
      },
      headers,
    );
    targetId = assessment.id;
  }
  const phases = [
    { title: '准备阶段', tasks: [{ title: '准备学习', kind: 'manual' }] },
    { title: '当前阶段', tasks: [{ title: '进入阶段任务', kind, targetId }] },
  ];
  // 同一目标可被不同计划引用，返回路径必须来自实际打开它的计划。
  const otherPlan = await post<LearningPlan>(
    `/agent/topics/${topic.id}/plans`,
    { title: '另一份计划', phases },
    headers,
  );
  const plan = await post<LearningPlan>(
    `/agent/topics/${topic.id}/plans`,
    { title: '来源学习计划', phases },
    headers,
  );
  const planPath = `/topics/${topic.id}/plans/${plan.id}`;
  await page.goto(`/topics/${topic.id}`);
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: plan.title, exact: true }) })
    .click();
  await expect(page).toHaveURL(planPath);
  const openTask = () =>
    page
      .getByRole('region', { name: '当前阶段', exact: true })
      .getByRole('link', { name: /^(前往|继续)$/ })
      .click();
  const readPlans = async () => {
    const response = await page.request.get(`/api/v1/topics/${topic.id}/plans?archiveState=all`);
    await expect(response).toBeOK();
    return ((await response.json()) as ApiResponse<LearningPlan[]>).data;
  };
  return { plan, otherPlan, planPath, openTask, targetId, topic, headers, readPlans };
}

test('计划阅读打开即完成来源任务，刷新不重复写入且仍返回来源计划', async ({ page }) => {
  const { plan, otherPlan, planPath, openTask, readPlans } = await createPlan(page, 'reading');
  const completionRequests: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/tasks\/[^/]+\/complete$/.test(request.url())) {
      completionRequests.push(request.postDataJSON());
    }
  });
  await openTask();
  await expect(page.getByRole('heading', { name: '阶段阅读内容' })).toBeVisible();
  const completed = (await readPlans()).find((item) => item.id === plan.id)!;
  expect(completed.revision).toBe(plan.revision + 1);
  expect(completed.phases[0]!.tasks[0]!.status).toBe('todo');
  expect(completed.phases[1]!.tasks[0]!).toMatchObject({
    status: 'completed',
    completedAt: expect.any(String),
  });
  expect((await readPlans()).find((item) => item.id === otherPlan.id)).toEqual(otherPlan);
  expect(completionRequests).toEqual([{ expectedRevision: plan.revision }]);
  await page.reload();
  const back = page.getByRole('link', { name: '返回学习计划', exact: true });
  await expect(back).toHaveAttribute('href', planPath);
  expect((await readPlans()).find((item) => item.id === plan.id)).toEqual(completed);
  expect(completionRequests).toHaveLength(1);
  await back.click();
  await expect(page).toHaveURL(planPath);
  await expect(page.getByRole('heading', { name: '来源学习计划' })).toBeVisible();
  await expect(page.getByRole('region', { name: '当前阶段', exact: true })).toContainText('已完成');
  await expect(
    page
      .getByRole('region', { name: '准备阶段', exact: true })
      .getByRole('button', { name: '标记完成' }),
  ).toBeVisible();
  await page.getByRole('link', { name: '返回主题', exact: true }).click();
  await expect(page).toHaveURL(planPath.split('/plans/')[0]!);
});

test('直接浏览或来源参数不匹配时不完成任何阅读任务', async ({ page }) => {
  const { plan, otherPlan, targetId, readPlans } = await createPlan(page, 'reading');
  const task = plan.phases[1]!.tasks[0]!;
  const queries = [
    '',
    `?taskId=${task.id}`,
    `?planId=${plan.id}`,
    `?planId=${otherPlan.id}&taskId=${task.id}`,
    `?planId=${plan.id}&taskId=${plan.phases[0]!.tasks[0]!.id}`,
    `?planId=${plan.id}&taskId=${randomUUID()}`,
  ];
  for (const query of queries) {
    await page.goto(`/contents/${targetId}${query}`);
    await expect(page.getByRole('heading', { name: '阶段阅读内容' })).toBeVisible();
    const plans = await readPlans();
    expect(plans.find((item) => item.id === plan.id)).toEqual(plan);
    expect(plans.find((item) => item.id === otherPlan.id)).toEqual(otherPlan);
  }
});

test('打开的内容不是任务目标时不自动完成', async ({ page }) => {
  const { plan, topic, headers, readPlans } = await createPlan(page, 'reading');
  const response = await page.request.post(`/api/v1/agent/topics/${topic.id}/contents`, {
    headers,
    data: { title: '另一篇阅读内容', bodyText: '不应完成其他阅读任务。' },
  });
  await expect(response).toBeOK();
  const content = ((await response.json()) as ApiResponse<Content>).data;
  await page.goto(
    `/contents/${content.id}?planId=${plan.id}&taskId=${plan.phases[1]!.tasks[0]!.id}`,
  );
  await expect(page.getByRole('heading', { name: content.title })).toBeVisible();
  expect((await readPlans()).find((item) => item.id === plan.id)).toEqual(plan);
});

test('阅读加载失败不会完成任务，重新加载成功后自动完成', async ({ page }) => {
  const { plan, targetId, openTask, readPlans } = await createPlan(page, 'reading');
  await page.route(`**/api/v1/contents/${targetId}`, (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: '暂时无法读取内容' } },
    }),
  );
  await openTask();
  await expect(page.getByRole('heading', { name: '内容读取失败' })).toBeVisible();
  expect((await readPlans()).find((item) => item.id === plan.id)).toEqual(plan);
  await page.unroute(`**/api/v1/contents/${targetId}`);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '阶段阅读内容' })).toBeVisible();
  expect((await readPlans()).find((item) => item.id === plan.id)!.phases[1]!.tasks[0]!.status).toBe(
    'completed',
  );
});

test('自动完成遇到版本冲突时保留正文，重试读取最新计划后完成', async ({ page }) => {
  const { plan, headers, openTask, readPlans } = await createPlan(page, 'reading');
  const revisions: number[] = [];
  const taskId = plan.phases[1]!.tasks[0]!.id;
  await page.route(`**/api/v1/tasks/${taskId}/complete`, async (route) => {
    revisions.push(
      (route.request().postDataJSON() as { expectedRevision: number }).expectedRevision,
    );
    if (revisions.length === 1) {
      // 在客户端读取后推进服务端 revision，验证冲突不会静默覆盖。
      const response = await page.request.patch(`/api/v1/agent/plans/${plan.id}`, {
        headers,
        data: { expectedRevision: plan.revision, title: '并发修改后的学习计划' },
      });
      await expect(response).toBeOK();
    }
    await route.continue();
  });
  await openTask();
  await expect(page.getByRole('heading', { name: '阶段阅读内容' })).toBeVisible();
  const notice = page.locator('.notice[role="alert"]');
  await expect(notice).toContainText('任务未能自动标记完成');
  expect((await readPlans()).find((item) => item.id === plan.id)!.phases[1]!.tasks[0]!.status).toBe(
    'todo',
  );
  await notice.getByRole('button', { name: '重试', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await readPlans()).find((item) => item.id === plan.id)!.phases[1]!.tasks[0]!.status,
    )
    .toBe('completed');
  const completed = (await readPlans()).find((item) => item.id === plan.id)!;
  expect(completed.title).toBe('并发修改后的学习计划');
  expect(revisions).toEqual([plan.revision, plan.revision + 1]);
});

test('查看归档计划的阅读内容不会更改任务状态', async ({ page }) => {
  const { plan, headers, openTask, readPlans } = await createPlan(page, 'reading');
  const response = await page.request.post(`/api/v1/agent/resources/plan/${plan.id}/archive`, {
    headers,
    data: { expectedRevision: plan.revision },
  });
  await expect(response).toBeOK();
  const archived = ((await response.json()) as ApiResponse<LearningPlan>).data;
  await openTask();
  await expect(page.getByRole('heading', { name: '阶段阅读内容' })).toBeVisible();
  expect((await readPlans()).find((item) => item.id === plan.id)).toEqual(archived);
  await expect(page.locator('.notice[role="alert"]')).toHaveCount(0);
});

for (const kind of ['practice', 'exam'] as const) {
  test(`计划阶段${kind === 'practice' ? '练习' : '考试'}的说明、作答和报告均返回来源计划`, async ({
    page,
  }) => {
    const { plan, planPath, openTask } = await createPlan(page, kind);
    await openTask();
    await page.getByRole('link', { name: '返回学习计划', exact: true }).click();
    await expect(page).toHaveURL(planPath);
    await openTask();
    await page.getByRole('button', { name: '开始或继续', exact: true }).click();
    await expect(page.getByRole('heading', { name: '应当返回来源计划' })).toBeVisible();
    await page.reload();
    await page.getByRole('link', { name: '保存并返回学习计划', exact: true }).click();
    await expect(page).toHaveURL(planPath);
    await openTask();
    await page.getByRole('button', { name: '开始或继续', exact: true }).click();
    await expect(page.getByRole('heading', { name: '应当返回来源计划' })).toBeVisible();
    const attemptPath = new URL(page.url()).pathname;
    await page.getByLabel('正确', { exact: true }).check();
    await page.getByRole('button', { name: '检查并交卷', exact: true }).click();
    await page.getByRole('button', { name: '确认交卷', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${attemptPath}/report`));
    await page.reload();
    await page.getByRole('link', { name: '返回学习计划', exact: true }).click();
    await expect(page).toHaveURL(planPath);
    await expect(page.getByRole('region', { name: '当前阶段', exact: true })).toContainText(
      '已完成',
    );
    // 已交卷会话的自动报告跳转也要保留计划来源。
    await page.goto(`${attemptPath}?planId=${plan.id}`);
    await expect(page).toHaveURL(new RegExp(`${attemptPath}/report`));
    await page.getByRole('link', { name: '返回学习计划', exact: true }).click();
    await expect(page).toHaveURL(planPath);
  });
}
