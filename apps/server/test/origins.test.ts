import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup(production: boolean) {
  const app = await createApp({
    databasePath: ':memory:',
    encryptionKey: 'a'.repeat(64),
    production,
    startWorkers: false,
    publicUrl: 'https://study.example.test/drill',
    corsOrigins: ['https://web.example.test', 'tauri://localhost', 'http://tauri.localhost'],
    bootstrapAdmin: { username: 'admin', password: 'Test-only-password-42!' },
  });
  apps.push(app);
  return app;
}
describe('browser origin policy', () => {
  it.each([false, true])('only permits exact configured origins in %s mode', async (production) => {
    const app = await setup(production);
    for (const origin of [
      'https://study.example.test',
      'https://web.example.test',
      'tauri://localhost',
      'http://tauri.localhost',
    ]) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/web/login',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-csrf-token',
        },
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    }
  });
  it.each([
    'null',
    'https://evil.example.test',
    'https://study.example.test:8443',
    'http://study.example.test',
    'https://study.example.test.attacker.test',
    'http://localhost:9999',
  ])('blocks %s including authenticated reads and token issuance', async (origin) => {
    const app = await setup(false);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/web/login',
      payload: { username: 'admin', password: 'Test-only-password-42!' },
    });
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    for (const url of ['/api/v1/me', '/api/v1/auth/csrf']) {
      const response = await app.inject({ url, headers: { origin, cookie } });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('ORIGIN_FORBIDDEN');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      expect(response.body).not.toContain(login.json().data.csrfToken);
    }
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/web/login',
      headers: { origin, 'access-control-request-method': 'POST' },
    });
    expect(preflight.statusCode).toBe(403);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('checks Referer when Origin is missing, but keeps non-browser clients working', async () => {
    const app = await setup(false);
    expect(
      (
        await app.inject({
          url: '/api/v1/health',
          headers: { referer: 'https://evil.example.test/' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: '/api/v1/health',
          headers: { referer: 'https://study.example.test/page' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject('/api/v1/health')).statusCode).toBe(200);
  });
});
