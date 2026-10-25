import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

// 无头浏览器默认隐藏滚动条；此处启用真实滚动条，避免宽度回归被掩盖。
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

for (const authenticated of [false, true]) {
  test(`${authenticated ? '学习页面' : '登录页面'}在内容溢出前后铺满视口且保持布局宽度`, async ({
    page,
  }) => {
    if (authenticated) {
      await page.route('**/api/v1/attempts', (route) =>
        route.fulfill({ json: { data: [], meta: {} } }),
      );
      await login(page);
      await page.goto('/history');
      await expect(page.getByText('没有符合条件的学习记录', { exact: true })).toBeVisible();
    } else {
      await page.goto('/login');
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    }

    const isOverflowing = () =>
      page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
    const layout = page.locator(
      authenticated
        ? '.app-layout, .app-main, .topbar, #main-content, .sidebar, .bottom-nav'
        : '.auth-layout, .auth-main, .auth-card',
    );
    const measure = () =>
      layout.evaluateAll((elements) =>
        elements.map((element) => {
          const { x, width } = element.getBoundingClientRect();
          return { x, width };
        }),
      );

    await expect.poll(isOverflowing).toBe(false);
    const fillsViewport = () =>
      page.evaluate(() => {
        const { x, width } = document.body.getBoundingClientRect();
        return x === 0 && width === window.innerWidth;
      });
    await expect.poll(fillsViewport).toBe(true);
    const before = await measure();

    // 只改变文档高度，保留真实页面的横向布局。
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.id = 'scrollbar-layout-spacer';
      spacer.style.height = '200vh';
      document.body.append(spacer);
    });
    await expect.poll(isOverflowing).toBe(true);
    expect(await measure()).toEqual(before);
    await expect.poll(fillsViewport).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // 隐藏的只是页面滚动条，滚轮和键盘仍能滚动原生文档。
    await page.mouse.move(await page.evaluate(() => window.innerWidth / 2), 100);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+End');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) <
            2,
        ),
      )
      .toBe(true);

    await page.locator('#scrollbar-layout-spacer').evaluate((element) => element.remove());
    await expect.poll(isOverflowing).toBe(false);
    expect(await measure()).toEqual(before);
    await expect.poll(fillsViewport).toBe(true);
  });
}
