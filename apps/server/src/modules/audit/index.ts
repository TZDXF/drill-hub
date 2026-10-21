import type { FastifyInstance } from 'fastify';
import type { LogFilters } from '@drill-hub/contracts';
import type { Actor, AppContext } from '../../core/context.js';
import { AppError } from '../../core/errors.js';
import { baseRecord } from '../../core/ids.js';

declare module 'fastify' {
  interface FastifyRequest {
    auditActor: Actor | null;
    loginAccount: { userId: string; username: string } | null;
    auditErrorCode: string | null;
  }
}

const loginRoutes = new Map<string, 'web' | 'mobile'>([
  ['/api/v1/auth/web/login', 'web'],
  ['/api/v1/auth/mobile/login', 'mobile'],
]);

/** 仅保存白名单元数据，绝不保存原始 URL、请求/响应正文或请求头。 */
export function registerAccessLogging(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('auditActor', null);
  app.decorateRequest('loginAccount', null);
  app.decorateRequest('auditErrorCode', null);
  app.addHook('onSend', async (request, reply, payload) => {
    if (
      reply.statusCode >= 400 &&
      typeof payload === 'string' &&
      String(reply.getHeader('content-type') ?? '').includes('application/json')
    ) {
      try {
        const code: unknown = JSON.parse(payload)?.error?.code;
        if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)) {
          request.auditErrorCode = code;
        }
      } catch {
        /* 非应用 JSON 错误响应不解析。 */
      }
    }
    return payload;
  });
  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const route = request.routeOptions.url?.startsWith('/api/')
      ? request.routeOptions.url
      : '/api/[unmatched]';
    const actor = request.auditActor;
    // Anonymous scans and rejected floods must not amplify persistent writes.
    if (
      !actor &&
      (route === '/api/[unmatched]' ||
        reply.statusCode === 429 ||
        reply.statusCode === 403 ||
        request.method === 'OPTIONS')
    )
      return;
    const channel = request.method === 'POST' ? loginRoutes.get(route) : undefined;
    try {
      await ctx.db.transaction(async (db) => {
        await db.insert('apiLogs', {
          ...baseRecord(),
          requestId: request.id,
          ownerId: actor?.userId ?? null,
          actorId: actor?.id ?? null,
          channel: actor?.channel ?? channel ?? 'anonymous',
          method: request.method,
          route,
          statusCode: reply.statusCode,
          durationMs: Math.max(0, Math.round(reply.elapsedTime)),
          ip: request.ip,
          errorCode: request.auditErrorCode,
        });
        if (channel) {
          await db.insert('loginLogs', {
            ...baseRecord(),
            requestId: request.id,
            ownerId: request.loginAccount?.userId ?? null,
            // 不回显未匹配的登录输入，避免任意文本或误填的密码进入日志。
            username: request.loginAccount?.username ?? null,
            channel,
            outcome: reply.statusCode < 400 ? 'succeeded' : 'failed',
            statusCode: reply.statusCode,
            ip: request.ip,
            errorCode: request.auditErrorCode,
          });
        }
      });
    } catch {
      // 响应已经发出；不暴露底层数据库错误，也不把日志故障伪装成业务失败。
      app.log.error({ requestId: request.id }, '访问日志写入失败');
    }
  });
}

function invalid(): never {
  throw new AppError(422, 'INVALID_LOG_FILTER', '日志筛选条件不正确');
}
function filters(value: unknown, kind: 'audit' | 'api' | 'login'): LogFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const query = value as Record<string, unknown>;
  const allowed = [
    'page',
    'pageSize',
    'q',
    'from',
    'until',
    ...(kind !== 'audit' ? ['channel', 'statusCode'] : []),
    ...(kind === 'api' ? ['method'] : []),
    ...(kind === 'login' ? ['outcome'] : []),
  ];
  if (Object.keys(query).some((key) => !allowed.includes(key))) invalid();
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = query[key];
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) invalid();
    const number = Number(raw);
    if (!Number.isSafeInteger(number) || number < min || number > max) invalid();
    return number;
  };
  const result: LogFilters = {
    page: integer('page', 1, 1, 1_000_000),
    pageSize: integer('pageSize', 20, 1, 100),
  };
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.length > 200) invalid();
    result.q = query.q.trim();
  }
  for (const key of ['from', 'until'] as const) {
    const raw = query[key];
    if (raw !== undefined) {
      if (
        typeof raw !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(raw) ||
        !Number.isFinite(Date.parse(raw))
      )
        invalid();
      const [year, month, day, hour, minute, second] = raw.slice(0, 19).split(/[-T:]/).map(Number);
      const maxDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
      if (
        month! < 1 ||
        month! > 12 ||
        day! < 1 ||
        day! > maxDay ||
        hour! > 23 ||
        minute! > 59 ||
        second! > 59
      )
        invalid();
      result[key] = new Date(raw).toISOString();
    }
  }
  if (result.from && result.until && result.from >= result.until) invalid();
  const choice = (key: string, options: string[]) => {
    const raw = query[key];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || !options.includes(raw)) invalid();
    return raw;
  };
  result.channel = choice(
    'channel',
    kind === 'login' ? ['web', 'mobile'] : ['web', 'mobile', 'agent', 'public', 'anonymous'],
  ) as LogFilters['channel'];
  result.method = choice('method', ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
  result.outcome = choice('outcome', ['succeeded', 'failed']) as LogFilters['outcome'];
  if (query.statusCode !== undefined) result.statusCode = integer('statusCode', 200, 100, 599);
  return result;
}

export function registerAuditRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/admin/audit-logs', async (request) => {
    await ctx.requireAdmin(request);
    return { data: await ctx.db.queryLogs('auditLogs', filters(request.query, 'audit')) };
  });
  app.get('/api/v1/admin/api-logs', async (request) => {
    await ctx.requireAdmin(request);
    return { data: await ctx.db.queryLogs('apiLogs', filters(request.query, 'api')) };
  });
  app.get('/api/v1/admin/login-logs', async (request) => {
    await ctx.requireAdmin(request);
    return { data: await ctx.db.queryLogs('loginLogs', filters(request.query, 'login')) };
  });
}
