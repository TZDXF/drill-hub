import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';

const originalHost = process.env.HOST;
const originalDriver = process.env.DATABASE_DRIVER;
const originalUrl = process.env.DATABASE_URL;
afterEach(() => {
  if (originalHost === undefined) delete process.env.HOST;
  else process.env.HOST = originalHost;
  if (originalDriver === undefined) delete process.env.DATABASE_DRIVER;
  else process.env.DATABASE_DRIVER = originalDriver;
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
});

describe('server host defaults', () => {
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

describe('database driver configuration', () => {
  const base = { databasePath: ':memory:', encryptionKey: 'a'.repeat(64) };
  it('defaults to sqlite without DATABASE_URL', async () => {
    const config = await loadConfig(base);
    expect(config.databaseDriver).toBe('sqlite');
    expect(config.databaseUrl).toBeUndefined();
  });
  it('accepts postgres driver with an explicit URL', async () => {
    const config = await loadConfig({
      ...base,
      databaseDriver: 'postgres',
      databaseUrl: 'postgres://drill_hub:secret@localhost:5432/drill_hub',
    });
    expect(config.databaseDriver).toBe('postgres');
    expect(config.databaseUrl).toBe('postgres://drill_hub:secret@localhost:5432/drill_hub');
  });
  it('reads driver and URL from environment', async () => {
    process.env.DATABASE_DRIVER = 'postgres';
    process.env.DATABASE_URL = 'postgres://drill_hub:secret@localhost:5432/drill_hub';
    const config = await loadConfig(base);
    expect(config.databaseDriver).toBe('postgres');
    expect(config.databaseUrl).toBe('postgres://drill_hub:secret@localhost:5432/drill_hub');
  });
  it('rejects postgres without a URL', async () => {
    await expect(loadConfig({ ...base, databaseDriver: 'postgres' })).rejects.toThrow(
      'DATABASE_DRIVER=postgres requires DATABASE_URL',
    );
  });
  it.each(['mysql', 'SQLite', 'oracle'])('rejects unknown driver %s', async (driver) => {
    await expect(loadConfig({ ...base, databaseDriver: driver as never })).rejects.toThrow(
      'Invalid DATABASE_DRIVER',
    );
  });
});
