<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { SearchOutcome, SearchResourceType, SearchResult } from '@drill-hub/contracts';
import { useLearning } from '#learning-client/injection';
import { errorMessage, formatDate } from '#learning-client/utils';
import PageHeader from '#learning-client/components/PageHeader.vue';
import AppFormField from '#learning-client/components/AppFormField.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppSelect from '#learning-client/components/AppSelect.vue';
import EmptyState from '#learning-client/components/EmptyState.vue';

const { t, n } = useI18n();
const learning = useLearning();
const router = useRouter();
const query = ref('');
const type = ref('all');
const loading = ref(false);
const searched = ref(false);
const error = ref('');
const outcome = ref<SearchOutcome | null>(null);
const typeOptions = computed(() => [
  { value: 'all', label: t('management.search.type.all') },
  ...(['topic', 'content', 'plan', 'question', 'assessment'] as const).map((value) => ({
    value,
    label: t(`management.search.type.${value}`),
  })),
]);
const results = computed(() => outcome.value?.results ?? []);
const total = computed(() => results.value.length);

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
  loading.value = true;
  error.value = '';
  try {
    const types = type.value === 'all' ? '' : `&types=${type.value}`;
    outcome.value = await learning.get<SearchOutcome>(`/search?q=${encodeURIComponent(q)}${types}`);
    searched.value = true;
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('management.search.failed'), error.value);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader
      :title="t('management.search.title')"
      eyebrow="SEARCH"
      :description="t('management.search.description')"
    />
    <form class="card filter-bar" role="search" @submit.prevent="run">
      <AppFormField id="search-query" :label="t('management.search.queryLabel')">
        <input
          id="search-query"
          v-model="query"
          class="input"
          type="search"
          :placeholder="t('management.search.queryPlaceholder')"
          maxlength="100"
        />
      </AppFormField>
      <AppFormField id="search-type" :label="t('management.search.typeLabel')">
        <AppSelect id="search-type" v-model="type" :items="typeOptions" />
      </AppFormField>
      <button class="button button--primary" type="submit" :disabled="loading">
        <span v-if="loading" class="spinner" /><AppIcon v-else name="search" :size="16" />
        {{ t('management.search.submit') }}
      </button>
    </form>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('management.search.loading') }}
    </div>
    <template v-else-if="searched">
      <p v-if="total" class="muted small search-summary">
        {{ t('management.search.resultCount', { count: n(total) }) }}
      </p>
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
              {{ result.title }}
              <span v-if="result.archived" class="badge">{{
                t('management.search.archived')
              }}</span>
            </h3>
            <p v-if="result.snippet">{{ result.snippet }}</p>
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
        v-else-if="!error"
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
.search-summary {
  margin: 0 0 10px;
}
</style>
