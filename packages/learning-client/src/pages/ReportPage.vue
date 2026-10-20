<script setup lang="ts">
import { useI18n } from 'vue-i18n';
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
import { errorMessage, formatDate, formatScore } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import GradeFeedback from '../components/GradeFeedback.vue';
import AttemptChoiceReview from '../components/AttemptChoiceReview.vue';
import EmptyState from '../components/EmptyState.vue';
import AttemptQuestionNav from '../components/AttemptQuestionNav.vue';

const { t } = useI18n();

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
      if (!publicToken.value) throw new Error(t('core.errors.ANSWER_LINK_REQUIRED'));
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
    if (notifyFailure) learning.notify.error(t('learning.report.notifyRefreshError'), error.value);
  } finally {
    loading.value = false;
    refreshing.value = false;
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
      <div v-if="loading" class="loading-block">
        <span class="spinner" />{{ t('learning.report.loading') }}
      </div>
      <EmptyState
        v-else-if="error && !report"
        icon="alert"
        :title="t('learning.report.loadFailed')"
        :description="t('learning.common.networkHint')"
        ><button class="button button--small" type="button" @click="load()">
          {{ t('learning.common.retry') }}
        </button></EmptyState
      >
      <template v-else-if="report">
        <PageHeader
          :title="report.attempt.title"
          eyebrow="LEARNING REPORT"
          :description="
            t('learning.report.submittedAt', {
              kind:
                report.attempt.kind === 'exam'
                  ? t('learning.common.exam')
                  : t('learning.common.practice'),
              date: formatDate(report.attempt.submittedAt),
            })
          "
        >
          <template v-if="!publicAccess" #back
            ><RouterLink class="back-link" :to="planReturn ?? { name: 'history' }"
              ><AppIcon name="back" :size="16" />{{
                planReturn ? t('learning.content.backToPlan') : t('learning.report.backToHistory')
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
              >{{ t('learning.home.continueAttempt') }}</RouterLink
            >
            <button class="button" type="button" :disabled="refreshing" @click="load(true)">
              <span v-if="refreshing" class="spinner" /><AppIcon
                v-else
                name="refresh"
                :size="17"
              />{{ t('learning.report.refresh') }}
            </button></template
          >
        </PageHeader>
        <div class="notice" style="margin-bottom: 14px">
          <span
            class="badge"
            :class="report.attempt.purpose === 'test' ? 'badge--amber' : 'badge--teal'"
            >{{
              report.attempt.purpose === 'test'
                ? t('core.attempt.purpose.test')
                : t('core.attempt.purpose.learning')
            }}</span
          >
          <p v-if="report.attempt.purpose === 'test'">
            {{ t('learning.report.testNotice') }}
          </p>
          <p v-else>{{ t('learning.report.formalNotice') }}</p>
        </div>
        <div
          v-if="report.attempt.voidedAt"
          class="notice notice--error"
          style="margin-bottom: 14px"
        >
          <AppIcon name="archive" />
          <div>
            <strong>{{ t('learning.report.voidedTitle') }}</strong>
            <p>{{ t('learning.report.voidedDescription') }}</p>
            <p>
              {{ t('learning.report.voidedAt', { date: formatDate(report.attempt.voidedAt) }) }}
            </p>
            <p>{{ t('learning.report.voidedBy', { name: report.attempt.voidedBy }) }}</p>
            <p class="feedback-text">
              {{ t('learning.report.voidReason', { reason: report.attempt.voidReason }) }}
            </p>
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
              <p>{{ t('learning.report.answerLinkNotice') }}</p>
            </div>
            <template v-if="currentIndex < 0">
              <div
                v-if="!report.attempt.voidedAt && report.hasActiveRegrading"
                class="notice notice--pending"
                style="margin-bottom: 14px"
              >
                <AppIcon name="refresh" />
                <div>
                  <strong>{{ t('learning.report.regradingTitle') }}</strong>
                  <p>{{ t('learning.report.regradingDescription') }}</p>
                </div>
              </div>
              <div
                v-else-if="!report.attempt.voidedAt && !report.isFinal"
                class="notice notice--pending"
                style="margin-bottom: 14px"
              >
                <AppIcon name="clock" />
                <div>
                  <strong>{{ t('learning.report.notFinalTitle') }}</strong>
                  <p>{{ t('learning.report.notFinalDescription') }}</p>
                </div>
              </div>
              <div
                v-if="report.failedCount"
                class="notice notice--error"
                style="margin-bottom: 14px"
              >
                <AppIcon name="alert" />
                <div>
                  <strong>{{
                    t('learning.report.failedCountTitle', { count: report.failedCount })
                  }}</strong>
                  <p>{{ t('learning.report.failedCountDescription') }}</p>
                </div>
              </div>
              <section
                class="paper-panel report-summary"
                :aria-label="t('learning.report.summaryLabel')"
              >
                <div class="report-summary__item">
                  <span>{{
                    report.isFinal
                      ? t('learning.report.finalScore')
                      : t('learning.report.currentScore')
                  }}</span
                  ><strong
                    >{{ formatScore(report.awardedScore) }}
                    <small>/ {{ formatScore(report.maxScore) }}</small></strong
                  >
                </div>
                <div class="report-summary__item">
                  <span>{{ t('learning.report.pendingScore') }}</span
                  ><strong>{{ formatScore(report.pendingMaxScore) }}</strong>
                </div>
                <div class="report-summary__item">
                  <span>{{ t('learning.report.reportStatus') }}</span
                  ><strong style="font-size: 20px">{{
                    report.attempt.voidedAt
                      ? t('learning.home.voided')
                      : report.attempt.status === 'in_progress'
                        ? t('learning.report.statusInProgress')
                        : report.isFinal
                          ? t('learning.plan.statusCompleted')
                          : t('learning.report.statusGrading')
                  }}</strong>
                </div>
                <div class="report-summary__item">
                  <span>{{ t('learning.report.unansweredCount') }}</span
                  ><strong>{{
                    t('learning.common.questionCount', { count: report.unansweredCount })
                  }}</strong>
                </div>
              </section>
              <p v-if="report.attempt.taskId" class="muted small">
                {{
                  report.attempt.purpose === 'test' || report.attempt.voidedAt
                    ? t('learning.report.taskNoteTest')
                    : report.attempt.kind === 'exam'
                      ? t('learning.attempt.submitNoteExam')
                      : t('learning.attempt.submitNotePractice')
                }}
              </p>
            </template>
            <section v-if="currentItem" :aria-label="t('learning.report.itemLabel')">
              <article :key="currentItem.id" class="paper-panel report-item">
                <header class="report-item__header">
                  <div>
                    <span class="question-number"
                      >{{ t('learning.attempt.questionNumber', { index: currentIndex + 1 }) }} ·
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
                  {{
                    t('learning.report.answerStatus', {
                      status: answerStatusLabels[currentItem.answerStatus],
                    })
                  }}
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
            <nav
              v-if="report.attempt.items.length"
              class="report-pagination"
              :aria-label="t('learning.report.paginationLabel')"
            >
              <button
                class="button"
                type="button"
                :disabled="currentIndex < 0"
                @click="goTo(currentIndex - 1)"
              >
                <AppIcon name="back" :size="16" />{{
                  currentIndex === 0
                    ? t('learning.report.paginationOverview')
                    : t('learning.attempt.previous')
                }}
              </button>
              <span class="muted small" aria-live="polite" aria-atomic="true">
                {{
                  currentIndex < 0
                    ? t('learning.report.overviewCount', { count: report.attempt.items.length })
                    : t('learning.report.questionProgress', {
                        index: currentIndex + 1,
                        total: report.attempt.items.length,
                      })
                }}
              </span>
              <button
                class="button"
                type="button"
                :disabled="currentIndex === report.attempt.items.length - 1"
                @click="goTo(currentIndex + 1)"
              >
                {{
                  currentIndex < 0
                    ? t('learning.report.viewQuestions')
                    : t('learning.attempt.next')
                }}<AppIcon name="chevron" :size="16" />
              </button>
            </nav>
            <EmptyState
              v-else
              :title="t('learning.report.emptyTitle')"
              :description="t('learning.report.emptyDescription')"
            />
          </div>
        </div>
      </template>
    </main>
  </div>
</template>
