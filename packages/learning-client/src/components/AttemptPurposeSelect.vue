<script setup lang="ts">
import type { AttemptView } from '@drill-hub/contracts';
import { attemptPurposeOptions } from '../attemptPresentation';
import AppSelect from './AppSelect.vue';

const purpose = defineModel<AttemptView['purpose']>({ required: true });
defineProps<{ id: string; disabled?: boolean }>();
function setPurpose(value: string) {
  if (value === 'learning' || value === 'test') purpose.value = value;
}
</script>

<template>
  <div class="form-field">
    <label :for="id">作答用途</label>
    <AppSelect
      :id="id"
      :model-value="purpose"
      @update:model-value="setPurpose"
      :items="attemptPurposeOptions"
      :disabled="disabled"
    />
    <p class="muted small">
      正式作答计入学习统计、错题与计划进度；测试作答仍可答题、交卷及评分，但不计入这些统计。
    </p>
  </div>
</template>
