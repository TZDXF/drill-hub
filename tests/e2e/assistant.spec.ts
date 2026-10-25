import { expect, test, type Page } from '@playwright/test';
import { testCredentials } from './helpers';

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

  test('mock 流：渲染回复、执行页面跳转与布局切换', async ({ page }, testInfo) => {
    await login(page);
    const threadId = 'thread-e2e';
    const turnId = 'turn-e2e';
    let pollCount = 0;
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
              turns: [],
              messages: [],
              events: [],
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
            turn: {
              id: turnId,
              threadId,
              userMessageId: 'u1',
              assistantMessageId: 'a1',
              status: 'running',
              errorCode: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              revision: 1,
            },
            userMessage: null,
          },
        }),
      });
    });
    // SSE 流不可用（非 200）时前端自动降级轮询事件接口。
    await page.route(`**/api/v1/me/assistant/threads/${threadId}/stream**`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        status: 503,
        body: JSON.stringify({ error: { code: 'STREAM_FAILED', message: 'unavailable' } }),
      });
    });
    await page.route(`**/api/v1/me/assistant/threads/${threadId}/events**`, async (route) => {
      pollCount += 1;
      const done = pollCount > 1;
      const events: {
        id: string;
        threadId: string;
        turnId: string;
        seq: number;
        type: string;
        payload: Record<string, unknown>;
        createdAt: string;
      }[] = [
        {
          id: 'e1',
          threadId,
          turnId,
          seq: 1,
          type: 'tool_call',
          payload: { toolCallId: 't1', name: 'navigate', args: {} },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'e2',
          threadId,
          turnId,
          seq: 2,
          type: 'ui_action',
          payload: { action: { type: 'navigate', route: 'topics' } },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'e3',
          threadId,
          turnId,
          seq: 3,
          type: 'tool_result',
          payload: { toolCallId: 't1', name: 'navigate', isError: false, summary: 'ok' },
          createdAt: new Date().toISOString(),
        },
      ];
      if (done) {
        events.push({
          id: 'e4',
          threadId,
          turnId,
          seq: 4,
          type: 'status',
          payload: { phase: 'turn_completed' },
          createdAt: new Date().toISOString(),
        });
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { events, activeTurn: done ? null : { id: turnId, status: 'running' } },
        }),
      });
    });

    if (testInfo.project.name === 'chromium-mobile') await page.goto('/assistant');
    else await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-input').fill('打开主题列表');
    await page.getByTestId('assistant-send').click();

    // ui_action navigate 应驱动真实路由跳转到主题列表页。
    await expect(page).toHaveURL(/\/topics$/, { timeout: 15000 });
    if (testInfo.project.name === 'chromium-mobile') {
      // 手机布局导航后自动收起面板，经 /assistant 重新打开。
      await expect(page.getByTestId('assistant-panel')).toBeHidden();
      await page.goto('/assistant');
      await expect(page.getByTestId('assistant-panel')).toBeVisible();
    } else {
      // 桌面保持并排布局，活动轮显示单行状态（含“正在思考…”或关键操作）。
      await expect(page.getByTestId('assistant-event-card')).toBeVisible();
      await expect(page.getByTestId('assistant-panel')).toBeVisible();
      await expect(page.locator('.app-layout--assistant')).toBeVisible();
    }
  });

  test('助手页面打开并排布局（桌面）', async ({ page }) => {
    await login(page);
    await page.goto('/assistant');
    await expect(page.getByTestId('assistant-page')).toBeVisible();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await expect(page.locator('.app-layout--assistant')).toBeVisible();
  });
});
