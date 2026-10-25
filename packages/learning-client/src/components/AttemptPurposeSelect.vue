<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AttemptView } from '@drill-hub/contracts';
import { attemptPurposeOptions } from '#learning-client/attemptPresentation';
import AppSelect from '#learning-client/components/AppSelect.vue';
import AppFormField from '#learning-client/components/AppFormField.vue';

const { t } = useI18n();

const purpose = defineModel<AttemptView['purpose']>({ required: true });
defineProps<{ id: string; disabled?: boolean }>();
function setPurpose(value: string) {
  if (value === 'learning' || value === 'test') purpose.value = value;
}
</script>

<template>
  <AppFormField :id="id" :label="t('components.purposeSelect.label')">
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
  </AppFormField>
</template>
