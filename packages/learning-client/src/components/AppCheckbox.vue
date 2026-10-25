<script setup lang="ts">
import { computed, useId } from 'vue';
import { CheckboxIndicator, CheckboxRoot, Label } from 'reka-ui';
import AppIcon from '#learning-client/components/AppIcon.vue';

const props = withDefaults(
  defineProps<{
    id?: string;
    disabled?: boolean;
  }>(),
  { disabled: false },
);
const model = defineModel<boolean>({ default: false });
const fallbackId = useId();
const checkboxId = computed(() => props.id ?? fallbackId);
</script>

<template>
  <div class="checkbox-row" :class="{ disabled }">
    <CheckboxRoot :id="checkboxId" v-model="model" class="choice-box" :disabled="disabled">
      <CheckboxIndicator class="choice-box__indicator">
        <AppIcon name="check" :size="13" />
      </CheckboxIndicator>
    </CheckboxRoot>
    <Label :for="checkboxId" class="choice-label"><slot /></Label>
  </div>
</template>
