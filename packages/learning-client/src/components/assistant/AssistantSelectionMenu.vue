<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  createSelectionQuote,
  type AssistantSelectionQuote,
} from '#learning-client/assistant/selection';
import { captureSelectionAnchor } from '#learning-client/assistant/selectionAnchors';
import AppIcon from '#learning-client/components/AppIcon.vue';
const props = defineProps<{ root: Ref<HTMLElement | null> }>();
const emit = defineEmits<{ quote: [quote: AssistantSelectionQuote] }>();
const { t } = useI18n();
const visible = ref(false);
const commenting = ref(false);
const comment = ref('');
const commentInput = ref<HTMLTextAreaElement | null>(null);
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
    left: Math.max(8, Math.min(window.innerWidth - 296, rect.left)),
    top: Math.max(8, rect.top - 42),
  };
  const anchor = captureSelectionAnchor(root, range);
  if (selected && anchor) selected.anchor = anchor;
  visible.value = true;
}
function clear() {
  selected = null;
  visible.value = false;
  commenting.value = false;
  comment.value = '';
  window.getSelection()?.removeAllRanges();
}
function quote() {
  if (selected) emit('quote', selected);
  clear();
}
async function addComment() {
  commenting.value = true;
  visible.value = false;
  await nextTick();
  commentInput.value?.focus();
}
function saveComment() {
  if (selected) emit('quote', { ...selected, comment: comment.value.trim() });
  clear();
}
function hide(event: MouseEvent) {
  if (
    !(event.target as Element)?.closest('.assistant-selection-menu, .assistant-selection-comment')
  )
    clear();
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
    ><div
      v-if="visible"
      class="assistant-selection-menu"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    >
      <button type="button" @mousedown.prevent @click="quote">
        <AppIcon name="quote" :size="14" />{{ t('components.assistant.quoteSelection') }}
      </button>
      <button type="button" @mousedown.prevent @click="addComment">
        <AppIcon name="message" :size="14" />{{ t('components.assistant.commentSelection') }}
      </button>
    </div>
    <div
      v-if="commenting"
      class="assistant-selection-comment"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    >
      <textarea
        ref="commentInput"
        v-model="comment"
        rows="1"
        :placeholder="t('components.assistant.quoteComment')"
        @keydown.esc.stop="clear"
        @keydown.ctrl.enter.prevent="saveComment"
        @keydown.meta.enter.prevent="saveComment"
      />
      <button
        type="button"
        :aria-label="t('components.assistant.saveQuote')"
        @mousedown.prevent
        @click="saveComment"
      >
        <AppIcon name="check" :size="15" />
      </button></div
  ></Teleport>
</template>
