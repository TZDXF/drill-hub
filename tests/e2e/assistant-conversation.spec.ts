import { expect, test, type Page } from '@playwright/test';
import { login } from '#e2e/helpers';
import type { AssistantQueuedMessage } from '@drill-hub/contracts';

declare global {
  interface Window {
    __assistantScrollCalls: ScrollToOptions[];
  }
}

const threadId = 'conversation-e2e';
function detail(options: { empty?: boolean; before?: string } = {}) {
  const messages = options.empty
    ? []
    : Array.from({ length: 12 }, (_, index) => index).flatMap((index) => {
        const stamp = `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`;
        return [
          {
            id: `u${index}`,
            threadId,
            role: 'user',
            content: `第 ${index + 1} 个学习问题`,
            reasoning: null,
            images: [],
            status: 'complete',
            errorCode: null,
            createdAt: stamp,
            updatedAt: stamp,
            revision: 1,
          },
          {
            id: `a${index}`,
            threadId,
            role: 'assistant',
            content: `这是第 ${index + 1} 个回答。\n\n${'为了帮助测试滚动，这段内容需要足够长。'.repeat(8)}`,
            reasoning: index === 11 ? '先分析问题，再给出步骤。' : null,
            images: [],
            status: 'complete',
            errorCode: null,
            createdAt: stamp,
            updatedAt: stamp,
            revision: 1,
          },
        ];
      });
  const allTurns = messages
    .filter((_, index) => index % 2 === 0)
    .map((user, index) => ({
      id: `turn-${index}`,
      threadId,
      userMessageId: user.id,
      assistantMessageId: `a${index}`,
      status: 'succeeded',
      errorCode: null,
      providerModelId: null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      revision: 1,
    }));
  const beforeIndex = options.before
    ? messages.findIndex((message) => message.id === options.before)
    : -1;
  const end = beforeIndex >= 0 ? beforeIndex : messages.length;
  const pageMessages = messages.slice(Math.max(0, end - 6), end);
  const ids = new Set(pageMessages.map((message) => message.id));
  return {
    thread: {
      id: threadId,
      ownerId: 'me',
      title: '长对话',
      lastMessageAt: '2026-01-01T00:00:11.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:11.000Z',
      revision: 1,
    },
    messages: pageMessages,
    turns: allTurns.filter((turn) => ids.has(turn.userMessageId)),
    events: [],
    activeTurn: null,
    queued: [],
    timeline: allTurns.map((turn) => ({
      id: turn.id,
      userMessageId: turn.userMessageId,
      question: '学习问题',
      answer: '回答',
      createdAt: turn.createdAt,
    })),
    hasOlder: end > pageMessages.length,
    oldestMessageId: pageMessages[0]?.id ?? null,
  };
}
async function mockConversation(page: Page) {
  await page.route('**/api/v1/me/assistant/threads', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ json: { data: [detail().thread] } });
  });
  await page.route(`**/api/v1/me/assistant/threads/${threadId}`, async (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: { data: detail({ before: url.searchParams.get('before') ?? undefined }) },
    });
  });
  await login(page);
}

test('长对话初始贴底，上翻后解除跟随，回到底部恢复', async ({ page }) => {
  await mockConversation(page);
  await page.goto('/assistant');
  const viewport = page.getByTestId('assistant-messages');
  await expect(viewport).toBeVisible();
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(100);
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(3);
  await viewport.hover();
  await page.mouse.wheel(0, -10000);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeLessThan(100);
  await expect(page.getByRole('button', { name: '回到最新' })).toBeVisible();
  await page.getByRole('button', { name: '回到最新' }).click();
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(3);
});

test('复制、划词引用和编辑分叉均连接真实交互', async ({ page }) => {
  await mockConversation(page);
  let forkMode = '';
  await page.route(`**/api/v1/me/assistant/threads/${threadId}/fork`, async (route) => {
    forkMode = route.request().postDataJSON().mode;
    return route.fulfill({
      status: 201,
      json: { data: { ...detail().thread, id: 'conversation-branch', title: '长对话 · 分支' } },
    });
  });
  await page.route('**/api/v1/me/assistant/threads/conversation-branch', async (route) =>
    route.fulfill({ json: { data: detail({ empty: true }) } }),
  );
  await page.goto('/assistant');
  await page.getByRole('button', { name: '复制问题' }).last().click();
  await expect(page.getByRole('status').filter({ hasText: '已复制' })).toBeVisible();
  const answer = page.locator('[data-selection-source="assistant"] .assistant-markdown').last();
  await answer.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '添加批注', exact: true }).click();
  await page.locator('.assistant-selection-comment textarea').fill('请按考试方式解释');
  await page
    .locator('.assistant-selection-comment')
    .getByRole('button', { name: '保存批注' })
    .click();
  await expect(page.locator('.assistant-composer-quotes')).toContainText('这是第');
  await expect(page.locator('.assistant-composer-quotes')).toContainText('考试方式');
  await page
    .getByTestId('assistant-messages')
    .evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: '定位引用原文' }).click();
  await expect(page.locator('.assistant-selection-highlight').first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.assistant-selection-highlight')
        .first()
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const viewport = element.ownerDocument
            .querySelector('[data-testid="assistant-messages"]')
            ?.getBoundingClientRect();
          return Boolean(
            viewport && rect.bottom > viewport.top && rect.top < viewport.bottom && rect.width > 0,
          );
        }),
    )
    .toBe(true);
  await page.getByRole('button', { name: '编辑引用批注' }).click();
  await page.locator('.assistant-quote-comment').fill('请结合例题解释');
  await page.getByRole('button', { name: '保存批注' }).click();
  await expect(page.locator('.assistant-composer-quotes')).toContainText('结合例题');
  await page.getByRole('button', { name: '编辑并重发' }).click();
  await expect.poll(() => forkMode).toBe('before');
  await expect(page.getByTestId('assistant-input')).toHaveValue('第 12 个学习问题');
});

test('流式推理只显示一个思考过程标题', async ({ page }) => {
  const activeTurn = {
    id: 'reasoning-turn',
    threadId,
    userMessageId: 'reasoning-user',
    assistantMessageId: 'reasoning-answer',
    status: 'running',
    errorCode: null,
    providerModelId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
  };
  const user = {
    id: 'reasoning-user',
    threadId,
    role: 'user',
    content: '请分析问题',
    reasoning: null,
    images: [],
    status: 'complete',
    errorCode: null,
    createdAt: activeTurn.createdAt,
    updatedAt: activeTurn.updatedAt,
    revision: 1,
  };
  const answer = {
    ...user,
    id: 'reasoning-answer',
    role: 'assistant',
    content: '',
    status: 'streaming',
  };
  await page.route('**/api/v1/me/assistant/threads', async (route) =>
    route.fulfill({ json: { data: [detail().thread] } }),
  );
  await page.route(`**/api/v1/me/assistant/threads/${threadId}`, async (route) =>
    route.fulfill({
      json: {
        data: {
          ...detail({ empty: true }),
          thread: detail().thread,
          messages: [user, answer],
          turns: [activeTurn],
          activeTurn,
        },
      },
    }),
  );
  await page.route(`**/api/v1/me/assistant/threads/${threadId}/stream**`, async (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: reasoning_delta\ndata: ${JSON.stringify({ delta: '先分析问题，再给出步骤。' })}\n\n: heartbeat\n\n`,
    }),
  );
  await login(page);
  await page.goto('/assistant');
  await expect(page.locator('.assistant-reasoning--live summary')).toHaveText('思考过程');
  await expect(page.getByText('思考过程', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('assistant-event-card')).toHaveCount(0);
  await expect(page.locator('.assistant-reasoning__content')).toContainText(
    '先分析问题，再给出步骤。',
  );
});

test('连续文本增量不重复发起平滑滚动，完成后仍停在最新回复', async ({ page }) => {
  const activeTurn = {
    id: 'live-turn',
    threadId,
    userMessageId: 'live-user',
    assistantMessageId: 'live-answer',
    status: 'running',
    errorCode: null,
    providerModelId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
  };
  const user = {
    id: 'live-user',
    threadId,
    role: 'user',
    content: '请持续回答',
    reasoning: null,
    images: [],
    status: 'complete',
    errorCode: null,
    createdAt: activeTurn.createdAt,
    updatedAt: activeTurn.updatedAt,
    revision: 1,
  };
  const answer = {
    ...user,
    id: 'live-answer',
    role: 'assistant',
    content: '',
    status: 'streaming',
  };
  let completed = false;
  await page.addInitScript(() => {
    const original = Element.prototype.scrollTo;
    window.__assistantScrollCalls = [];
    Element.prototype.scrollTo = function (options?: number | ScrollToOptions) {
      if (this instanceof HTMLElement && this.dataset.testid === 'assistant-messages')
        window.__assistantScrollCalls.push(typeof options === 'object' ? options : {});
      return Reflect.apply(original, this, [options]);
    };
  });
  await page.route('**/api/v1/me/assistant/threads', async (route) =>
    route.fulfill({ json: { data: [detail().thread] } }),
  );
  await page.route(`**/api/v1/me/assistant/threads/${threadId}`, async (route) => {
    const finalText = '第一段内容。第二段内容。第三段内容。最终回复。';
    const data = completed
      ? {
          ...detail({ empty: true }),
          thread: detail().thread,
          messages: [{ ...user }, { ...answer, content: finalText, status: 'complete' }],
          turns: [{ ...activeTurn, status: 'succeeded' }],
          activeTurn: null,
        }
      : {
          ...detail({ empty: true }),
          thread: detail().thread,
          messages: [{ ...user }, { ...answer }],
          turns: [activeTurn],
          activeTurn,
        };
    return route.fulfill({ json: { data } });
  });
  await page.route(`**/api/v1/me/assistant/threads/${threadId}/stream**`, async (route) => {
    completed = true;
    const frames = ['第一段内容。', '第二段内容。', '第三段内容。', '最终回复。'].map(
      (delta) => `event: text_delta\ndata: ${JSON.stringify({ delta })}\n\n`,
    );
    const event = {
      id: 'done',
      threadId,
      turnId: 'live-turn',
      seq: 1,
      type: 'status',
      payload: { phase: 'turn_completed' },
      createdAt: activeTurn.updatedAt,
    };
    frames.push(`event: status\nid: 1\ndata: ${JSON.stringify(event)}\n\n`);
    return route.fulfill({ contentType: 'text/event-stream', body: frames.join('') });
  });
  await login(page);
  await page.goto('/assistant');
  await expect(page.getByTestId('assistant-reply')).toContainText('最终回复。');
  const calls = await page.evaluate(() => window.__assistantScrollCalls);
  expect(calls.filter((call) => call?.behavior === 'smooth')).toHaveLength(0);
  const viewport = page.getByTestId('assistant-messages');
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(3);
});

test('回复中直接输入并加入队列，可编辑、排序、立即发送和删除', async ({ page }) => {
  const activeTurn = {
    id: 'queue-active-turn',
    threadId,
    userMessageId: 'queue-active-user',
    assistantMessageId: 'queue-active-answer',
    status: 'running',
    errorCode: null,
    providerModelId: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    revision: 1,
  };
  const queued: AssistantQueuedMessage[] = [];
  await page.route('**/api/v1/me/assistant/threads', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { data: [detail().thread] } });
    return route.continue();
  });
  await page.route(`**/api/v1/me/assistant/threads/${threadId}`, async (route) =>
    route.fulfill({ json: { data: { ...detail({ empty: true }), activeTurn, queued } } }),
  );
  await page.route(`**/api/v1/me/assistant/threads/${threadId}/stream**`, async (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' }),
  );
  await page.route(`**/api/v1/me/assistant/threads/${threadId}/messages`, async (route) => {
    const input = route.request().postDataJSON();
    const stamp = new Date().toISOString();
    const item: AssistantQueuedMessage = {
      id: `queued-${queued.length + 1}`,
      threadId,
      content: input.content,
      mode: 'followUp',
      position: queued.length + 1,
      providerModelId: null,
      images: [],
      createdAt: stamp,
      updatedAt: stamp,
      revision: 1,
    };
    queued.push(item);
    return route.fulfill({
      status: 202,
      json: { data: { turn: null, userMessage: null, queuedMessage: item } },
    });
  });
  await page.route(
    `**/api/v1/me/assistant/threads/${threadId}/queued-messages/order`,
    async (route) => {
      const ids: string[] = route.request().postDataJSON().ids;
      const ordered = ids.map((id) => queued.find((item) => item.id === id)!);
      queued.splice(0, queued.length, ...ordered);
      return route.fulfill({ json: { data: queued } });
    },
  );
  await page.route('**/api/v1/me/assistant/queued-messages/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const id = path.split('/').at(-1)!;
    if (path.endsWith('/send')) {
      const sendId = path.split('/').at(-2)!;
      const item = queued.find((entry) => entry.id === sendId)!;
      queued.splice(queued.indexOf(item), 1);
      return route.fulfill({ json: { data: { ...item, mode: 'steer' } } });
    }
    const index = queued.findIndex((entry) => entry.id === id);
    if (request.method() === 'PATCH') {
      queued[index] = { ...queued[index]!, content: request.postDataJSON().content, revision: 2 };
      return route.fulfill({ json: { data: queued[index] } });
    }
    queued.splice(index, 1);
    return route.fulfill({ status: 204, body: '' });
  });
  await login(page);
  await page.goto('/assistant');
  const input = page.getByTestId('assistant-input');
  await expect(input).toBeEnabled();
  await expect(page.getByText('正在回复，可继续输入')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '发送方式' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  await expect(page.getByRole('button', { name: '加入追问队列' })).toHaveCount(0);
  await input.fill('第一条追问');
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '加入追问队列' })).toBeVisible();
  await input.press('Enter');
  await input.fill('第二条追问');
  await page.getByRole('button', { name: '加入追问队列' }).click();
  const rows = page.locator('.assistant-queue-item');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('第一条追问');
  await rows.nth(0).getByRole('button', { name: '下移' }).click();
  await expect(rows.nth(0)).toContainText('第二条追问');
  await rows.nth(0).getByRole('button', { name: '编辑待发送消息' }).click();
  await rows.nth(0).getByRole('textbox', { name: '编辑待发送消息' }).fill('修改后的追问');
  await rows.nth(0).getByRole('button', { name: '保存', exact: true }).click();
  await expect(rows.nth(0)).toContainText('修改后的追问');
  await rows.nth(1).getByRole('button', { name: '立即发送' }).click();
  await expect(rows).toHaveCount(1);
  await rows.nth(0).getByRole('button', { name: '移除待发送消息' }).click();
  await expect(page.locator('.assistant-queue')).toHaveCount(0);
});
