import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('对话行悬停归档、归档管理恢复和空会话状态', async ({ page, isMobile }) => {
  await login(page);
  const stamp = '2026-10-29T00:00:00.000Z';
  const threads = ['当前对话', '其他对话'].map((title, index) => ({
    id: `archive-${index}`,
    ownerId: 'me',
    title,
    revision: 1,
    lastMessageAt: stamp,
    createdAt: stamp,
    updatedAt: stamp,
    archivedAt: null as string | null,
  }));
  const writes: string[] = [];
  await page.route('**/api/v1/me/assistant/threads**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      const thread = threads.find((item) => url.pathname.includes(`/${item.id}/`))!;
      expect(request.postDataJSON()).toEqual({ expectedRevision: thread.revision });
      thread.archivedAt = url.pathname.endsWith('/archive') ? stamp : null;
      thread.revision += 1;
      writes.push(url.pathname);
      await route.fulfill({ json: { data: thread } });
      return;
    }
    const thread = threads.find((item) => url.pathname.endsWith(`/${item.id}`));
    await route.fulfill({
      json: {
        data: thread
          ? {
              thread,
              turns: [],
              messages: [],
              events: [],
              activeTurn: null,
              queued: [],
              timeline: [],
              hasOlder: false,
              oldestMessageId: null,
            }
          : threads.filter((item) =>
              url.searchParams.get('archiveState') === 'archived'
                ? item.archivedAt !== null
                : item.archivedAt === null,
            ),
      },
    });
  });
  if (isMobile) await page.goto('/assistant');
  else await page.getByTestId('assistant-toggle').click();
  const title = page.getByTestId('assistant-panel').locator('.assistant-panel__title');
  await expect(title).toHaveText('当前对话');
  await page.getByTestId('assistant-threads').click();
  await expect(page.getByRole('menuitem', { name: '删除对话' })).toHaveCount(0);
  const other = page.getByTestId('assistant-thread-archive-1');
  const archiveOther = other.getByRole('menuitem', { name: '归档对话', exact: true });
  if (!isMobile) {
    await page.mouse.move(0, 0);
    await expect(archiveOther).toHaveCSS('opacity', '0');
    await other.hover();
  }
  await expect(archiveOther).toHaveCSS('opacity', '1');
  await archiveOther.click();
  await expect(title).toHaveText('当前对话');
  await page.getByTestId('assistant-threads').click();
  await expect(other).toHaveCount(0);
  const current = page.getByTestId('assistant-thread-archive-0');
  if (!isMobile) await current.hover();
  await current.getByRole('menuitem', { name: '归档对话', exact: true }).click();
  await expect(title).toHaveText('学习助手');
  await page.getByTestId('assistant-threads').click();
  await page.getByTestId('assistant-archived-threads').click();
  await expect(page).toHaveURL(/\/assistant\/archive$/);
  const archivedOther = page.getByTestId('archived-thread-archive-1');
  await expect(archivedOther).toContainText('其他对话');
  await expect(page.getByTestId('archived-thread-archive-0')).toContainText('当前对话');
  await archivedOther.getByRole('button', { name: '恢复对话' }).click();
  await expect(archivedOther).toHaveCount(0);
  await page.getByRole('link', { name: '返回学习助手' }).click();
  await page.getByTestId('assistant-threads').click();
  await expect(page.getByRole('menuitem', { name: '其他对话', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '当前对话', exact: true })).toHaveCount(0);
  const restoredArchive = page.getByRole('menuitem', { name: '归档对话', exact: true });
  await restoredArchive.focus();
  await expect(restoredArchive).toHaveCSS('opacity', '1');
  await restoredArchive.press('Enter');
  await expect.poll(() => writes.length).toBe(4);
  expect(writes).toEqual([
    '/api/v1/me/assistant/threads/archive-1/archive',
    '/api/v1/me/assistant/threads/archive-0/archive',
    '/api/v1/me/assistant/threads/archive-1/restore',
    '/api/v1/me/assistant/threads/archive-1/archive',
  ]);
  await page.getByTestId('assistant-threads').click();
  await page.getByTestId('assistant-archived-threads').click();
  for (const id of ['archive-0', 'archive-1']) {
    await page
      .getByTestId(`archived-thread-${id}`)
      .getByRole('button', { name: '恢复对话' })
      .click();
  }
  await expect(page.getByText('暂无归档对话', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
