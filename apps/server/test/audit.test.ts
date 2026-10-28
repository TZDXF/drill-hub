import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '#server/app.js';
import { Database } from '#server/db/database.js';
import { baseRecord } from '#server/core/ids.js';
import { createUser } from '#server/modules/auth/index.js';
import { hashSecret } from '#server/core/security.js';

const ADMIN = 'audit_admin';
const PASSWORD = 'Audit-test-only-password-42!';
let app: FastifyInstance;
async function login(username = ADMIN, password = PASSWORD, channel = 'web') {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/${channel}/login`,
    payload: { username, password },
  });
  return {
    response,
    headers: {
      cookie: response.cookies.map((item) => `${item.name}=${item.value}`).join('; '),
      'x-csrf-token': response.json().data?.csrfToken ?? '',
    },
  };
}
beforeEach(async () => {
  app = await createApp({
    databasePath: ':memory:',
    encryptionKey: 'c'.repeat(64),
    startWorkers: false,
    bootstrapAdmin: { username: ADMIN, password: PASSWORD },
  });
});
afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

describe('administrator audit and access logs', () => {
  it('records successful, failed, unknown and malformed Web/Android login attempts without credentials', async () => {
    const session = await login();
    await login(ADMIN, 'never-log-this-password');
    await login('unknown-login-input', 'never-log-this-password', 'mobile');
    const mobile = await login(ADMIN, PASSWORD, 'mobile');
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/web/login',
      payload: { password: PASSWORD },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/login',
      headers: { 'content-type': 'application/json' },
      payload: '{invalid',
    });
    const response = await app.inject({
      url: '/api/v1/admin/login-logs',
      headers: session.headers,
    });
    expect(response.statusCode).toBe(200);
    const result = response.json().data;
    expect(result.total).toBe(6);
    expect(
      result.items.filter((item: { outcome: string }) => item.outcome === 'succeeded'),
    ).toHaveLength(2);
    expect(result.items).toContainEqual(
      expect.objectContaining({
        username: ADMIN,
        channel: 'web',
        outcome: 'failed',
        errorCode: 'INVALID_CREDENTIALS',
        statusCode: 401,
      }),
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({
        username: null,
        channel: 'mobile',
        outcome: 'failed',
        errorCode: 'INVALID_CREDENTIALS',
      }),
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({ username: null, statusCode: 422 }),
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({ username: null, statusCode: 400 }),
    );
    const persisted = JSON.stringify({
      api: await app.ctx.db.list('apiLogs'),
      login: await app.ctx.db.list('loginLogs'),
    });
    for (const secret of [
      PASSWORD,
      'never-log-this-password',
      'unknown-login-input',
      session.response.json().data.csrfToken,
      session.response.cookies[0]!.value,
      mobile.response.json().data.accessToken,
      mobile.response.json().data.refreshToken,
    ]) {
      expect(persisted).not.toContain(secret);
      expect(response.body).not.toContain(secret);
    }
  });

  it('does not persist flood rejections or trust forwarding headers', async () => {
    vi.stubEnv('E2E_LOGIN_RATE_LIMIT_MAX', '1');
    await app.close();
    app = await createApp({
      databasePath: ':memory:',
      encryptionKey: 'd'.repeat(64),
      startWorkers: false,
      bootstrapAdmin: { username: ADMIN, password: PASSWORD },
    });
    await login();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/web/login',
      headers: { 'x-forwarded-for': '203.0.113.19' },
      payload: { username: ADMIN, password: PASSWORD },
    });
    expect(response.statusCode).toBe(429);
    const rows = await app.ctx.db.list('loginLogs');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'succeeded', statusCode: 200, ip: '127.0.0.1' });
  });

  it('stores matched route templates, status, identity and request correlation, never raw URLs or payloads', async () => {
    const session = await login();
    const rawId = 'private-resource-marker';
    const secret = 'never-store-query-or-body';
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/topics/${rawId}/contents?credential=${secret}`,
      payload: { title: secret, answer: secret },
      headers: { authorization: `Bearer dhk.${secret}`, 'x-request-id': secret },
    });
    // A matched parameterized route is logged even when authentication fails.
    await app.inject({ url: `/api/v1/not-a-route/${secret}?token=${secret}` });
    await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/web/login',
      headers: {
        origin: 'https://example.test',
        'access-control-request-method': 'POST',
      },
    });
    await app.inject('/not-an-api-page');
    await app.inject('/api/v1/me');
    await app.inject({ url: '/api/v1/me', headers: session.headers });
    const rows = await app.ctx.db.list('apiLogs');
    const correlated = rows.find((row) => row.requestId === response.json().meta.requestId);
    expect(correlated).toMatchObject({
      route: '/api/v1/agent/topics/:id/contents',
      method: 'POST',
      statusCode: 401,
      errorCode: 'AGENT_TOKEN_INVALID',
    });
    expect(correlated!.durationMs).toBeGreaterThanOrEqual(0);
    expect(correlated!.requestId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(rows.some((row) => row.route === '/api/[unmatched]')).toBe(false);
    expect(rows).toContainEqual(
      expect.objectContaining({ route: '/api/v1/me', statusCode: 401, channel: 'anonymous' }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        route: '/api/v1/me',
        statusCode: 200,
        channel: 'web',
        ownerId: session.response.json().data.user.id,
      }),
    );
    expect(rows.some((row) => row.method === 'OPTIONS')).toBe(false);
    expect(rows.every((row) => row.route.startsWith('/api/'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(rows)).not.toContain(rawId);
    const logs = await app.inject({
      url: '/api/v1/admin/api-logs?q=%2Fapi%2Fv1%2Fme&statusCode=200&method=GET&channel=web',
      headers: session.headers,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json().data.items).toHaveLength(1);
    expect(logs.json().data.items[0].username).toBe(ADMIN);
  });

  it('restricts all log endpoints to admin user sessions, including read-scoped admin Agent tokens', async () => {
    const user = await createUser(app.ctx.db, { username: 'audit_user', password: PASSWORD });
    const ordinary = await login(user.username);
    const admin = await login();
    const raw = 'dhk.audit-test-token';
    await app.ctx.db.insert('agentTokens', {
      ...baseRecord(),
      ownerId: admin.response.json().data.user.id,
      name: 'audit test',
      prefix: 'dhk.audit',
      secretHash: hashSecret(raw),
      encryptedSecret: app.ctx.vault.encrypt(raw),
      scopes: ['read'],
      expiresAt: null,
      lastUsedAt: null,
    });
    for (const kind of ['audit', 'api', 'login']) {
      const url = `/api/v1/admin/${kind}-logs`;
      expect((await app.inject(url)).statusCode).toBe(401);
      expect((await app.inject({ url, headers: ordinary.headers })).statusCode).toBe(403);
      expect(
        (await app.inject({ url, headers: { authorization: `Bearer ${raw}` } })).statusCode,
      ).toBe(401);
      expect((await app.inject({ url, headers: admin.headers })).statusCode).toBe(200);
    }
  });

  it('paginates and filters audit history deterministically without exposing free-text summaries', async () => {
    const session = await login();
    const actor = await app.ctx.requireUser({
      headers: {},
      cookies: { dh_session: session.response.cookies[0]!.value },
      method: 'GET',
    } as never);
    const dates = [
      '2026-10-01T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z',
    ];
    for (const [index, createdAt] of dates.entries()) {
      await app.ctx.db.insert('auditLogs', {
        ...baseRecord(),
        id: `audit-${index}`,
        createdAt,
        ownerId: actor.userId,
        actorId: actor.id,
        action: 'audit.test',
        resourceType: 'topic',
        resourceId: `topic-${index}`,
        summary: { reason: 'private-answer-or-credential', apiKey: 'private-key' },
      });
    }
    const url =
      '/api/v1/admin/audit-logs?q=audit.test&from=2026-10-02T00%3A00%3A00Z&until=2026-10-03T00%3A00%3A00Z&pageSize=1';
    const first = await app.inject({ url, headers: session.headers });
    const second = await app.inject({ url: url + '&page=2', headers: session.headers });
    expect(first.json().data).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      items: [{ id: 'audit-2', username: ADMIN }],
    });
    expect(second.json().data.items[0].id).toBe('audit-1');
    expect(first.body).not.toContain('summary');
    expect(first.body).not.toContain('private-answer-or-credential');
    const original = await app.ctx.db.get('auditLogs', 'audit-2');
    expect(original!.summary).toHaveProperty('reason', 'private-answer-or-credential');
    const literal = await app.inject({
      url: '/api/v1/admin/audit-logs?q=%25',
      headers: session.headers,
    });
    expect(literal.json().data.total).toBe(0);
    const pastEnd = await app.inject({ url: url + '&page=9', headers: session.headers });
    expect(pastEnd.json().data.items).toEqual([]);
  });

  it('filters login results and rejects invalid or unsupported query parameters', async () => {
    const session = await login();
    await login(ADMIN, 'wrong', 'mobile');
    const failed = await app.inject({
      url: '/api/v1/admin/login-logs?channel=mobile&outcome=failed&statusCode=401',
      headers: session.headers,
    });
    expect(failed.json().data).toMatchObject({
      total: 1,
      items: [{ channel: 'mobile', outcome: 'failed' }],
    });
    for (const query of [
      'page=0',
      'page=1.5',
      'pageSize=101',
      'pageSize=-1',
      'from=not-a-date',
      'from=2026-02-30T00:00:00Z',
      'until=2026-10-01T24:00:00Z',
      'from=2026-10-03T00:00:00Z&until=2026-10-01T00:00:00Z',
      'unknown=1',
      'page=1&page=2',
      'channel=agent',
      'outcome=unknown',
      'method=GET',
      'statusCode=600',
    ]) {
      const response = await app.inject({
        url: `/api/v1/admin/login-logs?${query}`,
        headers: session.headers,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_LOG_FILTER');
    }
    expect(
      (await app.inject({ url: '/api/v1/admin/audit-logs?channel=web', headers: session.headers }))
        .statusCode,
    ).toBe(422);
    expect(
      (await app.inject({ url: '/api/v1/admin/api-logs?outcome=failed', headers: session.headers }))
        .statusCode,
    ).toBe(422);
  });

  it('keeps already sent business responses intact when access logging fails', async () => {
    const log = vi.spyOn(app.log, 'error');
    const transaction = vi
      .spyOn(app.ctx.db, 'transaction')
      .mockRejectedValueOnce(new Error('sensitive-database-error'));
    const response = await app.inject('/api/v1/health?secret=must-not-be-logged');
    expect(response.statusCode).toBe(200);
    expect(log).toHaveBeenCalledWith(
      { requestId: response.json().meta.requestId },
      '访问日志写入失败',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive-database-error');
    expect(JSON.stringify(log.mock.calls)).not.toContain('must-not-be-logged');
    transaction.mockRestore();
    log.mockRestore();
  });

  it('initializes a file database and preserves logs and business audit history across reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'drill-audit-'));
    let database: Database | undefined;
    try {
      const filename = join(directory, 'audit.sqlite');
      database = await Database.open(filename);
      await database.insert('auditLogs', {
        ...baseRecord(),
        id: 'history',
        ownerId: null,
        actorId: 'system',
        action: 'test',
        resourceType: 'test',
        resourceId: 'test',
        summary: {},
      });
      await database.insert('loginLogs', {
        ...baseRecord(),
        requestId: 'persisted',
        ownerId: null,
        username: null,
        channel: 'web',
        outcome: 'failed',
        statusCode: 401,
        ip: '127.0.0.1',
        errorCode: 'INVALID_CREDENTIALS',
      });
      await database.close();
      database = await Database.open(filename);
      expect(await database.get('auditLogs', 'history')).toBeDefined();
      expect((await database.queryLogs('loginLogs', { page: 1, pageSize: 20 })).total).toBe(1);
      expect((await database.queryLogs('apiLogs', { page: 1, pageSize: 20 })).items).toEqual([]);
    } finally {
      await database?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
