<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ToastProvider } from 'reka-ui';
import { useLearning } from './injection';
import AppIcon from './components/AppIcon.vue';
import AppMessageHost from './components/AppMessageHost.vue';

const learning = useLearning();
const router = useRouter();
const { t } = useI18n();

async function retry() {
  await learning.initialize();
  await router.replace(
    learning.state.connection
      ? '/login'
      : learning.platform.kind === 'android'
        ? '/connect'
        : '/login',
  );
}

async function changeServer() {
  await learning.disconnect();
  await router.replace('/connect');
}
</script>

<template>
  <ToastProvider>
    <div v-if="!learning.state.ready" class="boot-screen" aria-live="polite">
      <div class="brand-mark brand-mark--large"><AppIcon name="book" :size="28" /></div>
      <strong>{{ t('core.boot.preparing') }}</strong>
      <span>{{ t('core.boot.verifying') }}</span>
    </div>
    <main v-else-if="learning.state.bootError" class="boot-screen boot-screen--error">
      <div class="brand-mark brand-mark--large"><AppIcon name="alert" :size="28" /></div>
      <h1>{{ t('core.boot.unreachable') }}</h1>
      <p>{{ learning.state.bootError }}</p>
      <div class="button-row">
        <button class="button button--primary" type="button" @click="retry">
          {{ t('core.boot.reconnect') }}
        </button>
        <button
          v-if="learning.platform.kind === 'android'"
          class="button"
          type="button"
          @click="changeServer"
        >
          {{ t('core.boot.changeServer') }}
        </button>
      </div>
    </main>
    <RouterView v-else />
    <AppMessageHost />
  </ToastProvider>
</template>
