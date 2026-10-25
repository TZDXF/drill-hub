import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '#server/app.js';
import { AppError } from '#server/core/errors.js';
import { normalizePublicBaseUrl, resolvePublicUrl } from '#server/core/public-url.js';

const apps: FastifyInstance[] = [];

async function setup(publicUrl = '') {
  const app = await createApp({
    databasePath: ':memory:',
    encryptionKey: 'a'.repeat(64),
    production: false,
    startWorkers: false,
    publicUrl,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('public deployment URL', () => {
  it.each([
    ['https://study.example.org/', 'https://study.example.org'],
    [' http://STUDY.example.org:8080/drill/// ', 'http://study.example.org:8080/drill'],
    ['HTTPS://STUDY.example.org:443/drill/', 'https://study.example.org/drill'],
    ['http://192.168.1.20:3000', 'http://192.168.1.20:3000'],
    ['http://[::1]:3000/drill/', 'http://[::1]:3000/drill'],
    ['https://study.example.org/学习/', 'https://study.example.org/%E5%AD%A6%E4%B9%A0'],
  ])('normalizes %s and preserves the deployment path', (input, expected) => {
    expect(normalizePublicBaseUrl(input)).toBe(expected);
  });

  it.each([
    '',
    '/drill',
    'study.example.org',
    '//study.example.org',
    'https:/study.example.org',
    'https:///study.example.org',
    'ftp://study.example.org',
    'javascript:alert(1)',
    'https://',
    'https://study.example.org:65536',
    'https://user:private-password@study.example.org',
    'https://@study.example.org',
    'https://study.example.org/?key=private-value',
    'https://study.example.org/#private-fragment',
    'https://study.example.org/?',
    'https://study.example.org/#',
    'https://study.example.org/a b',
    'https://study.example.org/\npath',
    'https://study.example.org/\\path',
  ])('rejects invalid configuration without exposing its value (%#)', (input) => {
    expect(() => normalizePublicBaseUrl(input)).toThrowError(AppError);
    expect(() => normalizePublicBaseUrl(input)).toThrowError(
      expect.objectContaining({
        statusCode: 503,
        code: 'INVALID_PUBLIC_URL',
        message:
          'PUBLIC_URL 必须是有效的 HTTP/HTTPS 公开部署地址，可包含路径，但不能包含凭据、查询参数或片段',
      }),
    );
  });

  it('prefers configured URL even when the request origin is unavailable', () => {
    expect(
      resolvePublicUrl({ protocol: 'http', headers: {} }, 'https://public.example/drill/'),
    ).toEqual({
      publicBaseUrl: 'https://public.example/drill',
      publicUrlSource: 'configured',
      isLoopback: false,
    });
  });

  it.each([undefined, '', '   '])(
    'falls back to the request for empty configuration (%#)',
    (value) => {
      expect(
        resolvePublicUrl({ protocol: 'https', headers: { host: 'localhost:8443' } }, value),
      ).toEqual({
        publicBaseUrl: 'https://localhost:8443',
        publicUrlSource: 'request',
        isLoopback: true,
      });
    },
  );

  it.each([
    'http://localhost:3000',
    'http://LOCALHOST.:3000',
    'http://app.localhost',
    'http://127.0.0.1:3000',
    'http://127.12.34.56',
    'http://2130706433',
    'http://[::1]:3000',
    'http://[0:0:0:0:0:0:0:1]',
    'http://[::ffff:127.0.0.1]',
  ])('recognizes loopback deployments (%s)', (url) => {
    expect(resolvePublicUrl({ protocol: 'http', headers: {} }, url).isLoopback).toBe(true);
  });

  it.each([
    'http://192.168.1.20',
    'https://study.example.org',
    'https://localhost.example.org',
    'http://127.example.org',
    'http://[2001:db8::1]',
    'http://[::ffff:192.168.1.20]',
    'http://[::ffff:0.127.0.1]',
  ])('does not mistake non-loopback hosts for loopback (%s)', (url) => {
    expect(resolvePublicUrl({ protocol: 'http', headers: {} }, url).isLoopback).toBe(false);
  });

  it.each([
    undefined,
    '',
    'user:secret@study.example.org',
    'study.example.org/path',
    'study.example.org?key=secret',
    'study.example.org#secret',
    'study.example.org\\path',
    'study.example.org:99999',
    'attacker.example',
    '192.168.1.20:3000',
    'study.example.org\n',
  ])('returns a stable error for an unusable request host (%#)', (host) => {
    expect(() => resolvePublicUrl({ protocol: 'http', headers: { host } })).toThrowError(
      expect.objectContaining({ statusCode: 503, code: 'PUBLIC_URL_UNAVAILABLE' }),
    );
  });

  it('does not accept non-HTTP request protocols', () => {
    expect(() =>
      resolvePublicUrl({ protocol: 'ftp', headers: { host: 'study.example.org' } }),
    ).toThrowError(expect.objectContaining({ code: 'PUBLIC_URL_UNAVAILABLE' }));
  });
});

describe('GET /api/v1/server-info public URL', () => {
  it('treats whitespace-only PUBLIC_URL as unset for browser requests too', async () => {
    const app = await setup('   ');
    const response = await app.inject({
      url: '/api/v1/server-info',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.publicBaseUrl).toBe('http://localhost:3000');
  });
  it.each(['http://public.example:8080/drill///', 'https://public.example/drill/'])(
    'advertises configured deployment %s without changing the request host',
    async (publicUrl) => {
      const app = await setup(publicUrl);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/server-info',
        headers: { host: '127.0.0.1:3000' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: {
          service: 'drill-hub',
          publicBaseUrl: normalizePublicBaseUrl(publicUrl),
          publicUrlSource: 'configured',
          isLoopback: false,
        },
        meta: { requestId: expect.any(String), serverTime: expect.any(String) },
      });
    },
  );

  it('uses the request host and ignores untrusted forwarded headers', async () => {
    const app = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/server-info',
      headers: {
        host: 'localhost:3000',
        forwarded: 'host=spoofed.example;proto=https',
        'x-forwarded-host': 'spoofed.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-prefix': '/spoofed',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      publicBaseUrl: 'http://localhost:3000',
      publicUrlSource: 'request',
      isLoopback: true,
    });
  });

  it('derives the advertised URL per request, not from a previous request', async () => {
    const app = await setup();
    for (const host of ['localhost:3000', '[::1]:3000']) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/server-info',
        headers: { host },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        publicBaseUrl: `http://${host}`,
        publicUrlSource: 'request',
        isLoopback: true,
      });
    }
  });

  it.each(['attacker.example', '192.168.1.20:3000'])(
    'rejects non-loopback Host without PUBLIC_URL (%s)',
    async (host) => {
      const app = await setup();
      const response = await app.inject({ url: '/api/v1/server-info', headers: { host } });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('PUBLIC_URL_UNAVAILABLE');
    },
  );

  it('returns the standard error envelope when the request host is unusable', async () => {
    const app = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/server-info',
      headers: { host: 'user:secret@study.example.org' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: 'PUBLIC_URL_UNAVAILABLE' },
      meta: { requestId: expect.any(String), serverTime: expect.any(String) },
    });
    expect(response.body).not.toContain('secret');
  });

  it('fails startup on invalid configuration rather than silently falling back', async () => {
    await expect(setup('https://user:private-password@study.example.org')).rejects.toThrowError(
      expect.objectContaining({ code: 'INVALID_PUBLIC_URL' }),
    );
  });
});
