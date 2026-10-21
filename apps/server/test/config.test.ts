import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';

const originalHost = process.env.HOST;
afterEach(() => {
  if (originalHost === undefined) delete process.env.HOST;
  else process.env.HOST = originalHost;
});

describe('server host defaults', () => {
  it.each([
    '*',
    'null',
    'https://*.example.org',
    'https://example.org/path',
    'https://example.org/',
    'https://user:password@example.org',
  ])('rejects unsafe browser whitelist entry %s', async (origin) => {
    await expect(
      loadConfig({ encryptionKey: 'a'.repeat(64), corsOrigins: [origin] }),
    ).rejects.toThrow('Invalid CORS_ORIGINS');
  });
  it.each(['0.0.0.0/0', '::/0', 'true', '127.0.0.1/33', '::1/129'])(
    'rejects unsafe trusted proxy entry %s',
    async (proxy) => {
      await expect(
        loadConfig({ encryptionKey: 'a'.repeat(64), trustedProxies: [proxy] }),
      ).rejects.toThrow('Invalid TRUSTED_PROXIES');
    },
  );
  it.each([0, -1, 366, 1.5, NaN])('rejects invalid retention %s', async (days) => {
    await expect(
      loadConfig({ encryptionKey: 'a'.repeat(64), accessLogRetentionDays: days }),
    ).rejects.toThrow('Invalid ACCESS_LOG_RETENTION_DAYS');
  });
  it('listens on all interfaces in development by default', async () => {
    delete process.env.HOST;
    const config = await loadConfig({
      databasePath: ':memory:',
      encryptionKey: 'a'.repeat(64),
      production: false,
    });
    expect(config.host).toBe('0.0.0.0');
  });

  it('keeps production on loopback by default', async () => {
    delete process.env.HOST;
    const config = await loadConfig({
      databasePath: ':memory:',
      encryptionKey: 'a'.repeat(64),
      production: true,
    });
    expect(config.host).toBe('127.0.0.1');
  });

  it('respects an explicit host', async () => {
    process.env.HOST = '127.0.0.1';
    const config = await loadConfig({
      databasePath: ':memory:',
      encryptionKey: 'a'.repeat(64),
      production: false,
    });
    expect(config.host).toBe('127.0.0.1');
  });
});
