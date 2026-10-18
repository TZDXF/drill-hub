import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';

const originalHost = process.env.HOST;
afterEach(() => {
  if (originalHost === undefined) delete process.env.HOST;
  else process.env.HOST = originalHost;
});

describe('server host defaults', () => {
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
