<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppTextarea from '#learning-client/components/AppTextarea.vue';
export interface AssistantSelectionPopupState {
  id: string;
  comment: string;
  anchor: { left: number; top: number; bottom: number };
}
const props = defineProps<{ state: AssistantSelectionPopupState | null }>();
const emit = defineEmits<{ save: [comment: string]; remove: []; cancel: [] }>();
const { t } = useI18n();
const comment = ref('');
const card = ref<HTMLElement | null>(null);
const input = ref<InstanceType<typeof AppTextarea> | null>(null);
watch(
  () => props.state,
  (state) => {
    comment.value = state?.comment ?? '';
    if (state) void nextTick(() => input.value?.focus());
  },
  { immediate: true },
);
function onDocumentMousedown(event: MouseEvent) {
  if (!props.state || !card.value || card.value.contains(event.target as Node)) return;
  emit('cancel');
}
onMounted(() => document.addEventListener('mousedown', onDocumentMousedown));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentMousedown));
const style = computed(() => {
  const anchor = props.state?.anchor;
  if (!anchor) return null;
  const margin = 8;
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - 288 - margin));
  const flip = window.innerHeight - anchor.bottom < 90;
  return {
    left: `${left}px`,
    ...(flip
      ? { bottom: `${window.innerHeight - anchor.top + 6}px` }
      : { top: `${anchor.bottom + 6}px` }),
  };
});
</script>
<template>
  <Teleport to="body">
    <div
      v-if="state && style"
      ref="card"
      class="assistant-selection-comment"
      :style="style"
      data-selection-popup
      :data-no-selection="true"
    >
      <AppTextarea
        ref="input"
        v-model="comment"
        rows="1"
        :placeholder="t('components.assistant.quoteComment')"
        @keydown.esc.stop="emit('cancel')"
        @keydown.ctrl.enter.prevent="emit('save', comment)"
        @keydown.meta.enter.prevent="emit('save', comment)"
      />
      <button
        type="button"
        class="assistant-selection-delete"
        :aria-label="t('components.assistant.removeQuote')"
        :title="t('components.assistant.removeQuote')"
        @mousedown.prevent
        @click="emit('remove')"
      >
        <AppIcon name="trash" :size="15" />
      </button>
      <button
        type="button"
        :aria-label="t('components.assistant.saveQuote')"
        :title="t('components.assistant.saveQuote')"
        @mousedown.prevent
        @click="emit('save', comment)"
      >
        <AppIcon name="check" :size="15" />
      </button>
    </div>
  </Teleport>
</template>
