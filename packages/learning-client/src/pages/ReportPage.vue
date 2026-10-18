<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AttemptReport } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { planReturnLocation } from '../planNavigation';
import { captureAnswerLinkToken } from '../publicAccess';
import { questionIndexFromQuery } from '../questionNavigation';
import { questionTypeLabels } from '../types';
import {
  answerStatusLabels,
  canContinueAttempt,
  gradingStatusLabels,
} from '../attemptPresentation';
import { planNavigationQuery } from '../planNavigation';
import { errorMessage, formatDate, formatScore, isApiError } from '../utils';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import GradeFeedback from '../components/GradeFeedback.vue';
import AttemptChoiceReview from '../components/AttemptChoiceReview.vue';
import EmptyState from '../components/EmptyState.vue';
import AttemptQuestionNav from '../components/AttemptQuestionNav.vue';

const props = withDefaults(defineProps<{ publicAccess?: boolean }>(), { publicAccess: false });
const learning = useLearning();
const route = useRoute();
const router = useRouter();
const publicToken = ref('');
const report = ref<AttemptReport | null>(null);
const planReturn = computed(() =>
  report.value ? planReturnLocation(report.value.attempt.topicId, route.query) : null,
);
const loading = ref(true);
const refreshing = ref(false);
const voidOpen = ref(false);
const voiding = ref(false);
const voidReason = ref('');
const validVoidReason = computed(
  () => voidReason.value.trim().length > 0 && voidReason.value.trim().length <= 4000,
);
const currentIndex = computed(() =>
  route.query.question && report.value
    ? questionIndexFromQuery(route.query.question, report.value.attempt.items.length)
    : -1,
);
const currentItem = computed(() => report.value?.attempt.items[currentIndex.value] ?? null);
const answers = computed(() =>
  Object.fromEntries(report.value?.attempt.items.map((item) => [item.id, item.answer]) ?? []),
);
const error = ref('');
let pollTimer: ReturnType<typeof setTimeout> | null = null;
const released = computed(
  () => report.value?.attempt.kind === 'practice' || report.value?.attempt.status !== 'in_progress',
);

async function load(background = false, notifyFailure = true) {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (background) refreshing.value = true;
  else loading.value = true;
  error.value = '';
  try {
    if (props.publicAccess) {
      publicToken.value = captureAnswerLinkToken(route.hash);
      if (!publicToken.value) throw new Error('答题链接缺少临时秘钥');
      report.value = await learning.publicGet<AttemptReport>(
        '/public/answer/report',
        publicToken.value,
      );
    } else {
      report.value = await learning.get<AttemptReport>(
        `/attempts/${String(route.params.attemptId)}/report`,
      );
    }
    const shouldPoll =
      !report.value.isFinal ||
      report.value.hasActiveRegrading ||
      report.value.attempt.items.some((item) =>
        ['pending', 'running'].includes(item.gradingStatus),
      );
    if (shouldPoll && !report.value.attempt.voidedAt) {
      pollTimer = setTimeout(() => void load(true, false), 5000);
    }
  } catch (reason) {
    error.value = errorMessage(reason);
    if (notifyFailure) learning.notify.error('报告刷新失败', error.value);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}
async function voidAttempt() {
  if (
    !report.value ||
    props.publicAccess ||
    report.value.attempt.voidedAt ||
    voiding.value ||
    !validVoidReason.value
  )
    return;
  voiding.value = true;
  try {
    await learning.post(`/attempts/${report.value.attempt.id}/void`, {
      expectedRevision: report.value.attempt.revision,
      reason: voidReason.value.trim(),
    });
    voidOpen.value = false;
    voidReason.value = '';
    learning.notify.success(
      '作答已作废',
      '记录和已有评分仍会保留，不再计入学习统计，也不能继续答题、交卷或触发评分。',
    );
    await load(true);
  } catch (reason) {
    learning.notify.error('作废失败', errorMessage(reason));
    if (isApiError(reason, 409)) {
      voidOpen.value = false;
      await load(true);
    }
  } finally {
    voiding.value = false;
  }
}
async function goTo(index: number) {
  if (
    !report.value ||
    index < -1 ||
    index >= report.value.attempt.items.length ||
    index === currentIndex.value
  )
    return;
  await router.replace({
    query: { ...route.query, question: index < 0 ? undefined : String(index + 1) },
    ...(props.publicAccess ? { hash: `#${publicToken.value}` } : {}),
  });
}
onMounted(() => void load());
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<template>
  <div class="attempt-layout">
    <main class="report-container">
      <div v-if="loading" class="loading-block"><span class="spinner" />正在读取服务端报告</div>
      <EmptyState
        v-else-if="error && !report"
        icon="alert"
        title="报告读取失败"
        description="请检查网络连接后重试。"
        ><button class="button button--small" type="button" @click="load()">
          重试
        </button></EmptyState
      >
      <template v-else-if="report">
        <PageHeader
          :title="report.attempt.title"
          eyebrow="LEARNING REPORT"
          :description="`${report.attempt.kind === 'exam' ? '考试' : '练习'} · 提交于 ${formatDate(report.attempt.submittedAt)}`"
        >
          <template v-if="!publicAccess" #back
            ><RouterLink class="back-link" :to="planReturn ?? { name: 'history' }"
              ><AppIcon name="back" :size="16" />{{
                planReturn ? '返回学习计划' : '学习历史'
              }}</RouterLink
            ></template
          >
          <template #actions>
            <RouterLink
              v-if="!publicAccess && canContinueAttempt(report.attempt)"
              class="button button--primary"
              :to="{
                name: 'attempt',
                params: { attemptId: report.attempt.id },
                query: planNavigationQuery(route.query),
              }"
              >继续作答</RouterLink
            >
            <button
              v-if="!publicAccess && !report.attempt.voidedAt"
              class="button button--danger"
              type="button"
              :disabled="voiding || refreshing"
              @click="voidOpen = true"
            >
              作废作答
            </button>
            <button
              class="button"
              type="button"
              :disabled="refreshing || voiding"
              @click="load(true)"
            >
              <span v-if="refreshing" class="spinner" /><AppIcon
                v-else
                name="refresh"
                :size="17"
              />刷新报告
            </button></template
          >
        </PageHeader>
        <div class="notice" style="margin-bottom: 14px">
          <span
            class="badge"
            :class="report.attempt.purpose === 'test' ? 'badge--amber' : 'badge--teal'"
            >{{ report.attempt.purpose === 'test' ? '测试作答' : '正式作答' }}</span
          >
          <p v-if="report.attempt.purpose === 'test'">
            可正常答题、交卷及评分，不计入学习统计、错题和计划进度。
          </p>
          <p v-else>未作废的正式作答计入所属用户的学习统计、错题和计划进度。</p>
        </div>
        <div
          v-if="report.attempt.voidedAt"
          class="notice notice--error"
          style="margin-bottom: 14px"
        >
          <AppIcon name="archive" />
          <div>
            <strong>已作废 · 只读</strong>
            <p>不再计入学习统计、错题与计划进度；不能编辑、交卷或触发后续评分，历史记录仍保留。</p>
            <p>作废时间：{{ formatDate(report.attempt.voidedAt) }}</p>
            <p>作废人：{{ report.attempt.voidedBy }}</p>
            <p class="feedback-text">作废原因：{{ report.attempt.voidReason }}</p>
          </div>
        </div>
        <div class="report-workspace">
          <AttemptQuestionNav
            :items="report.attempt.items"
            :answers="answers"
            :current-index="currentIndex"
            :marked-ids="[]"
            :marks-enabled="false"
            :disabled="false"
            mode="review"
            @select="goTo"
          />
          <div class="report-content">
            <div
              v-if="report.attempt.source === 'answer_link'"
              class="notice"
              style="margin-bottom: 14px"
            >
              <AppIcon name="eye" />
              <p>临时链接作答记到链接所属用户名下；登录后只能只读查看，不能修改链接答案。</p>
            </div>
            <template v-if="currentIndex < 0">
              <div
                v-if="!report.attempt.voidedAt && report.hasActiveRegrading"
                class="notice notice--pending"
                style="margin-bottom: 14px"
              >
                <AppIcon name="refresh" />
                <div>
                  <strong>有重评任务正在进行</strong>
                  <p>当前有效成绩仍会保留显示，新结果不会把旧分静默清零。</p>
                </div>
              </div>
              <div
                v-else-if="!report.attempt.voidedAt && !report.isFinal"
                class="notice notice--pending"
                style="margin-bottom: 14px"
              >
                <AppIcon name="clock" />
                <div>
                  <strong>报告尚未最终完成</strong>
                  <p>已判得分与待评分分值分开显示；待评分不是 0 分。</p>
                </div>
              </div>
              <div
                v-if="report.failedCount"
                class="notice notice--error"
                style="margin-bottom: 14px"
              >
                <AppIcon name="alert" />
                <div>
                  <strong>{{ report.failedCount }} 题评分未完成</strong>
                  <p>失败不等于零分。请稍后刷新，或等待管理员恢复评分任务。</p>
                </div>
              </div>
              <section class="paper-panel report-summary" aria-label="成绩摘要">
                <div class="report-summary__item">
                  <span>{{ report.isFinal ? '最终得分' : '当前已判得分' }}</span
                  ><strong
                    >{{ formatScore(report.awardedScore) }}
                    <small>/ {{ formatScore(report.maxScore) }}</small></strong
                  >
                </div>
                <div class="report-summary__item">
                  <span>待评分分值</span><strong>{{ formatScore(report.pendingMaxScore) }}</strong>
                </div>
                <div class="report-summary__item">
                  <span>报告状态</span
                  ><strong style="font-size: 20px">{{
                    report.attempt.voidedAt
                      ? '已作废'
                      : report.attempt.status === 'in_progress'
                        ? '作答中'
                        : report.isFinal
                          ? '已完成'
                          : '评分中'
                  }}</strong>
                </div>
                <div class="report-summary__item">
                  <span>未作答题数</span><strong>{{ report.unansweredCount }} 题</strong>
                </div>
              </section>
              <p v-if="report.attempt.taskId" class="muted small">
                {{
                  report.attempt.purpose === 'test' || report.attempt.voidedAt
                    ? '此记录不计入计划进度。'
                    : report.attempt.kind === 'exam'
                      ? '正式考试交卷即满足作答任务完成条件，全部留空也可完成。'
                      : '正式练习全部留空不会完成计划任务。'
                }}
              </p>
            </template>
            <section v-if="currentItem" aria-label="逐题报告">
              <article :key="currentItem.id" class="paper-panel report-item">
                <header class="report-item__header">
                  <div>
                    <span class="question-number"
                      >第 {{ currentIndex + 1 }} 题 ·
                      {{ questionTypeLabels[currentItem.type] }}</span
                    >
                    <h2>{{ currentItem.stem }}</h2>
                  </div>
                  <span
                    class="badge"
                    :class="
                      currentItem.gradingStatus === 'completed'
                        ? 'badge--green'
                        : currentItem.gradingStatus === 'failed'
                          ? 'badge--red'
                          : 'badge--amber'
                    "
                    >{{ gradingStatusLabels[currentItem.gradingStatus] }}</span
                  >
                </header>
                <p class="muted small">
                  答案状态：{{ answerStatusLabels[currentItem.answerStatus] }}
                </p>
                <AttemptChoiceReview :item="currentItem" />
                <GradeFeedback
                  v-if="released && currentItem.lockedAt"
                  :item="currentItem"
                  :show-score="false"
                  :voided="Boolean(report.attempt.voidedAt)"
                  show-reference
                />
              </article>
            </section>
            <nav v-if="report.attempt.items.length" class="report-pagination" aria-label="逐题切换">
              <button
                class="button"
                type="button"
                :disabled="currentIndex < 0"
                @click="goTo(currentIndex - 1)"
              >
                <AppIcon name="back" :size="16" />{{ currentIndex === 0 ? '评分总览' : '上一题' }}
              </button>
              <span class="muted small" aria-live="polite" aria-atomic="true">
                {{
                  currentIndex < 0
                    ? `评分总览 · 共 ${report.attempt.items.length} 题`
                    : `第 ${currentIndex + 1} / ${report.attempt.items.length} 题`
                }}
              </span>
              <button
                class="button"
                type="button"
                :disabled="currentIndex === report.attempt.items.length - 1"
                @click="goTo(currentIndex + 1)"
              >
                {{ currentIndex < 0 ? '查看题目' : '下一题' }}<AppIcon name="chevron" :size="16" />
              </button>
            </nav>
            <EmptyState v-else title="暂无题目" description="这份报告没有可展示的题目。" />
          </div>
        </div>
        <ConfirmDialog
          v-model:open="voidOpen"
          title="确认作废本次作答？"
          description="作废后不可恢复：作答仅供只读查看，不计入学习统计、错题和计划进度，也不能继续答题、交卷或触发评分。已有记录与评分历史仍保留。"
          confirm-label="确认作废"
          :busy="voiding"
          :confirm-disabled="!validVoidReason"
          danger
          @confirm="voidAttempt"
        >
          <div class="form-field">
            <label for="attempt-void-reason">作废原因（必填，最多 4000 字）</label>
            <textarea
              id="attempt-void-reason"
              v-model="voidReason"
              class="textarea"
              rows="4"
              maxlength="4000"
              :disabled="voiding"
              required
            />
            <p class="muted small">请确认当前记录和原因，版本冲突时需要重新查看后确认。</p>
          </div>
        </ConfirmDialog>
      </template>
    </main>
  </div>
</template>
