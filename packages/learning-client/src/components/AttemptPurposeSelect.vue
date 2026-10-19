<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AttemptView } from '@drill-hub/contracts';
import { attemptPurposeOptions } from '../attemptPresentation';
import AppSelect from './AppSelect.vue';

const { t } = useI18n();

const purpose = defineModel<AttemptView['purpose']>({ required: true });
defineProps<{ id: string; disabled?: boolean }>();
function setPurpose(value: string) {
  if (value === 'learning' || value === 'test') purpose.value = value;
}
</script>

<template>
  <div class="form-field">
    <label :for="id">{{ t('components.purposeSelect.label') }}</label>
    <AppSelect
      :id="id"
      :model-value="purpose"
      @update:model-value="setPurpose"
      :items="attemptPurposeOptions"
      :disabled="disabled"
    />
    <p class="muted small">
      {{ t('components.purposeSelect.hint') }}
    </p>
  </div>
</template>
