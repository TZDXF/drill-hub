<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AssistantMessageView } from '@drill-hub/contracts';
import { parsePromptQuotes } from '#learning-client/assistant/selection';
import { copyTextToClipboard } from '#learning-client/utils';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppTooltip from '#learning-client/components/AppTooltip.vue';
import AssistantImages from '#learning-client/components/assistant/AssistantImages.vue';
import AssistantSelectionBadges, {
  type AssistantSelectionBadge,
} from '#learning-client/components/assistant/AssistantSelectionBadges.vue';
const props = withDefaults(
  defineProps<{
    message: AssistantMessageView;
    canEdit?: boolean;
    busy?: boolean;
    selectionBadges?: AssistantSelectionBadge[];
  }>(),
  { selectionBadges: () => [] },
);
const emit = defineEmits<{
  edit: [message: AssistantMessageView];
  copy: [text: string];
  preview: [image: import('@drill-hub/contracts').AssistantImageAttachment];
  editSelection: [id: string];
}>();
const { t } = useI18n();
const parsed = computed(() => parsePromptQuotes(props.message.content));
async function copy() {
  if (await copyTextToClipboard(parsed.value.visibleContent))
    emit('copy', parsed.value.visibleContent);
}
</script>
<template>
  <div class="assistant-user-wrap" :data-message-id="message.id" data-selection-source="user">
    <div class="assistant-message assistant-message--user" data-testid="assistant-user-message">
      <AssistantImages :images="message.images" @preview="emit('preview', $event)" />
      <span v-if="parsed.visibleContent" data-selection-content>{{ parsed.visibleContent }}</span>
      <div v-if="parsed.quotes.length" class="assistant-quote-list">
        <span
          v-for="quote in parsed.quotes"
          :key="quote.id"
          class="assistant-quote-chip"
          :title="quote.text"
        >
          <AppIcon name="quote" :size="12" />{{ quote.text
          }}<small v-if="quote.comment"> · {{ quote.comment }}</small>
        </span>
      </div>
    </div>
    <AssistantSelectionBadges :badges="selectionBadges" @edit="emit('editSelection', $event)" />
    <div class="assistant-message-actions">
      <AppTooltip v-if="canEdit" :label="t('components.assistant.editPrompt')">
        <button
          class="icon-button"
          type="button"
          :disabled="busy"
          :aria-label="t('components.assistant.editPrompt')"
          @click="emit('edit', message)"
        >
          <AppIcon name="edit" :size="14" />
        </button>
      </AppTooltip>
      <AppTooltip :label="t('components.assistant.copyPrompt')">
        <button
          class="icon-button"
          type="button"
          :aria-label="t('components.assistant.copyPrompt')"
          @click="copy"
        >
          <AppIcon name="copy" :size="14" />
        </button>
      </AppTooltip>
      <time>{{
        new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }}</time>
    </div>
  </div>
</template>
