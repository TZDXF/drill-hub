<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Answer, AttemptItemView } from '@drill-hub/contracts';
import AppDialog from './AppDialog.vue';
import AppIcon from './AppIcon.vue';
import QuestionNav from './QuestionNav.vue';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    items: AttemptItemView[];
    answers: Record<string, Answer | null>;
    currentIndex: number;
    markedIds: string[];
    marksEnabled: boolean;
    disabled: boolean;
    mode?: 'answer' | 'review';
  }>(),
  { mode: 'answer' },
);
const emit = defineEmits<{ select: [index: number] }>();
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const position = ref<{ x: number; y: number } | null>(null);
const dragging = ref(false);
let dragStart: { id: number; x: number; y: number; left: number; top: number } | null = null;
let suppressClick = false;
let restoreFocusPending = false;
function clampPosition(x: number, y: number) {
  const viewport = window.visualViewport;
  const style = trigger.value ? window.getComputedStyle(trigger.value) : null;
  const inset = (edge: string) =>
    Math.max(12, Number.parseFloat(style?.getPropertyValue(`--fab-safe-${edge}`) ?? '0') || 0);
  const left = (viewport?.offsetLeft ?? 0) + inset('left');
  const top = (viewport?.offsetTop ?? 0) + inset('top');
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const size = trigger.value?.getBoundingClientRect();
  return {
    x: Math.max(
      left,
      Math.min(x, (viewport?.offsetLeft ?? 0) + width - (size?.width ?? 64) - inset('right')),
    ),
    y: Math.max(
      top,
      Math.min(y, (viewport?.offsetTop ?? 0) + height - (size?.height ?? 64) - inset('bottom')),
    ),
  };
}
function keepInViewport() {
  if (position.value) position.value = clampPosition(position.value.x, position.value.y);
}
function startDrag(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || props.disabled) return;
  const bounds = trigger.value?.getBoundingClientRect();
  if (!bounds) return;
  suppressClick = false;
  dragStart = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: bounds.x,
    top: bounds.y,
  };
  if (event.pointerType === 'mouse') trigger.value?.setPointerCapture(event.pointerId);
}
function moveDrag(event: PointerEvent) {
  if (!dragStart || event.pointerId !== dragStart.id) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  if (!dragging.value && Math.hypot(dx, dy) < 8) return;
  dragging.value = true;
  trigger.value?.setPointerCapture(event.pointerId);
  suppressClick = true;
  position.value = clampPosition(dragStart.left + dx, dragStart.top + dy);
  if (event.pointerType === 'mouse') event.preventDefault();
}
function endDrag(event: PointerEvent) {
  if (dragStart?.id !== event.pointerId) return;
  dragStart = null;
  dragging.value = false;
  if (trigger.value?.hasPointerCapture(event.pointerId))
    trigger.value.releasePointerCapture(event.pointerId);
}
function openCard(event: MouseEvent) {
  if (suppressClick && event.detail !== 0) {
    event.preventDefault();
    suppressClick = false;
    return;
  }
  if (!props.disabled) open.value = true;
}
let mobileQuery: MediaQueryList | undefined;
function closeOnDesktop() {
  if (!mobileQuery?.matches) open.value = false;
}
function restoreFocus() {
  if (!mobileQuery?.matches) {
    restoreFocusPending = false;
    return;
  }
  restoreFocusPending = props.disabled;
  if (!restoreFocusPending) trigger.value?.focus({ preventScroll: true });
}
watch(
  () => props.disabled,
  (disabled) => {
    if (!disabled && restoreFocusPending && !open.value) restoreFocus();
  },
  { flush: 'post' },
);
function select(index: number) {
  if (props.disabled) return;
  emit('select', index);
  open.value = false;
}
onMounted(() => {
  mobileQuery = window.matchMedia('(max-width: 780px)');
  mobileQuery.addEventListener('change', closeOnDesktop);
  window.addEventListener('resize', keepInViewport);
  window.visualViewport?.addEventListener('resize', keepInViewport);
  window.visualViewport?.addEventListener('scroll', keepInViewport);
});
onBeforeUnmount(() => {
  mobileQuery?.removeEventListener('change', closeOnDesktop);
  window.removeEventListener('resize', keepInViewport);
  window.visualViewport?.removeEventListener('resize', keepInViewport);
  window.visualViewport?.removeEventListener('scroll', keepInViewport);
});
</script>

<template>
  <QuestionNav
    class="attempt-question-nav--desktop"
    :items="items"
    :answers="answers"
    :current-index="currentIndex"
    :marked-ids="markedIds"
    :marks-enabled="marksEnabled"
    :disabled="disabled"
    :mode="mode"
    @select="select"
  />
  <button
    ref="trigger"
    class="question-nav-fab"
    :class="{ 'question-nav-fab--dragging': dragging }"
    :style="
      position
        ? { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto' }
        : undefined
    "
    type="button"
    :aria-label="t('components.attemptNav.fabLabel')"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :disabled="disabled"
    @pointerdown="startDrag"
    @pointermove="moveDrag"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @lostpointercapture="$event.target === $event.currentTarget && endDrag($event)"
    @click="openCard"
  >
    <AppIcon name="content" :size="19" />
    <span>{{ t('components.attemptNav.fabText') }}</span>
  </button>
  <AppDialog
    v-model:open="open"
    class="question-nav-sheet"
    :title="t('components.attemptNav.sheetTitle')"
    :description="
      t(
        currentIndex < 0
          ? marksEnabled
            ? 'components.attemptNav.overviewMarked'
            : 'components.attemptNav.overview'
          : marksEnabled
            ? 'components.attemptNav.positionMarked'
            : 'components.attemptNav.position',
        { current: currentIndex + 1, total: items.length, count: markedIds.length },
      )
    "
    :close-label="t('components.attemptNav.closeLabel')"
    @close-auto-focus.prevent="restoreFocus"
  >
    <template #top>
      <div class="question-nav-sheet__handle" aria-hidden="true" />
    </template>
    <QuestionNav
      :items="items"
      :answers="answers"
      :current-index="currentIndex"
      :marked-ids="markedIds"
      :marks-enabled="marksEnabled"
      :disabled="disabled"
      :mode="mode"
      @select="select"
    />
  </AppDialog>
</template>
