<script setup lang="ts">
import { watch } from 'vue';
import {
  ToastClose,
  ToastDescription,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  useToastManager,
} from 'reka-ui';
import { useLearning } from '../injection';
import AppIcon from './AppIcon.vue';

const learning = useLearning();
const { toasts, add } = useToastManager();

const icons = {
  success: 'check',
  error: 'alert',
  warning: 'alert',
  info: 'clock',
} as const;

watch(
  () => learning.state.messages.length,
  () => {
    const pending = learning.state.messages.splice(0);
    for (const message of pending) {
      add({
        title: message.title,
        description: message.description,
        status: message.tone,
        duration: message.tone === 'error' ? 7000 : 4500,
      });
    }
  },
  { flush: 'post', immediate: true },
);
</script>

<template>
  <ToastRoot
    v-for="toast in toasts"
    :key="toast.id"
    :toast="toast"
    class="app-toast"
    :class="`app-toast--${toast.status ?? 'info'}`"
    :type="toast.status === 'error' || toast.status === 'warning' ? 'foreground' : 'background'"
  >
    <span class="app-toast__icon" aria-hidden="true">
      <AppIcon :name="icons[toast.status as keyof typeof icons] ?? icons.info" :size="18" />
    </span>
    <div class="app-toast__copy">
      <ToastTitle class="app-toast__title">{{ toast.title }}</ToastTitle>
      <ToastDescription v-if="toast.description" class="app-toast__description">{{
        toast.description
      }}</ToastDescription>
    </div>
    <ToastClose class="app-toast__close" aria-label="关闭通知">
      <AppIcon name="close" :size="16" />
    </ToastClose>
  </ToastRoot>
  <ToastViewport class="app-toast-viewport" label="通知" />
</template>
