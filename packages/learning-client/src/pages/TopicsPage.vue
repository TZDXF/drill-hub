<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Topic } from '@drill-hub/contracts';
import { useLearning } from '#learning-client/injection';
import { errorMessage, formatDate } from '#learning-client/utils';
import { createListSearch, matchRanges } from '#learning-client/search';
import PageHeader from '#learning-client/components/PageHeader.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import EmptyState from '#learning-client/components/EmptyState.vue';
import AppFormField from '#learning-client/components/AppFormField.vue';
import SearchHighlight from '#learning-client/components/SearchHighlight.vue';

const { t, n } = useI18n();
const learning = useLearning();
const topics = ref<Topic[]>([]);
const query = ref('');
const search = computed(() => createListSearch(topics.value, ['title', 'goalText']));
const results = computed(() =>
  query.value.trim()
    ? search.value.search(query.value.trim())
    : topics.value.map((item, refIndex) => ({ item, refIndex, matches: undefined })),
);
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
    <form
      v-if="!loading && !error && topics.length"
      class="card filter-bar topic-search"
      role="search"
      @submit.prevent
    >
      <AppFormField
        id="topic-search"
        :label="t('learning.topics.searchLabel')"
        class="topic-search__field"
      >
        <input
          id="topic-search"
          v-model="query"
          type="search"
          class="input"
          maxlength="100"
          :placeholder="t('learning.topics.searchPlaceholder')"
        />
      </AppFormField>
      <button v-if="query" class="button" type="button" @click="query = ''">
        {{ t('management.search.clear') }}
      </button>
      <p class="topic-search__count" role="status">
        {{ t('management.search.resultCount', { count: n(results.length) }) }}
      </p>
    </form>
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
    <div v-else-if="results.length" class="card-grid">
      <RouterLink
        v-for="{ item: topic, matches } in results"
        :key="topic.id"
        class="card topic-card"
        :to="{ name: 'topic-detail', params: { topicId: topic.id } }"
      >
        <div class="topic-card__top">
          <span class="list-card__icon"><AppIcon name="target" /></span
          ><AppIcon name="arrow" :size="18" class="subtle" />
        </div>
        <h2><SearchHighlight :text="topic.title" :indices="matchRanges(matches, 'title')" /></h2>
        <p>
          <SearchHighlight :text="topic.goalText" :indices="matchRanges(matches, 'goalText')" />
        </p>
        <div class="topic-card__footer">
          <span>{{ t('learning.common.updatedAt', { date: formatDate(topic.updatedAt) }) }}</span
          ><span>{{ t('learning.topics.revision', { revision: n(topic.revision) }) }}</span>
        </div>
      </RouterLink>
    </div>
    <EmptyState
      v-else-if="topics.length"
      icon="search"
      :title="t('management.search.emptyTitle')"
      :description="t('learning.topics.searchEmpty')"
    >
      <button class="button" type="button" @click="query = ''">
        {{ t('management.search.clear') }}
      </button>
    </EmptyState>
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

<style scoped>
.topic-search__field {
  flex: 1 1 280px;
}
.topic-search__count {
  margin: 0;
  align-self: center;
  color: var(--ink-soft);
  font-size: 13px;
}
@media (max-width: 520px) {
  .topic-search__field {
    flex-basis: auto;
  }
  .topic-search__count {
    align-self: flex-start;
  }
}
</style>
