<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import AppIcon from './AppIcon.vue';
import AppScrollArea from './AppScrollArea.vue';

const { t } = useI18n();

const open = defineModel<boolean>('open', { required: true });
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    busy?: boolean;
    confirmDisabled?: boolean;
    danger?: boolean;
  }>(),
  { confirmDisabled: false, danger: false },
);
const emit = defineEmits<{ confirm: [] }>();
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent
        class="dialog-content"
        @escape-key-down="busy && $event.preventDefault()"
        @pointer-down-outside="busy && $event.preventDefault()"
      >
        <div class="dialog-heading">
          <div>
            <DialogTitle class="dialog-title">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="dialog-description">{{
              description
            }}</DialogDescription>
          </div>
          <DialogClose as-child>
            <button
              class="icon-button"
              type="button"
              :aria-label="t('components.confirm.close')"
              :disabled="busy"
            >
              <AppIcon name="close" />
            </button>
          </DialogClose>
        </div>
        <AppScrollArea
          class="dialog-body"
          viewport-class="dialog-body__viewport"
          orientation="vertical"
          type="hover"
        >
          <slot />
        </AppScrollArea>
        <div class="dialog-actions">
          <slot name="actions" />
          <DialogClose as-child>
            <button class="button" type="button" :disabled="busy">
              {{ cancelLabel ?? t('components.confirm.cancel') }}
            </button>
          </DialogClose>
          <button
            class="button"
            :class="danger ? 'button--danger' : 'button--primary'"
            type="button"
            :disabled="busy || confirmDisabled"
            @click="emit('confirm')"
          >
            <span v-if="busy" class="spinner" />{{
              confirmLabel ?? t('components.confirm.confirm')
            }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
