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
}
