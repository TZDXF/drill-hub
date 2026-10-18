import { reactive } from 'vue';
import { ApiClient, ApiError, normalizeServerUrl } from '@drill-hub/api-client';
import {
  API_VERSION,
  type ClientPlatform,
  type LoginResult,
  type ServerConnection,
  type ServerInfo,
  type StoredMobileSession,
  type UserView,
} from '@drill-hub/contracts';
import type { CsrfResult } from './types';
import { abortError, errorMessage, isApiError } from './utils';

type Method = 'get' | 'post' | 'patch' | 'put';

interface RequestOptions {
  retryAuth?: boolean;
  public?: boolean;
}

export interface LearningState {
  ready: boolean;
  bootError: string;
  authNotice: string;
  messages: AppMessage[];
  online: boolean;
  connection: ServerConnection | null;
  serverInfo: ServerInfo | null;
  user: UserView | null;
}

export type MessageTone = 'success' | 'error' | 'info' | 'warning';

export interface AppMessage {
  id: number;
  tone: MessageTone;
  title: string;
  description?: string;
}

export function createLearningContext(platform: ClientPlatform) {
  const state = reactive<LearningState>({
    ready: false,
    bootError: '',
    authNotice: '',
    messages: [],
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    connection: null,
    serverInfo: null,
    user: null,
  });

  let client: ApiClient | null = null;
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let generation = 0;
  let controller = new AbortController();
  let refreshPromise: Promise<void> | null = null;
  let messageId = 0;

  function notify(tone: MessageTone, title: string, description?: string) {
    state.messages.push({ id: ++messageId, tone, title, description });
    if (state.messages.length > 20) state.messages.splice(0, state.messages.length - 20);
  }

  function makeClient() {
    if (!state.connection) {
      client = null;
      return;
    }
    const connection = state.connection;
    client = new ApiClient({
      baseUrl: connection.baseUrl,
      credentials: platform.kind === 'web' ? 'include' : 'omit',
      getAccessToken: () => accessToken,
    });
  }

  function requireClient(): ApiClient {
    if (!client) throw new Error('尚未连接学习服务器');
    return client;
  }

  function resetRuntime() {
    generation += 1;
    client?.dispose();
    controller.abort();
    controller = new AbortController();
    refreshPromise = null;
    accessToken = null;
    refreshToken = null;
    client = null;
    state.user = null;
    state.serverInfo = null;
  }

  async function runWithCancellation<T>(operation: () => Promise<T>, ticket: number): Promise<T> {
    const signal = controller.signal;
    if (signal.aborted || ticket !== generation) throw abortError();
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      operation().then(
        (value) => {
          cleanup();
          if (ticket !== generation || signal.aborted) reject(abortError());
          else resolve(value);
        },
        (error: unknown) => {
          cleanup();
          if (ticket !== generation || signal.aborted) reject(abortError());
          else reject(error);
        },
      );
    });
  }

  async function direct<T>(
    method: Method,
    path: string,
    body?: unknown,
    ticket = generation,
  ): Promise<T> {
    const target = requireClient();
    const signal = controller.signal;
    return runWithCancellation(() => {
      if (method === 'get') return target.get<T>(path, { signal });
      if (method === 'post') return target.post<T>(path, body, { signal });
      if (method === 'patch') return target.patch<T>(path, body, { signal });
      return target.put<T>(path, body, { signal });
    }, ticket);
  }

  async function publicRequest<T>(
    method: Method,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<T> {
    const target = requireClient();
    const ticket = generation;
    const signal = controller.signal;
    return runWithCancellation(
      () =>
        target.request<T>(path, {
          method,
          body,
          signal,
          headers: { 'X-Answer-Link-Token': token },
        }),
      ticket,
    );
  }

  async function expireSession(message: string) {
    const connection = state.connection;
    accessToken = null;
    refreshToken = null;
    state.user = null;
    state.authNotice = message;
    if (platform.kind === 'android' && connection) {
      await platform.setSession(connection, null).catch(() => undefined);
    }
  }

  async function refreshMobileSession(ticket = generation): Promise<void> {
    if (platform.kind !== 'android' || !state.connection || !refreshToken) {
      throw new ApiError('UNAUTHORIZED', '登录已过期，请重新登录', 401);
    }
    if (refreshPromise) return refreshPromise;
    const connection = state.connection;
    const oldRefreshToken = refreshToken;
    refreshPromise = (async () => {
      try {
        const result = await direct<LoginResult>(
          'post',
          '/auth/mobile/refresh',
          { refreshToken: oldRefreshToken },
          ticket,
        );
        if (!result.accessToken) throw new Error('服务器未返回访问令牌');
        accessToken = result.accessToken;
        refreshToken = result.refreshToken ?? oldRefreshToken;
        state.user = result.user;
        const session: StoredMobileSession = { user: result.user, refreshToken };
        await platform.setSession(connection, session);
      } catch (error) {
        if (isApiError(error, 401) && ticket === generation)
          await expireSession('移动会话已失效，请重新登录');
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function request<T>(
    method: Method,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const ticket = generation;
    try {
      return await direct<T>(method, path, body, ticket);
    } catch (error) {
      if (ticket !== generation) throw abortError();
      const isAuthEndpoint = path.startsWith('/auth/');
      if (
        isApiError(error, 401) &&
        platform.kind === 'android' &&
        !isAuthEndpoint &&
        options.retryAuth !== false &&
        refreshToken
      ) {
        await refreshMobileSession(ticket);
        return request<T>(method, path, body, { ...options, retryAuth: false });
      }
      if (isApiError(error, 401) && !isAuthEndpoint && !options.public) {
        await expireSession('登录状态已过期，请重新登录');
      }
      throw error;
    }
  }

  function validateServerInfo(info: ServerInfo) {
    if (info.service !== 'drill-hub') throw new Error('该地址不是 Drill Hub 学习服务器');
    if (info.apiMajor !== API_VERSION) {
      throw new Error(`服务器 API 主版本为 ${info.apiMajor}，当前客户端仅支持 ${API_VERSION}`);
    }
    if (!info.instanceId || !info.displayName) throw new Error('服务器身份信息不完整，已停止连接');
  }

  async function initialize(): Promise<void> {
    state.ready = false;
    state.bootError = '';
    state.authNotice = '';
    resetRuntime();
    try {
      const connection = await platform.getConnection();
      state.connection = connection;
      if (!connection) return;
      makeClient();
      const info = await direct<ServerInfo>('get', '/server-info', undefined, generation);
      validateServerInfo(info);
      state.serverInfo = info;
      if (platform.kind === 'web') {
        state.connection = {
          baseUrl: connection.baseUrl,
          instanceId: info.instanceId,
          displayName: info.displayName,
        };
      }

      if (platform.kind === 'android') {
        if (connection.instanceId !== info.instanceId) {
          await platform.setSession(connection, null).catch(() => undefined);
          const changed: ServerConnection = {
            baseUrl: connection.baseUrl,
            instanceId: info.instanceId,
            displayName: info.displayName,
          };
          state.connection = changed;
          await platform.setConnection(changed);
          makeClient();
          return;
        }
        const stored = await platform.getSession(connection);
        if (stored?.refreshToken) {
          refreshToken = stored.refreshToken;
          state.user = stored.user;
          try {
            await refreshMobileSession(generation);
          } catch (error) {
            if (!isApiError(error, 401)) throw error;
            await platform.setSession(connection, null).catch(() => undefined);
          }
        }
      } else {
        try {
          state.user = await direct<UserView>('get', '/me');
          const csrf = await direct<CsrfResult>('get', '/auth/csrf');
          requireClient().setCsrfToken(csrf.csrfToken);
        } catch (error) {
          if (!isApiError(error, 401)) throw error;
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        state.bootError = errorMessage(error);
        state.user = null;
      }
    } finally {
      state.ready = true;
    }
  }

  async function verifyConnection(
    input: string,
  ): Promise<{ connection: ServerConnection; info: ServerInfo }> {
    let baseUrl: string;
    try {
      baseUrl = normalizeServerUrl(input);
    } catch (error) {
      throw new Error(errorMessage(error));
    }
    const verifier = new ApiClient({ baseUrl, credentials: 'omit' });
    let info: ServerInfo;
    try {
      info = await verifier.get<ServerInfo>('/server-info');
    } catch (error) {
      throw new Error(errorMessage(error));
    } finally {
      verifier.dispose();
    }
    validateServerInfo(info);
    return {
      info,
      connection: { baseUrl, instanceId: info.instanceId, displayName: info.displayName },
    };
  }

  async function confirmConnection(connection: ServerConnection, info: ServerInfo) {
    const previous = state.connection;
    resetRuntime();
    if (platform.kind === 'android' && previous) {
      await platform.setSession(previous, null).catch(() => undefined);
    }
    state.connection = connection;
    state.serverInfo = info;
    state.bootError = '';
    state.authNotice = '';
    await platform.setConnection(connection);
    makeClient();
  }

  async function disconnect() {
    const previous = state.connection;
    resetRuntime();
    if (platform.kind === 'android' && previous) {
      await platform.setSession(previous, null).catch(() => undefined);
    }
    state.connection = null;
    state.bootError = '';
    state.authNotice = '';
    await platform.setConnection(null);
  }

  async function login(username: string, password: string): Promise<UserView> {
    if (!state.connection || !state.serverInfo) throw new Error('请先验证并确认学习服务器');
    const path = platform.kind === 'web' ? '/auth/web/login' : '/auth/mobile/login';
    const result = await request<LoginResult>(
      'post',
      path,
      { username, password },
      { public: true, retryAuth: false },
    );
    if (platform.kind === 'android') {
      if (!result.accessToken || !result.refreshToken)
        throw new Error('服务器未返回完整的移动会话凭据');
      accessToken = result.accessToken;
      refreshToken = result.refreshToken;
      await platform.setSession(state.connection, {
        user: result.user,
        refreshToken: result.refreshToken,
      });
    } else if (result.csrfToken) {
      requireClient().setCsrfToken(result.csrfToken);
    }
    state.user = result.user;
    state.authNotice = '';
    return result.user;
  }

  async function logout() {
    const connection = state.connection;
    const serverInfo = state.serverInfo;
    try {
      if (client) await request('post', '/auth/logout', {}, { public: true, retryAuth: false });
    } finally {
      if (platform.kind === 'android' && connection) {
        await platform.setSession(connection, null).catch(() => undefined);
      }
      resetRuntime();
      state.connection = connection;
      state.serverInfo = serverInfo;
      makeClient();
      if (platform.kind === 'web' && client) {
        try {
          const csrf = await direct<CsrfResult>('get', '/auth/csrf');
          client.setCsrfToken(csrf.csrfToken);
        } catch {
          // The next login will surface connectivity errors.
        }
      }
    }
  }

  async function refreshMe(): Promise<UserView> {
    const user = await request<UserView>('get', '/me');
    state.user = user;
    if (platform.kind === 'android' && state.connection && refreshToken) {
      await platform.setSession(state.connection, { user, refreshToken });
    }
    return user;
  }

  const get = <T>(path: string) => request<T>('get', path);
  const post = <T>(path: string, body?: unknown) => request<T>('post', path, body);
  const patch = <T>(path: string, body?: unknown) => request<T>('patch', path, body);
  const put = <T>(path: string, body?: unknown) => request<T>('put', path, body);
  const publicGet = <T>(path: string, token: string) => publicRequest<T>('get', path, token);
  const publicPost = <T>(path: string, token: string, body?: unknown) =>
    publicRequest<T>('post', path, token, body);
  const publicPut = <T>(path: string, token: string, body?: unknown) =>
    publicRequest<T>('put', path, token, body);

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      state.online = true;
    });
    window.addEventListener('offline', () => {
      state.online = false;
    });
  }

  return {
    platform,
    state,
    initialize,
    verifyConnection,
    confirmConnection,
    disconnect,
    login,
    logout,
    refreshMe,
    get,
    post,
    patch,
    put,
    publicGet,
    publicPost,
    publicPut,
    notify: {
      success: (title: string, description?: string) => notify('success', title, description),
      error: (title: string, description?: string) => notify('error', title, description),
      info: (title: string, description?: string) => notify('info', title, description),
      warning: (title: string, description?: string) => notify('warning', title, description),
    },
  };
}

export type LearningContext = ReturnType<typeof createLearningContext>;
