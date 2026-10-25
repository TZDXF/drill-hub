import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '#server/app.js';
import { signInternalToken } from '#server/core/internal-auth.js';
import { runSearch } from '#server/modules/assistant/search.js';
import type { SearchProviderRecord } from '#server/db/records.js';

const PASSWORD = 'Test-only-password-42!';
const apps: FastifyInstance[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

async function setupApp() {
  const app = await createApp({
    databasePath: ':memory:',
    encryptionKey: 'a'.repeat(64),
    startWorkers: false,
    bootstrapAdmin: { username: 'admin', password: PASSWORD },
  });
  apps.push(app);
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/web/login',
    payload: { username: 'admin', password: PASSWORD },
  });
  const value = login.json().data;
  const cookie = login.cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
  return { app, admin: { cookie, 'x-csrf-token': value.csrfToken }, ownerId: value.user.id };
}

function sseResponse(chunks: unknown[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function assistantToolCallRound(toolName: string, args: Record<string, unknown>) {
  return [
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: toolName, arguments: '' },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }],
          },
        },
      ],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ];
}

function assistantTextRound(text: string) {
  return [
    { choices: [{ index: 0, delta: { content: text } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } },
  ];
}

/** stub 全局 fetch：区分本机直连、/models、评分合成测试与助手对话（流式，带工具声明）。 */
function installProvider(options: {
  assistant?: (callIndex: number) => Response | Promise<Response>;
  models?: unknown[];
}) {
  const assistantCalls: Record<string, any>[] = [];
  const realFetch = globalThis.fetch.bind(globalThis);
  let assistantIndex = 0;
  const fake = vi.fn<typeof fetch>(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url instanceof Request ? url.url : url);
    // 测试进程内的真实本机服务（如 SSE 端点）不经过桩。
    if (target.startsWith('http://127.0.0.1:')) return realFetch(url, init);
    if (target.endsWith('/models'))
      return new Response(JSON.stringify({ data: options.models ?? [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const body = JSON.parse(String(init?.body ?? '{}'));
    const isAssistant = Array.isArray(body.tools) && body.tools.length > 0 && body.stream === true;
    if (isAssistant) {
      assistantCalls.push(body);
      assistantIndex += 1;
      const respond =
        options.assistant?.(assistantIndex) ?? sseResponse(assistantTextRound('好的。'));
      return respond;
    }
    // 评分/连接测试的合成请求：返回成功的评分 JSON。
    return new Response(
      JSON.stringify({
        model: 'configured-model',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              refusal: null,
              content: JSON.stringify({
                criteria: [
                  {
                    criterionId: 'atomicity',
                    levelId: 'met',
                    evidence: ['All operations succeed together or roll back together.'],
                    explanation: 'synthetic check',
                  },
                ],
                summary: 'synthetic ok',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fake);
  return { assistantCalls };
}

async function configureAssistantModel(app: FastifyInstance, admin: Record<string, string>) {
  const connectionResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/model-connections',
    headers: admin,
    payload: {
      displayName: '助手测试供应商',
      protocol: 'chat_completions',
      baseUrl: 'http://provider.test/v1/',
      apiKey: 'test-only-secret',
    },
  });
  expect(connectionResponse.statusCode).toBe(201);
  const connection = connectionResponse.json().data;
  await app.inject({
    method: 'POST',
    url: `/api/v1/admin/model-connections/${connection.id}/test`,
    headers: admin,
    payload: {},
  });
  const modelResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/model-connections/${connection.id}/models`,
    headers: admin,
    payload: {
      modelKey: 'assistant-model',
      displayName: '助手测试模型',
      contextWindow: 128000,
      maxTokens: 16384,
      reasoning: true,
      input: ['text', 'image'],
      costPerMillion: { input: 0.5, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
    },
  });
  expect(modelResponse.statusCode).toBe(201);
  const model = modelResponse.json().data;
  expect(model.contextWindow).toBe(128000);
  expect(model.costPerMillion).toEqual({ input: 0.5, output: 2, cacheRead: 0.1, cacheWrite: 0.2 });
  const tested = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/provider-models/${model.id}/test`,
    headers: admin,
    payload: {},
  });
  expect(tested.statusCode).toBe(200);
  return { connection, model };
}

async function createThread(app: FastifyInstance, admin: Record<string, string>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/me/assistant/threads',
    headers: admin,
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  return response.json().data;
}

async function pollUntil(
  app: FastifyInstance,
  admin: Record<string, string>,
  threadId: string,
  predicate: (payload: {
    events: { type: string; payload: Record<string, unknown> }[];
    activeTurn: unknown;
  }) => boolean,
  timeoutMs = 20000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/me/assistant/threads/${threadId}/events`,
      headers: { cookie: admin.cookie },
    });
    const data = response.json().data as {
      events: { type: string; payload: Record<string, unknown> }[];
      activeTurn: unknown;
    };
    if (predicate(data)) return data;
    if (Date.now() > deadline) throw new Error('polling timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('built-in assistant', () => {
  it('runs a full turn with a tool call and records usage without admin endpoints', async () => {
    const { app, admin } = await setupApp();
    installProvider({
      assistant: (index) =>
        index === 1
          ? sseResponse(
              assistantToolCallRound('drill_hub_api', { method: 'GET', path: '/api/v1/topics' }),
            )
          : sseResponse(assistantTextRound('当前还没有主题，需要我帮你创建吗？')),
    });
    await configureAssistantModel(app, admin);
    const thread = await createThread(app, admin);
    const sent = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '帮我看看有哪些主题', pageContext: { route: 'home' } },
    });
    expect(sent.statusCode).toBe(202);
    const final = await pollUntil(app, admin, thread.id, (data) =>
      data.events.some(
        (event) => event.type === 'status' && event.payload.phase === 'turn_completed',
      ),
    );
    const toolCall = final.events.find((event) => event.type === 'tool_call');
    expect(toolCall?.payload.name).toBe('drill_hub_api');
    const toolResult = final.events.find((event) => event.type === 'tool_result');
    expect(toolResult?.payload.isError).toBe(false);
    expect(String(toolResult?.payload.summary)).toContain('200');
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/me/assistant/threads/${thread.id}`,
      headers: { cookie: admin.cookie },
    });
    const turns = detail.json().data.turns as { status: string }[];
    expect(turns).toHaveLength(1);
    expect(turns[0].status).toBe('succeeded');
    const messages = detail.json().data.messages as {
      role: string;
      status: string;
      content: string;
    }[];
    const assistantMessage = messages.find((message) => message.role === 'assistant');
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage!.status).toBe('complete');
    expect(assistantMessage!.content).toContain('主题');
    const usage = await app.ctx.db.list('modelUsage', { purpose: 'assistant' });
    expect(usage.length).toBe(1);
    expect(usage[0].usage?.totalTokens).toBe(40);
  });

  it('rejects admin and answer endpoints from the api allowlist', async () => {
    const { app, admin } = await setupApp();
    installProvider({
      assistant: (index) =>
        index === 1
          ? sseResponse(
              assistantToolCallRound('drill_hub_api', {
                method: 'GET',
                path: '/api/v1/admin/users',
              }),
            )
          : sseResponse(assistantTextRound('无法访问')),
    });
    await configureAssistantModel(app, admin);
    const thread = await createThread(app, admin);
    await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '列出所有用户' },
    });
    const final = await pollUntil(app, admin, thread.id, (data) =>
      data.events.some(
        (event) => event.type === 'status' && event.payload.phase === 'turn_completed',
      ),
    );
    const toolResult = final.events.find((event) => event.type === 'tool_result');
    expect(toolResult?.payload.isError).toBe(true);
    expect(String(toolResult?.payload.summary)).toContain('白名单');
  });

  it('does not leak frozen answers for in-progress attempts', async () => {
    const { app, admin } = await setupApp();
    let attemptId = '';
    installProvider({
      assistant: (index) =>
        index === 1
          ? sseResponse(
              assistantToolCallRound('drill_hub_api', {
                method: 'GET',
                path: '/api/v1/attempts/' + attemptId,
              }),
            )
          : sseResponse(assistantTextRound('已查看')),
    });
    const agentToken = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens',
      headers: admin,
      payload: {
        name: 'seed',
        scopes: ['read', 'content:write', 'assessment:write', 'attempt:write'],
      },
    });
    const token = agentToken.json().data;
    const revealed = await app.inject({
      method: 'POST',
      url: `/api/v1/me/agent-tokens/${token.id}/reveal`,
      headers: admin,
      payload: {},
    });
    const bearer = { authorization: `Bearer ${revealed.json().data.token}` };
    const topicResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/topics',
      headers: bearer,
      payload: { title: '安全主题' },
    });
    const topic = topicResponse.json().data;
    const questionResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/topics/${topic.id}/questions/batch`,
      headers: bearer,
      payload: {
        items: [
          {
            clientRef: 'q1',
            type: 'short_answer',
            stem: '解释事务的原子性',
            gradingMode: 'model_rubric',
            referenceAnswer: 'SECRET-REFERENCE-XYZ-绝不可泄露',
            rubric: {
              version: 1,
              criteria: [
                {
                  id: 'core',
                  description: '说明全部成功或回滚',
                  weight: 1,
                  levels: [
                    { id: 'not_met', creditBps: 0, description: '未达成' },
                    { id: 'met', creditBps: 10000, description: '达成' },
                  ],
                },
              ],
            },
          },
        ],
      },
    });
    expect(questionResponse.statusCode).toBe(201);
    const questionId = questionResponse.json().data[0].questionId;
    const assessmentResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/topics/${topic.id}/assessments`,
      headers: bearer,
      payload: {
        kind: 'exam',
        title: '安全考试',
        items: [{ questionId, questionVersion: 1, maxScore: '10' }],
      },
    });
    const assessment = assessmentResponse.json().data;
    const attemptResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${assessment.id}/attempts`,
      headers: admin,
      payload: {},
    });
    attemptId = attemptResponse.json().data.id;

    await configureAssistantModel(app, admin);
    const thread = await createThread(app, admin);
    await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '看看我正在做的考试' },
    });
    await pollUntil(app, admin, thread.id, (data) =>
      data.events.some(
        (event) => event.type === 'status' && event.payload.phase === 'turn_completed',
      ),
    );
    // 学习者投影不释放参考答案：工具摘要与事件中均不得出现秘密参考答案。
    const events = await app.ctx.db.list('assistantEvents', { threadId: thread.id });
    expect(JSON.stringify(events)).not.toContain('SECRET-REFERENCE-XYZ');
  });

  it('fails visibly when no assistant model is configured', async () => {
    const { app, admin } = await setupApp();
    installProvider({});
    const thread = await createThread(app, admin);
    await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '你好' },
    });
    const final = await pollUntil(app, admin, thread.id, (data) =>
      data.events.some((event) => event.type === 'error'),
    );
    const error = final.events.find((event) => event.type === 'error');
    expect(error?.payload.code).toBe('ASSISTANT_MODEL_NOT_CONFIGURED');
  });

  it('exposes selectable models and records the per-turn model choice', async () => {
    const { app, admin } = await setupApp();
    const seenModels: string[] = [];
    installProvider({
      assistant: () => {
        seenModels.push('call');
        return sseResponse(assistantTextRound('收到'));
      },
    });
    const { model } = await configureAssistantModel(app, admin);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/me/assistant/models',
      headers: { cookie: admin.cookie },
    });
    expect(list.statusCode).toBe(200);
    const options = list.json().data;
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      id: model.id,
      modelKey: 'assistant-model',
      displayName: '助手测试模型',
      reasoning: true,
      contextWindow: 128000,
      maxTokens: 16384,
      costPerMillion: { input: 0.5, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
    });

    const thread = await createThread(app, admin);
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '你好', providerModelId: 'missing-model' },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe('INVALID_MODEL');

    const sent = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '你好', providerModelId: model.id },
    });
    expect(sent.statusCode).toBe(202);
    expect(sent.json().data.turn.providerModelId).toBe(model.id);
    await pollUntil(app, admin, thread.id, (data) =>
      data.events.some(
        (event) => event.type === 'status' && event.payload.phase === 'turn_completed',
      ),
    );
    const usage = await app.ctx.db.list('modelUsage', { purpose: 'assistant' });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ modelKey: 'assistant-model', status: 'succeeded' });
  });

  it('rejects concurrent turns on one thread and isolates threads per owner', async () => {
    const { app, admin } = await setupApp();
    let releaseModel: (() => void) | undefined;
    const gate = new Promise<Response>((resolve) => {
      releaseModel = () => resolve(sseResponse(assistantTextRound('慢速回复')));
    });
    installProvider({ assistant: () => gate });
    await configureAssistantModel(app, admin);
    const thread = await createThread(app, admin);
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '慢一点回复' },
    });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '再问一个' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ACTIVE_TURN_EXISTS');
    releaseModel?.();
    await pollUntil(app, admin, thread.id, (data) =>
      data.events.some(
        (event) => event.type === 'status' && event.payload.phase === 'turn_completed',
      ),
    );
    // 其他用户不可见他人线程。
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: admin,
      payload: { username: 'other', password: PASSWORD },
    });
    expect(created.statusCode).toBe(200);
    const otherLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/web/login',
      payload: { username: 'other', password: PASSWORD },
    });
    const other = otherLogin.json().data;
    const otherCookie = otherLogin.cookies
      .map((entry: { name: string; value: string }) => `${entry.name}=${entry.value}`)
      .join('; ');
    const otherHeaders = { cookie: otherCookie, 'x-csrf-token': other.csrfToken };
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/me/assistant/threads/${thread.id}`,
      headers: { cookie: otherCookie },
    });
    expect(foreign.statusCode).toBe(404);
    void otherHeaders;
  });

  it('internal tokens authenticate as the invoking user but never as admin', async () => {
    const { app, admin, ownerId } = await setupApp();
    const secret = 'a'.repeat(64);
    const token = signInternalToken({
      secret,
      userId: ownerId,
      turnId: 'turn-test',
      role: 'admin',
      expiresAt: Date.now() + 60000,
    });
    const asInternal = { authorization: `Bearer ${token}` };
    const dashboard = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: asInternal,
    });
    expect(dashboard.statusCode).toBe(200);
    const adminEndpoint = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: asInternal,
    });
    expect(adminEndpoint.statusCode).toBe(403);
    const forged = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: { authorization: 'Bearer dhi.forged.token' },
    });
    expect(forged.statusCode).toBe(401);
    const expired = signInternalToken({
      secret,
      userId: ownerId,
      turnId: 'turn-old',
      role: 'user',
      expiresAt: Date.now() - 1000,
    });
    const stale = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(stale.statusCode).toBe(401);
    void admin;
  });

  it('streams events over SSE with replay for late subscribers', async () => {
    const { app, admin } = await setupApp();
    installProvider({
      assistant: (index) =>
        index === 1
          ? sseResponse(assistantToolCallRound('navigate', { route: 'topics' }))
          : sseResponse(assistantTextRound('已为你打开主题列表')),
    });
    await configureAssistantModel(app, admin);
    const thread = await createThread(app, admin);
    await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '打开主题列表' },
    });
    await pollUntil(app, admin, thread.id, (data) =>
      data.events.some(
        (event) => event.type === 'status' && event.payload.phase === 'turn_completed',
      ),
    );
    await new Promise((resolve) => (app.server ? setImmediate(resolve) : resolve(null)));
    const port = await new Promise<number>((resolve, reject) => {
      app.server?.listen(0, '127.0.0.1', () => {
        const address = app.server?.address();
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port'));
      });
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/v1/me/assistant/threads/${thread.id}/stream?after=0`,
        { headers: { cookie: admin.cookie } },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const seen: string[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (const frame of buffer.split('\n\n')) {
          const eventLine = frame.split('\n').find((line) => line.startsWith('event: '));
          if (eventLine) seen.push(eventLine.slice(7));
        }
        buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
        if (seen.includes('status')) break;
      }
      await reader.cancel();
      expect(seen).toContain('tool_call');
      expect(seen).toContain('ui_action');
      expect(seen).toContain('status');
    } finally {
      await new Promise<void>((resolve) => app.server?.close(() => resolve()));
    }
  }, 30000);
});

describe('search providers', () => {
  function provider(overrides: Partial<SearchProviderRecord>): SearchProviderRecord {
    return {
      id: 'p1',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      revision: 1,
      displayName: '测试搜索',
      kind: 'tavily',
      baseUrl: 'https://search.test',
      modelKey: null,
      enabled: true,
      encryptedApiKey: '',
      testError: null,
      ...overrides,
    } as SearchProviderRecord;
  }
  function nowIso() {
    return new Date().toISOString();
  }

  it('shapes tavily, brave, searxng and openai_responses requests', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let callIndex = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        callIndex += 1;
        calls.push({ url: String(url), init: init ?? {} });
        if (callIndex === 4)
          return new Response(
            JSON.stringify({
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: '搜索回答',
                      annotations: [
                        {
                          type: 'url_citation',
                          url: 'https://a.test/x',
                          title: '来源A',
                          text: '片段',
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          );
        if (callIndex === 2)
          return new Response(
            JSON.stringify({
              web: { results: [{ title: 'B', url: 'https://b.test', description: 'd' }] },
            }),
            { status: 200 },
          );
        if (callIndex === 3)
          return new Response(
            JSON.stringify({ results: [{ title: 'S', url: 'https://s.test', content: 'c' }] }),
            { status: 200 },
          );
        return new Response(
          JSON.stringify({ results: [{ title: 'T', url: 'https://t.test', content: 'c' }] }),
          { status: 200 },
        );
      }),
    );
    const tavily = await runSearch({
      provider: provider({ kind: 'tavily' }),
      apiKey: 'tk',
      query: 'q',
      maxResults: 3,
      allowPrivate: false,
    });
    expect(tavily[0].url).toBe('https://t.test');
    expect(calls[0].url).toBe('https://search.test/search');
    const brave = await runSearch({
      provider: provider({ kind: 'brave' }),
      apiKey: 'bk',
      query: 'q',
      maxResults: 3,
      allowPrivate: false,
    });
    expect(brave[0].url).toBe('https://b.test');
    const braveHeaders = new Headers(calls[1].init.headers);
    expect(braveHeaders.get('x-subscription-token')).toBe('bk');
    const searxng = await runSearch({
      provider: provider({ kind: 'searxng', baseUrl: 'https://searxng.test' }),
      apiKey: null,
      query: 'q',
      maxResults: 3,
      allowPrivate: false,
    });
    expect(searxng[0].url).toBe('https://s.test');
    expect(calls[2].url).toContain('format=json');
    const openai = await runSearch({
      provider: provider({
        kind: 'openai_responses',
        baseUrl: 'https://oa.test/v1',
        modelKey: 'gpt-test',
      }),
      apiKey: 'ok',
      query: 'q',
      maxResults: 3,
      allowPrivate: false,
    });
    expect(openai[0].url).toBe('https://a.test/x');
    const body = JSON.parse(String(calls[3].init.body));
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.model).toBe('gpt-test');
  });

  it('refuses private search endpoints unless explicitly allowed', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      runSearch({
        provider: provider({ baseUrl: 'http://127.0.0.1:8080' }),
        apiKey: 'k',
        query: 'q',
        maxResults: 2,
        allowPrivate: false,
      }),
    ).rejects.toMatchObject({ code: 'SEARCH_ADDRESS_FORBIDDEN' });
    await runSearch({
      provider: provider({ baseUrl: 'http://127.0.0.1:8080' }),
      apiKey: 'k',
      query: 'q',
      maxResults: 2,
      allowPrivate: true,
    });
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('assistant admin routes', () => {
  it('manages search providers, skills, mcp servers and settings with validation', async () => {
    const { app, admin } = await setupApp();
    installProvider({});
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/search-providers',
      headers: admin,
      payload: { displayName: '主搜索', kind: 'tavily', apiKey: 'tv-key' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain('tv-key');
    expect(created.json().data.apiKeyConfigured).toBe(true);
    const badKind = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/search-providers',
      headers: admin,
      payload: { displayName: 'x', kind: 'google', apiKey: 'k' },
    });
    expect(badKind.statusCode).toBe(422);
    const searxngMissingUrl = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/search-providers',
      headers: admin,
      payload: { displayName: 'x', kind: 'searxng' },
    });
    expect(searxngMissingUrl.statusCode).toBe(422);

    const skill = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/assistant-skills',
      headers: admin,
      payload: { name: 'exam-review', description: '复习指导', content: '复习时优先错题。' },
    });
    expect(skill.statusCode).toBe(201);
    const duplicateSkill = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/assistant-skills',
      headers: admin,
      payload: { name: 'exam-review', description: '重复', content: 'x' },
    });
    expect(duplicateSkill.statusCode).toBe(409);

    const privateMcp = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/mcp-servers',
      headers: admin,
      payload: { name: 'internal', transport: 'http', url: 'http://192.168.1.5/mcp' },
    });
    expect(privateMcp.statusCode).toBe(403);
    const stdioMcp = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/mcp-servers',
      headers: admin,
      payload: { name: 'tools', transport: 'stdio', command: 'npx', args: ['-y', 'some-server'] },
    });
    expect(stdioMcp.statusCode).toBe(201);
    expect(stdioMcp.json().data.enabled).toBe(false);

    // 全局助手设置已移除：默认模型与上限/超时不再可配置，端点应返回 404。
    const removedSettings = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/assistant-settings',
      headers: { cookie: admin.cookie },
    });
    expect(removedSettings.statusCode).toBe(404);
  });

  it('exposes assistant status for entry availability', async () => {
    const { app, admin } = await setupApp();
    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/me/assistant/status',
      headers: { cookie: admin.cookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().data).toEqual({
      modelConfigured: false,
      searchEnabled: false,
      mcpEnabled: false,
      customSkills: 0,
    });
  });
});
