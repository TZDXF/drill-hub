<script setup lang="ts">
import type { AssistantImageAttachment } from '@drill-hub/contracts';
defineProps<{ images: AssistantImageAttachment[] }>();
const emit = defineEmits<{ preview: [image: AssistantImageAttachment] }>();
</script>
<template>
  <div v-if="images.length" class="assistant-message-images">
    <button
      v-for="image in images"
      :key="image.name + image.data.slice(0, 24)"
      type="button"
      class="assistant-message-image"
      :aria-label="image.name"
      @click="emit('preview', image)"
    >
      <img :src="`data:${image.mimeType};base64,${image.data}`" :alt="image.name" loading="lazy" />
    </button>
  </div>
</template>
