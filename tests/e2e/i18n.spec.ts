import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('中英切换默认中文，两个入口按视口展示，并持久保存语言选择', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'chromium-mobile';
  const translationWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) translationWarnings.push(message.text());
  });
  await login(page);
  const csrfResponse = await page.request.get('/api/v1/auth/csrf');
  const {
    data: { csrfToken },
  } = await csrfResponse.json();
  const tokenResponse = await page.request.post('/api/v1/me/agent-tokens', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { name: `i18n-${randomUUID()}`, scopes: ['read', 'content:write'] },
  });
  await expect(tokenResponse).toBeOK();
  const {
    data: { token },
  } = await tokenResponse.json();
  const topicTitle = `保留学习内容原文-${randomUUID().slice(0, 8)}`;
  const topicResponse = await page.request.post('/api/v1/agent/topics', {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: topicTitle },
  });
  await expect(topicResponse).toBeOK();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  const desktopToggle = page.getByTestId('desktop-language-toggle');
  if (mobile) {
    await expect(desktopToggle).toBeHidden();
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '我的', exact: true })).toBeVisible();
    await page.getByTestId('settings-language-toggle').click();
  } else {
    await expect(desktopToggle).toBeVisible();
    await expect(desktopToggle).toHaveText('中');
    const avatar = page.locator('.topbar .avatar');
    const toggleBox = await desktopToggle.boundingBox();
    const avatarBox = await avatar.boundingBox();
    expect(toggleBox && avatarBox && toggleBox.x + toggleBox.width <= avatarBox.x).toBeTruthy();
    await desktopToggle.click();
  }
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  if (!mobile) await expect(desktopToggle).toHaveText('EN');
  await expect(
    page.getByRole('navigation', {
      name: mobile ? 'Mobile main navigation' : 'Main navigation',
      exact: true,
    }),
  ).toBeVisible();
  if (mobile) {
    await expect(page.getByRole('heading', { name: 'Me', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Change password', exact: true })).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => localStorage.getItem('drill-hub.locale'))).toBe('en');
  await page.screenshot({ path: testInfo.outputPath('language-switch-en.png'), fullPage: true });
  await page.goto('/topics');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('学习主题');
  const englishHeading = await page.getByRole('heading', { level: 1 }).innerText();
  expect(englishHeading).not.toMatch(/\p{Script=Han}/u);
  await expect(page.getByText(topicTitle, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  if (!mobile) await expect(desktopToggle).toHaveText('EN');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(englishHeading);
  if (mobile) {
    await page.goto('/settings');
    await page.getByTestId('settings-language-toggle').click();
  } else {
    await desktopToggle.click();
  }
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  if (!mobile) await expect(desktopToggle).toHaveText('中');
  await page.goto('/topics');
  await expect(
    page.getByRole('heading', { name: '学习主题', exact: true, level: 1 }),
  ).toBeVisible();
  expect(translationWarnings).toEqual([]);
});
