<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Topic } from '@drill-hub/contracts';
import { useLearning } from '#learning-client/injection';
import { errorMessage, formatDate } from '#learning-client/utils';
import PageHeader from '#learning-client/components/PageHeader.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import EmptyState from '#learning-client/components/EmptyState.vue';

const { t, n } = useI18n();
const learning = useLearning();
const topics = ref<Topic[]>([]);
const loading = ref(true);
const error = ref('');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    topics.value = await learning.get<Topic[]>('/topics?archiveState=active');
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('learning.topics.loadFailed'), error.value);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('learning.topics.title')"
      eyebrow="LEARNING TOPICS"
      :description="t('learning.topics.description')"
    />
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('learning.topics.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('learning.topics.loadFailed')"
      :description="t('learning.common.networkHint')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('learning.common.retry') }}
      </button></EmptyState
    >
    <div v-else-if="topics.length" class="card-grid">
      <RouterLink
        v-for="topic in topics"
        :key="topic.id"
        class="card topic-card"
        :to="{ name: 'topic-detail', params: { topicId: topic.id } }"
      >
        <div class="topic-card__top">
          <span class="list-card__icon"><AppIcon name="target" /></span
          ><AppIcon name="arrow" :size="18" class="subtle" />
        </div>
        <h2>{{ topic.title }}</h2>
        <p>{{ topic.goalText }}</p>
        <div class="topic-card__footer">
          <span>{{ t('learning.common.updatedAt', { date: formatDate(topic.updatedAt) }) }}</span
          ><span>{{ t('learning.topics.revision', { revision: n(topic.revision) }) }}</span>
        </div>
      </RouterLink>
    </div>
    <EmptyState
      v-else
      :title="t('learning.topics.emptyTitle')"
      :description="t('learning.topics.emptyDescription')"
    >
      <RouterLink class="button button--primary" :to="{ name: 'agent-tokens' }"
        ><AppIcon name="token" :size="17" />{{
          t('learning.topics.configureAgentTokens')
        }}</RouterLink
      >
    </EmptyState>
  </div>
</template>
