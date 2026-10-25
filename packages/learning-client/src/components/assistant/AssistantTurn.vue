<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AssistantImageAttachment, AssistantMessageView } from '@drill-hub/contracts';
import type { AssistantTurnItem } from '#learning-client/assistant/turns';
import { copyTextToClipboard } from '#learning-client/utils';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppTooltip from '#learning-client/components/AppTooltip.vue';
import MessageResponse from '#learning-client/components/ai-elements/message/MessageResponse.vue';
import AssistantProcessLine from '#learning-client/components/assistant/AssistantProcessLine.vue';
import AssistantUserMessage from '#learning-client/components/assistant/AssistantUserMessage.vue';
const props = defineProps<{
  item: AssistantTurnItem;
  streamingText: string;
  streamingReasoning: string;
  now: number;
  canEdit: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  edit: [message: AssistantMessageView];
  fork: [turnId: string];
  retry: [turn: AssistantTurnItem];
  copy: [text: string];
  preview: [image: AssistantImageAttachment];
}>();
const { t } = useI18n();
const content = computed(() =>
  props.item.active ? props.streamingText : (props.item.assistantMessage?.content ?? ''),
);
const reasoning = computed(() =>
  props.item.active ? props.streamingReasoning : (props.item.reasoning ?? ''),
);
const waitingSeconds = computed(() =>
  props.item.active && props.item.startedAt
    ? Math.max(0, Math.floor((props.now - Date.parse(props.item.startedAt)) / 1000))
    : 0,
);
const hasResponse = computed(() => Boolean(content.value) || !props.item.active);
async function copy() {
  if (await copyTextToClipboard(content.value)) emit('copy', content.value);
}
</script>
<template>
  <article class="assistant-turn" :class="{ 'assistant-turn--active': item.active }">
    <AssistantUserMessage
      v-if="item.userMessage"
      :message="item.userMessage"
      :can-edit="canEdit"
      :busy="busy"
      @edit="emit('edit', $event)"
      @copy="emit('copy', $event)"
      @preview="emit('preview', $event)"
    />
    <AssistantProcessLine
      :actions="item.actions"
      :active="item.active"
      :streaming="Boolean(content || reasoning)"
      :duration-ms="item.durationMs"
      :failed="item.failed"
      :reasoning="reasoning"
      :reasoning-streaming="item.active"
    />
    <div
      v-if="item.active && !content && !reasoning"
      class="assistant-waiting"
      data-testid="assistant-event-card"
      role="status"
    >
      <span class="assistant-dotting" aria-hidden="true" /><span data-testid="assistant-waiting">{{
        waitingSeconds > 0
          ? t('components.assistant.thinkingSeconds', { seconds: waitingSeconds })
          : t('components.assistant.thinking')
      }}</span>
    </div>
    <div
      v-if="hasResponse"
      class="assistant-message assistant-message--assistant"
      :data-message-id="item.assistantMessage?.id"
      data-selection-source="assistant"
      data-testid="assistant-reply"
    >
      <MessageResponse
        :content="content || ' '"
        :streaming="item.active"
        class="assistant-markdown"
      />
      <p v-if="item.failed && item.errorMessage" class="assistant-turn-error" role="alert">
        {{ item.errorMessage }}
      </p>
      <div v-if="!item.active" class="assistant-message-actions">
        <AppTooltip :label="t('components.assistant.copyReply')"
          ><button
            class="icon-button"
            type="button"
            :aria-label="t('components.assistant.copyReply')"
            @click="copy"
          >
            <AppIcon name="copy" :size="14" /></button
        ></AppTooltip>
        <AppTooltip :label="t('components.assistant.retry')"
          ><button
            class="icon-button"
            type="button"
            :aria-label="t('components.assistant.retry')"
            @click="emit('retry', item)"
          >
            <AppIcon name="retry" :size="14" /></button
        ></AppTooltip>
        <AppTooltip :label="t('components.assistant.fork')"
          ><button
            class="icon-button"
            type="button"
            :aria-label="t('components.assistant.fork')"
            @click="item.turnId && emit('fork', item.turnId)"
          >
            <AppIcon name="branch" :size="14" /></button
        ></AppTooltip>
        <time v-if="item.assistantMessage">{{
          new Date(item.assistantMessage.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
        }}</time>
      </div>
    </div>
  </article>
</template>
