import { createApp, watch, type App as VueApp } from 'vue';
import App from '#learning-client/App.vue';
import { createLearningContext } from '#learning-client/context';
import { learningContextKey } from '#learning-client/injection';
import { createLearningRouter } from '#learning-client/router';
import { initAssistantStore } from '#learning-client/assistant/store';
import type { ClientPlatform } from '@drill-hub/contracts';
import { i18n, initializeLocale } from '#learning-client/i18n';
import '#learning-client/theme';
import '#learning-client/style.css';

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
