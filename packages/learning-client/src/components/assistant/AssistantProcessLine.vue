<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import type { AssistantActionItem } from '../../assistant/turns';
import AppIcon from '../AppIcon.vue';

/**
 * 一轮对话的过程展示：活动轮只显示一行最新状态，完成后折叠为
 * 「执行了 X 秒 · N 项操作」一行，展开查看关键操作（无关调用已被过滤）。
 */
const props = defineProps<{
  actions: AssistantActionItem[];
  active: boolean;
  /** 活动轮当前是否有流式文本输出。 */
  streaming: boolean;
  durationMs: number | null;
  failed: boolean;
}>();

const { t } = useI18n();

const runningAction = computed(() => props.actions.find((action) => action.running) ?? null);

const summary = computed(() => {
  if (props.durationMs == null)
    return t('components.assistant.processCount', { count: props.actions.length });
  return t('components.assistant.processSummary', {
    seconds: (props.durationMs / 1000).toFixed(1),
    count: props.actions.length,
  });
});

function actionLabel(action: AssistantActionItem): string {
  const values = { ...action.values };
  if (action.key === 'navigate')
    values.route = t(`components.assistant.actions.routes.${values.route ?? ''}`);
  const base = t(`components.assistant.actions.${action.key}`, values);
  return action.running ? t('components.assistant.actions.running', { action: base }) : base;
}
</script>

<template>
  <div
    v-if="active && (runningAction || !streaming)"
    class="assistant-process__live"
    data-testid="assistant-event-card"
  >
    <template v-if="runningAction">
      <AppIcon :name="runningAction.icon" :size="14" class="assistant-process__spinner" />
      <span>{{ actionLabel(runningAction) }}</span>
    </template>
    <template v-else>
      <span class="assistant-dotting" aria-hidden="true"></span>
      <span data-testid="assistant-waiting">{{ t('components.assistant.thinking') }}</span>
    </template>
  </div>
  <CollapsibleRoot v-else-if="!active && (actions.length || failed)" class="assistant-process">
    <CollapsibleTrigger class="assistant-process__trigger">
      <AppIcon name="down" :size="13" class="assistant-process__chevron" />
      <span v-if="actions.length">{{ summary }}</span>
      <span v-if="failed" class="assistant-process__failed">{{
        t('components.assistant.turnFailed')
      }}</span>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ul v-if="actions.length" class="assistant-process__list">
        <li
          v-for="action in actions"
          :key="action.seq"
          :class="{ 'assistant-process__item--failed': action.failed }"
        >
          <AppIcon :name="action.icon" :size="13" />
          <span>{{ actionLabel(action) }}</span>
        </li>
      </ul>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
