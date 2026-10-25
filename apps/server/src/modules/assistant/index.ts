import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  AssistantRouteName,
  AssistantThread,
  AssistantTurnView,
  McpServerView,
  SearchProviderView,
} from '@drill-hub/contracts';
import { baseRecord, now } from '../../core/ids.js';
import { AppError } from '../../core/errors.js';
import { assertProviderHost } from '../../core/provider-network.js';
import type { AppContext } from '../../core/context.js';
import type {
  AssistantTurnRecord,
  McpServerRecord,
  SearchProviderRecord,
} from '../../db/records.js';
import {
  API_PREFIX,
  assert,
  body,
  checkRevision,
  expectedRevision,
  optionalString,
  owned,
  params,
  positiveInteger,
  query,
  requiredString,
  type JsonObject,
} from '../learning/common.js';
import {
  createAssistantService,
  createTurn,
  assistantEventViews,
  type AssistantServiceImpl,
} from './service.js';
import { runSearch, testSearchProvider, validateSearchProviderInput } from './search.js';

export { createAssistantService };
export type { AssistantServiceImpl };

const ROUTE_NAMES: AssistantRouteName[] = [
  'home',
  'topics',
  'topic',
  'plan',
  'content',
  'assessment',
  'attempt',
  'report',
  'wrong-questions',
  'wrong-question-detail',
  'history',
  'archive',
];

function threadView(record: AssistantThread): AssistantThread {
  return record;
}

function turnView(record: AssistantTurnRecord): AssistantTurnView {
  const { ownerId: _ownerId, promptContext: _promptContext, ...view } = record;
  return view;
}

function searchProviderView(record: SearchProviderRecord): SearchProviderView {
  const { encryptedApiKey, ...view } = record;
  return { ...view, apiKeyConfigured: Boolean(encryptedApiKey) };
}

function mcpServerView(record: McpServerRecord): McpServerView {
  const { encryptedEnv, encryptedHeaders, ...view } = record;
  return {
    ...view,
    envConfigured: Boolean(encryptedEnv),
    headersConfigured: Boolean(encryptedHeaders),
  };
}

async function findActiveTurn(
  ctx: AppContext,
  threadId: string,
): Promise<AssistantTurnRecord | null> {
  const turns = await ctx.db.list('assistantTurns', { threadId });
  return turns.find((turn) => turn.status === 'queued' || turn.status === 'running') ?? null;
}

function pageContextText(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  assert(
    typeof raw === 'object' && !Array.isArray(raw),
    'INVALID_PAGE_CONTEXT',
    '页面上下文格式无效',
  );
  const context = raw as JsonObject;
  const route = context.route;
  assert(
    typeof route === 'string' && ROUTE_NAMES.includes(route as AssistantRouteName),
    'INVALID_PAGE_CONTEXT',
    '页面上下文路由无效',
  );
  const parts = [`route=${route}`];
  for (const [key, value] of Object.entries(context.params ?? {}).slice(0, 4)) {
    assert(
      /^[\w-]{1,64}$/.test(key) && typeof value === 'string' && value.length <= 128,
      'INVALID_PAGE_CONTEXT',
      '页面上下文参数无效',
    );
    parts.push(`${key}=${value}`);
  }
  return `[当前页面：${parts.join(' ')}]`;
}

function sseWrite(reply: FastifyReply, frame: string): void {
  if (!reply.raw.writableEnded) reply.raw.write(frame);
}

export function registerAssistantRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  assistant: AssistantServiceImpl,
): void {
  // ===== 用户：线程与消息 =====
  app.get(`${API_PREFIX}/me/assistant/threads`, async (request) => {
    const actor = await ctx.requireUser(request);
    const threads = await ctx.db.list('assistantThreads', { ownerId: actor.userId });
    return { data: threads.map(threadView) };
  });

  app.post(`${API_PREFIX}/me/assistant/threads`, async (request, reply) => {
    const actor = await ctx.requireUser(request);
    const input = body(request, true);
    const thread = {
      ...baseRecord(),
      ownerId: actor.userId,
      title: optionalString(input, 'title', '新对话', 200),
      lastMessageAt: now(),
    };
    await ctx.db.insert('assistantThreads', thread);
    reply.code(201);
    return { data: threadView(thread) };
  });

  app.get(`${API_PREFIX}/me/assistant/threads/:id`, async (request) => {
    const actor = await ctx.requireUser(request);
    const thread = await owned(ctx.db, 'assistantThreads', params(request).id, actor.userId);
    const messages = await ctx.db.list('assistantMessages', { threadId: thread.id });
    const events = await ctx.db.list('assistantEvents', { threadId: thread.id });
    const orderedMessages = [...messages].sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    );
    const activeTurn = await findActiveTurn(ctx, thread.id);
    const turns = await ctx.db.list('assistantTurns', { threadId: thread.id });
    return {
      data: {
        thread: threadView(thread),
        turns: turns.map(turnView),
        messages: orderedMessages.map(({ ownerId: _ownerId, ...view }) => view),
        events: assistantEventViews([...events].sort((left, right) => left.seq - right.seq)),
        activeTurn: activeTurn ? turnView(activeTurn) : null,
      },
    };
  });

  app.patch(`${API_PREFIX}/me/assistant/threads/:id`, async (request) => {
    const actor = await ctx.requireUser(request);
    const input = body(request);
    const revision = expectedRevision(input);
    const thread = await ctx.db.get('assistantThreads', params(request).id);
    assert(thread && thread.ownerId === actor.userId, 'NOT_FOUND', '资源不存在', 404);
    const updated = await ctx.db.update('assistantThreads', thread.id, revision, {
      title: optionalString(input, 'title', thread.title, 200),
    });
    return { data: threadView(updated) };
  });

  app.delete(`${API_PREFIX}/me/assistant/threads/:id`, async (request, reply) => {
    const actor = await ctx.requireUser(request);
    const thread = await owned(ctx.db, 'assistantThreads', params(request).id, actor.userId);
    await ctx.db.transaction(async (tx) => {
      for (const table of ['assistantEvents', 'assistantMessages', 'assistantTurns'] as const) {
        for (const record of await tx.list(table, { threadId: thread.id }))
          await tx.delete(table, record.id);
      }
      await tx.delete('assistantThreads', thread.id);
      await ctx.audit(actor, 'assistant.thread.delete', 'assistantThread', thread.id, {}, tx);
    });
    reply.code(204);
    return reply.send();
  });

  app.post(
    `${API_PREFIX}/me/assistant/threads/:id/messages`,
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const actor = await ctx.requireUser(request);
      const thread = await owned(ctx.db, 'assistantThreads', params(request).id, actor.userId);
      const input = body(request);
      const content = requiredString(input, 'content', 20000);
      const promptContext = pageContextText(input.pageContext);
      const active = await findActiveTurn(ctx, thread.id);
      if (active)
        throw new AppError(409, 'ACTIVE_TURN_EXISTS', '当前对话仍在处理上一条消息，请稍候');
      const handle = await createTurn(ctx, actor.userId, thread.id, content, promptContext);
      const title = thread.title === '新对话' ? content.slice(0, 30) || thread.title : thread.title;
      await ctx.db.update('assistantThreads', thread.id, thread.revision, {
        title,
        lastMessageAt: now(),
      });
      assistant.enqueue(handle.turnId);
      reply.code(202);
      const userMessage = await ctx.db.get('assistantMessages', handle.userMessageId);
      const turn = await ctx.db.get('assistantTurns', handle.turnId);
      return {
        data: {
          turn: turn ? turnView(turn) : null,
          userMessage: userMessage
            ? (() => {
                const { ownerId: _ownerId, ...view } = userMessage;
                return view;
              })()
            : null,
        },
      };
    },
  );

  app.get(`${API_PREFIX}/me/assistant/threads/:id/events`, async (request) => {
    const actor = await ctx.requireUser(request);
    const thread = await owned(ctx.db, 'assistantThreads', params(request).id, actor.userId);
    const after = Number(query(request).after ?? 0);
    assert(Number.isInteger(after) && after >= 0, 'INVALID_AFTER', 'after 必须是非负整数', 400);
    const events = (await ctx.db.list('assistantEvents', { threadId: thread.id }))
      .filter((event) => event.seq > after)
      .sort((left, right) => left.seq - right.seq);
    const activeTurn = await findActiveTurn(ctx, thread.id);
    return {
      data: {
        events: assistantEventViews(events),
        activeTurn: activeTurn ? turnView(activeTurn) : null,
      },
    };
  });

  app.get(`${API_PREFIX}/me/assistant/threads/:id/stream`, async (request, reply) => {
    const actor = await ctx.requireUser(request);
    const thread = await owned(ctx.db, 'assistantThreads', params(request).id, actor.userId);
    const after = Number(query(request).after ?? 0);
    assert(Number.isInteger(after) && after >= 0, 'INVALID_AFTER', 'after 必须是非负整数', 400);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.setTimeout?.(0);
    let lastSeq = after;
    const listener = (frame: import('./service.js').AssistantStreamFrame): void => {
      if (frame.kind === 'event' && frame.event) {
        if (frame.event.seq <= lastSeq) return;
        lastSeq = frame.event.seq;
        sseWrite(
          reply,
          `event: ${frame.event.type}\nid: ${frame.event.seq}\ndata: ${JSON.stringify(frame.event)}\n\n`,
        );
        return;
      }
      if (frame.kind === 'text_delta' && frame.delta) {
        sseWrite(reply, `event: text_delta\ndata: ${JSON.stringify({ delta: frame.delta })}\n\n`);
      }
    };
    const unsubscribe = assistant.subscribe(thread.id, listener);
    const heartbeat = setInterval(() => sseWrite(reply, ': heartbeat\n\n'), 15000);
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', close);
    // 先订阅后回放：重叠事件按 seq 去重，断线期间落库的事件不会丢失。
    await assistant.replay(thread.id, lastSeq, listener);
  });

  app.post(`${API_PREFIX}/me/assistant/turns/:id/cancel`, async (request, reply) => {
    const actor = await ctx.requireUser(request);
    const cancelled = await assistant.cancelTurn(actor.userId, params(request).id);
    if (!cancelled) throw new AppError(409, 'TURN_NOT_ACTIVE', '该轮对话不在执行中');
    reply.code(202);
    return { data: { cancelled: true } };
  });

  app.get(`${API_PREFIX}/me/assistant/status`, async (request) => {
    await ctx.requireUser(request);
    const settings = await ctx.db.get('assistantSettings', 'global');
    let modelConfigured = false;
    if (settings?.defaultProviderModelId) {
      const model = await ctx.db.get('providerModels', settings.defaultProviderModelId);
      if (model?.enabled) {
        const connection = await ctx.db.get('modelConnections', model.connectionId);
        modelConfigured =
          Boolean(connection?.enabled) && model.verifiedConfigVersion === connection?.configVersion;
      }
    }
    const providers = await ctx.db.list('searchProviders', { enabled: true });
    const mcp = await ctx.db.list('mcpServers', { enabled: true });
    const skills = await ctx.db.list('assistantSkills', { enabled: true });
    return {
      data: {
        modelConfigured,
        searchEnabled: providers.length > 0,
        mcpEnabled: mcp.length > 0,
        customSkills: skills.length,
      },
    };
  });

  // ===== 管理员：搜索服务 =====
  app.get(`${API_PREFIX}/admin/search-providers`, async (request) => {
    await ctx.requireAdmin(request);
    const providers = await ctx.db.list('searchProviders', {});
    return { data: providers.map(searchProviderView) };
  });

  app.post(`${API_PREFIX}/admin/search-providers`, async (request, reply) => {
    const actor = await ctx.requireAdmin(request);
    const input = validateSearchProviderInput(body(request));
    const record: SearchProviderRecord = {
      ...baseRecord(),
      displayName: input.displayName,
      kind: input.kind,
      baseUrl: input.baseUrl,
      modelKey: input.modelKey,
      enabled: input.enabled,
      encryptedApiKey: input.apiKey ? ctx.vault.encrypt(input.apiKey) : '',
      testError: null,
    };
    await ctx.db.transaction(async (tx) => {
      await tx.insert('searchProviders', record);
      await ctx.audit(
        actor,
        'search-provider.create',
        'searchProvider',
        record.id,
        { kind: record.kind },
        tx,
      );
    });
    reply.code(201);
    return { data: searchProviderView(record) };
  });

  app.post(`${API_PREFIX}/admin/search-providers/test`, async (request) => {
    await ctx.requireAdmin(request);
    const input = validateSearchProviderInput(body(request));
    const candidate: SearchProviderRecord = {
      ...baseRecord(),
      displayName: input.displayName,
      kind: input.kind,
      baseUrl: input.baseUrl,
      modelKey: input.modelKey,
      enabled: true,
      encryptedApiKey: '',
      testError: null,
    };
    try {
      await testSearchProvider(candidate, input.apiKey, ctx.config.allowPrivateSearchUrls);
    } catch (error) {
      return { data: { ok: false, error: error instanceof AppError ? error.message : '连接失败' } };
    }
    return { data: { ok: true } };
  });

  app.patch(`${API_PREFIX}/admin/search-providers/:id`, async (request) => {
    const actor = await ctx.requireAdmin(request);
    const input = body(request);
    const revision = expectedRevision(input);
    const saved = await ctx.db.get('searchProviders', params(request).id);
    assert(saved, 'NOT_FOUND', '搜索服务不存在', 404);
    checkRevision(saved, revision);
    const updates: Partial<SearchProviderRecord> = {};
    if (input.displayName !== undefined)
      updates.displayName = requiredString(input, 'displayName', 200);
    if (input.baseUrl !== undefined || input.modelKey !== undefined || input.kind !== undefined) {
      const merged = validateSearchProviderInput({
        kind: input.kind ?? saved.kind,
        displayName: input.displayName ?? saved.displayName,
        baseUrl: input.baseUrl === null ? null : (input.baseUrl ?? saved.baseUrl),
        modelKey: input.modelKey ?? saved.modelKey ?? undefined,
        apiKey: input.apiKey ?? 'keep',
        enabled: input.enabled === undefined ? saved.enabled : input.enabled === true,
      });
      updates.kind = merged.kind;
      updates.baseUrl = merged.baseUrl;
      updates.modelKey = merged.modelKey;
      updates.enabled = merged.enabled;
    }
    if (input.enabled !== undefined) updates.enabled = input.enabled === true;
    if (typeof input.apiKey === 'string' && input.apiKey.trim())
      updates.encryptedApiKey = ctx.vault.encrypt(input.apiKey.trim());
    const updated = await ctx.db.update('searchProviders', saved.id, revision, updates);
    await ctx.audit(actor, 'search-provider.update', 'searchProvider', saved.id, {});
    return { data: searchProviderView(updated) };
  });

  app.delete(`${API_PREFIX}/admin/search-providers/:id`, async (request, reply) => {
    const actor = await ctx.requireAdmin(request);
    const saved = await ctx.db.get('searchProviders', params(request).id);
    assert(saved, 'NOT_FOUND', '搜索服务不存在', 404);
    await ctx.db.transaction(async (tx) => {
      await tx.delete('searchProviders', saved.id);
      await ctx.audit(actor, 'search-provider.delete', 'searchProvider', saved.id, {}, tx);
    });
    reply.code(204);
    return reply.send();
  });

  app.post(`${API_PREFIX}/admin/search-providers/:id/test`, async (request) => {
    await ctx.requireAdmin(request);
    const saved = await ctx.db.get('searchProviders', params(request).id);
    assert(saved, 'NOT_FOUND', '搜索服务不存在', 404);
    const apiKey = saved.encryptedApiKey ? ctx.vault.decrypt(saved.encryptedApiKey) : null;
    try {
      await runSearch({
        provider: saved,
        apiKey,
        query: 'connectivity check',
        maxResults: 2,
        allowPrivate: ctx.config.allowPrivateSearchUrls,
      });
    } catch (error) {
      const message = error instanceof AppError ? error.message : '连接失败';
      await ctx.db.update('searchProviders', saved.id, saved.revision, { testError: message });
      return { data: { ok: false, error: message } };
    }
    if (saved.testError)
      await ctx.db.update('searchProviders', saved.id, saved.revision, { testError: null });
    return { data: { ok: true } };
  });

  // ===== 管理员：MCP 服务器 =====
  function validateMcpServerInput(raw: JsonObject) {
    const name = requiredString(raw, 'name', 64);
    assert(
      /^[a-zA-Z0-9_-]+$/.test(name),
      'INVALID_MCP_NAME',
      'MCP 名称只能包含字母、数字、_ 和 -',
      422,
    );
    const transport = raw.transport;
    assert(
      transport === 'stdio' || transport === 'http',
      'INVALID_MCP_TRANSPORT',
      'transport 必须是 stdio 或 http',
    );
    const timeoutSeconds =
      raw.timeoutSeconds === undefined
        ? 60
        : positiveInteger(raw.timeoutSeconds, 'timeoutSeconds', 600);
    const exposure = raw.exposure === 'deferred' ? 'deferred' : 'direct';
    const env = raw.env === undefined || raw.env === null ? null : raw.env;
    const headers = raw.headers === undefined || raw.headers === null ? null : raw.headers;
    if (env !== null)
      assert(typeof env === 'object' && !Array.isArray(env), 'INVALID_ENV', 'env 必须是对象');
    if (headers !== null)
      assert(
        typeof headers === 'object' && !Array.isArray(headers),
        'INVALID_HEADERS',
        'headers 必须是对象',
      );
    for (const map of [env, headers]) {
      if (!map) continue;
      for (const [key, value] of Object.entries(map as JsonObject)) {
        assert(/^[\w-]{1,64}$/.test(key), 'INVALID_MCP_CONFIG', '配置键名无效', 422);
        assert(
          typeof value === 'string' && value.length <= 4000,
          'INVALID_MCP_CONFIG',
          '配置值无效',
          422,
        );
      }
    }
    const command = raw.command === undefined || raw.command === null ? null : String(raw.command);
    const args = Array.isArray(raw.args) ? raw.args.map(String) : [];
    const url = raw.url === undefined || raw.url === null ? null : String(raw.url);
    if (transport === 'stdio') {
      assert(
        command && /^[\w./:\\-]{1,256}$/.test(command),
        'INVALID_COMMAND',
        'stdio 服务器必须提供可执行命令',
        422,
      );
      assert(args.length <= 32, 'INVALID_ARGS', '参数过多', 422);
    } else {
      assert(typeof url === 'string', 'INVALID_URL', 'http 服务器必须提供 url', 422);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new AppError(422, 'INVALID_URL', 'url 必须是合法地址');
      }
      assert(
        parsed.protocol === 'http:' || parsed.protocol === 'https:',
        'INVALID_URL',
        'url 只允许 HTTP 或 HTTPS',
        422,
      );
      try {
        assertProviderHost(parsed, ctx.config.allowPrivateSearchUrls);
      } catch {
        throw new AppError(403, 'SEARCH_ADDRESS_FORBIDDEN', 'MCP 服务器地址被拒绝');
      }
    }
    return {
      name,
      transport: transport as 'stdio' | 'http',
      command,
      args,
      url,
      env: env as JsonObject | null,
      headers: headers as JsonObject | null,
      timeoutSeconds,
      exposure: exposure as 'direct' | 'deferred',
      enabled: raw.enabled === true,
    };
  }

  app.get(`${API_PREFIX}/admin/mcp-servers`, async (request) => {
    await ctx.requireAdmin(request);
    return { data: (await ctx.db.list('mcpServers', {})).map(mcpServerView) };
  });

  app.post(`${API_PREFIX}/admin/mcp-servers`, async (request, reply) => {
    const actor = await ctx.requireAdmin(request);
    const input = validateMcpServerInput(body(request));
    const existing = await ctx.db.list('mcpServers', {});
    assert(
      !existing.some((server) => server.name === input.name),
      'MCP_NAME_TAKEN',
      '同名 MCP 服务器已存在',
      409,
    );
    const record: McpServerRecord = {
      ...baseRecord(),
      name: input.name,
      transport: input.transport,
      command: input.command,
      args: input.args,
      url: input.url,
      encryptedEnv: input.env ? ctx.vault.encryptJson(input.env) : null,
      encryptedHeaders: input.headers ? ctx.vault.encryptJson(input.headers) : null,
      timeoutSeconds: input.timeoutSeconds,
      exposure: input.exposure,
      enabled: input.enabled,
      testError: null,
    };
    await ctx.db.transaction(async (tx) => {
      await tx.insert('mcpServers', record);
      await ctx.audit(
        actor,
        'mcp-server.create',
        'mcpServer',
        record.id,
        { transport: record.transport, enabled: record.enabled },
        tx,
      );
    });
    reply.code(201);
    return { data: mcpServerView(record) };
  });

  app.patch(`${API_PREFIX}/admin/mcp-servers/:id`, async (request) => {
    const actor = await ctx.requireAdmin(request);
    const input = body(request);
    const revision = expectedRevision(input);
    const saved = await ctx.db.get('mcpServers', params(request).id);
    assert(saved, 'NOT_FOUND', 'MCP 服务器不存在', 404);
    checkRevision(saved, revision);
    const updates: Partial<McpServerRecord> = {};
    if (input.enabled !== undefined) updates.enabled = input.enabled === true;
    if (input.timeoutSeconds !== undefined)
      updates.timeoutSeconds = positiveInteger(input.timeoutSeconds, 'timeoutSeconds', 600);
    if (input.exposure !== undefined)
      updates.exposure = input.exposure === 'deferred' ? 'deferred' : 'direct';
    if (input.args !== undefined && Array.isArray(input.args))
      updates.args = input.args.map(String).slice(0, 32);
    if (input.command !== undefined)
      updates.command = input.command === null ? null : String(input.command);
    if (input.url !== undefined) {
      updates.url = input.url === null ? null : String(input.url);
      if (updates.url) assertProviderHost(new URL(updates.url), ctx.config.allowPrivateSearchUrls);
    }
    if (typeof input.env === 'object' && input.env !== null)
      updates.encryptedEnv = ctx.vault.encryptJson(input.env);
    if (input.env === null) updates.encryptedEnv = null;
    if (typeof input.headers === 'object' && input.headers !== null)
      updates.encryptedHeaders = ctx.vault.encryptJson(input.headers);
    if (input.headers === null) updates.encryptedHeaders = null;
    const updated = await ctx.db.update('mcpServers', saved.id, revision, updates);
    await ctx.audit(actor, 'mcp-server.update', 'mcpServer', saved.id, {
      enabled: updated.enabled,
    });
    return { data: mcpServerView(updated) };
  });

  app.delete(`${API_PREFIX}/admin/mcp-servers/:id`, async (request, reply) => {
    const actor = await ctx.requireAdmin(request);
    const saved = await ctx.db.get('mcpServers', params(request).id);
    assert(saved, 'NOT_FOUND', 'MCP 服务器不存在', 404);
    await ctx.db.transaction(async (tx) => {
      await tx.delete('mcpServers', saved.id);
      await ctx.audit(actor, 'mcp-server.delete', 'mcpServer', saved.id, {}, tx);
    });
    reply.code(204);
    return reply.send();
  });

  // ===== 管理员：助手 Skills =====
  app.get(`${API_PREFIX}/admin/assistant-skills`, async (request) => {
    await ctx.requireAdmin(request);
    const skills = await ctx.db.list('assistantSkills', {});
    return { data: skills.map(({ content: _content, ...view }) => view) };
  });

  app.post(`${API_PREFIX}/admin/assistant-skills`, async (request, reply) => {
    const actor = await ctx.requireAdmin(request);
    const input = body(request);
    const name = requiredString(input, 'name', 64);
    assert(
      /^[a-z0-9][a-z0-9-]*$/.test(name),
      'INVALID_SKILL_NAME',
      'skill 名称只能包含小写字母、数字和连字符',
      422,
    );
    const description = requiredString(input, 'description', 1024);
    const content = requiredString(input, 'content', 100000);
    const existing = await ctx.db.list('assistantSkills', {});
    assert(
      !existing.some((skill) => skill.name === name),
      'SKILL_NAME_TAKEN',
      '同名 skill 已存在',
      409,
    );
    const record = {
      ...baseRecord(),
      name,
      description,
      content,
      enabled: input.enabled === undefined ? true : input.enabled === true,
    };
    await ctx.db.transaction(async (tx) => {
      await tx.insert('assistantSkills', record);
      await ctx.audit(actor, 'assistant-skill.create', 'assistantSkill', record.id, { name }, tx);
    });
    reply.code(201);
    const { content: _content, ...view } = record;
    return { data: view };
  });

  app.get(`${API_PREFIX}/admin/assistant-skills/:id`, async (request) => {
    await ctx.requireAdmin(request);
    const saved = await ctx.db.get('assistantSkills', params(request).id);
    assert(saved, 'NOT_FOUND', 'skill 不存在', 404);
    return { data: saved };
  });

  app.patch(`${API_PREFIX}/admin/assistant-skills/:id`, async (request) => {
    const actor = await ctx.requireAdmin(request);
    const input = body(request);
    const revision = expectedRevision(input);
    const saved = await ctx.db.get('assistantSkills', params(request).id);
    assert(saved, 'NOT_FOUND', 'skill 不存在', 404);
    checkRevision(saved, revision);
    const updated = await ctx.db.update('assistantSkills', saved.id, revision, {
      description:
        input.description === undefined
          ? saved.description
          : requiredString(input, 'description', 1024),
      content:
        input.content === undefined ? saved.content : requiredString(input, 'content', 100000),
      enabled: input.enabled === undefined ? saved.enabled : input.enabled === true,
    });
    await ctx.audit(actor, 'assistant-skill.update', 'assistantSkill', saved.id, {
      name: saved.name,
    });
    const { content: _content, ...view } = updated;
    return { data: view };
  });

  app.delete(`${API_PREFIX}/admin/assistant-skills/:id`, async (request, reply) => {
    const actor = await ctx.requireAdmin(request);
    const saved = await ctx.db.get('assistantSkills', params(request).id);
    assert(saved, 'NOT_FOUND', 'skill 不存在', 404);
    await ctx.db.transaction(async (tx) => {
      await tx.delete('assistantSkills', saved.id);
      await ctx.audit(
        actor,
        'assistant-skill.delete',
        'assistantSkill',
        saved.id,
        { name: saved.name },
        tx,
      );
    });
    reply.code(204);
    return reply.send();
  });

  // ===== 管理员：助手设置 =====
  async function ensureAssistantSettings() {
    let settings = await ctx.db.get('assistantSettings', 'global');
    if (!settings) {
      settings = {
        ...baseRecord(),
        id: 'global',
        defaultProviderModelId: null,
        maxSearchResults: 5,
        maxConcurrency: 1,
        turnTimeoutMs: 600000,
      };
      await ctx.db.insert('assistantSettings', settings);
    }
    return settings;
  }

  app.get(`${API_PREFIX}/admin/assistant-settings`, async (request) => {
    await ctx.requireAdmin(request);
    return { data: await ensureAssistantSettings() };
  });

  app.patch(`${API_PREFIX}/admin/assistant-settings`, async (request) => {
    const actor = await ctx.requireAdmin(request);
    const input = body(request);
    const revision = expectedRevision(input);
    const saved = await ensureAssistantSettings();
    checkRevision(saved, revision);
    const updates: Partial<typeof saved> = {};
    if (input.defaultProviderModelId !== undefined) {
      if (input.defaultProviderModelId === null) {
        updates.defaultProviderModelId = null;
      } else {
        const model = await ctx.db.get('providerModels', String(input.defaultProviderModelId));
        assert(model && model.enabled, 'INVALID_MODEL', '模型不存在或未启用', 422);
        const connection = await ctx.db.get('modelConnections', model.connectionId);
        assert(connection?.enabled, 'INVALID_MODEL', '模型所属连接未启用', 422);
        assert(
          model.verifiedConfigVersion === connection.configVersion,
          'ASSISTANT_MODEL_STALE',
          '模型需要先通过当前连接版本的测试',
          409,
        );
        updates.defaultProviderModelId = model.id;
      }
    }
    if (input.maxSearchResults !== undefined)
      updates.maxSearchResults = positiveInteger(input.maxSearchResults, 'maxSearchResults', 10);
    if (input.maxConcurrency !== undefined)
      updates.maxConcurrency = positiveInteger(input.maxConcurrency, 'maxConcurrency', 4);
    if (input.turnTimeoutMs !== undefined)
      updates.turnTimeoutMs = positiveInteger(input.turnTimeoutMs, 'turnTimeoutMs', 900000);
    const updated = await ctx.db.update('assistantSettings', saved.id, revision, updates);
    await ctx.audit(actor, 'assistant-settings.update', 'assistantSettings', 'global', {});
    assistant.invalidateRuntime();
    return { data: updated };
  });
}
