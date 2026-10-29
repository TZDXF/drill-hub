import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { AnswerLinkCreated, Assessment, Topic } from '@drill-hub/contracts';
import { login, post, agentHeaders } from '#e2e/helpers';

test('主题页可吊销答题链接并经影响预览永久删除主题', async ({ page, isMobile }) => {
  await login(page);
  const headers = await agentHeaders(page.request, `maintenance-${randomUUID()}`, [
    'read',
    'content:write',
    'assessment:write',
  ]);
  const title = `维护主题-${randomUUID().slice(0, 8)}`;
  const topic = await post<Topic>(
    page.request,
    '/agent/topics',
    { title, goalText: '测试删除与链接管理' },
    headers,
  );
  const questions = await post<{ questionId: string }[]>(
    page.request,
    `/agent/topics/${topic.id}/questions/batch`,
    {
      items: [
        {
          type: 'true_false',
          stem: '永久删除需要确认',
          gradingMode: 'rule',
          gradingKey: { value: true },
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
      title: `链接练习-${randomUUID().slice(0, 8)}`,
      items: questions.map(({ questionId }) => ({
        questionId,
        questionVersion: 1,
        maxScore: '10.00',
      })),
    },
    headers,
  );
  await post<AnswerLinkCreated>(
    page.request,
    `/agent/assessments/${assessment.id}/answer-links`,
    { purpose: 'test' },
    headers,
  );

  await page.goto(`/topics/${topic.id}`);
  const linksCard = page.locator('.topic-links');
  await expect(linksCard).toContainText(assessment.title);
  await expect(linksCard).toContainText('有效');
  await linksCard.getByRole('button', { name: '吊销' }).click();
  const revokeDialog = page.getByRole('dialog');
  await expect(revokeDialog).toContainText('吊销后链接立即失效');
  await revokeDialog.getByRole('button', { name: '确认吊销' }).click();
  await expect(linksCard).toContainText('已吊销');

  if (isMobile) {
    await expect(page.getByTestId('topic-export')).toHaveCount(0);
    await expect(page.locator('.topic-danger-zone')).not.toContainText('下载数据备份');
  } else {
    await page.getByTestId('topic-export').click();
    await expect(page).toHaveURL(/\/settings\?focus=export$/);
    await expect(page.getByRole('heading', { name: '数据备份与导出' })).toBeInViewport();
    await page.goBack();
  }

  await page.getByTestId('topic-purge').click();
  const dialog = page.getByRole('dialog');
  const deleteButton = dialog.getByRole('button', { name: '永久删除', exact: true });
  await expect(dialog).toContainText(title);
  await expect(dialog).toContainText('此操作无法撤销');
  await expect(dialog).toContainText('作答记录');
  await expect(deleteButton).toBeDisabled();
  await page.getByTestId('topic-purge-confirmation').fill(`${title}-错误`);
  await expect(deleteButton).toBeDisabled();
  await page.getByTestId('topic-purge-confirmation').fill(title);
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect(page.locator('h1')).toHaveText('学习主题');
  await expect(page.locator('.list-card', { hasText: title })).toHaveCount(0);
});
