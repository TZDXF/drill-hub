import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type {
  ApiResponse,
  AttemptReport,
  AttemptView,
  Topic,
  Assessment,
} from '@drill-hub/contracts';
import { closeQuestionNav, login, openQuestionNav } from './helpers';

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

test('Agent 创建五种题型，用户考试交卷，逐项评分同步报告和错题', async ({ page }, testInfo) => {
  await login(page);
  const csrfResponse = await page.request.get('/api/v1/auth/csrf');
  const {
    data: { csrfToken },
  } = await csrfResponse.json();
  const authorization = await post<{ token: string }>(
    page.request,
    '/me/agent-tokens',
    {
      name: `e2e-${randomUUID()}`,
      scopes: ['read', 'content:write', 'assessment:write', 'grade:write', 'archive:write'],
    },
    { 'X-CSRF-Token': csrfToken },
  );
  const headers = { Authorization: `Bearer ${authorization.token}` };
  const topic = await post<Topic>(
    page.request,
    '/agent/topics',
    { title: `数据库-${randomUUID()}` },
    headers,
  );
  const definitions = [
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
      type: 'multiple_choice',
      stem: '请选择事务性质',
      options: [
        { id: 'a', text: '原子性' },
        { id: 'b', text: '一致性' },
        { id: 'c', text: '随机性' },
      ],
      gradingMode: 'rule',
      gradingKey: { optionIds: ['a', 'b'] },
    },
    {
      type: 'true_false',
      stem: '事务具有原子性',
      gradingMode: 'rule',
      gradingKey: { value: true },
      explanation: '事务作为整体提交或回滚',
    },
    {
      type: 'fill_blank',
      stem: '本应用使用的数据库是？',
      slots: [{ id: 'database' }],
      gradingMode: 'rule',
      gradingKey: { acceptedAnswers: { database: ['SQLite'] } },
    },
    {
      type: 'short_answer',
      stem: '解释事务的两个性质',
      gradingMode: 'external_rubric',
      referenceAnswer: '原子性和一致性',
      rubric: {
        version: 1,
        criteria: [
          {
            id: 'properties',
            description: '说明原子性和一致性',
            weight: 1,
            levels: [
              { id: 'none', creditBps: 0, description: '未说明' },
              { id: 'partial', creditBps: 5000, description: '只说明一项' },
              { id: 'full', creditBps: 10000, description: '说明两项' },
            ],
          },
        ],
      },
    },
  ];
  const questions = await post<{ questionId: string }[]>(
    page.request,
    `/agent/topics/${topic.id}/questions/batch`,
    { items: definitions },
    headers,
  );
  const assessment = await post<Assessment>(
    page.request,
    `/agent/topics/${topic.id}/assessments`,
    {
      kind: 'exam',
      title: '五种题型闭环验收',
      durationSeconds: 600,
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
  await expect(page.getByRole('heading', { name: '请选择关系型数据库' })).toBeVisible();
  const questionNav = await openQuestionNav(page);
  await expect(questionNav).toBeVisible();
  await expect(page.locator('.attempt-progress, .progress-track')).toHaveCount(0);
  await expect(questionNav.getByRole('button')).toHaveCount(questions.length);
  for (let index = 0; index < questions.length; index += 1) {
    await expect(
      questionNav.getByRole('button', { name: `第 ${index + 1} 题，未作答`, exact: true }),
    ).toBeVisible();
  }
  await expect(questionNav.locator('.question-nav-grid')).toHaveCSS('display', 'grid');
  await expect(questionNav.getByRole('button').first()).toHaveAttribute('aria-current', 'step');
  const navBounds = await questionNav.boundingBox();
  const contentBounds = await page.locator('.attempt-content').boundingBox();
  expect(navBounds).not.toBeNull();
  expect(contentBounds).not.toBeNull();
  if (testInfo.project.name === 'chromium-desktop') {
    expect(navBounds!.x + navBounds!.width).toBeLessThanOrEqual(contentBounds!.x);
  } else {
    await expect
      .poll(async () => {
        const bounds = await page.getByRole('dialog', { name: '选择题号' }).boundingBox();
        return bounds ? Math.abs(bounds.y + bounds.height - page.viewportSize()!.height) : Infinity;
      })
      .toBeLessThan(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.screenshot({ path: testInfo.outputPath('attempt-question-grid.png'), fullPage: true });
  await questionNav.getByRole('button', { name: '第 5 题，未作答', exact: true }).click();
  await expect(page.getByRole('heading', { name: '解释事务的两个性质' })).toBeVisible();
  await openQuestionNav(page);
  await expect(questionNav.getByRole('button').last()).toHaveAttribute('aria-current', 'step');
  await questionNav.getByRole('button', { name: '第 1 题，未作答', exact: true }).click();
  await expect(page.getByRole('heading', { name: '请选择关系型数据库' })).toBeVisible();
  const attemptId = new URL(page.url()).pathname.split('/').at(-1)!;
  const before = (
    (await (
      await page.request.get(`/api/v1/attempts/${attemptId}`)
    ).json()) as ApiResponse<AttemptView>
  ).data;
  for (const item of before.items) {
    expect(item).not.toHaveProperty('gradingKey');
    expect(item).not.toHaveProperty('referenceAnswer');
    expect(item).not.toHaveProperty('rubric');
    expect(item).not.toHaveProperty('explanation');
  }
  await expect(page.locator('.save-state')).toHaveCount(0);
  await expect(page.getByText('修改后自动保存', { exact: true })).toHaveCount(0);
  const savedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith(`/attempts/${attemptId}/answers/${before.items[0]!.id}`),
  );
  await page.getByLabel('A. SQLite', { exact: true }).check();
  await expect(page.getByText('有修改等待保存', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/\d+ 项待保存/)).toHaveCount(0);
  const saved = await savedResponse;
  expect(saved.ok()).toBe(true);
  await expect(page.locator('.save-state')).toHaveCount(0);
  await expect(page.getByText(/已保存|保存成功/)).toHaveCount(0);
  await openQuestionNav(page);
  await expect(questionNav.getByRole('button').first()).toHaveAccessibleName('第 1 题，已作答');
  await expect(page.locator('.attempt-progress, .progress-track')).toHaveCount(0);
  await questionNav.getByRole('button', { name: '第 2 题，未作答', exact: true }).click();
  await expect(page.getByRole('heading', { name: '请选择事务性质' })).toBeVisible();
  await openQuestionNav(page);
  await questionNav.getByRole('button', { name: '第 1 题，已作答', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('A. SQLite', { exact: true })).toBeChecked();
  await expect(page.locator('.save-state')).toHaveCount(0);
  await openQuestionNav(page);
  await expect(questionNav.getByRole('button').first()).toHaveClass(/answered/);
  await closeQuestionNav(page);
  await page.getByRole('button', { name: '下一题' }).click();
  await page.getByLabel('A. 原子性', { exact: true }).check();
  await page.getByLabel('C. 随机性', { exact: true }).check();
  await page.getByRole('button', { name: '下一题' }).click();
  await page.getByLabel('错误', { exact: true }).check();
  await page.getByRole('button', { name: '下一题' }).click();
  await page.getByLabel('第 1 空').fill('SQLite');
  await page.getByRole('button', { name: '下一题' }).click();
  await page.getByLabel('你的答案', { exact: true }).fill('事务具有原子性');
  await page.getByRole('button', { name: '检查并交卷' }).click();
  await page.getByRole('button', { name: '确认交卷', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/attempts/${attemptId}/report$`));
  await expect(page.getByText('报告尚未最终完成')).toBeVisible();
  const pending = (
    (await (
      await page.request.get(`/api/v1/attempts/${attemptId}/report`)
    ).json()) as ApiResponse<AttemptReport>
  ).data;
  expect(pending.awardedScore).toBe('20.00');
  expect(pending.pendingMaxScore).toBe('10.00');
  expect(pending.isFinal).toBe(false);

  const reportItems = page.locator('.report-item');
  const pagination = page.getByRole('navigation', { name: '逐题切换' });
  const summary = page.getByRole('region', { name: '成绩摘要' });
  const reportTrigger = page.getByRole('button', { name: '打开答题卡', exact: true });
  await expect(summary).toBeVisible();
  await expect(reportItems).toHaveCount(0);
  await expect(pagination.getByRole('button', { name: '上一题' })).toBeDisabled();
  const mobileReport = testInfo.project.name === 'chromium-mobile';
  if (mobileReport) {
    await expect(reportTrigger).toBeVisible();
    await expect(questionNav).not.toBeVisible();
    const triggerBounds = (await reportTrigger.boundingBox())!;
    const initialViewport = page.viewportSize()!;
    expect(triggerBounds.width).toBe(triggerBounds.height);
    expect(triggerBounds.x).toBeGreaterThan(initialViewport.width / 2);
    expect(triggerBounds.y).toBeGreaterThan(initialViewport.height / 2);
  } else {
    await expect(reportTrigger).not.toBeVisible();
    await expect(questionNav).toBeVisible();
    const navBounds = (await questionNav.boundingBox())!;
    const summaryBounds = (await summary.boundingBox())!;
    expect(navBounds.x + navBounds.width).toBeLessThanOrEqual(summaryBounds.x);
    const contentBounds = (await page.locator('.report-content').boundingBox())!;
    expect(Math.abs(navBounds.y - contentBounds.y)).toBeLessThan(1);
  }
  await page.screenshot({ path: testInfo.outputPath('report-summary.png'), fullPage: true });
  await openQuestionNav(page);
  await expect(page.getByRole('button', { name: '评分总览', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(questionNav.locator('.question-nav-grid [aria-current]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('report-answer-card.png'), fullPage: true });
  await closeQuestionNav(page);
  if (mobileReport) await expect(reportTrigger).toBeFocused();
  await page.reload();
  await expect(summary).toBeVisible();
  await expect(reportItems).toHaveCount(0);
  await pagination.getByRole('button', { name: '查看题目' }).click();
  await expect(summary).toHaveCount(0);
  await expect(reportItems).toHaveCount(1);
  await expect(reportItems.getByRole('heading', { name: '请选择关系型数据库' })).toBeVisible();
  await expect(reportItems.locator('.review-choices .answer-option__text')).toHaveText([
    'A. SQLite',
    'B. 文本文件',
  ]);
  await expect(reportItems.getByLabel('A. SQLite', { exact: true })).toBeChecked();
  await expect(reportItems.getByLabel('A. SQLite', { exact: true })).toBeDisabled();
  await expect(reportItems.getByLabel('B. 文本文件', { exact: true })).not.toBeChecked();
  await expect(reportItems.getByText('回答正确', { exact: true })).toHaveCount(0);
  await openQuestionNav(page);
  await expect(questionNav.locator('.question-nav-grid').getByRole('button')).toHaveCount(
    questions.length,
  );
  await expect(
    questionNav.locator('.question-nav-grid').getByRole('button').first(),
  ).toHaveAttribute('aria-current', 'step');
  await expect(
    questionNav.getByRole('button', { name: '第 1 题，回答正确', exact: true }),
  ).toHaveClass(/correct/);
  await expect(
    questionNav.getByRole('button', { name: '第 2 题，回答错误', exact: true }),
  ).toHaveClass(/wrong/);
  await expect(
    questionNav.getByRole('button', { name: '第 3 题，回答错误', exact: true }),
  ).toHaveClass(/wrong/);
  await expect(
    questionNav.getByRole('button', { name: '第 5 题，待评分', exact: true }),
  ).not.toHaveClass(/correct|wrong/);
  await closeQuestionNav(page);
  await expect(pagination.getByRole('button', { name: '评分总览' })).toBeEnabled();
  await expect(pagination.getByText('第 1 / 5 题', { exact: true })).toBeVisible();
  await pagination.getByRole('button', { name: '下一题' }).click();
  await expect(reportItems.getByRole('heading', { name: '请选择事务性质' })).toBeVisible();
  await expect(reportItems.locator('.review-choices .answer-option__text')).toHaveText([
    'A. 原子性',
    'B. 一致性',
    'C. 随机性',
  ]);
  await expect(reportItems.getByLabel('A. 原子性', { exact: true })).toBeChecked();
  const missedOption = reportItems.locator('.answer-option', { hasText: 'B. 一致性' });
  const wrongOption = reportItems.locator('.answer-option', { hasText: 'C. 随机性' });
  await expect(missedOption.getByRole('checkbox')).not.toBeChecked();
  await expect(missedOption).toHaveClass(/missed/);
  await expect(missedOption.getByText('漏选', { exact: true })).toBeVisible();
  await expect(wrongOption.getByRole('checkbox')).toBeChecked();
  await expect(wrongOption).toHaveClass(/wrong/);
  await expect(wrongOption.getByText('错选', { exact: true })).toBeVisible();
  await expect(reportItems.getByText('回答错误', { exact: true })).toHaveCount(0);
  await pagination.getByRole('button', { name: '上一题' }).click();
  await expect(reportItems.getByRole('heading', { name: '请选择关系型数据库' })).toBeVisible();
  await openQuestionNav(page);
  await questionNav.getByRole('button', { name: '第 3 题，回答错误', exact: true }).click();
  await expect(reportItems.getByRole('heading', { name: '事务具有原子性' })).toBeVisible();
  await expect(reportItems.locator('.review-choices .answer-option__text')).toHaveText([
    '正确',
    '错误',
  ]);
  const correctBooleanOption = reportItems.locator('.answer-option', { hasText: '正确' });
  const wrongBooleanOption = reportItems.locator('.answer-option', { hasText: '错误' });
  await expect(reportItems.getByLabel('错误', { exact: true })).toBeChecked();
  await expect(reportItems.getByLabel('错误', { exact: true })).toBeDisabled();
  await expect(wrongBooleanOption).toHaveClass(/selected/);
  await expect(wrongBooleanOption).toHaveClass(/wrong/);
  await expect(correctBooleanOption).toHaveClass(/correct/);
  await openQuestionNav(page);
  await questionNav.getByRole('button').last().click();
  await expect(reportItems).toHaveCount(1);
  await expect(reportItems.getByRole('heading', { name: '解释事务的两个性质' })).toBeVisible();
  await expect(reportItems.getByText('待评分', { exact: true }).first()).toBeVisible();
  await expect(pagination.getByRole('button', { name: '下一题' })).toBeDisabled();
  await expect(pagination.getByRole('button', { name: '上一题' })).toBeEnabled();
  await expect(page).toHaveURL(/\?question=5$/);
  await page.reload();
  await expect(reportItems.getByRole('heading', { name: '解释事务的两个性质' })).toBeVisible();
  await expect(pagination.getByText('第 5 / 5 题', { exact: true })).toBeVisible();

  await expect(summary).toHaveCount(0);
  if (mobileReport) {
    await expect(reportTrigger).toBeVisible();
    await expect(questionNav).not.toBeVisible();
  } else {
    await expect(reportTrigger).not.toBeVisible();
    await expect(questionNav).toBeVisible();
    const navBounds = (await questionNav.boundingBox())!;
    const itemBounds = (await reportItems.boundingBox())!;
    expect(navBounds.x + navBounds.width).toBeLessThanOrEqual(itemBounds.x);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.screenshot({ path: testInfo.outputPath('report-question-grid.png'), fullPage: true });

  const shortAnswer = before.items[4]!;
  await post(
    page.request,
    `/agent/attempt-items/${shortAnswer.id}/grades`,
    {
      expectedGradeVersion: 0,
      criterionResults: [
        {
          criterionId: 'properties',
          levelId: 'partial',
          evidence: ['原子性'],
          explanation: '只说明原子性，未说明一致性',
        },
      ],
    },
    headers,
  );
  await page.getByRole('button', { name: '刷新报告' }).click();
  await expect(summary).toHaveCount(0);
  await expect(reportItems.getByRole('heading', { name: '解释事务的两个性质' })).toBeVisible();
  await openQuestionNav(page);
  await expect(questionNav.getByRole('button').last()).toHaveAttribute('aria-current', 'step');
  await closeQuestionNav(page);
  await expect(pagination.getByText('第 5 / 5 题', { exact: true })).toBeVisible();
  await expect(reportItems.getByText('已评分', { exact: true })).toBeVisible();
  await expect(reportItems.locator('.grade-feedback__summary')).toHaveCount(0);
  const criterionFeedback = reportItems.locator('.criterion-item');
  await expect(
    criterionFeedback.getByText('得分项：说明原子性和一致性', { exact: true }),
  ).toBeVisible();
  await expect(criterionFeedback.getByText('等级：只说明一项', { exact: true })).toBeVisible();
  await expect(criterionFeedback).not.toContainText('properties');
  await expect(criterionFeedback).not.toContainText('partial');
  const reportViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(pagination.getByRole('button', { name: '上一题' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(reportTrigger).toBeVisible();
  await expect(questionNav).not.toBeVisible();
  await openQuestionNav(page);
  await page.setViewportSize(reportViewport);
  if (mobileReport) await closeQuestionNav(page);
  else {
    await expect(page.getByRole('dialog', { name: '选择题号' })).not.toBeVisible();
    await expect(reportTrigger).not.toBeVisible();
    await expect(questionNav).toBeVisible();
  }
  await openQuestionNav(page);
  await page.getByRole('button', { name: '评分总览', exact: true }).click();
  await expect(summary).toBeVisible();
  await expect(page.getByText('最终得分', { exact: true })).toBeVisible();
  await expect(reportItems).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/attempts/${attemptId}/report$`));
  await pagination.getByRole('button', { name: '查看题目' }).click();
  await pagination.getByRole('button', { name: '评分总览' }).click();
  await expect(summary).toBeVisible();
  await page.getByRole('link', { name: '学习历史', exact: true }).click();
  await page.locator(`a[href="/attempts/${attemptId}/report"]`).click();
  await expect(summary).toBeVisible();
  await expect(reportItems).toHaveCount(0);
  await pagination.getByRole('button', { name: '查看题目' }).click();
  await expect(reportItems).toHaveCount(1);
  await expect(reportItems.getByRole('heading', { name: '请选择关系型数据库' })).toBeVisible();
  const final = (
    (await (
      await page.request.get(`/api/v1/attempts/${attemptId}/report`)
    ).json()) as ApiResponse<AttemptReport>
  ).data;
  expect(final.awardedScore).toBe('25.00');
  expect(final.isFinal).toBe(true);
  expect(final.attempt.items[4]!.grade!.criterionResults[0]).toMatchObject({
    criterionId: 'properties',
    levelId: 'partial',
    criterionDescription: '说明原子性和一致性',
    levelDescription: '只说明一项',
  });
  await page.goto('/wrong-questions');
  await expect(page.getByRole('heading', { name: '错题集', exact: true, level: 1 })).toBeVisible();
  await expect(
    page
      .getByRole('link', { name: '事务具有原子性', exact: true })
      .and(page.locator(`[href="/wrong-questions/${questions[2]!.questionId}"]`)),
  ).toBeVisible();
  await expect(
    page
      .locator(`[href="/wrong-questions/${questions[4]!.questionId}"]`)
      .getByText('解释事务的两个性质', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('wrong-questions.png'), fullPage: true });
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(viewport.content).toBeLessThanOrEqual(viewport.width);
  await page.locator(`h3 a[href="/wrong-questions/${questions[2]!.questionId}"]`).click();
  await page.getByRole('button', { name: '开始重练' }).click();
  await expect(
    page.getByRole('heading', { name: '事务具有原子性', exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByLabel('正确', { exact: true }).check();
  await page.getByRole('button', { name: '检查并交卷', exact: true }).click();
  await page.getByRole('button', { name: '确认交卷', exact: true }).click();
  await expect(summary).toBeVisible();
  await pagination.getByRole('button', { name: '查看题目' }).click();
  await expect(page.locator('.report-item').getByText('回答正确', { exact: true })).toHaveCount(0);
  await openQuestionNav(page);
  await expect(
    questionNav.getByRole('button', { name: '第 1 题，回答正确', exact: true }),
  ).toHaveClass(/correct/);
  await post(
    page.request,
    `/agent/resources/question/${questions[2]!.questionId}/archive`,
    { expectedRevision: 1 },
    headers,
  );
  await page.goto('/archive');
  const archivedCard = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: '事务具有原子性', exact: true }) });
  await archivedCard.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(archivedCard).toHaveCount(0);
  const archiveResponse = await page.request.get('/api/v1/archive');
  const archiveData = (await archiveResponse.json()).data as { id: string }[];
  expect(archiveData.some((item) => item.id === questions[2]!.questionId)).toBe(false);
});
