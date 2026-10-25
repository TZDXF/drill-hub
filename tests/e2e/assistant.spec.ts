import { expect, test, type Page } from '@playwright/test';
import { testCredentials } from '#e2e/helpers';

async function login(page: Page) {
  const credentials = testCredentials();
  await page.goto('/login');
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: /继续向前$/ })).toBeVisible();
}

test.describe('内置学习助手', () => {
  test('删除对话需确认，支持取消、失败重试并阻止重复提交', async ({ page, isMobile }) => {
    await login(page);
    const threads = ['待删除的对话', '保留的对话'].map((title, index) => ({
      id: `thread-delete-${index}`,
      ownerId: 'me',
      title,
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: 1,
    }));
    const target = threads[0]!;
    let deleteRequests = 0;
    let deleted = false;
    let finishDelete!: () => void;
    const deletionReady = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    await page.route('**/api/v1/me/assistant/threads**', async (route) => {
      const request = route.request();
      if (request.method() === 'DELETE') {
        expect(new URL(request.url()).pathname).toBe(`/api/v1/me/assistant/threads/${target.id}`);
        deleteRequests += 1;
        if (deleteRequests === 1) {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'delete failed' } }),
          });
          return;
        }
        await deletionReady;
        deleted = true;
        await route.fulfill({ status: 200, json: { data: null } });
        return;
      }
      const path = new URL(request.url()).pathname;
      const thread = threads.find((item) => path.endsWith(`/${item.id}`));
      await route.fulfill({
        json: {
          data: thread
            ? { thread, turns: [], messages: [], events: [], activeTurn: null }
            : threads.filter((item) => !deleted || item.id !== target.id),
        },
      });
    });

    if (isMobile) await page.goto('/assistant');
    else await page.getByTestId('assistant-toggle').click();
    const panel = page.getByTestId('assistant-panel');
    await expect(panel.locator('.assistant-panel__title')).toHaveText(target.title);
    const dialog = page.getByRole('dialog', { name: '删除这个对话？' });
    const openConfirmation = async () => {
      await page.getByTestId('assistant-threads').click();
      await page.getByRole('menuitem', { name: '删除对话' }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`确定删除“${target.title}”吗？`);
      await expect(dialog).toContainText('无法恢复');
    };

    await openConfirmation();
    expect(deleteRequests).toBe(0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(panel.locator('.assistant-panel__title')).toHaveText(target.title);
    await openConfirmation();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(deleteRequests).toBe(0);

    await openConfirmation();
    await dialog.getByRole('button', { name: '删除对话', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('服务暂时不可用');
    await expect(panel.locator('.assistant-panel__title')).toHaveText(target.title);
    expect(deleteRequests).toBe(1);

    try {
      await dialog.getByRole('button', { name: '删除对话', exact: true }).click();
      await expect(dialog.getByRole('button', { name: '删除对话', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await expect.poll(() => deleteRequests).toBe(2);
    } finally {
      finishDelete();
    }
    await expect(dialog).toBeHidden();
    await expect(panel.locator('.assistant-panel__title')).toHaveText('学习助手');
    await page.getByTestId('assistant-threads').click();
    await expect(page.getByRole('menuitem', { name: target.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: '保留的对话', exact: true })).toBeVisible();
    expect(deleteRequests).toBe(2);
  });

  test('真实服务端：打开面板、发送消息并可见未配置模型失败', async ({ page, isMobile }) => {
    await login(page);
    // 手机视口的顶栏隐藏，助手入口是 /assistant 页面（首页快捷链接同址）。
    if (isMobile) await page.goto('/assistant');
    else await page.getByTestId('assistant-toggle').click();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();

    await page.getByTestId('assistant-input').fill('帮我看看有哪些主题');
    await page.getByTestId('assistant-send').click();
    // 两个视口项目共用同一隔离服务，线程可能已含此前运行的消息；断言最后一条。
    await expect(page.getByTestId('assistant-user-message').last()).toContainText(
      '帮我看看有哪些主题',
    );

    // E2E 环境未配置默认助手模型，一轮对话必须以可见错误结束，而不是无限等待。
    await expect(page.locator('.assistant-panel__error')).toContainText('管理员', {
      timeout: 20000,
    });

    await page.getByTestId('assistant-close').click();
    await expect(page.getByTestId('assistant-panel')).toBeHidden();
  });

  test('仅 SSE：断线重连后刷新最终回复、耗时与折叠摘要', async ({ page }, testInfo) => {
    await login(page);
    const threadId = 'thread-e2e';
    const turnId = 'turn-e2e';
    const streamCursors: string[] = [];
    let eventRequests = 0;
    let completed = false;
    let completedDetailLoads = 0;
    const createdAt = '2026-10-25T10:00:00.000Z';
    const updatedAt = '2026-10-25T10:00:12.500Z';
    const turn = {
      id: turnId,
      threadId,
      userMessageId: 'u1',
      assistantMessageId: 'a1',
      status: 'running',
      errorCode: null,
      providerModelId: null,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
    };
    const events = [
      {
        id: 'e1',
        threadId,
        turnId,
        seq: 1,
        type: 'tool_call',
        payload: { toolCallId: 't1', name: 'navigate', args: {} },
        createdAt,
      },
      {
        id: 'e2',
        threadId,
        turnId,
        seq: 2,
        type: 'ui_action',
        payload: { action: { type: 'navigate', route: 'topics' } },
        createdAt,
      },
      {
        id: 'e3',
        threadId,
        turnId,
        seq: 3,
        type: 'tool_result',
        payload: { toolCallId: 't1', name: 'navigate', isError: false },
        createdAt,
      },
      {
        id: 'e4',
        threadId,
        turnId,
        seq: 4,
        type: 'ui_action',
        payload: { action: { type: 'set_layout', mode: 'split' } },
        createdAt,
      },
      {
        id: 'e5',
        threadId,
        turnId,
        seq: 5,
        type: 'status',
        payload: { phase: 'turn_completed' },
        createdAt: updatedAt,
      },
    ];
    await page.route('**/api/v1/me/assistant/threads', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: threadId,
                ownerId: 'me',
                title: 'E2E 对话',
                lastMessageAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                revision: 1,
              },
            ],
          }),
        });
        return;
      }
      await route.continue();
    });
    await page.route('**/api/v1/me/assistant/status', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { modelConfigured: true, searchEnabled: false, mcpEnabled: false, customSkills: 0 },
        }),
      });
    });
    await page.route(`**/api/v1/me/assistant/threads/${threadId}`, async (route) => {
      if (route.request().method() === 'GET') {
        if (completed) completedDetailLoads += 1;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              thread: {
                id: threadId,
                ownerId: 'me',
                title: 'E2E 对话',
                lastMessageAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                revision: 1,
              },
              turns: completed ? [{ ...turn, status: 'succeeded', updatedAt }] : [],
              messages: completed
                ? [
                    {
                      id: 'u1',
                      threadId,
                      role: 'user',
                      content: '打开主题列表',
                      status: 'complete',
                      errorCode: null,
                      createdAt,
                      updatedAt: createdAt,
                      revision: 1,
                    },
                    {
                      id: 'a1',
                      threadId,
                      role: 'assistant',
                      content: '已为你打开主题列表。',
                      status: 'complete',
                      errorCode: null,
                      createdAt,
                      updatedAt,
                      revision: 1,
                    },
                  ]
                : [],
              events: completed ? events : [],
              activeTurn: null,
            },
          }),
        });
        return;
      }
      await route.continue();
    });
    await page.route(`**/api/v1/me/assistant/threads/${threadId}/messages`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        status: 202,
        body: JSON.stringify({
          data: {
            turn,
            userMessage: null,
          },
        }),
      });
    });
    // 首次 SSE 提前结束，第二次连接失败，第三次通过 SSE 补齐完成事件。
    await page.route(`**/api/v1/me/assistant/threads/${threadId}/stream**`, async (route) => {
      streamCursors.push(new URL(route.request().url()).searchParams.get('after') ?? '');
      if (streamCursors.length === 2) {
        await route.fulfill({ status: 503, body: 'unavailable' });
        return;
      }
      completed = streamCursors.length >= 3;
      const frames = completed ? events.slice(3) : events.slice(0, 3);
      await route.fulfill({
        contentType: 'text/event-stream',
        body:
          frames
            .map(
              (event) =>
                `event: ${event.type}\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`,
            )
            .join('') + (completed ? '' : 'event: text_delta\ndata: {"delta":"正在打开"}\n\n'),
      });
    });
    await page.route(`**/api/v1/me/assistant/threads/${threadId}/events**`, async (route) => {
      eventRequests += 1;
      await route.abort();
    });

    if (testInfo.project.name === 'chromium-mobile') await page.goto('/assistant');
    else await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-input').fill('打开主题列表');
    await page.getByTestId('assistant-send').click();

    // ui_action navigate 应驱动真实路由跳转到主题列表页。
    await expect(page).toHaveURL(/\/topics$/, { timeout: 15000 });
    await expect.poll(() => completedDetailLoads, { timeout: 15000 }).toBe(1);
    // set_layout 动作重新打开手机面板；两个视口都直接检查完成事件触发的刷新。
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    if (testInfo.project.name !== 'chromium-mobile') {
      await expect(page.locator('.app-layout--assistant')).toBeVisible();
    }
    await expect(page.getByTestId('assistant-reply')).toContainText('已为你打开主题列表。');
    await expect(page.locator('.assistant-process__trigger')).toContainText('12.5');
    await expect(page.locator('.assistant-process__list')).toBeHidden();
    await page.locator('.assistant-process__trigger').click();
    await expect(page.locator('.assistant-process__list')).toContainText('主题');
    await expect(page.getByTestId('assistant-event-card')).toBeHidden();
    expect(streamCursors).toEqual(['0', '3', '3']);
    expect(eventRequests).toBe(0);
  });

  test('助手页面打开并排布局（桌面）', async ({ page }) => {
    await login(page);
    await page.goto('/assistant');
    await expect(page.getByTestId('assistant-page')).toBeVisible();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await expect(page.locator('.app-layout--assistant')).toBeVisible();
  });
});
