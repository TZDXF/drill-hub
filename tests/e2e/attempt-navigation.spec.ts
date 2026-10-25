import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ApiResponse, Assessment, AttemptView, Topic } from '@drill-hub/contracts';
import { closeQuestionNav, login, openQuestionNav } from '#e2e/helpers';

async function startExam(page: Page, extraQuestions = 0) {
  await login(page);
  const csrf = (await (await page.request.get('/api/v1/auth/csrf')).json()).data.csrfToken;
  async function post<T>(path: string, data: unknown, headers: Record<string, string>) {
    const response = await page.request.post(`/api/v1${path}`, { data, headers });
    await expect(response).toBeOK();
    return ((await response.json()) as ApiResponse<T>).data;
  }
  const { token } = await post<{ token: string }>(
    '/me/agent-tokens',
    {
      name: `attempt-navigation-${randomUUID()}`,
      scopes: ['read', 'content:write', 'assessment:write'],
    },
    { 'X-CSRF-Token': csrf },
  );
  const headers = { Authorization: `Bearer ${token}` };
  const topic = await post<Topic>('/agent/topics', { title: `题号导航-${randomUUID()}` }, headers);
  const questions = await post<{ questionId: string }[]>(
    `/agent/topics/${topic.id}/questions/batch`,
    {
      items: [
        {
          type: 'single_choice',
          stem: '第一题：请选择数据库',
          options: [
            { id: 'a', text: 'SQLite' },
            { id: 'b', text: '文本' },
          ],
          gradingMode: 'rule',
          gradingKey: { optionId: 'a' },
        },
        {
          type: 'fill_blank',
          stem: '第二题：填写数据库名称',
          slots: [{ id: 'database' }],
          gradingMode: 'rule',
          gradingKey: { acceptedAnswers: { database: ['SQLite'] } },
        },
        {
          type: 'short_answer',
          stem: '第三题：简述事务性质',
          gradingMode: 'external_rubric',
          rubric: {
            version: 1,
            criteria: [
              {
                id: 'one',
                description: '说明性质',
                weight: 1,
                levels: [
                  { id: 'none', creditBps: 0, description: '未说明' },
                  { id: 'full', creditBps: 10000, description: '说明正确' },
                ],
              },
            ],
          },
        },
        ...Array.from({ length: extraQuestions }, (_, index) => ({
          type: 'true_false',
          stem: `附加题 ${index + 1}`,
          gradingMode: 'rule',
          gradingKey: { value: true },
        })),
      ],
    },
    headers,
  );
  const assessment = await post<Assessment>(
    `/agent/topics/${topic.id}/assessments`,
    {
      kind: 'exam',
      title: '标记与手势回归',
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
  await expect(page.getByRole('heading', { name: '第一题：请选择数据库' })).toBeVisible();
}

async function swipe(
  target: Locator,
  dx: number,
  dy = 0,
  cancel = false,
  multi = false,
  whileNavigating = false,
) {
  if (!whileNavigating)
    await expect(target.page().locator('.question-card')).not.toHaveClass(/question-card--moving/);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('手势目标不可见');
  const page = target.page();
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const point = (offsetX: number, offsetY: number, id = 1) => ({
    x: x + offsetX,
    y: y + offsetY,
    id,
  });
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(0, 0)],
    });
    if (multi)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point(0, 0), point(10, 0, 2)],
      });
    for (let step = 1; step <= 8; step++) {
      const touchPoints = [point((dx * step) / 8, (dy * step) / 8)];
      if (multi) touchPoints.push(point((dx * step) / 8 + 10, (dy * step) / 8, 2));
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints });
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
    }
    await session.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

test('题目标记独立于答案，题号同步标记并可取消', async ({ page }) => {
  await startExam(page);
  const mark = page.getByRole('button', { name: '标记', exact: true });
  await expect(mark).toHaveAttribute('aria-pressed', 'false');
  await mark.click();
  await expect(page.getByRole('button', { name: '取消标记', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  let nav = await openQuestionNav(page);
  const first = nav.getByRole('button', { name: '第 1 题，未作答，已标记', exact: true });
  await expect(first).toHaveClass(/marked/);
  await expect(first).not.toHaveClass(/answered/);
  await expect(first.locator('.question-nav-mark')).toBeVisible();
  await nav.getByRole('button', { name: '第 2 题，未作答', exact: true }).click();
  await expect(page.getByRole('button', { name: '标记', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: '上一题', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消标记', exact: true })).toBeVisible();
  await page.getByLabel('A. SQLite', { exact: true }).check();
  nav = await openQuestionNav(page);
  await expect(
    nav.getByRole('button', { name: '第 1 题，已作答，已标记', exact: true }),
  ).toHaveClass(/answered/);
  await closeQuestionNav(page);
  await page.getByRole('button', { name: '取消标记', exact: true }).click();
  nav = await openQuestionNav(page);
  await expect(nav.getByRole('button', { name: '第 1 题，已作答', exact: true })).not.toHaveClass(
    /marked/,
  );
});

test('移动端圆形题号入口打开底部抽屉，选择后关闭并恢复焦点', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  await startExam(page);
  const trigger = page.getByRole('button', { name: '打开答题卡', exact: true });
  await expect(page.getByRole('navigation', { name: '题号导航' })).toHaveCount(0);
  await expect(trigger).toHaveCSS('border-radius', '50%');
  const bounds = await trigger.boundingBox();
  expect(bounds!.x).toBeGreaterThan(page.viewportSize()!.width / 2);
  expect(bounds!.y).toBeGreaterThan(page.viewportSize()!.height / 2);
  let nav = await openQuestionNav(page);
  const sheet = page.getByRole('dialog', { name: '选择题号' });
  await expect
    .poll(async () => {
      const bounds = await sheet.boundingBox();
      return bounds ? Math.abs(bounds.y + bounds.height - page.viewportSize()!.height) : Infinity;
    })
    .toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath('mobile-question-sheet.png') });
  await expect(nav.getByRole('button')).toHaveCount(3);
  await nav.getByRole('button', { name: '第 3 题，未作答', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '第三题：简述事务性质' })).toBeVisible();
  await expect(trigger).toHaveText('答题卡');
  await expect(trigger).toHaveAccessibleName('打开答题卡');
  await expect(trigger).toBeFocused();
  nav = await openQuestionNav(page);
  await expect(nav.getByRole('button').last()).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await openQuestionNav(page);
  await page.locator('.dialog-overlay').tap({ position: { x: 8, y: 80 } });
  await expect(sheet).not.toBeVisible();
  await openQuestionNav(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(sheet).not.toBeVisible();
  await expect(trigger).not.toBeVisible();
  await expect(page.getByRole('navigation', { name: '题号导航' })).toBeVisible();
});

test('移动端输入框和题干均可原生滑动切题，保存答案且忽略滚动与取消手势', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  await startExam(page);
  const stem = page.locator('.question-stem');
  await swipe(stem, 110);
  await expect(stem).toHaveText('第一题：请选择数据库');
  await swipe(stem, -25);
  await swipe(stem, -120, 90);
  await swipe(stem, -120, 0, true);
  await swipe(stem, -120, 0, false, true);
  await expect(stem).toHaveText('第一题：请选择数据库');
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  await page.getByLabel('A. SQLite', { exact: true }).check();
  await swipe(stem, -110);
  await expect(stem).toHaveText('第二题：填写数据库名称');
  const input = page.getByLabel('第 1 空');
  await input.fill('SQLite');
  await swipe(input, -120);
  await expect(stem).toHaveText('第三题：简述事务性质');
  await swipe(stem, 120);
  await expect(stem).toHaveText('第二题：填写数据库名称');
  await expect(input).toHaveValue('SQLite');
  // 暂停当前题的保存，验证连续手势不会越过下一题或发出重复保存。
  let releaseSave!: () => void;
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saveStarted!: () => void;
  const heldSave = new Promise<void>((resolve) => {
    saveStarted = resolve;
  });
  await page.route('**/answers/*', async (route) => {
    saveStarted();
    await saving;
    await route.continue();
  });
  await input.fill('SQLite');
  await swipe(stem, -110);
  await heldSave;
  await expect(page.locator('.question-nav-fab')).toBeDisabled();
  await swipe(stem, -110, 0, false, false, true);
  releaseSave();
  await expect(stem).toHaveText('第三题：简述事务性质');
  await expect(page.locator('.question-nav-fab')).toBeEnabled();
  await page.getByLabel('你的答案', { exact: true }).fill('原子性');
  await swipe(page.getByLabel('你的答案', { exact: true }), 110);
  await expect(stem).toHaveText('第二题：填写数据库名称');
  await expect(input).toHaveValue('SQLite');
  await swipe(stem, -110);
  await expect(stem).toHaveText('第三题：简述事务性质');
  await expect(page.getByLabel('你的答案', { exact: true })).toHaveValue('原子性');
  await swipe(stem, -110);
  await expect(stem).toHaveText('第三题：简述事务性质');
  await swipe(stem, 110);
  await expect(input).toHaveValue('SQLite');
  await swipe(stem, 110);
  await expect(page.getByLabel('A. SQLite', { exact: true })).toBeChecked();
  const attemptId = new URL(page.url()).pathname.split('/').at(-1)!;
  const result = (await (await page.request.get(`/api/v1/attempts/${attemptId}`)).json())
    .data as AttemptView;
  expect(result.items.map((item) => item.answer)).toEqual([
    { optionId: 'a' },
    { slots: { database: 'SQLite' } },
    { text: '原子性' },
  ]);
});

test('移动端较多题号可在底部抽屉内滚动并跳转末题', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  await startExam(page, 57);
  const nav = await openQuestionNav(page);
  const viewport = page.locator('.question-nav-sheet .dialog-body__viewport');
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await nav.getByRole('button', { name: '第 60 题，未作答', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '选择题号' })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '附加题 57', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开答题卡', exact: true })).toHaveText('答题卡');
});

test('移动端答题卡可触摸拖动且不会误打开，松手后仍可点击并约束在视口内', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  await startExam(page);
  const trigger = page.getByRole('button', { name: '打开答题卡', exact: true });
  await expect(trigger).toHaveText('答题卡');
  await expect(trigger).not.toContainText(/\d/);
  await trigger.tap();
  await expect(page.getByRole('dialog', { name: '选择题号' })).toBeVisible();
  await closeQuestionNav(page);
  const before = (await trigger.boundingBox())!;
  await swipe(trigger, -150, -210);
  const after = (await trigger.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x - 150, 0);
  expect(after.y).toBeCloseTo(before.y - 210, 0);
  await expect(page.getByRole('dialog', { name: '选择题号' })).not.toBeVisible();
  await trigger.click();
  await expect(page.getByRole('dialog', { name: '选择题号' })).toBeVisible();
  await closeQuestionNav(page);
  await expect(trigger).toBeFocused();
  expect((await trigger.boundingBox())!.x).toBeCloseTo(after.x, 0);
  // 鼠标拖动同样有效；越界拖动必须限制在屏幕内，不能将入口拖丢。
  await page.mouse.move(after.x + after.width / 2, after.y + after.height / 2);
  await page.mouse.down();
  await page.mouse.move(-150, -150, { steps: 12 });
  await page.mouse.up();
  const corner = (await trigger.boundingBox())!;
  expect(corner.x).toBeGreaterThanOrEqual(12);
  expect(corner.y).toBeGreaterThanOrEqual(12);
  await expect(page.getByRole('dialog', { name: '选择题号' })).not.toBeVisible();
  await page.setViewportSize({ width: 320, height: 480 });
  await expect
    .poll(async () => {
      const box = (await trigger.boundingBox())!;
      return box.x >= 12 && box.y >= 12 && box.x + box.width <= 308 && box.y + box.height <= 468;
    })
    .toBe(true);
  await trigger.click();
  await expect(page.getByRole('dialog', { name: '选择题号' })).toBeVisible();
});

test('移动端选项区域原生滑动和鼠标拖动均可切题，不误选答案，普通点击不受影响', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  await startExam(page);
  const stem = page.locator('.question-stem');
  await swipe(page.locator('.answer-option').first(), -120);
  await expect(stem).toHaveText('第二题：填写数据库名称');
  await swipe(stem, 120);
  await expect(stem).toHaveText('第一题：请选择数据库');
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  await page.getByLabel('A. SQLite', { exact: true }).click();
  await expect(page.getByLabel('A. SQLite', { exact: true })).toBeChecked();
  const box = (await page.locator('.answer-option').last().boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(stem).toHaveText('第二题：填写数据库名称');
  await swipe(stem, 120);
  await expect(page.getByLabel('A. SQLite', { exact: true })).toBeChecked();
  await expect(page.getByLabel('B. 文本', { exact: true })).not.toBeChecked();
  // 作答卡片外的空白区域也支持切题，不再只有题干的一小块区域可用。
  await expect(page.locator('.question-card')).not.toHaveClass(/question-card--moving/);
  const content = page.locator('.attempt-content');
  const contentBox = (await content.boundingBox())!;
  const cardBox = (await page.locator('.question-card').boundingBox())!;
  const y = Math.min(cardBox.y + cardBox.height + 30, page.viewportSize()!.height - 30);
  expect(y).toBeLessThan(contentBox.y + contentBox.height);
  await page.mouse.move(280, y);
  await page.mouse.down();
  await page.mouse.move(120, y, { steps: 10 });
  await page.mouse.up();
  await expect(stem).toHaveText('第二题：填写数据库名称');
});

async function recordQuestionAnimations(page: Page) {
  await page.evaluate(() => {
    const records: { from: number; to: number; duration: number; finished: boolean }[] = [];
    Reflect.set(window, '__questionAnimations', records);
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      if (this.matches('.question-track')) {
        const frames = (animation.effect as KeyframeEffect).getKeyframes();
        const record = {
          from: new DOMMatrixReadOnly(String(frames[0]?.transform ?? 'none')).m41,
          to: new DOMMatrixReadOnly(String(frames.at(-1)?.transform ?? 'none')).m41,
          duration: Number(animation.effect!.getTiming().duration),
          finished: false,
        };
        records.push(record);
        void animation.finished.then(
          () => {
            record.finished = true;
          },
          () => {},
        );
      }
      return animation;
    };
  });
}

async function cardOffset(page: Page) {
  return page
    .locator('.question-track')
    .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41);
}

async function questionAnimations(page: Page) {
  return page.evaluate(
    () =>
      Reflect.get(window, '__questionAnimations') as {
        from: number;
        to: number;
        duration: number;
        finished: boolean;
      }[],
  );
}

test('移动端半拖可见真实相邻题内容，整条轨道跟手滑动并回弹或连续切题', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  await startExam(page);
  await recordQuestionAnimations(page);
  const card = page.locator('.question-card');
  const stem = page.locator('.question-stem');
  const drag = async (distance: number) => {
    const box = (await stem.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + distance, y, { steps: 8 });
  };
  // 首题向右拖动有边界阻力，松手后回弹，不切题。
  await drag(90);
  expect(await cardOffset(page)).toBeGreaterThan(10);
  expect(await cardOffset(page)).toBeLessThan(40);
  await page.mouse.up();
  await expect(card).not.toHaveClass(/question-card--moving/);
  expect(await cardOffset(page)).toBe(0);
  await expect(stem).toHaveText('第一题：请选择数据库');
  // 未达切换阈值时仍然跟手，且用真实动画回到中心。
  await drag(-35);
  expect(await cardOffset(page)).toBeCloseTo(-35, 0);
  await page.mouse.up();
  await expect(card).not.toHaveClass(/question-card--moving/);
  expect(await cardOffset(page)).toBe(0);
  const bounces = await questionAnimations(page);
  expect(bounces).toHaveLength(2);
  expect(bounces.every((motion) => motion.duration > 0 && motion.finished)).toBe(true);
  expect(bounces.every((motion) => motion.to === 0)).toBe(true);
  await page.getByLabel('A. SQLite', { exact: true }).click();
  // 拖动到一半时，下一题的题干和输入框已进入屏幕，而非空白或截图占位。
  const cardWidth = (await card.boundingBox())!.width;
  await drag(-cardWidth / 2);
  expect(await cardOffset(page)).toBeCloseTo(-cardWidth / 2, 0);
  const nextPreview = page
    .locator('.question-preview')
    .filter({ hasText: '第二题：填写数据库名称' });
  await expect(nextPreview.locator('.question-preview-stem')).toHaveText('第二题：填写数据库名称');
  await expect(nextPreview.locator('input')).toHaveValue('');
  await expect(nextPreview).toHaveAttribute('inert', '');
  await expect(nextPreview).toHaveAttribute('aria-hidden', 'true');
  const currentBounds = (await card.boundingBox())!;
  const previewBounds = (await nextPreview.boundingBox())!;
  expect(previewBounds.x).toBeGreaterThan(0);
  expect(previewBounds.x).toBeLessThan(page.viewportSize()!.width - 50);
  expect(previewBounds.x - (currentBounds.x + currentBounds.width)).toBeCloseTo(16, 0);
  await page.screenshot({ path: testInfo.outputPath('question-carousel-half-drag.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.mouse.up();
  await expect(stem).toHaveText('第二题：填写数据库名称');
  await expect(card).not.toHaveClass(/question-card--moving/);
  expect(await cardOffset(page)).toBe(0);
  const forward = (await questionAnimations(page)).slice(2);
  expect(forward).toHaveLength(1);
  expect(forward[0]!.to).toBeLessThan(-200);
  await expect(page.locator('.question-preview')).toHaveCount(0);
  expect(forward.every((motion) => motion.finished)).toBe(true);
  // 右拖时能看到上一题的完整选项和已选答案，预览不会改写任何答案。
  await page.getByLabel('第 1 空').fill('SQLite');
  await drag(cardWidth / 2);
  expect(await cardOffset(page)).toBeCloseTo(cardWidth / 2, 0);
  const previousPreview = page
    .locator('.question-preview')
    .filter({ hasText: '第一题：请选择数据库' });
  await expect(previousPreview.locator('.answer-option__text')).toHaveText([
    'A. SQLite',
    'B. 文本',
  ]);
  await expect(previousPreview.locator('.answer-option.selected .answer-option__text')).toHaveText(
    'A. SQLite',
  );
  const previousBounds = (await previousPreview.boundingBox())!;
  expect(previousBounds.x + previousBounds.width).toBeGreaterThan(50);
  await page.mouse.up();
  await expect(stem).toHaveText('第一题：请选择数据库');
  await expect(card).not.toHaveClass(/question-card--moving/);
  const backward = (await questionAnimations(page)).slice(3);
  expect(backward).toHaveLength(1);
  expect(backward[0]!.to).toBeGreaterThan(200);
  await expect(page.locator('.question-preview')).toHaveCount(0);
  expect(backward.every((motion) => motion.finished)).toBe(true);
  await page.getByLabel('A. SQLite', { exact: true }).click();
  await expect(page.getByLabel('A. SQLite', { exact: true })).toBeChecked();
});

test('移动端减少动态效果设置下可切题且不播放切题动画', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startExam(page);
  await recordQuestionAnimations(page);
  await swipe(page.locator('.question-stem'), -110);
  await expect(page.locator('.question-stem')).toHaveText('第二题：填写数据库名称');
  await expect(page.locator('.question-card')).not.toHaveClass(/question-card--moving/);
  // 路由切换与轨道复位不是同一个浏览器任务，等待最终偏移，不读取中间帧。
  await expect.poll(() => cardOffset(page)).toBe(0);
  expect(await questionAnimations(page)).toHaveLength(0);
});

test('移动端输入框拖动未过阈值可继续输入，选区与中文组字保持原生行为', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  await startExam(page);
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  const input = page.getByLabel('第 1 空');
  await input.fill('SQLite');
  const box = (await input.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7 - 35, box.y + box.height / 2, { steps: 6 });
  expect(await cardOffset(page)).toBeCloseTo(-35, 0);
  await page.mouse.up();
  await expect(page.locator('.question-card')).not.toHaveClass(/question-card--moving/);
  await expect(page.locator('.question-stem')).toHaveText('第二题：填写数据库名称');
  await expect(input).toBeFocused();
  await input.press('End');
  await input.press('!');
  await expect(input).toHaveValue('SQLite!');
  await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(0, 3));
  await swipe(input, -120);
  await expect(page.locator('.question-stem')).toHaveText('第二题：填写数据库名称');
  await expect(input).toHaveValue('SQLite!');
  await input.evaluate((element: HTMLInputElement) =>
    element.setSelectionRange(element.value.length, element.value.length),
  );
  await input.dispatchEvent('compositionstart');
  await swipe(input, -120);
  await expect(page.locator('.question-stem')).toHaveText('第二题：填写数据库名称');
  await input.dispatchEvent('compositionend');
  await swipe(input, -120);
  await expect(page.locator('.question-stem')).toHaveText('第三题：简述事务性质');
  await swipe(page.locator('.question-stem'), 120);
  await expect(input).toHaveValue('SQLite!');
});

test('移动端简答框可纵向滚动，横向拖动能切题且保留已输入内容', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '仅移动视口');
  await startExam(page);
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  const textarea = page.getByLabel('你的答案', { exact: true });
  const answer = Array.from({ length: 35 }, (_, index) => `第 ${index + 1} 行说明事务性质`).join(
    '\n',
  );
  await textarea.fill(answer);
  await textarea.evaluate((element) => {
    element.scrollTop = 0;
  });
  await swipe(textarea, 0, -100);
  await expect(page.locator('.question-stem')).toHaveText('第三题：简述事务性质');
  expect(await textarea.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await textarea.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(element.value.length, element.value.length),
  );
  await swipe(textarea, 120);
  await expect(page.locator('.question-stem')).toHaveText('第二题：填写数据库名称');
  await swipe(page.locator('.question-stem'), -120);
  await expect(textarea).toHaveValue(answer);
});
