<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { GradingJob } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import AppSelect from '../components/AppSelect.vue';
import AppScrollArea from '../components/AppScrollArea.vue';

const learning = useLearning();
const jobs = ref<GradingJob[]>([]);
const status = ref('all');
const loading = ref(true);
const retrying = ref('');
const error = ref('');
const labels: Record<GradingJob['status'], string> = {
  queued: '排队中',
  running: '运行中',
  retry_wait: '等待重试',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消（作答作废）',
  blocked_config: '配置阻塞',
  blocked_budget: '预算阻塞',
};
const statusOptions = [
  { value: 'all', label: '全部状态' },
  ...Object.entries(labels).map(([value, label]) => ({ value, label })),
];
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await learning.get<GradingJob[]>('/admin/grading-jobs');
    jobs.value =
      status.value === 'all' ? result : result.filter((job) => job.status === status.value);
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error('评分任务读取失败', error.value);
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
    learning.notify.success('评分任务已恢复', '任务已重新进入评分队列。');
    await load();
  } catch (reason) {
    learning.notify.error('恢复评分任务失败', errorMessage(reason));
  } finally {
    retrying.value = '';
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      title="评分运维"
      eyebrow="GRADING OPERATIONS"
      description="仅展示脱敏任务状态与安全错误码，不提供跨用户答案浏览，也不能在此修改分数。"
    >
      <template #actions
        ><button class="button" type="button" @click="load">
          <AppIcon name="refresh" :size="17" />刷新
        </button></template
      >
    </PageHeader>
    <form class="card filter-bar" @submit.prevent="load">
      <div class="form-field">
        <label for="job-status">任务状态</label
        ><AppSelect id="job-status" v-model="status" :items="statusOptions" />
      </div>
      <button class="button" type="submit">应用筛选</button>
    </form>
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取评分任务</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="评分任务读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
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
            <th>任务</th>
            <th>状态</th>
            <th>尝试次数</th>
            <th>下次运行</th>
            <th>安全错误码</th>
            <th><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in jobs" :key="job.id">
            <td data-label="任务">
              <span class="table-primary">{{ job.id }}</span
              ><span class="table-secondary"
                >作答 {{ job.attemptId }} · generation {{ job.generation }}</span
              >
            </td>
            <td data-label="状态">
              <span
                class="badge"
                :class="
                  job.status === 'succeeded'
                    ? 'badge--green'
                    : ['failed', 'blocked_config', 'blocked_budget'].includes(job.status)
                      ? 'badge--red'
                      : 'badge--amber'
                "
                >{{ labels[job.status] }}</span
              >
            </td>
            <td data-label="尝试次数">{{ job.attemptCount }}</td>
            <td data-label="下次运行">{{ formatDate(job.nextRunAt) }}</td>
            <td data-label="安全错误码">{{ job.lastErrorCode ?? '—' }}</td>
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
                  <span v-if="retrying === job.id" class="spinner" />恢复任务
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </AppScrollArea>
    <EmptyState
      v-else
      title="没有符合条件的评分任务"
      description="学习与交卷不依赖此页面。配置修复后，可在这里显式恢复失败或阻塞任务。"
    />
  </div>
</template>
