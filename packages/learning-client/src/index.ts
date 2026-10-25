import { createApp, watch, type App as VueApp } from 'vue';
import App from './App.vue';
import { createLearningContext } from './context';
import { learningContextKey } from './injection';
import { createLearningRouter } from './router';
import { initAssistantStore } from './assistant/store';
import type { ClientPlatform } from '@drill-hub/contracts';
import { i18n, initializeLocale } from './i18n';
import './theme';
import './style.css';

export interface CreateLearningAppOptions {
  platform: ClientPlatform;
}

export function createLearningApp({ platform }: CreateLearningAppOptions): VueApp {
  initializeLocale(platform);
  const context = createLearningContext(platform);
  const ready = context.initialize();
  const router = createLearningRouter(context, ready);
  initAssistantStore(context, router);
  const app = createApp(App);
  app.provide(learningContextKey, context);
  app.use(i18n);
  app.use(router);

  watch(
    () => context.state.user,
    (user, previous) => {
      if (!user && previous && router.currentRoute.value.meta.requiresAuth) {
        void router.push({ name: 'login' });
      }
    },
  );

  return app;
}
