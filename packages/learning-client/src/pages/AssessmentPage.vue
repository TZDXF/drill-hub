<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Assessment, AttemptView } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { planNavigationQuery, planReturnLocation } from '../planNavigation';
import { asAttemptView } from '../types';
import { errorMessage, formatDuration, formatScore } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import AttemptPurposeSelect from '../components/AttemptPurposeSelect.vue';

const learning = useLearning();
const route = useRoute();
const router = useRouter();
const assessment = ref<Assessment | null>(null);
const planReturn = computed(() =>
  assessment.value ? planReturnLocation(assessment.value.topicId, route.query) : null,
);
const loading = ref(true);
const starting = ref(false);
const purpose = ref<AttemptView['purpose']>('learning');
const error = ref('');

function totalScore(items: Assessment['items']) {
  const cents = items.reduce((sum, item) => {
    const [whole = '0', fraction = ''] = item.maxScore.split('.');
    return sum + BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  }, 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    assessment.value = await learning.get<Assessment>(
      `/assessments/${String(route.params.assessmentId)}`,
    );
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error('参与说明读取失败', error.value);
  } finally {
    loading.value = false;
  }
}
async function start() {
  if (!assessment.value) return;
  starting.value = true;
  error.value = '';
  try {
    const taskId = typeof route.query.taskId === 'string' ? route.query.taskId : undefined;
    const result = await learning.post<AttemptView | { attempt: AttemptView }>(
      `/assessments/${assessment.value.id}/attempts`,
      { purpose: purpose.value, ...(taskId ? { taskId } : {}) },
    );
    const attempt = asAttemptView(result);
    await router.push({
      name: 'attempt',
      params: { attemptId: attempt.id },
      query: planNavigationQuery(route.query),
    });
  } catch (reason) {
    learning.notify.error('无法开始作答', errorMessage(reason));
  } finally {
    starting.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取参与说明</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="参与说明读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
    >
    <template v-else-if="assessment">
      <PageHeader
        :title="assessment.title"
        :eyebrow="assessment.kind === 'exam' ? 'EXAM BRIEFING' : 'PRACTICE BRIEFING'"
        :description="
          assessment.kind === 'exam'
            ? '请在开始前确认时间与网络；考试以服务端截止时间和交卷事实为准。'
            : '练习可逐题提交并查看评分反馈，模型题可能需要等待。'
        "
      >
        <template #back
          ><RouterLink
            class="back-link"
            :to="planReturn ?? { name: 'topic-detail', params: { topicId: assessment.topicId } }"
            ><AppIcon name="back" :size="16" />{{
              planReturn ? '返回学习计划' : '返回主题'
            }}</RouterLink
          ></template
        >
      </PageHeader>
      <div v-if="assessment.archivedAt" class="notice notice--pending" style="margin-bottom: 16px">
        <AppIcon name="archive" />
        <div>
          <strong>已归档</strong>
          <p>不能开始新会话，已有作答与报告不受影响。</p>
        </div>
      </div>
      <section class="paper-panel assessment-hero" aria-labelledby="assessment-overview">
        <div>
          <span
            class="badge"
            :class="assessment.kind === 'exam' ? 'badge--amber' : 'badge--teal'"
            >{{ assessment.kind === 'exam' ? '限时 / 整体交卷' : '逐题提交 / 即时规则反馈' }}</span
          >
          <h2 id="assessment-overview">参与说明</h2>
          <div class="assessment-facts">
            <div class="assessment-fact">
              <strong>{{ assessment.items.length }}</strong
              ><span>题目数量</span>
            </div>
            <div class="assessment-fact">
              <strong>{{ formatScore(totalScore(assessment.items)) }}</strong
              ><span>试卷满分</span>
            </div>
            <div class="assessment-fact">
              <strong>{{ formatDuration(assessment.durationSeconds) }}</strong
              ><span>作答时限</span>
            </div>
          </div>
          <p>
            {{
              assessment.kind === 'exam'
                ? '考试开始前不会启动考试题评分，也不会展示标准答案或得分项。整体交卷后，已作答内容才会进入评分流程。'
                : '单题锁定后不能修改该题答案。规则题可立即评分；模型题与外部评分题会明确显示等待状态。'
            }}
          </p>
          <AttemptPurposeSelect
            id="assessment-purpose"
            v-model="purpose"
            :disabled="starting || Boolean(assessment.archivedAt)"
          />
          <button
            class="button button--primary button--large"
            type="button"
            :disabled="starting || Boolean(assessment.archivedAt)"
            @click="start"
          >
            <span v-if="starting" class="spinner" /><AppIcon v-else name="arrow" :size="18" />{{
              starting ? '正在准备会话' : '开始或继续'
            }}
          </button>
        </div>
        <aside class="assessment-side">
          <h3>作答前请了解</h3>
          <ul>
            <li>答案保存成功后才计入服务端会话。</li>
            <li>断网、切换应用或修改设备时间不会延长服务端时限。</li>
            <li>模型评分题的答案可能发送给管理员配置的评分模型。</li>
            <li>待评分与评分失败都不是 0 分。</li>
          </ul>
        </aside>
      </section>
    </template>
  </div>
</template>
