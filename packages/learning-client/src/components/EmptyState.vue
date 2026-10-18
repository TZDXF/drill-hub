<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    icon?: string;
    compact?: boolean;
  }>(),
  { icon: 'book', compact: false },
);
</script>

<template>
  <section class="empty-state" :class="{ 'empty-state--compact': compact }">
    <div class="empty-state__icon"><AppIcon :name="icon" :size="compact ? 20 : 25" /></div>
    <div>
      <h2>{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
      <slot />
    </div>
  </section>
</template>
