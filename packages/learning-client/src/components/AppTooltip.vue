<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui';

withDefaults(
  defineProps<{
    /** 提示文案；触发元素自身的 aria-label 不受影响。 */
    label: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
  }>(),
  { side: 'bottom' },
);
</script>

<template>
  <TooltipRoot :delay-duration="300">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent :side="side" :side-offset="6" class="app-tooltip">
        {{ label }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
