import { expect, test } from '@playwright/test';

test('应用图标由离线 Iconify 数据渲染且不访问外部域名', async ({ page }) => {
  const externalRequests: string[] = [];
  const iconifyRequests: string[] = [];

  page.on('request', (request) => {
    const requestUrl = request.url();
    if (!requestUrl.startsWith('http')) return;
    if (/iconify/i.test(new URL(requestUrl).hostname)) iconifyRequests.push(requestUrl);
  });

  await page.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (!requestUrl.startsWith('http')) {
      await route.continue();
      return;
    }

    const { hostname } = new URL(requestUrl);
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      await route.continue();
      return;
    }

    externalRequests.push(requestUrl);
    await route.abort();
  });

  await page.goto('/login');

  const icon = page.locator('.brand-mark .app-icon').first();
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
  await expect(icon).toHaveAttribute('width', '20');
  await expect(icon).toHaveAttribute('height', '20');
  await expect(
    icon.locator('path, circle, rect, line, polyline, polygon, ellipse'),
  ).not.toHaveCount(0);

  expect(iconifyRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
});
