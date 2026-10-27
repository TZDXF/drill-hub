import type { ApiFailure, ApiResponse } from '@drill-hub/contracts';
export class ApiError extends Error {
  readonly statusCode: number;
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = status;
  }
}
export function normalizeServerUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ApiError(
      'INVALID_SERVER_URL',
      '请输入完整的服务器地址，例如 https://study.example.org',
    );
  }
  if (url.username || url.password || url.search || url.hash)
    throw new ApiError('INVALID_SERVER_URL', '服务器地址不能包含账号密码、查询参数或片段');
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new ApiError('INVALID_SERVER_URL', '服务器地址必须使用 HTTP 或 HTTPS');
  return url.origin + url.pathname.replace(/\/+$/, '');
}
export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null;
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface StreamEvent {
  event: string;
  data: string;
  id?: string;
}
export interface StreamOptions {
  signal?: AbortSignal;
  onEvent(event: StreamEvent): void;
}
export class ApiClient {
  readonly baseUrl: string;
  private csrfToken: string | null = null;
  private controller = new AbortController();
  constructor(private options: ApiClientOptions) {
    this.baseUrl = normalizeServerUrl(options.baseUrl);
  }
  setCsrfToken(value: string | null) {
    this.csrfToken = value;
  }
  dispose() {
    this.controller.abort();
  }
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
      throw new ApiError('INVALID_PATH', '无效的 API 路径');
    const apiRoot = this.baseUrl + '/api/v1';
    const target = new URL(apiRoot + path);
    if (
      target.origin !== new URL(this.baseUrl).origin ||
      !target.pathname.startsWith(new URL(apiRoot + '/').pathname)
    )
      throw new ApiError('INVALID_PATH', 'API 路径不能离开当前服务器');
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const access = this.options.getAccessToken?.();
    if (access) headers.Authorization = 'Bearer ' + access;
    if (this.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method))
      headers['X-CSRF-Token'] = this.csrfToken;
    const timer = new AbortController();
    const handle = setTimeout(
      () => timer.abort(),
      options.timeoutMs ?? this.options.timeoutMs ?? 20000,
    );
    const signals = [
      this.controller.signal,
      timer.signal,
      ...(options.signal ? [options.signal] : []),
    ];
    try {
      const response = await (this.options.fetch ?? fetch)(target, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: this.options.credentials ?? 'same-origin',
        redirect: 'error',
        signal: AbortSignal.any(signals),
      });
      if (response.status === 204) return undefined as T;
      let result: ApiResponse<T> | ApiFailure;
      try {
        result = (await response.json()) as ApiResponse<T> | ApiFailure;
      } catch {
        throw new ApiError('INVALID_RESPONSE', '服务器未返回有效的应用响应', response.status);
      }
      if (!response.ok || 'error' in result) {
        if ('error' in result)
          throw new ApiError(
            result.error.code,
            result.error.message,
            response.status,
            result.error.fields,
          );
        throw new ApiError('REQUEST_FAILED', '请求失败', response.status);
      }
      if (!('data' in result))
        throw new ApiError('INVALID_RESPONSE', '服务器响应格式不正确', response.status);
      return result.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (this.controller.signal.aborted || options.signal?.aborted)
        throw new ApiError('REQUEST_CANCELLED', '请求已取消');
      if (timer.signal.aborted) throw new ApiError('REQUEST_TIMEOUT', '连接超时，请稍后重试');
      throw new ApiError('NETWORK_ERROR', '无法连接服务器，请检查网络、地址或传输设置');
    } finally {
      clearTimeout(handle);
    }
  }
  get<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) {
    return this.request<T>(path, { ...options, method: 'GET' });
  }
  post<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }
  patch<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }
  put<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }
  /**
   * 订阅服务端 SSE 流（如内置助手事件流）。长连接不设默认超时；
   * 返回的 Promise 在流正常结束或被取消时 resolve，异常时 reject ApiError。
   */
  async streamRequest(path: string, options: StreamOptions): Promise<void> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
      throw new ApiError('INVALID_PATH', '无效的 API 路径');
    const apiRoot = this.baseUrl + '/api/v1';
    const target = new URL(apiRoot + path);
    if (
      target.origin !== new URL(this.baseUrl).origin ||
      !target.pathname.startsWith(new URL(apiRoot + '/').pathname)
    )
      throw new ApiError('INVALID_PATH', 'API 路径不能离开当前服务器');
    const access = this.options.getAccessToken?.();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (access) headers.Authorization = 'Bearer ' + access;
    const signals = [this.controller.signal, ...(options.signal ? [options.signal] : [])];
    try {
      const response = await (this.options.fetch ?? fetch)(target, {
        method: 'GET',
        headers,
        credentials: this.options.credentials ?? 'same-origin',
        redirect: 'error',
        signal: AbortSignal.any(signals),
      });
      if (!response.ok || !response.body) {
        let code = 'STREAM_FAILED';
        let message = '无法建立事件流连接';
        try {
          const failure = (await response.json()) as ApiFailure;
          if (failure && 'error' in failure) {
            code = failure.error.code;
            message = failure.error.message;
          }
        } catch {
          /* 非 JSON 错误响应使用默认文案。 */
        }
        throw new ApiError(code, message, response.status);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let pendingCarriageReturn = false;
      for (;;) {
        const { done, value } = await reader.read();
        let chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
        if (pendingCarriageReturn) chunk = '\r' + chunk;
        pendingCarriageReturn = !done && chunk.endsWith('\r');
        if (pendingCarriageReturn) chunk = chunk.slice(0, -1);
        buffer += chunk.replace(/\r\n|\r/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this.emitStreamFrame(frame, options.onEvent);
          boundary = buffer.indexOf('\n\n');
        }
        if (done) break;
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (this.controller.signal.aborted || options.signal?.aborted)
        throw new ApiError('REQUEST_CANCELLED', '事件流已取消');
      throw new ApiError('NETWORK_ERROR', '事件流连接中断');
    }
  }
  private emitStreamFrame(frame: string, onEvent: (event: StreamEvent) => void): void {
    let event = 'message';
    const data: string[] = [];
    let id: string | undefined;
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
      else if (field === 'id' && !value.includes('\0')) id = value;
    }
    if (!data.length) return;
    onEvent({ event, data: data.join('\n'), id });
  }
}
