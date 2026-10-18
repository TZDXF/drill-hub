<script setup lang="ts">
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from 'reka-ui';

withDefaults(
  defineProps<{
    orientation?: 'vertical' | 'horizontal' | 'both';
    type?: 'auto' | 'always' | 'scroll' | 'hover' | 'glimpse';
    viewportClass?: string;
    focusable?: boolean;
  }>(),
  { orientation: 'vertical', type: 'hover', focusable: true },
);
</script>

<template>
  <ScrollAreaRoot class="app-scroll-area" :type="type">
    <ScrollAreaViewport
      class="app-scroll-area__viewport"
      :class="viewportClass"
      :tabindex="focusable ? 0 : undefined"
    >
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar
      v-if="orientation === 'vertical' || orientation === 'both'"
      class="app-scroll-area__scrollbar"
      orientation="vertical"
    >
      <ScrollAreaThumb class="app-scroll-area__thumb" />
    </ScrollAreaScrollbar>
    <ScrollAreaScrollbar
      v-if="orientation === 'horizontal' || orientation === 'both'"
      class="app-scroll-area__scrollbar"
      orientation="horizontal"
    >
      <ScrollAreaThumb class="app-scroll-area__thumb" />
    </ScrollAreaScrollbar>
    <ScrollAreaCorner v-if="orientation === 'both'" />
  </ScrollAreaRoot>
</template>
