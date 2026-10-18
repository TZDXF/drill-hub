<script setup lang="ts">
defineProps<{ title?: string; eyebrow?: string; description?: string }>();
</script>

<template>
  <header class="page-header">
    <div class="page-header__copy">
      <slot name="back" />
      <span v-if="eyebrow" class="eyebrow">{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions"><slot name="actions" /></div>
  </header>
</template>
