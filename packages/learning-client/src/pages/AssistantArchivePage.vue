<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AssistantThread } from '@drill-hub/contracts';
import { useLearning } from '#learning-client/injection';
import { useAssistant } from '#learning-client/assistant/store';
import { errorMessage, formatDate } from '#learning-client/utils';
import PageHeader from '#learning-client/components/PageHeader.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import EmptyState from '#learning-client/components/EmptyState.vue';
import ConfirmDialog from '#learning-client/components/ConfirmDialog.vue';

const { t } = useI18n();
const learning = useLearning();
const assistant = useAssistant();
const threads = ref<AssistantThread[]>([]);
const loading = ref(true);
const error = ref('');
const selected = ref<AssistantThread | null>(null);
const busy = ref(false);
const deleteError = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    threads.value = await learning.get<AssistantThread[]>(
      '/me/assistant/threads?archiveState=archived',
    );
    threads.value.sort((a, b) => b.archivedAt!.localeCompare(a.archivedAt!));
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}
async function restore(thread: AssistantThread) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await assistant.restoreThread(thread);
    threads.value = threads.value.filter((item) => item.id !== thread.id);
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}
function requestDelete(thread: AssistantThread) {
  selected.value = thread;
  deleteError.value = '';
}
async function remove() {
  if (!selected.value || busy.value) return;
  busy.value = true;
  deleteError.value = '';
  try {
    const id = selected.value.id;
    await assistant.deleteThread(id);
    threads.value = threads.value.filter((thread) => thread.id !== id);
    selected.value = null;
  } catch (reason) {
    deleteError.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div data-testid="assistant-archive-page">
    <PageHeader
      :title="t('components.assistant.archivedThreads')"
      :description="t('components.assistant.archiveDescription')"
    >
      <template #actions>
        <RouterLink class="button button--small" :to="{ name: 'assistant' }">
          <AppIcon name="back" :size="16" />{{ t('components.assistant.backToAssistant') }}
        </RouterLink>
        <button
          class="button button--small"
          type="button"
          :disabled="loading || busy"
          @click="load"
        >
          <AppIcon name="refresh" :size="16" />{{ t('components.assistant.refreshArchive') }}
        </button>
      </template>
    </PageHeader>
    <p v-if="error" class="assistant-panel__error" role="alert">{{ error }}</p>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('components.assistant.historyLoading') }}
    </div>
    <div v-else-if="threads.length" class="list-stack">
      <article
        v-for="thread in threads"
        :key="thread.id"
        class="card list-card"
        :data-testid="`archived-thread-${thread.id}`"
      >
        <span class="list-card__icon"><AppIcon name="archive" /></span>
        <div class="list-card__body">
          <h3>{{ thread.title }}</h3>
          <p>
            {{
              t('components.assistant.threadArchivedAt', { date: formatDate(thread.archivedAt) })
            }}
          </p>
        </div>
        <div class="button-row">
          <button
            class="button button--small"
            type="button"
            :disabled="busy"
            @click="restore(thread)"
          >
            {{ t('components.assistant.restoreThread') }}
          </button>
          <button
            class="button button--small button--danger"
            type="button"
            :disabled="busy"
            @click="requestDelete(thread)"
          >
            {{ t('components.assistant.deleteThread') }}
          </button>
        </div>
      </article>
    </div>
    <EmptyState
      v-else-if="!error"
      icon="archive"
      :title="t('components.assistant.archiveEmpty')"
      :description="t('components.assistant.archiveEmptyDescription')"
    />
    <ConfirmDialog
      :open="Boolean(selected)"
      :title="t('components.assistant.deleteThreadTitle')"
      :description="
        selected ? t('components.assistant.deleteThreadDescription', { title: selected.title }) : ''
      "
      :confirm-label="t('components.assistant.deleteThread')"
      :busy="busy"
      danger
      @update:open="!$event && !busy && (selected = null)"
      @confirm="remove"
    >
      <p v-if="deleteError" class="assistant-panel__error" role="alert">{{ deleteError }}</p>
    </ConfirmDialog>
  </div>
</template>
