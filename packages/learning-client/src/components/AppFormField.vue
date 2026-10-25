<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 关联控件的 id，渲染到 label 的 for 上。 */
    id: string;
    label: string;
    hint?: string;
  }>(),
  {},
);
</script>

<template>
  <div class="form-field">
    <label :for="id">{{ label }}</label>
    <slot />
    <p v-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>
