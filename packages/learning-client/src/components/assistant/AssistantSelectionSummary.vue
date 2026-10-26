<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AssistantSelectionQuote } from '#learning-client/assistant/selection';
import AppIcon from '#learning-client/components/AppIcon.vue';
defineProps<{ items: AssistantSelectionQuote[] }>();
const emit = defineEmits<{ locate: [id: string]; edit: [id: string]; remove: [id: string] }>();
const { t } = useI18n();
const open = ref(false);
const trigger = ref<HTMLElement | null>(null);
let closeTimer: ReturnType<typeof setTimeout> | undefined;
function openList() {
  if (closeTimer !== undefined) clearTimeout(closeTimer);
  closeTimer = undefined;
  open.value = true;
}
function scheduleClose() {
  if (closeTimer !== undefined) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    open.value = false;
    closeTimer = undefined;
  }, 150);
}
function locate(id: string) {
  open.value = false;
  emit('locate', id);
}
function edit(id: string) {
  open.value = false;
  emit('edit', id);
}
onBeforeUnmount(() => {
  if (closeTimer !== undefined) clearTimeout(closeTimer);
});
const style = computed(() => {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect || !open.value) return null;
  const margin = 8;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - 320 - margin));
  const flip = rect.top < 300;
  return {
    left: `${left}px`,
    ...(flip
      ? { top: `${rect.bottom + 4}px` }
      : { bottom: `${window.innerHeight - rect.top + 4}px` }),
  };
});
</script>
<template>
  <button
    ref="trigger"
    type="button"
    class="assistant-selection-summary-trigger"
    :aria-expanded="open"
    @mouseenter="openList"
    @mouseleave="scheduleClose"
    @click="open ? scheduleClose() : openList()"
  >
    <AppIcon name="quote" :size="14" />
    <span>{{ t('components.assistant.selectionSummary', { count: items.length }) }}</span>
    <AppIcon name="down" :size="12" :class="{ 'is-open': open }" />
  </button>
  <Teleport to="body">
    <div
      v-if="open && style"
      class="assistant-selection-summary"
      :style="style"
      @mouseenter="openList"
      @mouseleave="scheduleClose"
    >
      <div v-for="(item, index) in items" :key="item.id" class="assistant-selection-summary__item">
        <span class="assistant-selection-badge" aria-hidden="true">{{ index + 1 }}</span>
        <button type="button" class="assistant-selection-summary__text" @click="locate(item.id)">
          <span v-if="item.source === 'user'" class="assistant-selection-summary__source">{{
            t('components.assistant.selectionFromUser')
          }}</span>
          <span class="assistant-selection-summary__quote" :title="item.text">{{ item.text }}</span>
          <span
            v-if="item.comment"
            class="assistant-selection-summary__comment"
            :title="item.comment"
            >{{ item.comment }}</span
          >
        </button>
        <button
          type="button"
          class="assistant-selection-summary__action"
          :aria-label="t('components.assistant.editQuote')"
          :title="t('components.assistant.editQuote')"
          @click="edit(item.id)"
        >
          <AppIcon name="edit" :size="14" />
        </button>
        <button
          type="button"
          class="assistant-selection-summary__action"
          :aria-label="t('components.assistant.removeQuote')"
          :title="t('components.assistant.removeQuote')"
          @click="emit('remove', item.id)"
        >
          <AppIcon name="trash" :size="14" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
