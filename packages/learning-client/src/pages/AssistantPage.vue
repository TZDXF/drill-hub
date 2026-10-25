<script setup lang="ts">
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAssistant } from '#learning-client/assistant/store';
import EmptyState from '#learning-client/components/EmptyState.vue';

const { t } = useI18n();
const assistant = useAssistant();

onMounted(() => {
  assistant.setLayout('split');
  assistant.openPanel();
  void assistant.refreshStatus();
});
</script>

<template>
  <div class="assistant-page" data-testid="assistant-page">
    <EmptyState :title="t('learning.assistant.pageTitle')">
      <p class="assistant-page__hint">{{ t('learning.assistant.pageHint') }}</p>
      <p
        v-if="assistant.state.status && !assistant.state.status.modelConfigured"
        class="assistant-page__hint"
      >
        {{ t('learning.assistant.modelMissing') }}
      </p>
    </EmptyState>
  </div>
</template>
