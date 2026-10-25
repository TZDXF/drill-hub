<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import type { AssistantActionItem } from '#learning-client/assistant/turns';
import AppIcon from '#learning-client/components/AppIcon.vue';
const props = withDefaults(
  defineProps<{
    actions: AssistantActionItem[];
    active: boolean;
    streaming: boolean;
    durationMs: number | null;
    failed: boolean;
    reasoning?: string | null;
    reasoningStreaming?: boolean;
  }>(),
  { reasoning: null, reasoningStreaming: false },
);
const { t } = useI18n();
const runningAction = computed(() => props.actions.find((action) => action.running) ?? null);
const summary = computed(() =>
  props.durationMs == null
    ? t('components.assistant.processCount', { count: props.actions.length })
    : t('components.assistant.processSummary', {
        seconds: (props.durationMs / 1000).toFixed(1),
        count: props.actions.length,
      }),
);
function actionLabel(action: AssistantActionItem): string {
  const values = { ...action.values };
  if (action.key === 'navigate')
    values.route = t(`components.assistant.actions.routes.${values.route ?? ''}`);
  const base = t(`components.assistant.actions.${action.key}`, values);
  return action.running ? t('components.assistant.actions.running', { action: base }) : base;
}
function json(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}
</script>
<template>
  <div class="assistant-process-wrap">
    <div
      v-if="active && (runningAction || reasoning)"
      class="assistant-process__live"
      data-testid="assistant-event-card"
    >
      <template v-if="runningAction"
        ><AppIcon
          :name="runningAction.icon"
          :size="14"
          class="assistant-process__spinner"
        /><span>{{ actionLabel(runningAction) }}</span></template
      >
      <template v-else
        ><span class="assistant-dotting" aria-hidden="true" /><span
          data-testid="assistant-waiting"
          >{{
            reasoning ? t('components.assistant.reasoning') : t('components.assistant.thinking')
          }}</span
        ></template
      >
    </div>
    <CollapsibleRoot
      v-else-if="!active && (actions.length || failed || reasoning || durationMs != null)"
      class="assistant-process"
    >
      <CollapsibleTrigger class="assistant-process__trigger">
        <AppIcon name="down" :size="13" class="assistant-process__chevron" />
        <span v-if="actions.length">{{ summary }}</span
        ><span v-else>{{ t('components.assistant.responseProcess') }}</span>
        <span v-if="failed" class="assistant-process__failed">{{
          t('components.assistant.turnFailed')
        }}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <details v-if="reasoning" class="assistant-reasoning">
          <summary>
            <AppIcon name="brain" :size="13" />{{ t('components.assistant.reasoning') }}
          </summary>
          <div class="assistant-reasoning__content">{{ reasoning }}</div>
        </details>
        <ul v-if="actions.length" class="assistant-process__list">
          <li
            v-for="action in actions"
            :key="action.seq"
            :class="{ 'assistant-process__item--failed': action.failed }"
          >
            <details class="assistant-action-detail">
              <summary>
                <AppIcon :name="action.icon" :size="13" /><span>{{ actionLabel(action) }}</span
                ><small v-if="action.durationMs != null"
                  >{{ (action.durationMs / 1000).toFixed(1) }}s</small
                >
              </summary>
              <pre v-if="action.args">{{ json(action.args) }}</pre>
              <p v-if="action.result" class="assistant-action-result">{{ action.result }}</p>
            </details>
          </li>
        </ul>
      </CollapsibleContent>
    </CollapsibleRoot>
    <details
      v-if="active && reasoning"
      class="assistant-reasoning assistant-reasoning--live"
      :open="reasoningStreaming"
    >
      <summary>
        <AppIcon name="brain" :size="13" />{{ t('components.assistant.reasoning') }}
      </summary>
      <div class="assistant-reasoning__content">{{ reasoning }}</div>
    </details>
  </div>
</template>
