<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AttemptItemView, AttemptView } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import {
  answerText,
  asAttemptView,
  wrongPracticeRequest,
  type WrongQuestionDetailView,
} from '../types';
import { errorMessage, formatDate, formatOptionLabel } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import GradeFeedback from '../components/GradeFeedback.vue';
import AttemptChoiceReview from '../components/AttemptChoiceReview.vue';
import EmptyState from '../components/EmptyState.vue';

const { t } = useI18n();

const learning = useLearning();
const route = useRoute();
const router = useRouter();
const detail = ref<WrongQuestionDetailView | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const masteryLabels = {
  pending: t('learning.common.mastery.pending'),
  reviewing: t('learning.common.mastery.reviewing'),
  mastered: t('learning.common.mastery.mastered'),
} as const;
type Mastery = keyof typeof masteryLabels;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    detail.value = await learning.get<WrongQuestionDetailView>(
      `/wrong-questions/${String(route.params.questionId)}`,
    );
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('learning.wrongQuestionDetail.loadFailed'), error.value);
  } finally {
    loading.value = false;
  }
}
async function setMastery(masteryStatus: Mastery) {
  if (!detail.value) return;
  busy.value = true;
  error.value = '';
  try {
    await learning.patch(`/wrong-questions/${detail.value.questionId}/mastery`, {
      masteryStatus,
      expectedRevision: detail.value.revision,
    });
    learning.notify.success(
      t('learning.wrongQuestionDetail.notifyMasteryUpdated'),
      masteryLabels[masteryStatus],
    );
    await load();
  } catch (reason) {
    learning.notify.error(
      t('learning.wrongQuestionDetail.notifyMasteryError'),
      errorMessage(reason),
    );
  } finally {
    busy.value = false;
  }
}
async function practice() {
  if (!detail.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await learning.post<AttemptView | { attempt: AttemptView }>(
      '/wrong-question-practices',
      { ...wrongPracticeRequest(detail.value), purpose: 'learning' },
    );
    await router.push({ name: 'attempt', params: { attemptId: asAttemptView(result).id } });
  } catch (reason) {
    learning.notify.error(t('learning.wrongQuestions.notifyPracticeError'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
function displayAnswer(item: AttemptItemView) {
  const answer = item.answer;
  if (!answer) return t('learning.attempt.statUnanswered');
  if ('optionId' in answer)
    return item.options?.find((option) => option.id === answer.optionId)?.text ?? answer.optionId;
  if ('optionIds' in answer)
    return (
      answer.optionIds
        .map((id) => item.options?.find((option) => option.id === id)?.text ?? id)
        .join('\n') || t('learning.attempt.statUnanswered')
    );
  return answerText(answer);
}
onMounted(load);
</script>

<template>
  <div>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('learning.wrongQuestionDetail.loading') }}
    </div>
    <EmptyState
      v-else-if="error && !detail"
      icon="alert"
      :title="t('learning.wrongQuestionDetail.loadFailed')"
      :description="t('learning.common.networkHint')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('learning.common.retry') }}
      </button></EmptyState
    >
    <template v-else-if="detail">
      <PageHeader
        :title="t('learning.wrongQuestionDetail.title')"
        eyebrow="WRONG QUESTION REVIEW"
        :description="
          t('learning.wrongQuestionDetail.description', {
            count: detail.wrongCount,
            date: formatDate(detail.lastWrongAt),
          })
        "
      >
        <template #back
          ><RouterLink class="back-link" :to="{ name: 'wrong-questions' }"
            ><AppIcon name="back" :size="16" />{{
              t('learning.wrongQuestionDetail.backToList')
            }}</RouterLink
          ></template
        >
        <template #actions
          ><button class="button button--primary" type="button" :disabled="busy" @click="practice">
            <AppIcon name="refresh" :size="17" />{{
              t('learning.wrongQuestionDetail.startPractice')
            }}
          </button></template
        >
      </PageHeader>
      <section
        class="card card--padded"
        style="margin-bottom: 18px"
        aria-labelledby="mastery-title"
      >
        <div class="section-heading">
          <div>
            <h2 id="mastery-title">{{ t('learning.wrongQuestions.filterLabel') }}</h2>
            <p>{{ t('learning.wrongQuestionDetail.masteryDescription') }}</p>
          </div>
          <span class="badge badge--amber">{{ masteryLabels[detail.masteryStatus] }}</span>
        </div>
        <div class="button-row">
          <button
            v-for="(label, value) in masteryLabels"
            :key="value"
            class="button button--small"
            :class="{ 'button--primary': detail.masteryStatus === value }"
            type="button"
            :disabled="busy || detail.masteryStatus === value"
            @click="setMastery(value)"
          >
            {{ label }}
          </button>
        </div>
      </section>
      <section v-if="detail.question" class="paper-panel report-item" aria-labelledby="wrong-stem">
        <span class="question-number">{{
          t('learning.wrongQuestionDetail.questionVersion', { version: detail.question.version })
        }}</span>
        <h2 id="wrong-stem" style="margin-top: 8px; white-space: pre-wrap">
          {{ detail.question.definition.stem }}
        </h2>
        <div
          v-if="detail.question.definition.options?.length"
          class="tag-list"
          style="margin-top: 16px"
        >
          <span
            v-for="(option, index) in detail.question.definition.options"
            :key="option.id"
            class="badge"
            >{{ formatOptionLabel(index, option.text) }}</span
          >
        </div>
      </section>
      <section aria-labelledby="wrong-history-title">
        <div class="section-heading">
          <div>
            <h2 id="wrong-history-title">{{ t('learning.wrongQuestionDetail.historyTitle') }}</h2>
            <p>{{ t('learning.wrongQuestionDetail.historyDescription') }}</p>
          </div>
        </div>
        <div v-if="detail.attempts?.length" class="list-stack">
          <article
            v-for="attempt in detail.attempts"
            :key="attempt.id"
            class="paper-panel report-item"
          >
            <div class="section-heading">
              <div>
                <h3>{{ attempt.title }}</h3>
                <p>
                  {{ formatDate(attempt.submittedAt ?? attempt.startedAt) }} ·
                  {{
                    attempt.kind === 'exam'
                      ? t('learning.common.exam')
                      : t('learning.common.practice')
                  }}
                </p>
              </div>
              <RouterLink
                class="text-link"
                :to="{ name: 'report', params: { attemptId: attempt.id } }"
                >{{ t('learning.wrongQuestionDetail.fullReport') }}<AppIcon name="arrow" :size="14"
              /></RouterLink>
            </div>
            <div v-for="item in attempt.items" :key="item.id">
              <h4 style="white-space: pre-wrap">{{ item.stem }}</h4>
              <AttemptChoiceReview :item="item" />
              <div class="report-answer">
                <span class="meta-label">{{ t('learning.wrongQuestionDetail.thisAnswer') }}</span>
                <p>{{ displayAnswer(item) }}</p>
              </div>
              <GradeFeedback :item="item" show-reference />
            </div>
          </article>
        </div>
        <div v-else class="notice">
          <AppIcon name="history" />{{ t('learning.wrongQuestionDetail.noHistoryNotice') }}
        </div>
      </section>
    </template>
  </div>
</template>
