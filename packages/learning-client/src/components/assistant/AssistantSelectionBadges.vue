<script setup lang="ts">
import { useI18n } from 'vue-i18n';
export interface AssistantSelectionBadge {
  id: string;
  index: number;
  left: number;
  top: number;
}
defineProps<{ badges: AssistantSelectionBadge[] }>();
const emit = defineEmits<{ edit: [id: string] }>();
const { t } = useI18n();
</script>
<template>
  <sup
    v-for="badge in badges"
    :key="badge.id"
    :data-selection-anchor="badge.id"
    class="assistant-selection-badge assistant-selection-badge--overlay"
    :title="t('components.assistant.editQuote')"
    :style="{ left: `${badge.left}px`, top: `${badge.top}px` }"
    @click="emit('edit', badge.id)"
    >{{ badge.index }}</sup
  >
</template>
