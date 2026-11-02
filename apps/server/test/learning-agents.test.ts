import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createApp } from '#server/app.js';
import { createUser } from '#server/modules/auth/index.js';
import type { LearningAgentView } from '@drill-hub/contracts';

// 测试内凭据仅用于内存数据库的登录与加密，全部运行时随机生成，不存在真实凭据。
const PASSWORD = `Test-only-password-${randomUUID()}`;
const PROVIDER_API_KEY = `test-only-key-${randomUUID()}`;
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

async function loginUser(app: FastifyInstance, username: string) {
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/web/login',
    payload: { username, password: PASSWORD },
  });
  const value = login.json().data;
  return {
    cookie: login.cookies.map((entry) => `${entry.name}=${entry.value}`).join('; '),
    'x-csrf-token': value.csrfToken,
  };
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

function assistantTextRound(text: string) {
  return [
    { choices: [{ index: 0, delta: { content: text } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } },
  ];
}

/**
 * stub 全局 fetch：智能体草稿生成（max_completion_tokens=1200 的非流式调用）与助手主对话分开响应；
 * 标题生成走默认非流式回复。
 */
function installProvider(options: {
  draft?: (callIndex: number) => Response | Promise<Response>;
  assistant?: (callIndex: number) => Response | Promise<Response>;
}) {
  const draftCalls: Record<string, any>[] = [];
  const assistantCalls: Record<string, any>[] = [];
  const realFetch = globalThis.fetch.bind(globalThis);
  let draftIndex = 0;
  let assistantIndex = 0;
  const fake = vi.fn<typeof fetch>(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url instanceof Request ? url.url : url);
    if (target.startsWith('http://127.0.0.1:')) return realFetch(url, init);
    if (target.endsWith('/models'))
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.stream === false && body.max_completion_tokens === 1200) {
      draftCalls.push(body);
      draftIndex += 1;
      return (
        options.draft?.(draftIndex) ??
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    name: '苏格拉底教练',
                    description: '追问式引导你思考',
                    icon: '🧠',
                    approachTags: ['socratic', 'active_recall', 'bogus_tag'],
                    tone: 'rigorous',
                    detailLevel: 'balanced',
                    instructions: '一次只问一个问题。',
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      );
    }
    if (body.stream === false)
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '测试对话标题' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    assistantCalls.push(body);
    assistantIndex += 1;
    return options.assistant?.(assistantIndex) ?? sseResponse(assistantTextRound('好的。'));
  });
  vi.stubGlobal('fetch', fake);
  return { draftCalls, assistantCalls };
}

async function configureModels(app: FastifyInstance, admin: Record<string, string>, count = 2) {
  const models: { id: string; modelKey: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const connectionResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/model-connections',
      headers: admin,
      payload: {
        displayName: `供应商 ${index}`,
        protocol: 'chat_completions',
        baseUrl: `http://provider-${index}.test/v1/`,
        apiKey: PROVIDER_API_KEY,
      },
    });
    const connection = connectionResponse.json().data;
    const modelResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/model-connections/${connection.id}/models`,
      headers: admin,
      payload: {
        modelKey: `model-${index}`,
        displayName: `测试模型 ${index}`,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: ['text'],
        costPerMillion: null,
      },
    });
    expect(modelResponse.statusCode).toBe(201);
    models.push({ id: modelResponse.json().data.id, modelKey: `model-${index}` });
  }
  return models;
}

function draftResponse(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function createAgent(
  app: FastifyInstance,
  headers: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/me/learning-agents',
    headers,
    payload: {
      name: '苏格拉底导师',
      description: '追问式引导',
      icon: '🧠',
      approachTags: ['socratic', 'active_recall'],
      tone: 'rigorous',
      detailLevel: 'balanced',
      instructions: '一次只问一个问题；答对后追问依据。',
      ...overrides,
    },
  });
}

describe('learning agents api', () => {
  it('creates, lists, updates, archives and deletes agents with revision checks', async () => {
    const { app, admin } = await setupApp();
    const created = await createAgent(app, admin);
    expect(created.statusCode).toBe(201);
    const agent: LearningAgentView = created.json().data;
    expect(agent).toMatchObject({
      ownerId: expect.any(String),
      name: '苏格拉底导师',
      tone: 'rigorous',
      archivedAt: null,
    });
    expect(agent.approachTags).toEqual(['socratic', 'active_recall']);

    // 校验：非法枚举与未知标签拒绝。
    const badTone = await createAgent(app, admin, { name: 'x', tone: 'angry' });
    expect(badTone.statusCode).toBe(422);
    const badTags = await createAgent(app, admin, {
      name: '标签收敛',
      approachTags: ['socratic', 'not-a-tag', 42],
    });
    expect(badTags.statusCode).toBe(422);
    const missingName = await app.inject({
      method: 'POST',
      url: '/api/v1/me/learning-agents',
      headers: admin,
      payload: { tone: 'rigorous' },
    });
    expect(missingName.statusCode).toBe(422);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/me/learning-agents',
      headers: admin,
    });
    expect(list.json().data.map((item: { id: string }) => item.id)).toEqual([agent.id]);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/me/learning-agents/${agent.id}`,
      headers: admin,
      payload: {
        name: '主动回忆陪练',
        approachTags: ['active_recall', 'spaced_review'],
        expectedRevision: agent.revision,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      name: '主动回忆陪练',
      tone: 'rigorous',
      approachTags: ['active_recall', 'spaced_review'],
    });
    const conflict = await app.inject({
      method: 'PATCH',
      url: `/api/v1/me/learning-agents/${agent.id}`,
      headers: admin,
      payload: { name: '过期修改', expectedRevision: agent.revision },
    });
    expect(conflict.statusCode).toBe(409);

    const deleteWithoutArchive = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/learning-agents/${agent.id}`,
      headers: admin,
    });
    expect(deleteWithoutArchive.statusCode).toBe(409);
    expect(deleteWithoutArchive.json().error.code).toBe('AGENT_NOT_ARCHIVED');

    const archived = await app.inject({
      method: 'POST',
      url: `/api/v1/me/learning-agents/${agent.id}/archive`,
      headers: admin,
      payload: { expectedRevision: updated.json().data.revision },
    });
    expect(archived.statusCode).toBe(200);
    const activeList = await app.inject({
      method: 'GET',
      url: '/api/v1/me/learning-agents',
      headers: admin,
    });
    expect(activeList.json().data).toEqual([]);
    const allList = await app.inject({
      method: 'GET',
      url: '/api/v1/me/learning-agents?archiveState=all',
      headers: admin,
    });
    expect(allList.json().data).toHaveLength(1);
    const restored = await app.inject({
      method: 'POST',
      url: `/api/v1/me/learning-agents/${agent.id}/restore`,
      headers: admin,
      payload: { expectedRevision: archived.json().data.revision },
    });
    expect(restored.json().data.archivedAt).toBeNull();
    const reArchive = await app.inject({
      method: 'POST',
      url: `/api/v1/me/learning-agents/${agent.id}/archive`,
      headers: admin,
      payload: { expectedRevision: restored.json().data.revision },
    });
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/learning-agents/${agent.id}`,
      headers: admin,
    });
    expect(deleted.statusCode).toBe(204);
    expect(await app.ctx.db.get('learningAgents', agent.id)).toBeUndefined();
    const actions = (await app.ctx.db.list('auditLogs', {}))
      .filter((entry) => entry.resourceId === agent.id)
      .map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'learning-agent.create',
        'learning-agent.update',
        'learning-agent.archive',
        'learning-agent.restore',
        'learning-agent.delete',
      ]),
    );
    void reArchive;
  });

  it('isolates agents per owner and validates the default model', async () => {
    const { app, admin } = await setupApp();
    await createUser(app.ctx.db, { username: 'agent-owner', password: PASSWORD });
    const other = await loginUser(app, 'agent-owner');
    const mine = await createAgent(app, admin);
    const foreign = mine.json().data as LearningAgentView;

    for (const request of [
      { method: 'GET', url: `/api/v1/me/learning-agents/${foreign.id}` },
      {
        method: 'PATCH',
        url: `/api/v1/me/learning-agents/${foreign.id}`,
        payload: { expectedRevision: foreign.revision },
      },
      { method: 'DELETE', url: `/api/v1/me/learning-agents/${foreign.id}` },
    ] as const) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: other,
        ...(request.method === 'PATCH' ? { payload: request.payload } : {}),
      });
      expect(response.statusCode).toBe(404);
    }
    const otherList = await app.inject({
      method: 'GET',
      url: '/api/v1/me/learning-agents',
      headers: other,
    });
    expect(otherList.json().data).toEqual([]);

    const badModel = await createAgent(app, admin, { defaultProviderModelId: 'missing-model' });
    expect(badModel.statusCode).toBe(422);
    expect(badModel.json().error.code).toBe('INVALID_MODEL');
    const models = await configureModels(app, admin, 1);
    const goodModel = await createAgent(app, admin, {
      defaultProviderModelId: models[0].id,
    });
    expect(goodModel.statusCode).toBe(201);
    expect(goodModel.json().data.defaultProviderModelId).toBe(models[0].id);

    // 线程绑定：外部智能体与不存在的智能体都拒绝。
    const foreignThread = await app.inject({
      method: 'POST',
      url: '/api/v1/me/assistant/threads',
      headers: other,
      payload: { agentId: foreign.id },
    });
    expect(foreignThread.statusCode).toBe(404);
    const missingThread = await app.inject({
      method: 'POST',
      url: '/api/v1/me/assistant/threads',
      headers: admin,
      payload: { agentId: 'missing-agent' },
    });
    expect(missingThread.statusCode).toBe(404);
    const bound = await app.inject({
      method: 'POST',
      url: '/api/v1/me/assistant/threads',
      headers: admin,
      payload: { agentId: goodModel.json().data.id },
    });
    expect(bound.statusCode).toBe(201);
    expect(bound.json().data.agentId).toBe(goodModel.json().data.id);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/me/assistant/threads/${bound.json().data.id}`,
      headers: admin,
    });
    expect(detail.json().data.agent).toMatchObject({ id: goodModel.json().data.id });
    expect(detail.json().data.thread.agentId).toBe(goodModel.json().data.id);

    const unbound = await app.inject({
      method: 'PATCH',
      url: `/api/v1/me/assistant/threads/${bound.json().data.id}`,
      headers: admin,
      payload: { agentId: null, expectedRevision: bound.json().data.revision },
    });
    expect(unbound.statusCode).toBe(200);
    expect(unbound.json().data.agentId).toBeNull();
  });

  it('generates drafts with usage accounting and maps provider failures', async () => {
    const { app, admin } = await setupApp();
    const provider = installProvider({});
    const noModel = await app.inject({
      method: 'POST',
      url: '/api/v1/me/learning-agents/generate-draft',
      headers: admin,
      payload: { description: '我喜欢刷题，希望有人陪练' },
    });
    expect(noModel.statusCode).toBe(409);
    expect(noModel.json().error.code).toBe('ASSISTANT_MODEL_NOT_CONFIGURED');
    await configureModels(app, admin, 1);

    const generated = await app.inject({
      method: 'POST',
      url: '/api/v1/me/learning-agents/generate-draft',
      headers: admin,
      payload: { description: '我喜欢刷题，希望有人陪练，语气不要太严肃' },
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().data).toMatchObject({
      name: '苏格拉底教练',
      icon: '🧠',
      approachTags: ['socratic', 'active_recall'],
      tone: 'rigorous',
    });
    expect(provider.draftCalls).toHaveLength(1);
    expect(provider.draftCalls[0]).toMatchObject({ stream: false, max_completion_tokens: 1200 });
    const usage = await app.ctx.db.list('modelUsage', { purpose: 'learning_agent_generate' });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ status: 'succeeded', usage: { totalTokens: 40 } });
    const audits = (await app.ctx.db.list('auditLogs', {})).filter(
      (entry) => entry.action === 'learning-agent.generate',
    );
    expect(audits).toHaveLength(1);
  }, 20000);

  it('maps garbage provider output to MODEL_INVALID_RESPONSE and records failed usage', async () => {
    const { app, admin } = await setupApp();
    installProvider({
      draft: () => draftResponse('这不是 JSON'),
    });
    await configureModels(app, admin, 1);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/learning-agents/generate-draft',
      headers: admin,
      payload: { description: '描述' },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('MODEL_INVALID_RESPONSE');
    const failed = await app.ctx.db.list('modelUsage', { purpose: 'learning_agent_generate' });
    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe('failed');
  });
});

describe('learning agents in assistant conversations', () => {
  it('injects the persona and applies the agent default model to turns', async () => {
    const { app, admin } = await setupApp();
    const models = await configureModels(app, admin, 2);
    const provider = installProvider({});
    const agentResponse = await createAgent(app, admin, {
      name: '费曼教练',
      approachTags: ['feynman', 'step_by_step'],
      instructions: '每次先让我用自己的话解释概念。',
      defaultProviderModelId: models[1].id,
    });
    const agent = agentResponse.json().data as LearningAgentView;
    const threadResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/me/assistant/threads',
      headers: admin,
      payload: { agentId: agent.id },
    });
    const thread = threadResponse.json().data;
    const sent = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '讲解一下牛顿第二定律' },
    });
    expect(sent.statusCode).toBe(202);
    for (let deadline = Date.now() + 20000; ;) {
      const events = await app.inject({
        method: 'GET',
        url: `/api/v1/me/assistant/threads/${thread.id}/events`,
        headers: { cookie: admin.cookie },
      });
      const data = events.json().data;
      if (!data.activeTurn) break;
      if (Date.now() > deadline) throw new Error('polling timed out');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(provider.assistantCalls).toHaveLength(1);
    expect(provider.assistantCalls[0].model).toBe('model-1');
    const firstCall = JSON.stringify(provider.assistantCalls[0]);
    expect(firstCall).toContain('[学习智能体人设]');
    expect(firstCall).toContain('费曼教练');
    expect(firstCall).toContain('每次先让我用自己的话解释概念。');
    expect(firstCall).toContain('费曼技巧');

    // 解绑后不再注入人设，模型回到自动选择。
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/me/assistant/threads/${thread.id}`,
      headers: { cookie: admin.cookie },
    });
    const unbound = await app.inject({
      method: 'PATCH',
      url: `/api/v1/me/assistant/threads/${thread.id}`,
      headers: admin,
      payload: { agentId: null, expectedRevision: detail.json().data.thread.revision },
    });
    expect(unbound.statusCode).toBe(200);
    await app.inject({
      method: 'POST',
      url: `/api/v1/me/assistant/threads/${thread.id}/messages`,
      headers: admin,
      payload: { content: '换个方式再讲一遍' },
    });
    for (let deadline = Date.now() + 20000; ;) {
      const events = await app.inject({
        method: 'GET',
        url: `/api/v1/me/assistant/threads/${thread.id}/events`,
        headers: { cookie: admin.cookie },
      });
      const data = events.json().data;
      if (!data.activeTurn) break;
      if (Date.now() > deadline) throw new Error('polling timed out');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(provider.assistantCalls).toHaveLength(2);
    // 持久会话会回放历史：第二轮仍能看到第一轮的人设块，但不再有新增的第二份。
    expect(JSON.stringify(provider.assistantCalls[1]).split('[学习智能体人设]')).toHaveLength(2);
    expect(provider.assistantCalls[1].model).toBe('model-0');
  }, 30000);
});
