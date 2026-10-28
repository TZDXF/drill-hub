import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('主要页面在桌面与窄屏保持可读布局，深浅主题均无页面横向溢出', async ({
  page,
  isMobile,
}, testInfo) => {
  test.setTimeout(90_000);
  await login(page);
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  const paths = [
    '/',
    '/topics',
    '/history',
    '/wrong-questions',
    '/archive',
    '/search',
    '/settings',
    '/settings/agent-tokens',
    '/token-usage',
    '/admin/users',
    '/admin/settings/models',
    '/admin/settings/assistant',
    '/admin/audit',
    '/admin/grading',
    '/change-password',
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.locator('.loading-block')).toHaveCount(0);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${path} 在 ${theme} 主题不应横向溢出`,
      ).toBe(true);
    }
    if (['/', '/settings', '/admin/audit'].includes(path)) {
      await page.screenshot({
        path: testInfo.outputPath(`layout-${path.replaceAll('/', '-') || 'home'}.png`),
        fullPage: true,
      });
    }
  }
});
