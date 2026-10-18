import { createApp, watch, type App as VueApp } from 'vue';
import App from './App.vue';
import { createLearningContext } from './context';
import { learningContextKey } from './injection';
import { createLearningRouter } from './router';
import type { ClientPlatform } from '@drill-hub/contracts';
import './style.css';

export interface CreateLearningAppOptions {
  platform: ClientPlatform;
}

export function createLearningApp({ platform }: CreateLearningAppOptions): VueApp {
  const context = createLearningContext(platform);
  const ready = context.initialize();
  const router = createLearningRouter(context, ready);
  const app = createApp(App);
  app.provide(learningContextKey, context);
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
