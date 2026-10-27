import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, type CreateAppOptions } from '#server/app.js';
import { createUser } from '#server/modules/auth/index.js';
import { baseRecord } from '#server/core/ids.js';
const apps: FastifyInstance[] = [];
const password = 'Test-only-password-42!';
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
});
async function setup(options: CreateAppOptions = {}) {
  const app = await createApp({
    databasePath: ':memory:',
    encryptionKey: 'a'.repeat(64),
    startWorkers: false,
    bootstrapAdmin: { username: 'admin', password },
    ...options,
  });
  apps.push(app);
  return app;
}
function login(
  app: FastifyInstance,
  username: string,
  suppliedPassword = password,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/web/login',
    headers,
    payload: { username, password: suppliedPassword },
  });
}
describe('resource and deployment boundaries', () => {
  it('limits unregistered API paths in one shared bucket without persistent scan writes', async () => {
    const app = await setup();
    for (let i = 0; i < 3; i++)
      expect((await app.inject('/missing-static-' + i + '.bin')).statusCode).toBe(404);
    for (let i = 0; i < 1200; i++)
      expect((await app.inject('/api/scan-' + i)).statusCode).toBe(404);
    expect((await app.inject('/api/another-missing-path')).statusCode).toBe(429);
    expect((await app.inject('/missing-static-after-api-limit.bin')).statusCode).toBe(404);
    expect((await app.inject('/api/v1/health')).statusCode).toBe(429);
    expect(await app.ctx.db.list('apiLogs')).toHaveLength(0);
    expect(await app.ctx.db.list('loginLogs')).toHaveLength(0);
    expect((await login(app, 'admin')).statusCode).toBe(429);
  });
  it('isolates accounts behind a shared reverse proxy and ignores spoofed IP headers by default', async () => {
    vi.stubEnv('E2E_LOGIN_RATE_LIMIT_MAX', '2');
    const app = await setup();
    await createUser(app.ctx.db, { username: 'learner', password });
    expect((await login(app, 'admin', 'invalid')).statusCode).toBe(401);
    expect((await login(app, 'admin', 'invalid')).statusCode).toBe(401);
    expect((await login(app, 'admin', password, { 'x-forwarded-for': '8.8.8.8' })).statusCode).toBe(
      429,
    );
    expect((await login(app, 'learner')).statusCode).toBe(200);
  });
  it.each(['NaN', '0', '-1', '1.5'])(
    'uses a safe login limit for invalid configuration %s',
    async (value) => {
      vi.stubEnv('E2E_LOGIN_RATE_LIMIT_MAX', value);
      const app = await setup();
      for (let index = 0; index < 10; index++)
        expect((await login(app, 'admin', 'invalid')).statusCode).toBe(401);
      expect((await login(app, 'admin', 'invalid')).statusCode).toBe(429);
    },
  );
  it('honors the E2E login limit in the shared IP flood bucket', async () => {
    vi.stubEnv('E2E_LOGIN_RATE_LIMIT_MAX', '40');
    const app = await setup();
    for (let index = 0; index < 40; index++)
      expect((await login(app, `unknown_${index}`, 'invalid')).statusCode).toBe(401);
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/login',
      payload: { username: 'another_unknown', password: 'invalid' },
    });
    expect(denied.statusCode).toBe(429);
    expect(denied.json().error.code).toBe('RATE_LIMITED');
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
  });
  it('uses client IP only through explicitly trusted proxies and sets Secure behind HTTPS termination', async () => {
    vi.stubEnv('E2E_LOGIN_RATE_LIMIT_MAX', '1');
    const app = await setup({
      trustedProxies: ['127.0.0.1'],
      publicUrl: 'https://study.example.test',
    });
    expect(
      (await login(app, 'admin', 'invalid', { 'x-forwarded-for': '8.8.8.8' })).statusCode,
    ).toBe(401);
    const result = await login(app, 'admin', password, { 'x-forwarded-for': '1.1.1.1' });
    expect(result.statusCode).toBe(200);
    expect(result.cookies[0]?.secure).toBe(true);
    expect((await app.ctx.db.list('loginLogs')).map((r) => r.ip).sort()).toEqual([
      '1.1.1.1',
      '8.8.8.8',
    ]);
  });
  it('prunes only expired operational logs, preserving audit/business history', async () => {
    const app = await setup();
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    for (const createdAt of [old, new Date().toISOString()]) {
      await app.ctx.db.insert('apiLogs', {
        ...baseRecord(),
        createdAt,
        requestId: 'test',
        ownerId: null,
        actorId: null,
        channel: 'anonymous',
        method: 'GET',
        route: '/api/v1/health',
        statusCode: 200,
        durationMs: 0,
        ip: '127.0.0.1',
        errorCode: null,
      });
      await app.ctx.db.insert('loginLogs', {
        ...baseRecord(),
        createdAt,
        requestId: 'test',
        ownerId: null,
        username: null,
        channel: 'web',
        outcome: 'failed',
        statusCode: 401,
        ip: '127.0.0.1',
        errorCode: 'INVALID_CREDENTIALS',
      });
    }
    await app.ctx.db.insert('auditLogs', {
      ...baseRecord(),
      createdAt: old,
      ownerId: 'test',
      actorId: 'test',
      action: 'test',
      resourceType: 'test',
      resourceId: 'test',
      summary: {},
    });
    await app.ctx.db.pruneAccessLogs(7);
    expect(await app.ctx.db.list('apiLogs')).toHaveLength(1);
    expect(await app.ctx.db.list('loginLogs')).toHaveLength(1);
    expect(await app.ctx.db.list('auditLogs')).toHaveLength(1);
  });
});
