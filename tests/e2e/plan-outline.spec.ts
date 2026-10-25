import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { ApiResponse, Assessment, Content, LearningPlan, Topic } from '@drill-hub/contracts';
import { login } from '#e2e/helpers';

async function seedPlan(page: Page) {
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
      name: `plan-outline-${randomUUID()}`,
      scopes: ['read', 'content:write', 'assessment:write', 'archive:write'],
    },
    { 'X-CSRF-Token': csrf },
  );
  const headers = { Authorization: `Bearer ${token}` };
  const topic = await post<Topic>('/agent/topics', { title: `计划目录-${randomUUID()}` }, headers);
  const first = await post<Content>(
    `/agent/topics/${topic.id}/contents`,
    { title: '目录阅读一', bodyText: '第一篇计划阅读内容。' },
    headers,
  );
  const second = await post<Content>(
    `/agent/topics/${topic.id}/contents`,
    { title: '目录阅读二', bodyText: '第二篇计划阅读内容。' },
    headers,
  );
  const questions = await post<{ questionId: string }[]>(
    `/agent/topics/${topic.id}/questions/batch`,
    {
      items: [
        {
          type: 'true_false',
          stem: '目录练习判断题',
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
      kind: 'practice',
      title: '目录练习',
      items: [{ questionId: questions[0]!.questionId, questionVersion: 1, maxScore: '10.00' }],
    },
    headers,
  );
  const plan = await post<LearningPlan>(
    `/agent/topics/${topic.id}/plans`,
    {
      title: '目录来源计划',
      phases: [
        {
          title: '阅读阶段',
          tasks: [
            { title: '阅读目录阅读一', kind: 'reading', targetId: first.id },
            { title: '阅读目录阅读二', kind: 'reading', targetId: second.id },
          ],
        },
        {
          title: '练习阶段',
          tasks: [
            { title: '完成目录练习', kind: 'practice', targetId: assessment.id },
            { title: '手动整理笔记', kind: 'manual' },
          ],
        },
      ],
    },
    headers,
  );
  return { topic, first, second, assessment, plan };
}

test('桌面阅读页展示计划目录，可切换任务并即时反映完成状态', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '仅桌面视口');
  const { first, second, plan } = await seedPlan(page);
  const readingTask = plan.phases[0]!.tasks[0]!;
  await page.goto(`/contents/${first.id}?planId=${plan.id}&taskId=${readingTask.id}`);

  const outline = page.getByRole('navigation', { name: '学习计划目录' });
  await expect(outline).toBeVisible();
  await expect(outline.getByRole('link', { name: /目录来源计划/ })).toBeVisible();
  await expect(outline).toContainText('阅读阶段');
  await expect(outline).toContainText('练习阶段');
  await expect(outline).toContainText('手动整理笔记');
  // 打开即完成后，目录里的进度与当前任务高亮同步更新。
  await expect(outline).toContainText('已完成 1/4');
  const taskOne = outline.getByRole('link', { name: /阅读目录阅读一/ });
  const taskTwo = outline.getByRole('link', { name: /阅读目录阅读二/ });
  await expect(taskOne).toHaveAttribute('aria-current', 'true');
  await expect(taskTwo).not.toHaveAttribute('aria-current', 'true');

  await taskTwo.click();
  await expect(page).toHaveURL(new RegExp(`/contents/${second.id}.*planId=${plan.id}`));
  await expect(page.getByRole('heading', { name: '目录阅读二' })).toBeVisible();
  await expect(taskTwo).toHaveAttribute('aria-current', 'true');
  await expect(taskOne).not.toHaveAttribute('aria-current', 'true');
  await expect(outline).toContainText('已完成 2/4');
});

test('桌面简报页与答题页左侧显示计划目录和题号导航', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '仅桌面视口');
  const { topic, plan, assessment, first } = await seedPlan(page);
  await page.goto(`/topics/${topic.id}/plans/${plan.id}`);
  await page
    .getByRole('region', { name: '练习阶段', exact: true })
    .getByRole('link', { name: '前往' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/assessments/${assessment.id}`));

  const outline = page.getByRole('navigation', { name: '学习计划目录' });
  await expect(outline).toBeVisible();
  await expect(outline.getByRole('link', { name: /完成目录练习/ })).toHaveAttribute(
    'aria-current',
    'true',
  );

  await page.getByRole('button', { name: '开始或继续' }).click();
  await expect(page).toHaveURL(/\/attempts\//);
  await expect(outline).toBeVisible();
  await expect(page.getByRole('navigation', { name: '题号导航' })).toBeVisible();
  await expect(outline.getByRole('link', { name: /完成目录练习/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(outline).toContainText('目录阅读一');

  // 从答题页目录直接切回阅读任务。
  await outline.getByRole('link', { name: /阅读目录阅读一/ }).click();
  await expect(page).toHaveURL(new RegExp(`/contents/${first.id}`));
  await expect(page.getByRole('heading', { name: '目录阅读一' })).toBeVisible();
});

test('移动端阅读页通过浮动按钮展开计划目录并切换任务', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  const { first, second, plan } = await seedPlan(page);
  const readingTask = plan.phases[0]!.tasks[0]!;
  await page.goto(`/contents/${first.id}?planId=${plan.id}&taskId=${readingTask.id}`);
  await expect(page.getByRole('heading', { name: '目录阅读一' })).toBeVisible();

  await expect(page.locator('.plan-outline-nav--desktop')).toBeHidden();
  const fab = page.getByRole('button', { name: '打开学习计划目录' });
  await expect(fab).toBeVisible();
  await fab.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const outline = dialog.getByRole('navigation', { name: '学习计划目录' });
  await expect(outline).toBeVisible();
  await expect(outline).toContainText('已完成 1/4');

  await outline.getByRole('link', { name: /阅读目录阅读二/ }).click();
  await expect(page).toHaveURL(new RegExp(`/contents/${second.id}`));
  await expect(page.getByRole('heading', { name: '目录阅读二' })).toBeVisible();
  await expect(dialog).not.toBeVisible();
});

test('移动端答题页答题卡与计划目录按钮并存且互不遮挡', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  const { topic, plan, assessment } = await seedPlan(page);
  await page.goto(`/topics/${topic.id}/plans/${plan.id}`);
  await page
    .getByRole('region', { name: '练习阶段', exact: true })
    .getByRole('link', { name: '前往' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/assessments/${assessment.id}`));
  await page.getByRole('button', { name: '开始或继续' }).click();
  await expect(page).toHaveURL(/\/attempts\//);

  const planFab = page.getByRole('button', { name: '打开学习计划目录' });
  const sheetFab = page.getByRole('button', { name: '打开答题卡' });
  await expect(planFab).toBeVisible();
  await expect(sheetFab).toBeVisible();
  const planBox = await planFab.boundingBox();
  const sheetBox = await sheetFab.boundingBox();
  expect(planBox).toBeTruthy();
  expect(sheetBox).toBeTruthy();
  expect(planBox!.y + planBox!.height).toBeLessThanOrEqual(sheetBox!.y + 1);

  await planFab.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('navigation', { name: '学习计划目录' })).toContainText(
    '完成目录练习',
  );
  await expect(dialog.getByRole('link', { name: /完成目录练习/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await page.getByRole('button', { name: '关闭学习计划目录' }).click();
  await expect(dialog).not.toBeVisible();
});
