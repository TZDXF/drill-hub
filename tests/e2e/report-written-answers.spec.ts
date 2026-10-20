import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type {
  ApiResponse,
  Assessment,
  AttemptView,
  QuestionDefinition,
  Topic,
} from '@drill-hub/contracts';
import { login } from './helpers';

test('作答报告展示简答原文、按题目顺序排列的填空及未作答占位', async ({ page }) => {
  await login(page);
  const csrf = (await (await page.request.get('/api/v1/auth/csrf')).json()).data.csrfToken;
  const userHeaders = { 'X-CSRF-Token': csrf };
  async function post<T>(
    path: string,
    data: unknown,
    headers: Record<string, string> = userHeaders,
  ) {
    const response = await page.request.post(`/api/v1${path}`, { data, headers });
    await expect(response).toBeOK();
    return ((await response.json()) as ApiResponse<T>).data;
  }
  const { token } = await post<{ token: string }>('/me/agent-tokens', {
    name: `答案展示-${randomUUID()}`,
    scopes: ['read', 'content:write', 'assessment:write'],
  });
  const agentHeaders = { Authorization: `Bearer ${token}` };
  const topic = await post<Topic>(
    '/agent/topics',
    { title: `答案展示-${randomUUID()}` },
    agentHeaders,
  );
  const shortAnswer: QuestionDefinition = {
    type: 'short_answer',
    stem: '写出修改方案',
    gradingMode: 'external_rubric',
    referenceAnswer: '将规则封装到独立模块，通过接口调用。',
    rubric: {
      version: 1,
      criteria: [
        {
          id: 'solution',
          description: '提出具体修改方案',
          weight: 1,
          levels: [
            { id: 'none', creditBps: 0, description: '未说明' },
            { id: 'full', creditBps: 10000, description: '说明完整' },
          ],
        },
      ],
    },
  };
  const fillBlank: QuestionDefinition = {
    type: 'fill_blank',
    stem: '填写三个模块',
    slots: [{ id: 'rules' }, { id: 'orders' }, { id: 'payments' }],
    gradingMode: 'rule',
    gradingKey: {
      acceptedAnswers: { rules: ['规则模块'], orders: ['订单模块'], payments: ['支付模块'] },
    },
  };
  const questions = await post<{ questionId: string }[]>(
    `/agent/topics/${topic.id}/questions/batch`,
    {
      items: [
        shortAnswer,
        fillBlank,
        { ...shortAnswer, stem: '未作答的简答题' },
        { ...fillBlank, stem: '未作答的填空题' },
      ],
    },
    agentHeaders,
  );
  const assessment = await post<Assessment>(
    `/agent/topics/${topic.id}/assessments`,
    {
      kind: 'exam',
      title: '答案展示回归',
      durationSeconds: 600,
      items: questions.map(({ questionId }) => ({
        questionId,
        questionVersion: 1,
        maxScore: '10.00',
      })),
    },
    agentHeaders,
  );
  const attempt = await post<AttemptView>(`/assessments/${assessment.id}/attempts`, {
    purpose: 'learning',
  });
  const text = `修改订单积分规则\n  抽取独立规则模块，通过接口调用。\n<script>alert('原样展示')</script>\n${'LongAnswer'.repeat(40)}`;
  const answers = [{ text }, { slots: { orders: '订单模块', rules: '规则模块', payments: '  ' } }];
  for (const [index, answer] of answers.entries()) {
    const response = await page.request.put(
      `/api/v1/attempts/${attempt.id}/answers/${attempt.items[index]!.id}`,
      { headers: userHeaders, data: { expectedRevision: 0, answer } },
    );
    await expect(response).toBeOK();
  }
  await post(`/attempts/${attempt.id}/submit`, {});
  await page.goto(`/attempts/${attempt.id}/report?question=1`);
  const reportItem = page.locator('.report-item');
  const writtenAnswer = reportItem.getByRole('region', { name: '你的答案', exact: true });
  await expect(writtenAnswer.locator('p')).toHaveText(text, { useInnerText: false });
  expect(await writtenAnswer.locator('p').textContent()).toBe(text);
  await expect(writtenAnswer.locator('script')).toHaveCount(0);
  await expect(writtenAnswer.locator('p')).toHaveCSS('white-space', 'pre-wrap');
  await expect(reportItem.getByText(shortAnswer.referenceAnswer!, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await expect(writtenAnswer.locator('.meta-label')).toHaveText([
    '你的答案',
    '第 1 空',
    '第 2 空',
    '第 3 空',
  ]);
  await expect(writtenAnswer.locator('p')).toHaveText(['规则模块', '订单模块', '未作答']);
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await expect(writtenAnswer.locator('p')).toHaveText('未作答');
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await expect(writtenAnswer.locator('p')).toHaveText(['未作答', '未作答', '未作答']);
});
