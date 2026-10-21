import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import {
  assertProviderHost,
  isPublicProviderAddress,
  publicProviderLookup,
} from '../src/core/provider-network.js';
import { testChatCompletionsConnection } from '../src/modules/grading/chat-completions.js';
const dns = vi.hoisted(() => ({
  addresses: [{ address: '8.8.8.8', family: 4 }],
  error: null as Error | null,
}));
vi.mock('node:dns', () => ({
  lookup: (
    _host: string,
    _options: unknown,
    callback: (error: Error | null, addresses: { address: string; family: number }[]) => void,
  ) => callback(dns.error, dns.addresses),
}));
afterEach(() => {
  dns.addresses = [{ address: '8.8.8.8', family: 4 }];
  dns.error = null;
});
describe('provider outbound network policy', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '64:ff9b::7f00:1',
    '3fff::1',
  ])('rejects special address %s', (address) => {
    expect(isPublicProviderAddress(address)).toBe(false);
  });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'accepts public unicast %s',
    (address) => {
      expect(isPublicProviderAddress(address)).toBe(true);
    },
  );
  it.each([
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://[::ffff:127.0.0.1]',
    'http://localhost.',
    'http://evil.localhost',
    'http://service.internal',
    'http://service.local',
    'http://metadata.google.internal',
  ])('blocks %s before dispatch or credential transmission', async (baseUrl) => {
    const fake = vi.fn<typeof fetch>();
    await expect(
      testChatCompletionsConnection({
        baseUrl,
        apiKey: 'synthetic-key',
        timeoutMs: 1000,
        fetchImpl: fake,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ADDRESS_FORBIDDEN', retryable: false });
    expect(fake).not.toHaveBeenCalled();
  });
  it('rejects the whole DNS answer if any address is private', async () => {
    dns.addresses.push({ address: '127.0.0.1', family: 4 });
    await expect(
      new Promise((resolve, reject) =>
        publicProviderLookup('provider.test', { all: true }, (error, addresses) =>
          error ? reject(error) : resolve(addresses),
        ),
      ),
    ).rejects.toThrow('Provider address is forbidden');
  });
  it('hands vetted DNS records directly to the connector', async () => {
    const result = await new Promise((resolve, reject) =>
      publicProviderLookup('provider.test', { all: true }, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      ),
    );
    expect(result).toEqual([{ address: '8.8.8.8', family: 4 }]);
    dns.error = new Error('DNS failure');
    await expect(
      new Promise((resolve, reject) =>
        publicProviderLookup('provider.test', {}, (error, address) =>
          error ? reject(error) : resolve(address),
        ),
      ),
    ).rejects.toThrow('DNS failure');
  });
  it('requires explicit opt-in for a real private server and still refuses redirects', async () => {
    let calls = 0;
    const server = createServer((_request, response) => {
      calls++;
      response.writeHead(302, { location: 'http://127.0.0.1/metadata' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const input = {
      baseUrl: 'http://127.0.0.1:' + address.port,
      apiKey: 'synthetic-key',
      timeoutMs: 1000,
    };
    try {
      await expect(testChatCompletionsConnection(input)).rejects.toMatchObject({
        code: 'PROVIDER_ADDRESS_FORBIDDEN',
      });
      expect(calls).toBe(0);
      dns.addresses = [{ address: '127.0.0.1', family: 4 }];
      await expect(
        testChatCompletionsConnection({
          ...input,
          baseUrl: 'http://provider.test:' + address.port,
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ADDRESS_FORBIDDEN' });
      expect(calls).toBe(0);
      expect(() => assertProviderHost(new URL(input.baseUrl), true)).not.toThrow();
      await expect(
        testChatCompletionsConnection({ ...input, allowPrivateUrls: true }),
      ).rejects.toMatchObject({ code: 'PROVIDER_REDIRECT_FORBIDDEN' });
      expect(calls).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
