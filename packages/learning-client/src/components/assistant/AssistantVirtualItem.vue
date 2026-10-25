<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
const props = withDefaults(defineProps<{ enabled?: boolean; pinned?: boolean; live?: boolean }>(), {
  enabled: true,
  pinned: false,
  live: false,
});
const shell = ref<HTMLElement | null>(null);
const body = ref<HTMLElement | null>(null);
const nearby = ref(false);
const revealed = ref(false);
const focused = ref(false);
const rendered = ref(Boolean(props.pinned || props.live));
const height = ref(180);
let intersection: IntersectionObserver | null = null;
let resize: ResizeObserver | null = null;
let viewport: HTMLElement | null = null;
function measure() {
  if (!body.value) return;
  const next = body.value.getBoundingClientRect().height;
  if (next > 0) height.value = next;
}
function reveal() {
  revealed.value = true;
  rendered.value = true;
}
watch(
  () => [props.pinned, props.live, nearby.value, revealed.value, focused.value],
  () => {
    rendered.value = Boolean(
      props.pinned || props.live || nearby.value || revealed.value || focused.value,
    );
  },
  { immediate: true },
);
watch(
  rendered,
  async (value) => {
    if (!value) return;
    await nextTick();
    if (body.value) {
      resize?.disconnect();
      resize?.observe(body.value);
    }
    measure();
  },
  { flush: 'post' },
);
onMounted(() => {
  viewport = shell.value?.closest('.assistant-viewport') as HTMLElement | null;
  resize = new ResizeObserver(measure);
  if (body.value) resize.observe(body.value);
  if (viewport && shell.value) {
    intersection = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (
            !entry.isIntersecting &&
            !document.getSelection()?.isCollapsed &&
            (shell.value?.contains(document.getSelection()?.anchorNode ?? null) ||
              shell.value?.contains(document.getSelection()?.focusNode ?? null))
          )
            continue;
          nearby.value = entry.isIntersecting;
          if (entry.isIntersecting) revealed.value = false;
        }
      },
      { root: viewport, rootMargin: '800px 0px' },
    );
    intersection.observe(shell.value);
  }
});
onBeforeUnmount(() => {
  intersection?.disconnect();
  resize?.disconnect();
});
</script>
<template>
  <div
    ref="shell"
    class="assistant-virtual-item"
    :style="rendered ? undefined : { height: `${height}px` }"
    :data-virtual-mounted="rendered"
    @virtual-reveal="reveal"
    @focusin="focused = true"
    @focusout="focused = false"
  >
    <div v-if="rendered" ref="body"><slot /></div>
  </div>
</template>
