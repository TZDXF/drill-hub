import type { ClientPlatform, ServerConnection, StoredMobileSession } from '@drill-hub/contracts';

const deploymentUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
const baseUrl = deploymentUrl.origin + deploymentUrl.pathname.replace(/\/+$/, '');
const connection: ServerConnection = {
  baseUrl,
  instanceId: 'web',
  displayName: '当前学习服务器',
};

export const webPlatform: ClientPlatform = {
  kind: 'web',
  sessionPersistence: 'memory',
  async getConnection() {
    return { ...connection };
  },
  async setConnection() {
    // Web connections always follow the current origin and deployment base.
  },
  async getSession(): Promise<StoredMobileSession | null> {
    return null;
  },
  async setSession() {
    // Browser credentials remain in HttpOnly cookies, never in Web Storage.
  },
};
