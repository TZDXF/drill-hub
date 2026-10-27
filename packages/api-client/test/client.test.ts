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
  it('replays a mutating request once after refreshing a rotated CSRF token', async () => {
    let call = 0;
    const mock = vi.fn<typeof fetch>(async (_url, init) => {
      call += 1;
      const headers = (init as RequestInit).headers as Record<string, string>;
      if (call === 1 && headers['X-CSRF-Token'] === 'stale-token')
        return new Response(
          JSON.stringify({ error: { code: 'CSRF_REQUIRED', message: '过期' }, meta: {} }),
          { status: 403 },
        );
      return new Response(
        JSON.stringify({ data: { ok: true }, meta: { requestId: 'test', serverTime: '' } }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const refreshCsrf = vi.fn(async () => 'fresh-token');
    const client = new ApiClient({
      baseUrl: 'https://study.example.org',
      credentials: 'omit',
      fetch: mock as typeof fetch,
      refreshCsrf,
    });
    client.setCsrfToken('stale-token');
    expect(await client.post('/topics', { title: 'test' })).toEqual({ ok: true });
    expect(refreshCsrf).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(2);
    const replayHeaders = (mock.mock.calls[1] as unknown as [URL, RequestInit])[1]
      .headers as Record<string, string>;
    expect(replayHeaders['X-CSRF-Token']).toBe('fresh-token');
  });

  it('does not replay GET requests or retry when refresh fails', async () => {
    const mock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'CSRF_REQUIRED', message: '过期' }, meta: {} }),
          { status: 403 },
        ),
    );
    const refreshCsrf = vi.fn(async () => null);
    const client = new ApiClient({
      baseUrl: 'https://study.example.org',
      credentials: 'omit',
      fetch: mock as typeof fetch,
      refreshCsrf,
    });
    client.setCsrfToken('stale-token');
    await expect(client.post('/topics', {})).rejects.toMatchObject({ code: 'CSRF_REQUIRED' });
    // 尝试刷新一次但拿不到新令牌（返回 null），不重放。
    expect(refreshCsrf).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(1);
    // GET 请求不触发刷新重放。
    await expect(client.get('/topics')).rejects.toMatchObject({ code: 'CSRF_REQUIRED' });
    expect(refreshCsrf).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(2);
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

describe('event streams', () => {
  it('parses CRLF split across chunks and SSE fields without spaces', async () => {
    const encoder = new TextEncoder();
    const chunks = ['event:update\r', '\nid: 42\r\ndata:first\r', '\ndata: second\r\n\r', '\n'];
    const client = new ApiClient({
      baseUrl: 'https://study.example.org',
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
              controller.close();
            },
          }),
        ),
    });
    const onEvent = vi.fn<(event: import('#api-client/index.js').StreamEvent) => void>();
    await client.streamRequest('/events', { onEvent });
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      event: 'update',
      id: '42',
      data: 'first\nsecond',
    });
  });
});
