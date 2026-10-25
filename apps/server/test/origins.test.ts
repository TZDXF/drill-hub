import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '#server/app.js';

const apps: FastifyInstance[] = [];
const password = 'Test-only-password-42!';
const origins = [
  'https://study.example.test',
  'https://unregistered.example.test',
  'https://study.example.test:8443',
  'http://localhost:9999',
  'http://192.168.1.20:5173',
  'tauri://localhost',
  'http://tauri.localhost',
  'null',
];

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
    bootstrapAdmin: { username: 'admin', password },
  });
  apps.push(app);
  return app;
}

describe('browser origin policy', () => {
  it.each([false, true])(
    'reflects all origins and permits credentialed preflights in %s mode',
    async (production) => {
      const app = await setup(production);
      for (const origin of origins) {
        const response = await app.inject({
          method: 'OPTIONS',
          url: '/api/v1/me',
          headers: {
            origin,
            'access-control-request-method': 'PATCH',
            'access-control-request-headers': 'content-type,x-csrf-token',
          },
        });
        expect(response.statusCode).toBe(204);
        expect(response.headers['access-control-allow-origin']).toBe(origin);
        expect(response.headers['access-control-allow-credentials']).toBe('true');
        expect(response.headers['access-control-allow-headers']).toMatch(/x-csrf-token/i);
        expect(response.headers['access-control-allow-methods']).toContain('PATCH');
      }
    },
  );

  it('permits session and CSRF reads from any origin without bypassing authentication', async () => {
    const app = await setup(false);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/web/login',
      payload: { username: 'admin', password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    for (const origin of origins) {
      for (const url of ['/api/v1/me', '/api/v1/auth/csrf']) {
        const response = await app.inject({ url, headers: { origin, cookie } });
        expect(response.statusCode).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe(origin);
        expect(response.headers['access-control-allow-credentials']).toBe('true');
      }
      const anonymous = await app.inject({ url: '/api/v1/me', headers: { origin } });
      expect(anonymous.statusCode).toBe(401);
    }
  });

  it('keeps CSRF protection for cross-origin Cookie writes', async () => {
    const app = await setup(false);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/web/login',
      payload: { username: 'admin', password },
    });
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const origin = 'https://unregistered.example.test';
    const payload = { expectedRevision: login.json().data.user.revision, displayName: '跨域修改' };
    const denied = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { origin, cookie },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['access-control-allow-origin']).toBe(origin);
    const allowed = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { origin, cookie, 'x-csrf-token': login.json().data.csrfToken },
      payload,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data.displayName).toBe('跨域修改');
  });

  it('does not restrict Referer and keeps non-browser clients working', async () => {
    const app = await setup(false);
    const response = await app.inject({
      url: '/api/v1/health',
      headers: { referer: 'https://unregistered.example.test/' },
    });
    expect(response.statusCode).toBe(200);
    expect((await app.inject('/api/v1/health')).statusCode).toBe(200);
  });
});
