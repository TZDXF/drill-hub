<script setup lang="ts">
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
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import GradeFeedback from '../components/GradeFeedback.vue';
import AttemptChoiceReview from '../components/AttemptChoiceReview.vue';
import EmptyState from '../components/EmptyState.vue';
import AttemptPurposeSelect from '../components/AttemptPurposeSelect.vue';

const purpose = ref<AttemptView['purpose']>('learning');
const learning = useLearning();
const route = useRoute();
const router = useRouter();
const detail = ref<WrongQuestionDetailView | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const masteryLabels = { pending: '待复习', reviewing: '复习中', mastered: '已掌握' } as const;
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
    learning.notify.error('错题详情读取失败', error.value);
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
    learning.notify.success('掌握状态已更新', masteryLabels[masteryStatus]);
    await load();
  } catch (reason) {
    learning.notify.error('更新掌握状态失败', errorMessage(reason));
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
      { ...wrongPracticeRequest(detail.value), purpose: purpose.value },
    );
    await router.push({ name: 'attempt', params: { attemptId: asAttemptView(result).id } });
  } catch (reason) {
    learning.notify.error('开始重练失败', errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
function displayAnswer(item: AttemptItemView) {
  const answer = item.answer;
  if (!answer) return '未作答';
  if ('optionId' in answer)
    return item.options?.find((option) => option.id === answer.optionId)?.text ?? answer.optionId;
  if ('optionIds' in answer)
    return (
      answer.optionIds
        .map((id) => item.options?.find((option) => option.id === id)?.text ?? id)
        .join('\n') || '未作答'
    );
  return answerText(answer);
}
onMounted(load);
</script>

<template>
  <div>
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取错题详情</div>
    <EmptyState
      v-else-if="error && !detail"
      icon="alert"
      title="错题详情读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
    >
    <template v-else-if="detail">
      <PageHeader
        title="错题详情"
        eyebrow="WRONG QUESTION REVIEW"
        :description="`累计答错 ${detail.wrongCount} 次 · 最近答错 ${formatDate(detail.lastWrongAt)}`"
      >
        <template #back
          ><RouterLink class="back-link" :to="{ name: 'wrong-questions' }"
            ><AppIcon name="back" :size="16" />返回错题集</RouterLink
          ></template
        >
        <template #actions
          ><button class="button button--primary" type="button" :disabled="busy" @click="practice">
            <AppIcon name="refresh" :size="17" />开始重练
          </button></template
        >
      </PageHeader>
      <section class="card" aria-label="错题重练用途" style="margin-bottom: 16px">
        <AttemptPurposeSelect id="wrong-detail-purpose" v-model="purpose" :disabled="busy" />
      </section>
      <section
        class="card card--padded"
        style="margin-bottom: 18px"
        aria-labelledby="mastery-title"
      >
        <div class="section-heading">
          <div>
            <h2 id="mastery-title">掌握状态</h2>
            <p>只记录复习状态，不修改任何历史得分</p>
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
        <span class="question-number">题目版本 {{ detail.question.version }}</span>
        <h2 id="wrong-stem" style="margin-top: 8px; white-space: pre-wrap">
          {{ detail.question.definition.stem }}
        </h2>
        <div
          v-if="detail.question.definition.options?.length"
          class="tag-list"
          style="margin-top: 16px"
        >
          <span
            v-for="option in detail.question.definition.options"
            :key="option.id"
            class="badge"
            >{{ option.text }}</span
          >
        </div>
      </section>
      <section aria-labelledby="wrong-history-title">
        <div class="section-heading">
          <div>
            <h2 id="wrong-history-title">错答与复习历史</h2>
            <p>每次作答独立保留，重练不会覆盖旧记录</p>
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
                  {{ attempt.kind === 'exam' ? '考试' : '练习' }}
                </p>
              </div>
              <RouterLink
                class="text-link"
                :to="{ name: 'report', params: { attemptId: attempt.id } }"
                >完整报告<AppIcon name="arrow" :size="14"
              /></RouterLink>
            </div>
            <div v-for="item in attempt.items" :key="item.id">
              <h4 style="white-space: pre-wrap">{{ item.stem }}</h4>
              <AttemptChoiceReview :item="item" />
              <div class="report-answer">
                <span class="meta-label">本次答案</span>
                <p>{{ displayAnswer(item) }}</p>
              </div>
              <GradeFeedback :item="item" show-reference />
            </div>
          </article>
        </div>
        <div v-else class="notice">
          <AppIcon name="history" />服务端未返回错答历史，可在“学习历史”中查找对应作答。
        </div>
      </section>
    </template>
  </div>
</template>
