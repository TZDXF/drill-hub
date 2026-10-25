import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_VERSION, APP_VERSION } from '@drill-hub/contracts';
import { Database } from './db/database.js';
import { loadConfig } from './core/config.js';
import { SecretVault } from './core/security.js';
import { AppError } from './core/errors.js';
import { normalizePublicBaseUrl, resolvePublicUrl } from './core/public-url.js';
import { baseRecord, id, now } from './core/ids.js';
import type { AppContext, ServerConfig } from './core/context.js';
import { createAuthFunctions, createUser, registerAuthRoutes } from './modules/auth/index.js';
import { registerLearningRoutes, expireAttempts } from './modules/learning/index.js';
import { registerAccessLogging, registerAuditRoutes } from './modules/audit/index.js';
import { createGradingService, registerGradingRoutes } from './modules/grading/index.js';
import { createAssistantService, registerAssistantRoutes } from './modules/assistant/index.js';
declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
export interface CreateAppOptions extends Partial<ServerConfig> {
  startWorkers?: boolean;
  logger?: boolean;
  bootstrapAdmin?: { username: string; password: string; displayName?: string };
}
export async function createApp(options: CreateAppOptions = {}) {
  const config = await loadConfig(options);
  config.publicUrl = config.publicUrl?.trim()
    ? normalizePublicBaseUrl(config.publicUrl)
    : undefined;
  const db = await Database.open({
    driver: config.databaseDriver,
    database: config.databasePath,
    url: config.databaseUrl,
  });
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 30000,
    trustProxy: config.trustedProxies.length ? config.trustedProxies : false,
    requestIdHeader: false,
    genReqId: id,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 1200, timeWindow: '1 minute' });
  await app.register(cors, {
    credentials: true,
    origin: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Answer-Link-Token'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  let settings = await db.get('settings', 'global');
  if (!settings)
    settings = await db.insert('settings', {
      ...baseRecord(),
      id: 'global',
      instanceId: id(),
      displayName: 'Drill Hub 学习工作台',
      defaultGradingProfileId: null,
    });
  const auth = createAuthFunctions(db, config);
  const ctx: AppContext = {
    db,
    config,
    vault: new SecretVault(config.encryptionKey),
    ...auth,
    grading: undefined as unknown as AppContext['grading'],
    assistant: undefined as unknown as AppContext['assistant'],
    async audit(actor, action, resourceType, resourceId, summary = {}, database = db) {
      await database.insert('auditLogs', {
        ...baseRecord(),
        ownerId: actor.userId,
        actorId: actor.id,
        action,
        resourceType,
        resourceId,
        summary,
      });
    },
  };
  ctx.grading = createGradingService(ctx);
  const assistant = createAssistantService(ctx, app);
  ctx.assistant = assistant;
  app.decorate('ctx', ctx);
  registerAccessLogging(app, ctx);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
        meta: { requestId: request.id, serverTime: now() },
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    const code = (error as { code?: string }).code;
    if (status && status >= 400 && status < 500)
      return reply.code(status).send({
        error: {
          code: code ?? 'INVALID_REQUEST',
          message: status === 429 ? '请求过于频繁，请稍后重试' : '请求格式不正确',
        },
        meta: { requestId: request.id, serverTime: now() },
      });
    app.log.error(
      { requestId: request.id, errorType: error instanceof Error ? error.name : 'Unknown' },
      '请求处理失败',
    );
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' },
      meta: { requestId: request.id, serverTime: now() },
    });
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (
      typeof payload === 'string' &&
      String(reply.getHeader('content-type') ?? '').includes('application/json')
    ) {
      try {
        const result = JSON.parse(payload) as Record<string, unknown>;
        if (result && typeof result === 'object' && ('data' in result || 'error' in result)) {
          result.meta = { requestId: request.id, serverTime: now() };
          return JSON.stringify(result);
        }
      } catch {}
    }
    return payload;
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.get('/api/v1/health', async () => ({ data: { status: 'ok', version: APP_VERSION } }));
  app.get('/api/v1/server-info', async (request) => {
    const current = (await db.get('settings', 'global'))!;
    return {
      data: {
        service: 'drill-hub',
        ...resolvePublicUrl(request, config.publicUrl),
        instanceId: current.instanceId,
        displayName: current.displayName,
        apiMajor: API_VERSION,
        minClientVersion: APP_VERSION,
        capabilities: [
          'model_rubric_grading',
          'android_login',
          'external_rubric',
          'temporary_answer_links',
          'built_in_assistant',
        ],
      },
    };
  });
  registerAuditRoutes(app, ctx);
  await registerAuthRoutes(app, ctx);
  await registerLearningRoutes(app, ctx);
  await registerGradingRoutes(app, ctx);
  registerAssistantRoutes(app, ctx, assistant);
  const bootstrap =
    options.bootstrapAdmin ??
    (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD
      ? { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }
      : undefined);
  if (bootstrap && (await db.list('users')).length === 0)
    await createUser(db, { ...bootstrap, role: 'admin' });
  const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.woff2': 'font/woff2',
  };
  const limitApiNotFound = app.rateLimit();
  app.setNotFoundHandler(
    {
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        if (request.url.startsWith('/api/')) await limitApiNotFound.call(app, request, reply);
      },
    },
    async (request, reply) => {
      const pathname = new URL(request.raw.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && !pathname.startsWith('/api/')) {
        try {
          const decoded = decodeURIComponent(pathname);
          const target = resolve(webDist, '.' + decoded);
          if (
            (target === resolve(webDist) || target.startsWith(resolve(webDist) + sep)) &&
            !decoded.includes('\\') &&
            !decoded.includes('\0')
          ) {
            const candidate = extname(target) ? target : resolve(webDist, 'index.html');
            const info = await stat(candidate);
            if (info.isFile()) {
              const extension = extname(candidate);
              if (extension === '.zip') reply.header('Content-Disposition', 'attachment');
              return reply
                .type(mime[extension] ?? 'application/octet-stream')
                .send(await readFile(candidate));
            }
          }
        } catch {}
      }
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '页面或接口不存在' } });
    },
  );
  await db.pruneAccessLogs(config.accessLogRetentionDays);
  const logRetentionTimer = setInterval(() => {
    void db
      .pruneAccessLogs(config.accessLogRetentionDays)
      .catch(() => app.log.error('访问日志清理失败'));
  }, 3600000);
  logRetentionTimer.unref();
  let expirationTimer: ReturnType<typeof setInterval> | undefined;
  if (options.startWorkers !== false) {
    ctx.grading.start();
    await ctx.assistant.start();
    expirationTimer = setInterval(() => {
      void expireAttempts(ctx).catch(() => app.log.error('考试到期结算失败'));
    }, 5000);
    expirationTimer.unref();
    await expireAttempts(ctx);
  }
  app.addHook('onClose', async () => {
    clearInterval(logRetentionTimer);
    if (expirationTimer) clearInterval(expirationTimer);
    ctx.grading.stop();
    ctx.assistant.stop();
    await db.close();
  });
  return app;
}
