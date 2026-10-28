<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { SearchOutcome, SearchResourceType, SearchResult } from '@drill-hub/contracts';
import { useLearning } from '#learning-client/injection';
import { errorMessage, formatDate } from '#learning-client/utils';
import PageHeader from '#learning-client/components/PageHeader.vue';
import AppFormField from '#learning-client/components/AppFormField.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppSelect from '#learning-client/components/AppSelect.vue';
import EmptyState from '#learning-client/components/EmptyState.vue';
import SearchHighlight from '#learning-client/components/SearchHighlight.vue';

const { t, n } = useI18n();
const learning = useLearning();
const router = useRouter();
const route = useRoute();
const query = ref(typeof route.query.q === 'string' ? route.query.q.slice(0, 100) : '');
const resourceTypes = ['topic', 'content', 'plan', 'question', 'assessment'] as const;
const type = ref(
  resourceTypes.some((value) => value === route.query.types) ? String(route.query.types) : 'all',
);
const loading = ref(false);
const error = ref('');
const outcome = ref<SearchOutcome | null>(null);
let disposed = false;
const typeOptions = computed(() => [
  { value: 'all', label: t('management.search.type.all') },
  ...resourceTypes.map((value) => ({
    value,
    label: t(`management.search.type.${value}`),
  })),
]);
const results = computed(() => outcome.value?.results ?? []);
const total = computed(() =>
  Object.values(outcome.value?.counts ?? {}).reduce((sum, count) => sum + count, 0),
);

function typeLabel(resourceType: SearchResourceType): string {
  return t(`management.search.type.${resourceType}`);
}
function target(result: SearchResult): { name: string; params: Record<string, string> } {
  switch (result.resourceType) {
    case 'topic':
      return { name: 'topic-detail', params: { topicId: result.id } };
    case 'content':
      return { name: 'content', params: { contentId: result.id } };
    case 'plan':
      return { name: 'plan', params: { topicId: result.topicId, planId: result.id } };
    case 'question':
      return { name: 'topic-detail', params: { topicId: result.topicId } };
    case 'assessment':
      return { name: 'assessment', params: { assessmentId: result.id } };
  }
}
function icon(resourceType: SearchResourceType): string {
  switch (resourceType) {
    case 'topic':
      return 'topics';
    case 'content':
      return 'content';
    case 'plan':
      return 'plan';
    case 'question':
      return 'list';
    case 'assessment':
      return 'wrong';
  }
}
async function run() {
  const q = query.value.trim();
  if (!q || loading.value) return;
  const selectedType = type.value;
  loading.value = true;
  error.value = '';
  try {
    const types = selectedType === 'all' ? '' : `&types=${selectedType}`;
    const result = await learning.get<SearchOutcome>(`/search?q=${encodeURIComponent(q)}${types}`);
    if (disposed) return;
    outcome.value = result;
    await router.replace({
      query: { q, ...(selectedType === 'all' ? {} : { types: selectedType }) },
    });
  } catch (reason) {
    if (disposed) return;
    error.value = errorMessage(reason);
    learning.notify.error(t('management.search.failed'), error.value);
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  if (query.value.trim()) void run();
});
onBeforeUnmount(() => {
  disposed = true;
});
</script>

<template>
  <div>
    <PageHeader
      :title="t('management.search.title')"
      eyebrow="SEARCH"
      :description="t('management.search.description')"
    />
    <form
      class="card filter-bar search-filters"
      role="search"
      :aria-busy="loading"
      @submit.prevent="run"
    >
      <AppFormField
        id="search-query"
        class="search-filters__query"
        :label="t('management.search.queryLabel')"
      >
        <input
          id="search-query"
          v-model="query"
          class="input"
          type="search"
          :placeholder="t('management.search.queryPlaceholder')"
          maxlength="100"
          :disabled="loading"
        />
      </AppFormField>
      <AppFormField id="search-type" :label="t('management.search.typeLabel')">
        <AppSelect id="search-type" v-model="type" :items="typeOptions" :disabled="loading" />
      </AppFormField>
      <button class="button button--primary" type="submit" :disabled="loading || !query.trim()">
        <span v-if="loading" class="spinner" /><AppIcon v-else name="search" :size="16" />
        {{ t('management.search.submit') }}
      </button>
    </form>
    <div v-if="loading" class="loading-block" role="status">
      <span class="spinner" />{{ t('management.search.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('management.search.failed')"
      :description="error"
    >
      <button class="button" type="button" @click="run">{{ t('management.common.retry') }}</button>
    </EmptyState>
    <template v-else-if="outcome">
      <div class="search-summary" role="status">
        <p>{{ t('management.search.resultsFor', { query: outcome.query, count: n(total) }) }}</p>
        <p v-if="total > results.length" class="field-hint">
          {{ t('management.search.resultLimit', { count: n(results.length) }) }}
        </p>
      </div>
      <div v-if="results.length" class="list-stack">
        <RouterLink
          v-for="result in results"
          :key="`${result.resourceType}-${result.id}`"
          class="card list-card"
          :to="target(result)"
        >
          <span class="list-card__icon"><AppIcon :name="icon(result.resourceType)" /></span>
          <div class="list-card__body">
            <h3>
              <SearchHighlight :text="result.title" :query="outcome.query" />
              <span v-if="result.archived" class="badge">{{
                t('management.search.archived')
              }}</span>
            </h3>
            <p v-if="result.snippet">
              <SearchHighlight :text="result.snippet" :query="outcome.query" />
            </p>
            <div class="list-card__meta">
              <span>{{ typeLabel(result.resourceType) }}</span>
              <span>{{
                t('learning.common.updatedAt', { date: formatDate(result.updatedAt) })
              }}</span>
            </div>
          </div>
          <AppIcon name="chevron" :size="18" class="subtle" />
        </RouterLink>
      </div>
      <EmptyState
        v-else
        icon="search"
        :title="t('management.search.emptyTitle')"
        :description="t('management.search.emptyDescription')"
      />
    </template>
    <EmptyState
      v-else
      icon="search"
      :title="t('management.search.initialTitle')"
      :description="t('management.search.initialDescription')"
    />
  </div>
</template>

<style scoped>
.search-filters__query {
  flex: 1 1 280px;
}
.search-summary {
  display: grid;
  gap: 6px;
  margin: 0 0 16px;
  color: var(--ink-soft);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.search-summary p {
  margin: 0;
}
@media (max-width: 520px) {
  .search-filters__query {
    flex-basis: auto;
  }
}
</style>
