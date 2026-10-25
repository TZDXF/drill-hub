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
    /** 关闭按钮的无障碍文案，默认复用通用确认文案。 */
    closeLabel?: string;
    /** 为 true 时禁用关闭按钮并屏蔽 Esc / 点击遮罩关闭。 */
    busy?: boolean;
  }>(),
  { busy: false },
);

defineOptions({ inheritAttrs: false });
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <!-- class 与内容区事件经 attrs 由调用方传入，避免和各弹层的专属样式耦合。 -->
      <DialogContent
        v-bind="$attrs"
        @escape-key-down="busy && $event.preventDefault()"
        @pointer-down-outside="busy && $event.preventDefault()"
      >
        <slot name="top" />
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
              :aria-label="closeLabel ?? t('components.confirm.close')"
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
        <div v-if="$slots.actions" class="dialog-actions">
          <slot name="actions" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
