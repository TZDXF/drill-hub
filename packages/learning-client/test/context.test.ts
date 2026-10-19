import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ClientPlatform,
  ServerConnection,
  ServerInfo,
  StoredMobileSession,
  UserView,
} from '@drill-hub/contracts';
import { createLearningContext } from '../src/context';

const connection: ServerConnection = {
  baseUrl: 'https://study.example.org',
  instanceId: 'instance-one',
  displayName: '测试服务器',
};
const serverInfo: ServerInfo = {
  service: 'drill-hub',
  instanceId: connection.instanceId,
  displayName: connection.displayName,
  apiMajor: 1,
  minClientVersion: '0.1.0',
  capabilities: [],
  publicBaseUrl: connection.baseUrl,
  publicUrlSource: 'configured',
  isLoopback: false,
};
const user: UserView = {
  id: 'user-one',
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
  revision: 1,
  username: 'learner',
  displayName: '学习者',
  role: 'user',
  status: 'active',
  mustChangePassword: false,
};

function success(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code }, meta: {} }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makePlatform(kind: 'web' | 'android') {
  let storedSession: StoredMobileSession | null = null;
  const platform: ClientPlatform = {
    kind,
    sessionPersistence: 'memory',
    getLocale: () => null,
    setLocale() {},
    async getConnection() {
      return { ...connection };
    },
    async setConnection() {},
    async getSession() {
      return storedSession;
    },
    async setSession(_connection, value) {
      storedSession = value;
    },
  };
  return { platform, storedSession: () => storedSession };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('learning context session lifecycle', () => {
  it('keeps verified server information so login works after logout', async () => {
    const { platform } = makePlatform('web');
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const pathname = new URL(input instanceof URL ? input : String(input)).pathname;
      const method = init?.method ?? 'GET';
      if (method === 'GET' && pathname.endsWith('/server-info')) return success(serverInfo);
      if (method === 'POST' && pathname.endsWith('/auth/web/login'))
        return success({ user, csrfToken: 'csrf-token' });
      if (method === 'POST' && pathname.endsWith('/auth/logout'))
        return success({ loggedOut: true });
      return failure(401, 'UNAUTHENTICATED');
    });
    vi.stubGlobal('fetch', fetchMock);
    const context = createLearningContext(platform);
    await context.initialize();
    await context.login('learner', 'secret');

    await context.logout();

    expect(context.state.connection).toEqual(connection);
    expect(context.state.serverInfo).toEqual(serverInfo);
    await expect(context.login('learner', 'secret')).resolves.toEqual(user);
    expect(context.state.user).toEqual(user);
  });

  it('retains a mobile session after a transient refresh network failure', async () => {
    const { platform, storedSession } = makePlatform('android');
    let failRefresh = true;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const pathname = new URL(input instanceof URL ? input : String(input)).pathname;
      const method = init?.method ?? 'GET';
      if (method === 'GET' && pathname.endsWith('/server-info')) return success(serverInfo);
      if (method === 'POST' && pathname.endsWith('/auth/mobile/login')) {
        return success({ user, accessToken: 'access-one', refreshToken: 'refresh-one' });
      }
      if (method === 'POST' && pathname.endsWith('/auth/mobile/refresh')) {
        if (failRefresh) {
          failRefresh = false;
          throw new TypeError('temporary network failure');
        }
        return success({ user, accessToken: 'access-two', refreshToken: 'refresh-two' });
      }
      if (method === 'GET' && pathname.endsWith('/topics')) {
        const authorization = new Headers(init?.headers).get('Authorization');
        return authorization === 'Bearer access-two'
          ? success([])
          : failure(401, 'SESSION_EXPIRED');
      }
      return failure(500, 'UNEXPECTED_REQUEST');
    });
    vi.stubGlobal('fetch', fetchMock);
    const context = createLearningContext(platform);
    await context.initialize();
    await context.login('learner', 'secret');

    await expect(context.get('/topics')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(context.state.user).toEqual(user);
    expect(storedSession()?.refreshToken).toBe('refresh-one');

    await expect(context.get<unknown[]>('/topics')).resolves.toEqual([]);
    expect(context.state.user).toEqual(user);
    expect(storedSession()?.refreshToken).toBe('refresh-two');
  });
});
