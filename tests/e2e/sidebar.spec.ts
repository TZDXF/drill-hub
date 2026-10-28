import { expect, test, type Page } from '@playwright/test';
import { login } from '#e2e/helpers';

function sidebarWidth(page: Page) {
  return page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width);
}

async function dragSidebar(page: Page, delta: number) {
  const handle = await page.getByRole('separator', { name: '调整侧边栏宽度' }).boundingBox();
  if (!handle) throw new Error('侧边栏拖拽手柄不可见');
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.app-layout')).not.toHaveClass(/app-layout--sidebar-resizing/);
}

test('桌面侧边栏支持拖拽、宽度边界与键盘调整', async ({ page, isMobile }) => {
  test.skip(isMobile, '仅桌面显示侧边栏');
  await login(page);
  const handle = page.getByRole('separator', { name: '调整侧边栏宽度' });
  await expect.poll(() => sidebarWidth(page)).toBe(244);

  await dragSidebar(page, 60);
  await expect.poll(() => sidebarWidth(page)).toBe(304);
  await expect(handle).toHaveAttribute('aria-valuenow', '304');
  await expect
    .poll(() => page.locator('.app-main').evaluate((el) => el.getBoundingClientRect().x))
    .toBe(304);

  await dragSidebar(page, 500);
  await expect.poll(() => sidebarWidth(page)).toBe(360);
  await dragSidebar(page, -500);
  await expect.poll(() => sidebarWidth(page)).toBe(200);

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => sidebarWidth(page)).toBe(210);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => sidebarWidth(page)).toBe(200);
  await page.keyboard.press('End');
  await expect.poll(() => sidebarWidth(page)).toBe(360);
  await page.keyboard.press('Home');
  await expect.poll(() => sidebarWidth(page)).toBe(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('收起后保留图标导航与提示，展开恢复调整后的宽度', async ({ page, isMobile }) => {
  test.skip(isMobile, '仅桌面显示侧边栏');
  await login(page);
  await dragSidebar(page, 80);
  const header = page.locator('.sidebar-header');
  const collapse = header.getByRole('button', { name: '收起侧边栏' });
  await expect(collapse).toBeVisible();
  expect(
    await header.evaluate((element) => {
      const brand = element.querySelector('.brand')!.getBoundingClientRect();
      const button = element.querySelector('button')!.getBoundingClientRect();
      return (
        button.x >= brand.right &&
        Math.abs(button.y + button.height / 2 - brand.y - brand.height / 2) < 1
      );
    }),
  ).toBe(true);
  await collapse.click();
  await expect.poll(() => sidebarWidth(page)).toBe(72);
  const expand = header.getByRole('button', { name: '展开侧边栏' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await page.mouse.move(600, 100);
  await expect(expand.locator('.sidebar-toggle__brand')).toHaveCSS('opacity', '1');
  await expect(expand.locator('.sidebar-toggle__action')).toHaveCSS('opacity', '0');
  await expand.hover();
  await expect(expand.locator('.sidebar-toggle__brand')).toHaveCSS('opacity', '0');
  await expect(expand.locator('.sidebar-toggle__action')).toHaveCSS('opacity', '1');
  await page.mouse.move(600, 100);
  await expect(expand.locator('.sidebar-toggle__brand')).toHaveCSS('opacity', '1');
  await expect(page.getByRole('separator', { name: '调整侧边栏宽度' })).toHaveCount(0);
  await expect(page.locator('.brand strong')).toBeHidden();
  const history = page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: '学习历史' });
  await expect(history.locator('span')).toBeHidden();
  await history.hover();
  await expect(page.getByRole('tooltip')).toContainText('学习历史');
  await history.click();
  await expect(page).toHaveURL('/history');
  await expect.poll(() => sidebarWidth(page)).toBe(72);
  await expand.click();
  await expect.poll(() => sidebarWidth(page)).toBe(324);
  await expect(page.getByRole('button', { name: '收起侧边栏' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(history.locator('span')).toBeVisible();
});

test('顶部侧栏开关可通过键盘收起和展开，聚焦时显示展开图标', async ({ page, isMobile }) => {
  test.skip(isMobile, '仅桌面显示侧边栏');
  await login(page);
  await page.locator('.brand').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '收起侧边栏' })).toBeFocused();
  await page.keyboard.press('Enter');
  const expand = page.getByRole('button', { name: '展开侧边栏' });
  await expect(expand).toBeFocused();
  await expect(expand.locator('.sidebar-toggle__action')).toHaveCSS('opacity', '1');
  await expect(expand.locator('.sidebar-toggle__brand')).toHaveCSS('opacity', '0');
  await page.keyboard.press('Enter');
  await expect.poll(() => sidebarWidth(page)).toBe(244);
});

test('助手布局中可以收起和展开侧边栏，移动视口保留底部导航', async ({ page, isMobile }) => {
  await login(page);
  if (isMobile) {
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.getByRole('button', { name: '收起侧边栏' })).toBeHidden();
    await expect(page.getByRole('separator', { name: '调整侧边栏宽度' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: '手机主导航' })).toBeVisible();
    return;
  }

  await page.getByTestId('assistant-toggle').click();
  await expect(page.getByTestId('assistant-pane')).toBeVisible();
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect.poll(() => sidebarWidth(page)).toBe(72);
  await expect
    .poll(() => page.getByTestId('assistant-pane').evaluate((el) => el.getBoundingClientRect().x))
    .toBe(72);
  await page.getByRole('button', { name: '展开侧边栏' }).click();
  await dragSidebar(page, 40);
  await expect
    .poll(() => page.getByTestId('assistant-pane').evaluate((el) => el.getBoundingClientRect().x))
    .toBe(284);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => sidebarWidth(page)).toBe(284);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
