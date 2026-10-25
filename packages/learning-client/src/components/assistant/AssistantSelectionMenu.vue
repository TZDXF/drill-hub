<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  createSelectionQuote,
  type AssistantSelectionQuote,
} from '#learning-client/assistant/selection';
import AppIcon from '#learning-client/components/AppIcon.vue';
const props = defineProps<{ root: Ref<HTMLElement | null> }>();
const emit = defineEmits<{ quote: [quote: AssistantSelectionQuote] }>();
const { t } = useI18n();
const visible = ref(false);
const position = ref({ left: 0, top: 0 });
let selected: AssistantSelectionQuote | null = null;
function inspect() {
  const root = props.root.value;
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || !selection.rangeCount) {
    visible.value = false;
    return;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    visible.value = false;
    return;
  }
  selected = createSelectionQuote(selection.toString());
  if (!selected) {
    visible.value = false;
    return;
  }
  const rect = range.getBoundingClientRect();
  position.value = {
    left: Math.max(8, Math.min(window.innerWidth - 130, rect.left)),
    top: Math.max(8, rect.top - 42),
  };
  visible.value = true;
}
function quote() {
  if (selected) emit('quote', selected);
  selected = null;
  visible.value = false;
  window.getSelection()?.removeAllRanges();
}
function hide(event: MouseEvent) {
  if (!(event.target as Element)?.closest('.assistant-selection-menu')) visible.value = false;
}
onMounted(() => {
  document.addEventListener('mouseup', inspect);
  document.addEventListener('keyup', inspect);
  document.addEventListener('mousedown', hide);
});
onBeforeUnmount(() => {
  document.removeEventListener('mouseup', inspect);
  document.removeEventListener('keyup', inspect);
  document.removeEventListener('mousedown', hide);
});
</script>
<template>
  <Teleport to="body"
    ><button
      v-if="visible"
      class="assistant-selection-menu"
      type="button"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      @mousedown.prevent
      @click="quote"
    >
      <AppIcon name="quote" :size="14" />{{ t('components.assistant.quoteSelection') }}
    </button></Teleport
  >
</template>
