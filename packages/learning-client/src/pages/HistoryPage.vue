<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, onMounted, ref } from 'vue';
import { attemptPurposeOptions, canContinueAttempt } from '../attemptPresentation';
import type { AttemptView } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import AppSelect from '../components/AppSelect.vue';

const { t } = useI18n();

const learning = useLearning();
const attempts = ref<AttemptView[]>([]);
const kind = ref('all');
const status = ref('all');
const purpose = ref('all');
const voided = ref('all');
const purposeOptions = computed(() => [
  { value: 'all', label: t('learning.history.filter.purposeAll') },
  ...attemptPurposeOptions,
]);
const voidOptions = computed(() => [
  { value: 'all', label: t('learning.history.filter.voidAll') },
  { value: 'valid', label: t('learning.history.filter.voidValid') },
  { value: 'voided', label: t('learning.home.voided') },
]);
const visibleAttempts = computed(() =>
  attempts.value.filter(
    (attempt) =>
      (purpose.value === 'all' || attempt.purpose === purpose.value) &&
      (voided.value === 'all' || Boolean(attempt.voidedAt) === (voided.value === 'voided')),
  ),
);
const loading = ref(true);
const error = ref('');
const kindOptions = computed(() => [
  { value: 'all', label: t('learning.history.filter.kindAll') },
  { value: 'practice', label: t('learning.common.practice') },
  { value: 'exam', label: t('learning.common.exam') },
]);
const statusOptions = computed(() => [
  { value: 'all', label: t('learning.history.filter.statusAll') },
  { value: 'in_progress', label: t('learning.report.statusInProgress') },
  { value: 'pending_grading', label: t('learning.home.pendingGrading') },
  { value: 'completed', label: t('learning.plan.statusCompleted') },
]);
async function load() {
  loading.value = true;
  error.value = '';
  const query = new URLSearchParams();
  if (kind.value !== 'all') query.set('kind', kind.value);
  if (status.value !== 'all') query.set('status', status.value);
  try {
    attempts.value = await learning.get<AttemptView[]>(`/attempts${query.size ? `?${query}` : ''}`);
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('learning.history.loadFailed'), error.value);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('learning.report.backToHistory')"
      eyebrow="LEARNING HISTORY"
      :description="t('learning.history.description')"
    />
    <form
      class="card filter-bar history-filters"
      :aria-label="t('learning.history.filtersLabel')"
      @submit.prevent="load"
    >
      <div class="form-field">
        <label for="history-kind">{{ t('learning.history.labelKind') }}</label
        ><AppSelect id="history-kind" v-model="kind" :items="kindOptions" />
      </div>
      <div class="form-field">
        <label for="history-status">{{ t('learning.history.labelStatus') }}</label
        ><AppSelect id="history-status" v-model="status" :items="statusOptions" />
      </div>
      <div class="form-field">
        <label for="history-purpose">{{ t('learning.history.labelPurpose') }}</label>
        <AppSelect id="history-purpose" v-model="purpose" :items="purposeOptions" />
      </div>
      <div class="form-field">
        <label for="history-voided">{{ t('learning.history.labelVoided') }}</label>
        <AppSelect id="history-voided" v-model="voided" :items="voidOptions" />
      </div>
      <button class="button" type="submit">
        <AppIcon name="history" :size="16" />{{ t('learning.wrongQuestions.applyFilter') }}
      </button>
    </form>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('learning.history.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('learning.history.loadFailed')"
      :description="t('learning.common.networkHint')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('learning.common.retry') }}
      </button></EmptyState
    >
    <div v-else-if="visibleAttempts.length" class="list-stack">
      <RouterLink
        v-for="attempt in visibleAttempts"
        :key="attempt.id"
        class="card list-card"
        :to="
          canContinueAttempt(attempt)
            ? { name: 'attempt', params: { attemptId: attempt.id } }
            : { name: 'report', params: { attemptId: attempt.id } }
        "
      >
        <span class="list-card__icon"
          ><AppIcon :name="attempt.kind === 'exam' ? 'lock' : 'content'"
        /></span>
        <div class="list-card__body">
          <h3>{{ attempt.title }}</h3>
          <p>
            {{
              attempt.kind === 'exam' ? t('learning.common.exam') : t('learning.common.practice')
            }}
            · {{ t('learning.history.startedAt', { date: formatDate(attempt.startedAt) }) }}
          </p>
          <div class="list-card__meta">
            <span
              class="badge"
              :class="attempt.purpose === 'test' ? 'badge--amber' : 'badge--teal'"
              >{{
                attempt.purpose === 'test'
                  ? t('core.attempt.purpose.test')
                  : t('core.attempt.purpose.learning')
              }}</span
            >
            <span v-if="attempt.voidedAt" class="badge badge--red">{{
              t('learning.home.voided')
            }}</span>
            <span v-if="attempt.source === 'answer_link'">{{
              t('learning.history.answerLinkReadOnly')
            }}</span>
            <span v-if="attempt.submittedAt">{{
              t('learning.home.submittedAt', { date: formatDate(attempt.submittedAt) })
            }}</span
            ><span v-if="attempt.submissionReason === 'time_expired'">{{
              t('learning.history.timeExpired')
            }}</span>
          </div>
        </div>
        <div class="list-card__aside">
          <span
            class="badge"
            :class="attempt.status === 'completed' ? 'badge--green' : 'badge--amber'"
            >{{
              attempt.voidedAt
                ? t('learning.history.readOnly')
                : attempt.status === 'in_progress'
                  ? t('learning.report.statusInProgress')
                  : attempt.status === 'pending_grading'
                    ? t('learning.home.pendingGrading')
                    : t('learning.plan.statusCompleted')
            }}</span
          ><AppIcon name="chevron" :size="17" />
        </div>
      </RouterLink>
    </div>
    <EmptyState
      v-else
      :title="t('learning.history.emptyTitle')"
      :description="t('learning.history.emptyDescription')"
    />
  </div>
</template>

<style scoped>
@media (max-width: 520px) {
  .history-filters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .history-filters .form-field {
    min-width: 0;
  }
  .history-filters > button {
    grid-column: 1 / -1;
  }
}
</style>
