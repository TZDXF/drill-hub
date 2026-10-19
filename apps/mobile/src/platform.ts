import type { ClientPlatform, ServerConnection, StoredMobileSession } from '@drill-hub/contracts';

const CONNECTION_STORAGE_KEY = 'drill-hub.mobile.connection.v1';

// Refresh tokens and user data intentionally live only in this process.
const sessions = new Map<string, StoredMobileSession>();

let connectionLoaded = false;
let currentConnection: ServerConnection | null = null;

function normalizeBaseUrl(value: string): string {
  const input = value.trim();

  if (!input) {
    throw new TypeError('Server base URL is required.');
  }
  if (input.includes('?') || input.includes('#')) {
    throw new TypeError('Server base URL must not contain a query or fragment.');
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError('Server base URL is not a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Server base URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password) {
    throw new TypeError('Server base URL must not contain credentials.');
  }

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

function normalizeConnection(value: ServerConnection): ServerConnection {
  const instanceId = value.instanceId.trim();
  if (!instanceId) {
    throw new TypeError('Server instanceId is required.');
  }

  const baseUrl = normalizeBaseUrl(value.baseUrl);
  return {
    baseUrl,
    instanceId,
    displayName: value.displayName.trim() || baseUrl,
  };
}

function connectionKey(connection: ServerConnection): string {
  const normalized = normalizeConnection(connection);
  return JSON.stringify([normalized.baseUrl, normalized.instanceId]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStoredConnection(): ServerConnection | null {
  try {
    const raw = globalThis.localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      typeof value.baseUrl !== 'string' ||
      typeof value.instanceId !== 'string' ||
      typeof value.displayName !== 'string'
    ) {
      return null;
    }

    return normalizeConnection({
      baseUrl: value.baseUrl,
      instanceId: value.instanceId,
      displayName: value.displayName,
    });
  } catch {
    return null;
  }
}

function writeStoredConnection(value: ServerConnection | null): void {
  try {
    if (value) {
      globalThis.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(value));
    } else {
      globalThis.localStorage.removeItem(CONNECTION_STORAGE_KEY);
    }
  } catch {
    // Connection metadata remains available for this process without storage.
  }
}

function copySession(value: StoredMobileSession): StoredMobileSession {
  return {
    user: { ...value.user },
    refreshToken: value.refreshToken,
  };
}

export const androidPlatform: ClientPlatform = {
  kind: 'android',
  sessionPersistence: 'memory',
  getLocale() {
    try {
      return globalThis.localStorage.getItem('drill-hub.locale');
    } catch {
      return null;
    }
  },
  setLocale(locale) {
    try {
      globalThis.localStorage.setItem('drill-hub.locale', locale);
    } catch {
      // Language switching remains available when preference storage is blocked.
    }
  },

  async getConnection() {
    if (!connectionLoaded) {
      currentConnection = readStoredConnection();
      connectionLoaded = true;
    }

    return currentConnection ? { ...currentConnection } : null;
  },

  async setConnection(value) {
    const normalized = value ? normalizeConnection(value) : null;
    currentConnection = normalized;
    connectionLoaded = true;
    writeStoredConnection(normalized);
  },

  async getSession(connection) {
    const session = sessions.get(connectionKey(connection));
    return session ? copySession(session) : null;
  },

  async setSession(connection, value) {
    const key = connectionKey(connection);

    if (value === null) {
      sessions.delete(key);
      return;
    }

    if (
      !value.user ||
      typeof value.user.id !== 'string' ||
      !value.user.id ||
      typeof value.refreshToken !== 'string' ||
      !value.refreshToken
    ) {
      throw new TypeError('A complete mobile session is required.');
    }

    sessions.set(key, copySession(value));
  },
};

export default androidPlatform;
