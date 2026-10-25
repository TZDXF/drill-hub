<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GradingJob } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppFormField from '../components/AppFormField.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import AppSelect from '../components/AppSelect.vue';
import AppScrollArea from '../components/AppScrollArea.vue';

const { t } = useI18n();
const learning = useLearning();
const jobs = ref<GradingJob[]>([]);
const status = ref('all');
const loading = ref(true);
const retrying = ref('');
const error = ref('');
const statusKeys: GradingJob['status'][] = [
  'queued',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'cancelled',
  'blocked_config',
  'blocked_budget',
];
const statusLabels = computed<Record<GradingJob['status'], string>>(() => ({
  queued: t('management.grading.status.queued'),
  running: t('management.grading.status.running'),
  retry_wait: t('management.grading.status.retry_wait'),
  succeeded: t('management.grading.status.succeeded'),
  failed: t('management.grading.status.failed'),
  cancelled: t('management.grading.status.cancelled'),
  blocked_config: t('management.grading.status.blocked_config'),
  blocked_budget: t('management.grading.status.blocked_budget'),
}));
const statusOptions = computed(() => [
  { value: 'all', label: t('management.grading.status.all') },
  ...statusKeys.map((value) => ({ value, label: statusLabels.value[value] })),
]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await learning.get<GradingJob[]>('/admin/grading-jobs');
    jobs.value =
      status.value === 'all' ? result : result.filter((job) => job.status === status.value);
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('management.grading.loadError'), error.value);
  } finally {
    loading.value = false;
  }
}
async function retry(job: GradingJob) {
  if (job.status === 'cancelled') return;
  retrying.value = job.id;
  error.value = '';
  try {
    await learning.post(`/admin/grading-jobs/${job.id}/retry`, {});
    learning.notify.success(
      t('management.grading.retryDone'),
      t('management.grading.retryDoneDesc'),
    );
    await load();
  } catch (reason) {
    learning.notify.error(t('management.grading.retryFailed'), errorMessage(reason));
  } finally {
    retrying.value = '';
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('management.grading.title')"
      eyebrow="GRADING OPERATIONS"
      :description="t('management.grading.description')"
    >
      <template #actions
        ><button class="button" type="button" @click="load">
          <AppIcon name="refresh" :size="17" />{{ t('management.common.refresh') }}
        </button></template
      >
    </PageHeader>
    <form class="card filter-bar" @submit.prevent="load">
      <AppFormField id="job-status" :label="t('management.grading.status.label')">
        <AppSelect id="job-status" v-model="status" :items="statusOptions" />
      </AppFormField>
      <button class="button" type="submit">{{ t('management.common.applyFilter') }}</button>
    </form>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('management.grading.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('management.grading.loadFailed')"
      :description="t('management.common.networkRetry')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('management.common.retry') }}
      </button></EmptyState
    >
    <AppScrollArea
      v-else-if="jobs.length"
      class="paper-panel table-wrap"
      orientation="horizontal"
      type="auto"
    >
      <table class="data-table responsive-table">
        <thead>
          <tr>
            <th>{{ t('management.grading.col.task') }}</th>
            <th>{{ t('management.grading.col.status') }}</th>
            <th>{{ t('management.grading.col.attempts') }}</th>
            <th>{{ t('management.grading.col.nextRun') }}</th>
            <th>{{ t('management.grading.col.errorCode') }}</th>
            <th>
              <span class="sr-only">{{ t('management.common.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in jobs" :key="job.id">
            <td :data-label="t('management.grading.col.task')">
              <span class="table-primary">{{ job.id }}</span
              ><span class="table-secondary">{{
                t('management.grading.taskMeta', {
                  attempt: job.attemptId,
                  generation: job.generation,
                })
              }}</span>
            </td>
            <td :data-label="t('management.grading.col.status')">
              <span
                class="badge"
                :class="
                  job.status === 'succeeded'
                    ? 'badge--green'
                    : ['failed', 'blocked_config', 'blocked_budget'].includes(job.status)
                      ? 'badge--red'
                      : 'badge--amber'
                "
                >{{ statusLabels[job.status] }}</span
              >
            </td>
            <td :data-label="t('management.grading.col.attempts')">{{ job.attemptCount }}</td>
            <td :data-label="t('management.grading.col.nextRun')">
              {{ formatDate(job.nextRunAt) }}
            </td>
            <td :data-label="t('management.grading.col.errorCode')">
              {{ job.lastErrorCode ?? '—' }}
            </td>
            <td>
              <div class="table-actions">
                <button
                  v-if="
                    job.status !== 'succeeded' &&
                    job.status !== 'running' &&
                    job.status !== 'cancelled'
                  "
                  class="button button--small"
                  type="button"
                  :disabled="retrying === job.id"
                  @click="retry(job)"
                >
                  <span v-if="retrying === job.id" class="spinner" />{{
                    t('management.grading.retry')
                  }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </AppScrollArea>
    <EmptyState
      v-else
      :title="t('management.grading.empty')"
      :description="t('management.grading.emptyDesc')"
    />
  </div>
</template>
