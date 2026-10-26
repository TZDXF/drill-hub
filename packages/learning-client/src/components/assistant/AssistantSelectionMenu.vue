<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ASSISTANT_SELECTION_MAX,
  createSelectionQuote,
  type AssistantSelectionQuote,
  type AssistantSelectionSource,
} from '#learning-client/assistant/selection';
import {
  captureSelectionAnchor,
  selectionEndRect,
} from '#learning-client/assistant/selectionAnchors';
import AppIcon from '#learning-client/components/AppIcon.vue';
const props = defineProps<{ root: Ref<HTMLElement | null> }>();
const emit = defineEmits<{ quote: [quote: AssistantSelectionQuote] }>();
const { t } = useI18n();
const state = ref<{
  quote: AssistantSelectionQuote;
  anchor: { left: number; top: number; bottom: number };
} | null>(null);
const tooLong = computed(() => (state.value?.quote.text.length ?? 0) > ASSISTANT_SELECTION_MAX);
function anchorElement(node: Node | null): HTMLElement | null {
  return node?.nodeType === 1 ? (node as HTMLElement) : (node?.parentElement ?? null);
}
function isExcludedEndpoint(node: Node | null): boolean {
  const element = anchorElement(node);
  if (!element) return true;
  return Boolean(
    element.closest(
      'button, a, textarea, input, select, [data-selection-anchor], [contenteditable], [data-no-selection]',
    ),
  );
}
function inspect() {
  const root = props.root.value;
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  if (isExcludedEndpoint(range.startContainer) || isExcludedEndpoint(range.endContainer))
    return null;
  const sourceElement = anchorElement(range.startContainer)?.closest('[data-selection-source]');
  if (
    !sourceElement ||
    sourceElement !== anchorElement(range.endContainer)?.closest('[data-selection-source]')
  )
    return null;
  const source = sourceElement.getAttribute('data-selection-source') as AssistantSelectionSource;
  if (source !== 'user' && source !== 'assistant') return null;
  const anchor = captureSelectionAnchor(root, range);
  const quote = createSelectionQuote(selection.toString());
  const endRect = selectionEndRect(range);
  if (!anchor || !quote || !endRect) return null;
  quote.source = source;
  quote.anchor = anchor;
  return {
    quote,
    anchor: { left: endRect.right, top: endRect.top, bottom: endRect.bottom },
  };
}
function clear() {
  state.value = null;
}
function onSelectionChange() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) clear();
}
function onMouseUp() {
  state.value = inspect();
}
function onKeyUp(event: KeyboardEvent) {
  if (!event.shiftKey && event.key !== 'Shift') return;
  state.value = inspect();
}
function quote() {
  if (!state.value || tooLong.value) return;
  const inspected = inspect();
  clear();
  if (inspected) emit('quote', inspected.quote);
}
onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('scroll', clear, true);
});
watch(
  () => props.root.value,
  () => clear(),
);
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onSelectionChange);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('keyup', onKeyUp);
  document.removeEventListener('scroll', clear, true);
});
const placement = computed(() => {
  const anchor = state.value?.anchor;
  if (!anchor) return null;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 168));
  const flip = window.innerHeight - anchor.bottom < 48;
  return {
    left: `${left}px`,
    ...(flip
      ? { bottom: `${window.innerHeight - anchor.top + 4}px` }
      : { top: `${anchor.bottom + 4}px` }),
  };
});
</script>
<template>
  <Teleport to="body">
    <div
      v-if="state && placement"
      class="assistant-selection-menu"
      :style="placement"
      :data-no-selection="true"
    >
      <button
        type="button"
        :disabled="tooLong"
        :title="tooLong ? t('components.assistant.selectionLimitSingle') : undefined"
        @mousedown.prevent
        @click="quote"
      >
        <AppIcon name="quote" :size="14" />{{ t('components.assistant.quoteSelection') }}
      </button>
    </div>
  </Teleport>
</template>
