import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Assessment, Content, Topic } from '@drill-hub/contracts';
import { agentHeaders, login, post } from '#e2e/helpers';

test('阅读、练习入口、做题和报告均可打开并收起学习助手', async ({ page, isMobile }) => {
  await login(page);
  const headers = await agentHeaders(page.request, `assistant-pages-${randomUUID()}`, [
    'read',
    'content:write',
    'assessment:write',
  ]);
  const topic = await post<Topic>(
    page.request,
    '/agent/topics',
    { title: `助手页面适配-${randomUUID()}` },
    headers,
  );
  const content = await post<Content>(
    page.request,
    `/agent/topics/${topic.id}/contents`,
    { title: '助手阅读适配', bodyText: '在阅读正文时也可以使用学习助手。' },
    headers,
  );
  const questions = await post<{ questionId: string }[]>(
    page.request,
    `/agent/topics/${topic.id}/questions/batch`,
    {
      items: [
        {
          type: 'true_false',
          stem: '做题时可以打开学习助手',
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
      title: '助手练习适配',
      items: [{ questionId: questions[0]!.questionId, questionVersion: 1, maxScore: '10.00' }],
    },
    headers,
  );

  // 通过真实页面开始练习，后续报告仍引用同一份作答。
  await page.goto(`/assessments/${assessment.id}`);
  await page.getByRole('button', { name: '开始或继续' }).click();
  await expect(page.getByRole('heading', { name: '做题时可以打开学习助手' })).toBeVisible();
  const attemptPath = new URL(page.url()).pathname;
  const routes = [
    { path: `/contents/${content.id}`, heading: '助手阅读适配' },
    { path: `/assessments/${assessment.id}`, heading: '助手练习适配' },
    { path: attemptPath, heading: '做题时可以打开学习助手' },
    { path: `${attemptPath}/report`, heading: '助手练习适配' },
  ];
  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible();
    await expect(page.locator('.sidebar, .bottom-nav')).toHaveCount(0);
    const launcher = page.getByTestId(/^(assistant-launcher|assistant-floating-launcher)$/);
    await launcher.click();
    const panel = page.getByTestId('assistant-panel');
    const pane = page.getByTestId('assistant-pane');
    await expect(panel).toBeVisible();

    if (isMobile) {
      const bounds = await pane.boundingBox();
      expect(bounds!.x).toBe(0);
      expect(bounds!.width).toBe(page.viewportSize()!.width);
    } else {
      // 上一个页面选择的悬浮位置会保留；显式切回左侧验证各布局。
      await page.getByTestId('assistant-position-trigger').click();
      await page.getByTestId('assistant-position-left').click();
      const main = page.locator('.app-main');
      const left = await pane.boundingBox();
      const contentBounds = await main.boundingBox();
      expect(left!.x).toBe(0);
      expect(left!.x + left!.width).toBeCloseTo(contentBounds!.x, 0);

      await page.getByTestId('assistant-position-trigger').click();
      await page.getByTestId('assistant-position-right').click();
      const right = await pane.boundingBox();
      const mainBounds = await main.boundingBox();
      expect(mainBounds!.x).toBe(0);
      expect(mainBounds!.width).toBeCloseTo(right!.x, 0);
      expect(right!.x + right!.width).toBeCloseTo(page.viewportSize()!.width, 0);

      const desktopViewport = page.viewportSize()!;
      await page.setViewportSize({ width: 900, height: desktopViewport.height });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      const narrowMain = await main.boundingBox();
      expect(narrowMain!.width).toBeGreaterThanOrEqual(440);
      const questionNav = page.getByRole('button', { name: '打开答题卡', exact: true });
      if (await questionNav.isVisible()) {
        const navBounds = await questionNav.boundingBox();
        expect(navBounds!.x + navBounds!.width).toBeLessThanOrEqual(narrowMain!.width);
      }
      await page.setViewportSize(desktopViewport);

      await page.getByTestId('assistant-layout-toggle').click();
      await expect(main).toBeHidden();
      expect((await pane.boundingBox())!.width).toBeCloseTo(page.viewportSize()!.width, 0);
      await page.getByTestId('assistant-layout-toggle').click();
      await expect(main).toBeVisible();

      await page.getByTestId('assistant-position-trigger').click();
      await page.getByTestId('assistant-position-floating').click();
      await expect(pane).toHaveClass(/assistant-pane--floating/);
      await expect(page.getByTestId('assistant-floating-drag-handle')).toBeVisible();
    }

    await page.getByTestId('assistant-close').click();
    await expect(panel).toBeHidden();
    const reopen = page.getByTestId(
      isMobile ? 'assistant-launcher' : 'assistant-floating-launcher',
    );
    await expect(reopen).toBeVisible();
    // 助手入口与右下角的题号导航/计划目录保持分离。
    expect((await reopen.boundingBox())!.x).toBeLessThan(page.viewportSize()!.width / 2);
    await reopen.click();
    await expect(panel).toBeVisible();
    await page.getByTestId('assistant-close').click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
});
