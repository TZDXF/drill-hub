import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, normalizeServerUrl } from '#api-client/index.js';
describe('server connection and request isolation', () => {
  it('normalizes a deployment prefix and rejects embedded credentials', () => {
    expect(normalizeServerUrl('https://study.example.org/learn///')).toBe(
      'https://study.example.org/learn',
    );
    expect(() => normalizeServerUrl('https://user:pass@study.example.org')).toThrow(ApiError);
    expect(() => normalizeServerUrl('https://study.example.org?token=secret')).toThrow(ApiError);
    expect(normalizeServerUrl('http://study.example.org/learn///')).toBe(
      'http://study.example.org/learn',
    );
    expect(() => normalizeServerUrl('ftp://study.example.org')).toThrow(ApiError);
    expect(normalizeServerUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
  });
  it('preserves path prefixes, scopes auth and never follows redirects', async () => {
    const mock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: { ok: true }, meta: { requestId: 'test', serverTime: '' } }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new ApiClient({
      baseUrl: 'https://study.example.org/learn',
      getAccessToken: () => 'test-access',
      credentials: 'omit',
      fetch: mock as typeof fetch,
    });
    client.setCsrfToken('test-csrf');
    expect(await client.post('/topics', { title: 'test' })).toEqual({ ok: true });
    expect(mock.mock.calls[0]?.[0]?.toString()).toBe(
      'https://study.example.org/learn/api/v1/topics',
    );
    const options = (mock.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(options.redirect).toBe('error');
    expect(options.credentials).toBe('omit');
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer test-access',
      'X-CSRF-Token': 'test-csrf',
    });
  });
  it('rejects paths that escape the server and decodes structured errors', async () => {
    const client = new ApiClient({
      baseUrl: 'https://study.example.org/learn',
      fetch: async () =>
        new Response(
          JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: '请刷新' }, meta: {} }),
          { status: 409 },
        ),
    });
    const traversalPath = ['', '..', '..', 'other'].join('/');
    await expect(client.get(traversalPath)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(client.get('/%2e%2e/%2e%2e/other')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    await expect(client.get('//another.invalid')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(client.get('/topics')).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
      message: '请刷新',
    });
  });
  it('does not confuse an HTML login page with a successful API response', async () => {
    const client = new ApiClient({
      baseUrl: 'https://study.example.org',
      fetch: async () => new Response('<html>proxy login</html>'),
    });
    await expect(client.get('/me')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('accepts successful 204 responses without a JSON body', async () => {
    const client = new ApiClient({
      baseUrl: 'https://study.example.org',
      fetch: async () => new Response(null, { status: 204 }),
    });
    await expect(client.request<void>('/queued/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
  it('cancels in-flight requests when a connection is disposed', async () => {
    const client = new ApiClient({
      baseUrl: 'https://study.example.org',
      fetch: ((_url: unknown, options?: RequestInit) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as typeof fetch,
    });
    const pending = client.get('/me');
    client.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  });
});
