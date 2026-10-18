import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClientPlatform,
  ServerConnection,
  StoredMobileSession,
  UserView,
} from '@drill-hub/contracts';

const CONNECTION_STORAGE_KEY = 'drill-hub.mobile.connection.v1';

function createMemoryLocalStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function makeConnection(
  baseUrl: string,
  instanceId: string,
  displayName = '测试服务',
): ServerConnection {
  return { baseUrl, instanceId, displayName };
}

function makeUser(id: string, username: string): UserView {
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
    username,
    displayName: `${username} 的显示名`,
    role: 'user',
    status: 'active',
    mustChangePassword: false,
  };
}

function makeSession(id: string, username: string, refreshToken: string): StoredMobileSession {
  return {
    user: makeUser(id, username),
    refreshToken,
  };
}

async function loadPlatform(): Promise<ClientPlatform> {
  const module = await import('../src/platform.js');
  return module.androidPlatform;
}

let storage = createMemoryLocalStorage();

beforeEach(() => {
  vi.resetModules();
  storage = createMemoryLocalStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('mobile platform connection storage', () => {
  it('normalizes HTTP and HTTPS base URLs and connection metadata', async () => {
    const platform = await loadPlatform();

    await platform.setConnection({
      baseUrl: '  https://Study.Example.org/learn///  ',
      instanceId: '  instance-one  ',
      displayName: '   ',
    });

    expect(await platform.getConnection()).toEqual({
      baseUrl: 'https://study.example.org/learn',
      instanceId: 'instance-one',
      displayName: 'https://study.example.org/learn',
    });
  });
  it('accepts HTTP base URLs for remote deployments', async () => {
    const platform = await loadPlatform();

    await platform.setConnection({
      baseUrl: ' http://Study.Example.org:8080/learn/// ',
      instanceId: 'instance-one',
      displayName: 'Study Server',
    });

    expect(await platform.getConnection()).toEqual({
      baseUrl: 'http://study.example.org:8080/learn',
      instanceId: 'instance-one',
      displayName: 'Study Server',
    });
  });

  it.each([
    ['empty', '', 'Server base URL is required.'],
    ['malformed', 'not a URL', 'Server base URL is not a valid URL.'],
    [
      'query',
      'https://study.example.org?tenant=1',
      'Server base URL must not contain a query or fragment.',
    ],
    [
      'fragment',
      'https://study.example.org/#section',
      'Server base URL must not contain a query or fragment.',
    ],
    ['unsupported-protocol', 'ftp://study.example.org', 'Server base URL must use HTTP or HTTPS.'],
    [
      'credential-bearing',
      'https://user:password@study.example.org',
      'Server base URL must not contain credentials.',
    ],
  ] as const)('rejects an invalid %s base URL', async (_label, baseUrl, message) => {
    const platform = await loadPlatform();

    await expect(platform.setConnection(makeConnection(baseUrl, 'instance-one'))).rejects.toThrow(
      message,
    );
    expect(storage.length).toBe(0);
  });

  it('persists only normalized connection metadata and reloads it', async () => {
    const platform = await loadPlatform();
    const connection = makeConnection(
      'https://study.example.org/learn///',
      '  instance-one  ',
      '  Study Server  ',
    );

    await platform.setConnection(connection);

    const raw = storage.getItem(CONNECTION_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw as string) as Record<string, unknown>;
    expect(stored).toEqual({
      baseUrl: 'https://study.example.org/learn',
      instanceId: 'instance-one',
      displayName: 'Study Server',
    });
    expect(Object.keys(stored).sort()).toEqual(['baseUrl', 'displayName', 'instanceId']);
    expect(JSON.stringify(stored)).not.toMatch(/password|token|secret|credential/i);

    vi.resetModules();
    const reloaded = await loadPlatform();
    expect(await reloaded.getConnection()).toEqual(stored);
  });
});

describe('mobile platform in-memory sessions', () => {
  it('isolates sessions by normalized baseUrl and instanceId', async () => {
    const platform = await loadPlatform();
    const alphaShared = makeConnection('https://alpha.example.org', 'shared-instance');
    const alphaOther = makeConnection('https://alpha.example.org', 'other-instance');
    const betaShared = makeConnection('https://beta.example.org', 'shared-instance');
    const alphaSession = makeSession('user-alpha', 'alpha-user', 'refresh-alpha');
    const otherSession = makeSession('user-other', 'other-user', 'refresh-other');
    const betaSession = makeSession('user-beta', 'beta-user', 'refresh-beta');

    await platform.setSession(alphaShared, alphaSession);
    await platform.setSession(alphaOther, otherSession);
    await platform.setSession(betaShared, betaSession);

    expect(await platform.getSession(alphaShared)).toEqual(alphaSession);
    expect(await platform.getSession(alphaOther)).toEqual(otherSession);
    expect(await platform.getSession(betaShared)).toEqual(betaSession);
    expect(
      await platform.getSession(
        makeConnection('https://alpha.example.org///', ' shared-instance '),
      ),
    ).toEqual(alphaSession);
    expect(
      await platform.getSession(
        makeConnection('https://alpha.example.org', 'shared-instance', '其他名称'),
      ),
    ).toEqual(alphaSession);

    await platform.setSession(alphaShared, null);
    expect(await platform.getSession(alphaShared)).toBeNull();
    expect(await platform.getSession(alphaOther)).toEqual(otherSession);
    expect(await platform.getSession(betaShared)).toEqual(betaSession);
  });

  it('returns deep copies from connection and session getters', async () => {
    const platform = await loadPlatform();
    const connection = makeConnection('https://study.example.org', 'instance-one');
    const session = makeSession('user-one', 'student-one', 'refresh-one');

    await platform.setConnection(connection);
    const connectionCopy = await platform.getConnection();
    expect(connectionCopy).toEqual(connection);
    expect(connectionCopy).not.toBe(connection);
    connectionCopy!.instanceId = 'mutated-instance';
    expect((await platform.getConnection())?.instanceId).toBe('instance-one');

    await platform.setSession(connection, session);
    const sessionCopy = await platform.getSession(connection);
    expect(sessionCopy).toEqual(session);
    expect(sessionCopy).not.toBe(session);
    expect(sessionCopy?.user).not.toBe(session.user);

    sessionCopy!.refreshToken = 'mutated-refresh-token';
    sessionCopy!.user.username = 'mutated-user';

    const nextCopy = await platform.getSession(connection);
    expect(nextCopy).toEqual(session);
    expect(nextCopy).not.toBe(sessionCopy);
  });

  it('has no sessions after a process reload while connection metadata remains', async () => {
    const platform = await loadPlatform();
    const connection = makeConnection('https://study.example.org', 'instance-one');
    const session = makeSession('user-one', 'student-one', 'refresh-one');

    await platform.setConnection(connection);
    await platform.setSession(connection, session);
    expect(await platform.getSession(connection)).toEqual(session);

    vi.resetModules();
    const reloaded = await loadPlatform();

    expect(await reloaded.getConnection()).toEqual(connection);
    expect(await reloaded.getSession(connection)).toBeNull();
  });
});
