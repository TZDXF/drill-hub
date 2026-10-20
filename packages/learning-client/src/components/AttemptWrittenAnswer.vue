<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AttemptItemView } from '@drill-hub/contracts';

const props = defineProps<{ item: AttemptItemView }>();
const { t } = useI18n();

const entries = computed(() => {
  const { item } = props;
  const answer = item.answer;
  if (item.type === 'short_answer') {
    return [{ label: '', text: answer && 'text' in answer ? answer.text : '' }];
  }
  if (item.type === 'fill_blank') {
    return (item.slots ?? []).map((slot, index) => ({
      label: t('learning.attempt.blankNumber', { index: index + 1 }),
      text: answer && 'slots' in answer ? (answer.slots[slot.id] ?? '') : '',
    }));
  }
  return [];
});
</script>

<template>
  <section
    v-if="item.type === 'short_answer' || item.type === 'fill_blank'"
    class="report-answer"
    :aria-label="t('learning.attempt.yourAnswer')"
  >
    <span class="meta-label">{{ t('learning.attempt.yourAnswer') }}</span>
    <div v-for="(entry, index) in entries" :key="index">
      <span v-if="entry.label" class="meta-label">{{ entry.label }}</span>
      <p>{{ entry.text.trim() ? entry.text : t('core.common.unanswered') }}</p>
    </div>
  </section>
</template>
