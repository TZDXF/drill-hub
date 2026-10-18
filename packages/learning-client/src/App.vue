<script setup lang="ts">
import { useRouter } from 'vue-router';
import { ToastProvider } from 'reka-ui';
import { useLearning } from './injection';
import AppIcon from './components/AppIcon.vue';
import AppMessageHost from './components/AppMessageHost.vue';

const learning = useLearning();
const router = useRouter();

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
      <strong>正在准备学习工作台</strong>
      <span>验证服务器与恢复安全会话…</span>
    </div>
    <main v-else-if="learning.state.bootError" class="boot-screen boot-screen--error">
      <div class="brand-mark brand-mark--large"><AppIcon name="alert" :size="28" /></div>
      <h1>暂时无法连接</h1>
      <p>{{ learning.state.bootError }}</p>
      <div class="button-row">
        <button class="button button--primary" type="button" @click="retry">重新连接</button>
        <button
          v-if="learning.platform.kind === 'android'"
          class="button"
          type="button"
          @click="changeServer"
        >
          更换服务器
        </button>
      </div>
    </main>
    <RouterView v-else />
    <AppMessageHost />
  </ToastProvider>
</template>
