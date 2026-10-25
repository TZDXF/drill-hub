import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AGENT_SCOPES } from '@drill-hub/contracts';
import type { Role, Scope, UserView } from '@drill-hub/contracts';
import type { Actor, AppContext, ServerConfig } from '../../core/context.js';
import type { Database } from '../../db/database.js';
import type { AgentTokenRecord, UserRecord } from '../../db/records.js';
import { AppError } from '../../core/errors.js';
import { baseRecord, id, now } from '../../core/ids.js';
import {
  hashSecret,
  passwordHash,
  randomSecret,
  sameSecret,
  validatePassword,
  verifyPassword,
} from '../../core/security.js';
import { object, revision, text } from '../../core/validation.js';
import { INTERNAL_TOKEN_PREFIX, verifyInternalToken } from '../../core/internal-auth.js';
const COOKIE = 'dh_session';
const dummyPassword = passwordHash(randomSecret());
const csrf = (config: ServerConfig, sessionId: string) =>
  createHmac('sha256', Buffer.from(config.encryptionKey, 'hex'))
    .update('csrf:' + sessionId)
    .digest('base64url');
export function userView(user: UserRecord): UserView {
  const { passwordHash: _secret, ...view } = user;
  return view;
}
function agentTokenView(token: AgentTokenRecord) {
  const { secretHash: _hash, encryptedSecret: _secret, ownerId: _owner, ...view } = token;
  return view;
}
function agentTokenScopes(value: unknown): Scope[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > AGENT_SCOPES.length ||
    value.some((scope) => !AGENT_SCOPES.includes(scope as Scope)) ||
    new Set(value).size !== value.length
  )
    throw new AppError(422, 'INVALID_SCOPES', '请选择有效且不重复的令牌权限');
  return value as Scope[];
}
async function activeUser(db: Database, userId: string) {
  const user = await db.get('users', userId);
  if (!user || user.status !== 'active')
    throw new AppError(401, 'ACCOUNT_UNAVAILABLE', '账号不可用，请重新登录');
  return user;
}
export function createAuthFunctions(
  db: Database,
  config: ServerConfig,
): Pick<AppContext, 'requireUser' | 'requireAdmin' | 'requireAgent'> {
  /**
   * 助手内部令牌（dhi. 前缀）：服务端在同进程内为 drill_hub_api 工具签发，
   * 以发起用户身份执行端点。HMAC 签名无法伪造，短 TTL 且绑定单一 turn。
   */
  function internalActor(request: FastifyRequest): { actor: Actor } | null {
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (!bearer.startsWith(INTERNAL_TOKEN_PREFIX)) return null;
    const verified = verifyInternalToken(bearer, config.encryptionKey);
    if (!verified) throw new AppError(401, 'INVALID_SESSION', '内部凭证无效或已过期');
    return {
      actor: {
        id: `assistant:${verified.turnId}`,
        userId: verified.userId,
        role: verified.role,
        channel: 'mobile',
        scopes: [],
        assistantTurnId: verified.turnId,
      },
    };
  }

  async function requireUser(request: FastifyRequest): Promise<Actor> {
    const internal = internalActor(request);
    if (internal) {
      const user = await activeUser(db, internal.actor.userId);
      request.auditActor = internal.actor;
      return { ...internal.actor, role: user.role };
    }
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const raw = bearer ?? request.cookies[COOKIE];
    if (!raw) throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
    if (bearer && !bearer.startsWith('mob.'))
      throw new AppError(401, 'INVALID_SESSION', '此接口需要用户登录会话');
    const session = await db.findOne('sessions', { secretHash: hashSecret(raw) });
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now())
      throw new AppError(401, 'SESSION_EXPIRED', '登录已过期，请重新登录');
    if ((bearer && session.channel !== 'mobile') || (!bearer && session.channel !== 'web'))
      throw new AppError(401, 'INVALID_SESSION', '登录会话无效');
    const user = await activeUser(db, session.userId);
    request.auditActor = {
      id: session.id,
      userId: user.id,
      role: user.role,
      channel: session.channel,
      scopes: [],
      sessionId: session.id,
    };
    if (session.channel === 'web' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const token = request.headers['x-csrf-token'];
      if (typeof token !== 'string' || !session.csrfHash || !sameSecret(token, session.csrfHash))
        throw new AppError(403, 'CSRF_REQUIRED', '安全校验失败，请刷新页面后重试');
    }
    return {
      id: session.id,
      userId: user.id,
      role: user.role,
      channel: session.channel,
      scopes: [],
      sessionId: session.id,
    };
  }
  async function requireAdmin(request: FastifyRequest) {
    const actor = await requireUser(request);
    // 内部令牌即使是管理员用户发起，也不获得管理端点权限。
    if (actor.assistantTurnId) throw new AppError(403, 'ADMIN_REQUIRED', '此操作仅管理员可用');
    if (actor.role !== 'admin') throw new AppError(403, 'ADMIN_REQUIRED', '此操作仅管理员可用');
    return actor;
  }
  async function requireAgent(request: FastifyRequest, scope: Scope = 'read'): Promise<Actor> {
    const internal = internalActor(request);
    if (internal) {
      const user = await activeUser(db, internal.actor.userId);
      const actor: Actor = {
        ...internal.actor,
        role: user.role,
        channel: 'agent',
        scopes: [...AGENT_SCOPES],
      };
      request.auditActor = actor;
      return actor;
    }
    const header = request.headers.authorization;
    const raw = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (!raw.startsWith('dhk.'))
      throw new AppError(401, 'AGENT_TOKEN_REQUIRED', '需要 Agent 访问令牌');
    const token = await db.findOne('agentTokens', { secretHash: hashSecret(raw) });
    if (!token || (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()))
      throw new AppError(401, 'AGENT_TOKEN_INVALID', 'Agent 令牌无效或已撤销');
    const user = await activeUser(db, token.ownerId);
    request.auditActor = {
      id: token.id,
      userId: user.id,
      role: user.role,
      channel: 'agent',
      scopes: token.scopes,
      tokenId: token.id,
    };
    if (!token.scopes.includes(scope))
      throw new AppError(403, 'SCOPE_REQUIRED', '令牌缺少权限：' + scope);
    if (!token.lastUsedAt || Date.now() - Date.parse(token.lastUsedAt) > 60000)
      try {
        await db.update('agentTokens', token.id, token.revision, { lastUsedAt: now() });
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'VERSION_CONFLICT')) throw error;
      }
    return {
      id: token.id,
      userId: user.id,
      role: user.role,
      channel: 'agent',
      scopes: token.scopes,
      tokenId: token.id,
    };
  }
  return { requireUser, requireAdmin, requireAgent };
}
export async function createUser(
  db: Database,
  input: {
    username: string;
    password: string;
    displayName?: string;
    role?: Role;
    mustChangePassword?: boolean;
  },
) {
  const username = text(input.username, '用户名', 64, 3);
  if (!/^[\p{L}\p{N}_.-]+$/u.test(username))
    throw new AppError(422, 'INVALID_USERNAME', '用户名只能包含文字、数字、下划线、点和连字符');
  validatePassword(input.password);
  return db.transaction(async (tx) => {
    if (await tx.findOne('users', { username }))
      throw new AppError(409, 'USERNAME_TAKEN', '用户名已存在');
    return tx.insert('users', {
      ...baseRecord(),
      username,
      displayName: input.displayName?.trim() || username,
      passwordHash: passwordHash(input.password),
      role: input.role ?? 'user',
      status: 'active',
      mustChangePassword: input.mustChangePassword ?? false,
    });
  });
}
async function revokeUserCredentials(db: Database, userId: string) {
  for (const session of await db.list('sessions', { userId }))
    if (!session.revokedAt)
      await db.update('sessions', session.id, session.revision, { revokedAt: now() });
  for (const token of await db.list('agentTokens', { ownerId: userId }))
    await db.delete('agentTokens', token.id);
}
function cookie(reply: FastifyReply, request: FastifyRequest, raw: string, config: ServerConfig) {
  const publicProtocol = config.publicUrl ? new URL(config.publicUrl).protocol : null;
  reply.setCookie(COOKIE, raw, {
    httpOnly: true,
    secure: request.protocol === 'https' || publicProtocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
}
export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  async function login(request: FastifyRequest, reply: FastifyReply, channel: 'web' | 'mobile') {
    const body = object(request.body);
    const username = text(body.username, '用户名', 64, 3);
    const password = typeof body.password === 'string' ? body.password : '';
    const user = await db.findOne('users', { username });
    request.loginAccount = user ? { userId: user.id, username: user.username } : null;
    const valid = verifyPassword(password, user?.passwordHash ?? dummyPassword);
    if (!valid || !user || user.status !== 'active')
      throw new AppError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
    const sessionId = id();
    const raw = (channel === 'web' ? 'web.' : 'mob.') + sessionId + '.' + randomSecret();
    const refreshToken = channel === 'mobile' ? 'ref.' + sessionId + '.' + randomSecret() : null;
    const csrfToken = channel === 'web' ? csrf(config, sessionId) : null;
    await db.insert('sessions', {
      ...baseRecord(),
      id: sessionId,
      userId: user.id,
      channel,
      secretHash: hashSecret(raw),
      refreshHash: refreshToken ? hashSecret(refreshToken) : null,
      usedRefreshHashes: [],
      csrfHash: csrfToken ? hashSecret(csrfToken) : null,
      expiresAt: new Date(
        Date.now() + (channel === 'web' ? 12 * 3600000 : 15 * 60000),
      ).toISOString(),
      refreshExpiresAt:
        channel === 'mobile' ? new Date(Date.now() + 30 * 86400000).toISOString() : null,
      revokedAt: null,
    });
    request.auditActor = {
      id: sessionId,
      userId: user.id,
      role: user.role,
      channel,
      scopes: [],
      sessionId,
    };
    if (channel === 'web') {
      cookie(reply, request, raw, config);
      return { data: { user: userView(user), csrfToken } };
    }
    return { data: { user: userView(user), accessToken: raw, refreshToken } };
  }
  const loginRateLimitMax = Number(process.env.E2E_LOGIN_RATE_LIMIT_MAX ?? 10);
  const loginFloodLimit = app.createRateLimit();
  const limitLoginFlood = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await loginFloodLimit(request);
    if (!result.isAllowed && result.isExceeded) {
      reply.header('Retry-After', result.ttlInSeconds);
      throw new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
    }
  };
  const loginRateLimit = {
    max: loginRateLimitMax,
    timeWindow: '1 minute',
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) => {
      const raw = request.body as Record<string, unknown> | null;
      const username = typeof raw?.username === 'string' ? raw.username.trim().slice(0, 64) : '';
      return JSON.stringify([request.ip, username]);
    },
  };
  app.post(
    '/api/v1/auth/web/login',
    { onRequest: limitLoginFlood, config: { rateLimit: loginRateLimit } },
    (req, reply) => login(req, reply, 'web'),
  );
  app.post(
    '/api/v1/auth/mobile/login',
    { onRequest: limitLoginFlood, config: { rateLimit: loginRateLimit } },
    (req, reply) => login(req, reply, 'mobile'),
  );
  app.post('/api/v1/auth/mobile/refresh', async (request) => {
    const body = object(request.body);
    const raw = text(body.refreshToken, '刷新凭据', 1000);
    const parts = raw.split('.');
    if (parts.length !== 3 || parts[0] !== 'ref')
      throw new AppError(401, 'INVALID_REFRESH', '刷新凭据无效');
    const result = await db.transaction(async (tx) => {
      const session = await tx.get('sessions', parts[1]!);
      if (
        !session ||
        session.channel !== 'mobile' ||
        session.revokedAt ||
        !session.refreshHash ||
        !session.refreshExpiresAt ||
        Date.parse(session.refreshExpiresAt) <= Date.now()
      )
        return { error: 'INVALID_REFRESH' };
      const user = await activeUser(tx, session.userId);
      if (!sameSecret(raw, session.refreshHash)) {
        if (session.usedRefreshHashes.includes(hashSecret(raw)))
          await tx.update('sessions', session.id, session.revision, { revokedAt: now() });
        return { error: 'INVALID_REFRESH' };
      }
      const accessToken = 'mob.' + session.id + '.' + randomSecret();
      const refreshToken = 'ref.' + session.id + '.' + randomSecret();
      await tx.update('sessions', session.id, session.revision, {
        secretHash: hashSecret(accessToken),
        refreshHash: hashSecret(refreshToken),
        usedRefreshHashes: [...session.usedRefreshHashes, session.refreshHash].slice(-128),
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      });
      return { user: userView(user), accessToken, refreshToken };
    });
    if ('error' in result) throw new AppError(401, 'INVALID_REFRESH', '刷新凭据无效，请重新登录');
    return { data: result };
  });
  app.get('/api/v1/me', async (request) => {
    const actor = await ctx.requireUser(request);
    return { data: userView(await activeUser(db, actor.userId)) };
  });
  app.get('/api/v1/auth/csrf', async (request) => {
    const actor = await ctx.requireUser(request);
    if (actor.channel !== 'web') return { data: { csrfToken: null } };
    return { data: { csrfToken: csrf(config, actor.sessionId!) } };
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const actor = await ctx.requireUser(request);
    const session = await db.get('sessions', actor.sessionId!);
    if (session && !session.revokedAt)
      await db.update('sessions', session.id, session.revision, { revokedAt: now() });
    reply.clearCookie(COOKIE, { path: '/' });
    return { data: { loggedOut: true } };
  });
  app.patch('/api/v1/me', async (request) => {
    const actor = await ctx.requireUser(request);
    const body = object(request.body);
    if (Object.keys(body).some((key) => !['displayName', 'expectedRevision'].includes(key)))
      throw new AppError(422, 'INVALID_FIELD', '包含不允许修改的设置');
    const user = await activeUser(db, actor.userId);
    const changes: Partial<UserRecord> = {};
    if (body.displayName !== undefined)
      changes.displayName = text(body.displayName, '显示名称', 100);
    return {
      data: userView(
        await db.update(
          'users',
          user.id,
          body.expectedRevision === undefined ? user.revision : revision(body.expectedRevision),
          changes,
        ),
      ),
    };
  });
  app.patch('/api/v1/me/password', async (request) => {
    const actor = await ctx.requireUser(request);
    const body = object(request.body);
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = body.newPassword;
    validatePassword(newPassword);
    await db.transaction(async (tx) => {
      const user = await activeUser(tx, actor.userId);
      if (!verifyPassword(current, user.passwordHash))
        throw new AppError(401, 'INVALID_PASSWORD', '当前密码不正确');
      await tx.update('users', user.id, user.revision, {
        passwordHash: passwordHash(newPassword),
        mustChangePassword: false,
      });
      await revokeUserCredentials(tx, user.id);
      await ctx.audit(actor, 'password.changed', 'user', user.id, {}, tx);
    });
    return { data: { changed: true } };
  });
  app.get('/api/v1/me/sessions', async (request) => {
    const actor = await ctx.requireUser(request);
    return {
      data: (await db.list('sessions', { userId: actor.userId }))
        .filter((s) => !s.revokedAt)
        .map((s) => ({
          id: s.id,
          channel: s.channel,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          current: s.id === actor.sessionId,
        })),
    };
  });
  app.post<{ Params: { id: string } }>('/api/v1/me/sessions/:id/revoke', async (request) => {
    const actor = await ctx.requireUser(request);
    const session = await db.get('sessions', request.params.id);
    if (!session || session.userId !== actor.userId)
      throw new AppError(404, 'NOT_FOUND', '会话不存在');
    if (!session.revokedAt)
      await db.update('sessions', session.id, session.revision, { revokedAt: now() });
    return { data: { revoked: true } };
  });
  app.get('/api/v1/me/agent-tokens', async (request) => {
    const actor = await ctx.requireUser(request);
    return {
      data: (await db.list('agentTokens', { ownerId: actor.userId })).map(agentTokenView),
    };
  });
  app.post('/api/v1/me/agent-tokens', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const actor = await ctx.requireUser(request);
    const body = object(request.body);
    const name = text(body.name, '令牌名称', 100);
    const scopes = agentTokenScopes(body.scopes);
    let expiresAt: string | null = null;
    if (body.expiresAt !== undefined && body.expiresAt !== null) {
      const date = Date.parse(String(body.expiresAt));
      if (!Number.isFinite(date) || date <= Date.now())
        throw new AppError(422, 'INVALID_EXPIRY', '到期时间需要在未来');
      expiresAt = new Date(date).toISOString();
    }
    const recordId = id();
    const token = 'dhk.' + recordId + '.' + randomSecret();
    const record = await db.insert('agentTokens', {
      ...baseRecord(),
      id: recordId,
      ownerId: actor.userId,
      name,
      prefix: token.slice(0, 12),
      secretHash: hashSecret(token),
      encryptedSecret: ctx.vault.encrypt(token),
      scopes,
      expiresAt,
      lastUsedAt: null,
    });
    await ctx.audit(actor, 'agent_token.created', 'agentToken', record.id, { scopes });
    return { data: { ...agentTokenView(record), token } };
  });
  app.patch<{ Params: { id: string } }>('/api/v1/me/agent-tokens/:id', async (request) => {
    const actor = await ctx.requireUser(request);
    const record = await db.transaction(async (tx) => {
      const token = await tx.get('agentTokens', request.params.id);
      if (!token || token.ownerId !== actor.userId)
        throw new AppError(404, 'NOT_FOUND', '令牌不存在');
      const body = object(request.body);
      if (Object.keys(body).some((key) => !['scopes', 'expectedRevision'].includes(key)))
        throw new AppError(422, 'INVALID_FIELD', '仅允许修改令牌权限');
      const scopes = agentTokenScopes(body.scopes);
      const updated = await tx.update('agentTokens', token.id, revision(body.expectedRevision), {
        scopes,
      });
      await ctx.audit(
        actor,
        'agent_token.scopes_updated',
        'agentToken',
        token.id,
        { previousScopes: token.scopes, scopes },
        tx,
      );
      return updated;
    });
    return { data: agentTokenView(record) };
  });
  app.post<{ Params: { id: string } }>(
    '/api/v1/me/agent-tokens/:id/reveal',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const actor = await ctx.requireUser(request);
      const token = await db.get('agentTokens', request.params.id);
      if (!token || token.ownerId !== actor.userId)
        throw new AppError(404, 'NOT_FOUND', '令牌不存在');
      if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now())
        throw new AppError(409, 'AGENT_TOKEN_EXPIRED', '已过期的令牌无法再复制');
      const secret = ctx.vault.decrypt(token.encryptedSecret);
      await ctx.audit(actor, 'agent_token.secret_revealed', 'agentToken', token.id);
      return { data: { token: secret } };
    },
  );
  app.post<{ Params: { id: string } }>('/api/v1/me/agent-tokens/:id/revoke', async (request) => {
    const actor = await ctx.requireUser(request);
    await db.transaction(async (tx) => {
      const token = await tx.get('agentTokens', request.params.id);
      if (!token || token.ownerId !== actor.userId)
        throw new AppError(404, 'NOT_FOUND', '令牌不存在');
      await tx.delete('agentTokens', token.id);
      await ctx.audit(actor, 'agent_token.revoked', 'agentToken', token.id, {}, tx);
    });
    return { data: { revoked: true } };
  });
  app.get('/api/v1/admin/users', async (request) => {
    await ctx.requireAdmin(request);
    return { data: (await db.list('users')).map(userView) };
  });
  app.post('/api/v1/admin/users', async (request) => {
    const actor = await ctx.requireAdmin(request);
    const body = object(request.body);
    if (body.role !== undefined && !['admin', 'user'].includes(String(body.role)))
      throw new AppError(422, 'INVALID_ROLE', '账号角色无效');
    const password = body.password;
    validatePassword(password);
    const user = await createUser(db, {
      username: text(body.username, '用户名', 64, 3),
      password,
      displayName:
        body.displayName === undefined ? undefined : text(body.displayName, '显示名称', 100),
      role: body.role === 'admin' ? 'admin' : 'user',
      mustChangePassword: false,
    });
    await ctx.audit(actor, 'user.created', 'user', user.id);
    return { data: userView(user) };
  });
  app.patch<{ Params: { id: string } }>('/api/v1/admin/users/:id/status', async (request) => {
    const actor = await ctx.requireAdmin(request);
    const body = object(request.body);
    if (!['active', 'disabled'].includes(String(body.status)))
      throw new AppError(422, 'INVALID_STATUS', '账号状态无效');
    if (request.params.id === actor.userId && body.status === 'disabled')
      throw new AppError(409, 'SELF_DISABLE_FORBIDDEN', '不能停用当前管理员账号');
    const updated = await db.transaction(async (tx) => {
      const user = await tx.get('users', request.params.id);
      if (!user) throw new AppError(404, 'NOT_FOUND', '账号不存在');
      const value = await tx.update(
        'users',
        user.id,
        body.expectedRevision === undefined ? user.revision : revision(body.expectedRevision),
        { status: body.status as 'active' | 'disabled' },
      );
      if (body.status === 'disabled') await revokeUserCredentials(tx, user.id);
      await ctx.audit(actor, 'user.status_changed', 'user', user.id, { status: body.status }, tx);
      return value;
    });
    return { data: userView(updated) };
  });
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/users/:id/reset-password',
    async (request) => {
      const actor = await ctx.requireAdmin(request);
      const body = object(request.body ?? {});
      const temporaryPassword = body.password === undefined ? 'T!' + randomSecret() : body.password;
      validatePassword(temporaryPassword);
      const user = await db.transaction(async (tx) => {
        const current = await tx.get('users', request.params.id);
        if (!current) throw new AppError(404, 'NOT_FOUND', '账号不存在');
        const updated = await tx.update('users', current.id, current.revision, {
          passwordHash: passwordHash(temporaryPassword),
          mustChangePassword: false,
        });
        await revokeUserCredentials(tx, current.id);
        await ctx.audit(actor, 'user.password_reset', 'user', current.id, {}, tx);
        return updated;
      });
      return { data: { user: userView(user), temporaryPassword } };
    },
  );
}
