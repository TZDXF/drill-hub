<script setup lang="ts">
import { computed } from 'vue';
import type { RangeTuple } from 'fuse.js';
import { highlightParts } from '#learning-client/search';

const props = defineProps<{
  text: string;
  query?: string;
  indices?: readonly RangeTuple[];
}>();
const parts = computed(() => highlightParts(props.text, props.query, props.indices));
</script>

<template>
  <span class="search-highlight"
    ><template v-for="(part, index) in parts" :key="index"
      ><mark v-if="part.highlighted" class="search-match">{{ part.text }}</mark
      ><template v-else>{{ part.text }}</template></template
    ></span
  >
</template>
