<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { attemptPurposeOptions, canContinueAttempt } from '../attemptPresentation';
import type { AttemptView } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import AppSelect from '../components/AppSelect.vue';

const learning = useLearning();
const attempts = ref<AttemptView[]>([]);
const kind = ref('all');
const status = ref('all');
const purpose = ref('all');
const voided = ref('all');
const purposeOptions = [{ value: 'all', label: '全部用途' }, ...attemptPurposeOptions];
const voidOptions = [
  { value: 'all', label: '全部记录' },
  { value: 'valid', label: '未作废' },
  { value: 'voided', label: '已作废' },
];
const visibleAttempts = computed(() =>
  attempts.value.filter(
    (attempt) =>
      (purpose.value === 'all' || attempt.purpose === purpose.value) &&
      (voided.value === 'all' || Boolean(attempt.voidedAt) === (voided.value === 'voided')),
  ),
);
const loading = ref(true);
const error = ref('');
const kindOptions = [
  { value: 'all', label: '全部类型' },
  { value: 'practice', label: '练习' },
  { value: 'exam', label: '考试' },
];
const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'in_progress', label: '作答中' },
  { value: 'pending_grading', label: '待评分' },
  { value: 'completed', label: '已完成' },
];
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
    learning.notify.error('历史读取失败', error.value);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      title="学习历史"
      eyebrow="LEARNING HISTORY"
      description="正式作答计入学习统计；测试及已作废作答不计入统计。临时链接作答记到所属用户名下，登录后仅可只读查看。"
    />
    <form class="card filter-bar history-filters" aria-label="历史筛选" @submit.prevent="load">
      <div class="form-field">
        <label for="history-kind">类型</label
        ><AppSelect id="history-kind" v-model="kind" :items="kindOptions" />
      </div>
      <div class="form-field">
        <label for="history-status">状态</label
        ><AppSelect id="history-status" v-model="status" :items="statusOptions" />
      </div>
      <div class="form-field">
        <label for="history-purpose">用途</label>
        <AppSelect id="history-purpose" v-model="purpose" :items="purposeOptions" />
      </div>
      <div class="form-field">
        <label for="history-voided">作废状态</label>
        <AppSelect id="history-voided" v-model="voided" :items="voidOptions" />
      </div>
      <button class="button" type="submit"><AppIcon name="history" :size="16" />应用筛选</button>
    </form>
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取历史</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="历史读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
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
            {{ attempt.kind === 'exam' ? '考试' : '练习' }} · 开始于
            {{ formatDate(attempt.startedAt) }}
          </p>
          <div class="list-card__meta">
            <span
              class="badge"
              :class="attempt.purpose === 'test' ? 'badge--amber' : 'badge--teal'"
              >{{ attempt.purpose === 'test' ? '测试作答' : '正式作答' }}</span
            >
            <span v-if="attempt.voidedAt" class="badge badge--red">已作废</span>
            <span v-if="attempt.source === 'answer_link'">临时链接作答 · 只读</span>
            <span v-if="attempt.submittedAt">提交于 {{ formatDate(attempt.submittedAt) }}</span
            ><span v-if="attempt.submissionReason === 'time_expired'">到期自动结算</span>
          </div>
        </div>
        <div class="list-card__aside">
          <span
            class="badge"
            :class="attempt.status === 'completed' ? 'badge--green' : 'badge--amber'"
            >{{
              attempt.voidedAt
                ? '只读记录'
                : attempt.status === 'in_progress'
                  ? '作答中'
                  : attempt.status === 'pending_grading'
                    ? '待评分'
                    : '已完成'
            }}</span
          ><AppIcon name="chevron" :size="17" />
        </div>
      </RouterLink>
    </div>
    <EmptyState
      v-else
      title="没有符合条件的学习记录"
      description="调整筛选条件，或从主题中开始一次真实练习。这里不会生成示例成绩。"
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
