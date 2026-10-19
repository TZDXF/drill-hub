import { watch } from 'vue';
import { createI18n } from 'vue-i18n';
import type { ClientLocale, ClientPlatform } from '@drill-hub/contracts';
import componentsZh from './locales/components.zh-CN.json';
import componentsEn from './locales/components.en.json';
import managementZh from './locales/management.zh-CN.json';
import managementEn from './locales/management.en.json';
import learningZh from './locales/learning.zh-CN.json';
import learningEn from './locales/learning.en.json';
import coreZh from './locales/core.zh-CN.json';
import coreEn from './locales/core.en.json';

export const messages = {
  'zh-CN': {
    components: componentsZh,
    management: managementZh,
    learning: learningZh,
    core: coreZh,
  },
  en: {
    components: componentsEn,
    management: managementEn,
    learning: learningEn,
    core: coreEn,
  },
};

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN' as ClientLocale,
  fallbackLocale: 'zh-CN',
  messages,
});

export const appLocale = i18n.global.locale;
export const t = i18n.global.t;
let localePlatform: ClientPlatform | null = null;

function updateDocumentLanguage(locale: ClientLocale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.title = t('core.app.title');
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', t('core.app.description'));
  }
}

watch(appLocale, updateDocumentLanguage, { flush: 'sync' });

export function initializeLocale(platform: ClientPlatform): void {
  localePlatform = platform;
  let stored: string | null = null;
  try {
    stored = platform.getLocale();
  } catch {
    // An unavailable preference store must not prevent the app from starting.
  }
  appLocale.value = stored === 'en' ? 'en' : 'zh-CN';
  updateDocumentLanguage(appLocale.value);
}

export function setLocale(locale: ClientLocale): void {
  if (locale !== 'zh-CN' && locale !== 'en') return;
  appLocale.value = locale;
  try {
    localePlatform?.setLocale(locale);
  } catch {
    // Keep the in-memory preference even if persistence is unavailable.
  }
}

export function toggleLocale(): void {
  setLocale(appLocale.value === 'zh-CN' ? 'en' : 'zh-CN');
}

export function useLocale() {
  return { locale: appLocale, setLocale, toggleLocale };
}
