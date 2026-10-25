import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import {
  isNearBottom,
  pinToBottom,
  shouldReleaseBottomLock,
} from '#learning-client/assistant/scroll';

/** Owns the reading position. Streaming updates never override an explicit upward gesture. */
export function useConversationScroll(
  content: Ref<HTMLElement | null>,
  enabled: Ref<boolean> = ref(true),
) {
  const viewport = ref<HTMLElement | null>(null);
  const following = ref(true);
  const userScrolled = ref(false);
  const atBottom = ref(true);
  let observer: ResizeObserver | null = null;
  let initial = true;
  const stop = () => {
    following.value = false;
    userScrolled.value = true;
  };
  const update = () => {
    const element = viewport.value;
    if (!element) return;
    atBottom.value = isNearBottom(element);
    if (atBottom.value && !initial) following.value = true;
  };
  const pin = () => {
    const element = viewport.value;
    if (element && enabled.value) pinToBottom(element, following.value);
    update();
  };
  const scrollToBottom = (smooth = false) => {
    const element = viewport.value;
    if (!element) return;
    following.value = true;
    userScrolled.value = false;
    element.scrollTo({
      top: element.scrollHeight,
      behavior:
        smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'smooth'
          : 'instant',
    });
    atBottom.value = true;
  };
  const onScroll = () => {
    const element = viewport.value;
    if (!element) return;
    const near = isNearBottom(element);
    atBottom.value = near;
    // Wheel, keyboard, touch and native scrollbar gestures release the lock;
    // reaching the latest message explicitly restores it.
    if (near) following.value = true;
  };
  const onWheel = (event: WheelEvent) => {
    if (
      viewport.value &&
      shouldReleaseBottomLock(viewport.value, event.target as Element, event.deltaY)
    )
      stop();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (
      event.target === viewport.value ||
      (event.target as Element)?.closest('.assistant-viewport')
    ) {
      const element = viewport.value;
      if (element && event.clientX >= element.getBoundingClientRect().right - 18) stop();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (['PageUp', 'ArrowUp', 'Home'].includes(event.key)) stop();
    if (event.key === 'End') scrollToBottom();
  };
  let lastTop = 0;
  const onTouchStart = () => {
    lastTop = viewport.value?.scrollTop ?? 0;
  };
  const onTouchMove = () => {
    const element = viewport.value;
    if (!element) return;
    if (element.scrollTop < lastTop - 1) stop();
    lastTop = element.scrollTop;
  };
  onMounted(async () => {
    await nextTick();
    const element = viewport.value;
    if (!element) return;
    lastTop = element.scrollTop;
    observer = new ResizeObserver(pin);
    if (content.value) observer.observe(content.value);
    if (initial) {
      scrollToBottom();
      initial = false;
    }
    element.addEventListener('wheel', onWheel, { passive: true });
    element.addEventListener('pointerdown', onPointerDown, { passive: true });
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: true });
  });
  watch(
    content,
    async (element, old) => {
      if (old) observer?.unobserve(old);
      await nextTick();
      if (element) observer?.observe(element);
      pin();
    },
    { flush: 'post' },
  );
  onBeforeUnmount(() => {
    observer?.disconnect();
    const element = viewport.value;
    element?.removeEventListener('wheel', onWheel);
    element?.removeEventListener('pointerdown', onPointerDown);
    element?.removeEventListener('keydown', onKeyDown);
    element?.removeEventListener('touchstart', onTouchStart);
    element?.removeEventListener('touchmove', onTouchMove);
  });
  return {
    viewport,
    following: computed(() => following.value),
    userScrolled: computed(() => userScrolled.value),
    atBottom: computed(() => atBottom.value),
    stop,
    scrollToBottom,
    pin,
    onScroll,
    scrollToMessage: async (id: string) => {
      stop();
      await nextTick();
      const element = viewport.value;
      const target = element?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
      if (!element || !target) return;
      element.scrollTo({
        top:
          element.scrollTop +
          target.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          24,
        behavior: 'smooth',
      });
    },
  };
}
