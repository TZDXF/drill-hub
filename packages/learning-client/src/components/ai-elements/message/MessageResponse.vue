<script setup lang="ts">
// Adapted from AI Elements Vue's MessageResponse (Apache-2.0; see ../LICENSE).
// Keep the Markdown renderer only; chat, model SDKs, and optional extensions are not needed here.
import type { HTMLAttributes } from 'vue';
import { computed, useSlots } from 'vue';
import { Markdown } from 'vue-stream-markdown';
import 'vue-stream-markdown/index.css';

const props = defineProps<{
  content?: string;
  class?: HTMLAttributes['class'];
}>();

const slots = useSlots();
const slotContent = computed(() => {
  const nodes = slots.default?.();
  if (!Array.isArray(nodes)) return undefined;
  let text = '';
  for (const node of nodes) {
    if (typeof node.children === 'string') text += node.children;
  }
  return text || undefined;
});
const md = computed(() => slotContent.value ?? props.content ?? '');
</script>

<template>
  <Markdown :content="md" :class="props.class" v-bind="$attrs" />
</template>
