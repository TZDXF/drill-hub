<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AssistantTimelineTurn } from '@drill-hub/contracts';
import AppTooltip from '#learning-client/components/AppTooltip.vue';
const props = defineProps<{ turns: AssistantTimelineTurn[] }>();
const emit = defineEmits<{ navigate: [turn: AssistantTimelineTurn] }>();
const { t } = useI18n();
const nav = ref<HTMLElement | null>(null);
const current = ref<string | null>(null);
const nodeHeight = ref(20);
let observer: ResizeObserver | null = null;
function resize() {
  const available = (nav.value?.clientHeight ?? 0) - 8;
  nodeHeight.value = props.turns.length
    ? Math.max(6, Math.min(20, Math.floor(available / props.turns.length)))
    : 20;
}
function updateCurrent() {
  const viewport = nav.value?.parentElement?.querySelector<HTMLElement>('.assistant-viewport');
  if (!viewport) return;
  const top = viewport.getBoundingClientRect().top;
  const bottom = top + viewport.clientHeight;
  const anchors = props.turns
    .map((turn) => ({
      turn,
      element: viewport.querySelector<HTMLElement>(`[data-message-id="${turn.userMessageId}"]`),
    }))
    .filter((entry) => entry.element);
  const visible = anchors.filter((entry, index) => {
    const start = entry.element!.getBoundingClientRect().top;
    const end = anchors[index + 1]?.element!.getBoundingClientRect().top ?? Infinity;
    return start < bottom && end > top;
  });
  current.value = visible.at(-1)?.turn.id ?? null;
}
onMounted(() => {
  observer = new ResizeObserver(() => {
    resize();
    updateCurrent();
  });
  if (nav.value) observer.observe(nav.value);
  nav.value?.parentElement
    ?.querySelector('.assistant-viewport')
    ?.addEventListener('scroll', updateCurrent, { passive: true });
  resize();
});
watch(() => props.turns.length, resize);
onBeforeUnmount(() => {
  observer?.disconnect();
  nav.value?.parentElement
    ?.querySelector('.assistant-viewport')
    ?.removeEventListener('scroll', updateCurrent);
});
const hasTurns = computed(() => props.turns.length > 0);
</script>
<template>
  <nav
    v-if="hasTurns"
    ref="nav"
    class="assistant-timeline"
    :aria-label="t('components.assistant.timeline')"
  >
    <ol :style="{ '--assistant-node-height': `${nodeHeight}px` }">
      <li v-for="(turn, index) in props.turns" :key="turn.id">
        <AppTooltip
          :label="turn.question || t('components.assistant.timelineJump', { number: index + 1 })"
          ><button
            type="button"
            class="assistant-timeline-node"
            :class="{ 'is-current': current === turn.id }"
            :aria-label="t('components.assistant.timelineJump', { number: index + 1 })"
            @click="emit('navigate', turn)"
          >
            <span>{{ index + 1 }}</span>
          </button></AppTooltip
        >
      </li>
    </ol>
  </nav>
</template>
