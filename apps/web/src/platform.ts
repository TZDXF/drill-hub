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
  getAssistantPanelPreferences() {
    try {
      return globalThis.localStorage.getItem('drill-hub.assistant-panel');
    } catch {
      return null;
    }
  },
  setAssistantPanelPreferences(value) {
    try {
      globalThis.localStorage.setItem('drill-hub.assistant-panel', value);
    } catch {
      // Panel controls remain available when preference storage is blocked.
    }
  },
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
