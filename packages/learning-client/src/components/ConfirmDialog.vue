<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { DialogClose } from 'reka-ui';
import AppDialog from '#learning-client/components/AppDialog.vue';

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
  <AppDialog
    v-model:open="open"
    class="dialog-content"
    :title="title"
    :description="description"
    :busy="busy"
  >
    <slot />
    <template #actions>
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
        <span v-if="busy" class="spinner" />{{ confirmLabel ?? t('components.confirm.confirm') }}
      </button>
    </template>
  </AppDialog>
</template>
