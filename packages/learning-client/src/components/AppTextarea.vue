<script setup lang="ts">
import { ref } from 'vue';
import { Primitive } from 'reka-ui';

const model = defineModel<string>({ default: '' });
const textarea = ref<HTMLTextAreaElement | null>(null);

function onInput(event: Event) {
  model.value = (event.target as HTMLTextAreaElement).value;
}

defineExpose({
  focus: () => textarea.value?.focus(),
  blur: () => textarea.value?.blur(),
});
</script>

<template>
  <Primitive ref="textarea" as="textarea" :value="model" @input="onInput" />
</template>
