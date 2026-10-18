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
  });
  apps.push(app);
  return app;
}

describe('browser origin policy', () => {
  it.each([false, true])('allows arbitrary origins in %s mode', async (production) => {
    const app = await setup(production);
    for (const origin of [
      'https://untrusted.invalid',
      'http://8.8.8.8:5173',
      'http://192.168.1.20:8080',
      'tauri://localhost',
    ]) {
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/web/login',
        headers: { origin, 'access-control-request-method': 'POST' },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe(origin);
      expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    }
  });
});
