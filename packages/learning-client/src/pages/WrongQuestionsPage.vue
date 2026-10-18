<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { AttemptView, WrongQuestionListItem } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { asAttemptView, wrongPracticeRequest, type WrongQuestionDetailView } from '../types';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import AttemptPurposeSelect from '../components/AttemptPurposeSelect.vue';
import AppSelect from '../components/AppSelect.vue';

const purpose = ref<AttemptView['purpose']>('learning');
const learning = useLearning();
const router = useRouter();
const items = ref<WrongQuestionListItem[]>([]);
const mastery = ref('all');
const loading = ref(true);
const starting = ref('');
const error = ref('');
const labels = { pending: '待复习', reviewing: '复习中', mastered: '已掌握' };
const masteryOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待复习' },
  { value: 'reviewing', label: '复习中' },
  { value: 'mastered', label: '已掌握' },
];
async function load() {
  loading.value = true;
  error.value = '';
  try {
    items.value = await learning.get<WrongQuestionListItem[]>(
      `/wrong-questions${mastery.value !== 'all' ? `?masteryStatus=${mastery.value}` : ''}`,
    );
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error('错题读取失败', error.value);
  } finally {
    loading.value = false;
  }
}
async function practice(questionId: string) {
  starting.value = questionId;
  error.value = '';
  try {
    const detail = await learning.get<WrongQuestionDetailView>(`/wrong-questions/${questionId}`);
    const result = await learning.post<AttemptView | { attempt: AttemptView }>(
      '/wrong-question-practices',
      { ...wrongPracticeRequest(detail), purpose: purpose.value },
    );
    const attempt = asAttemptView(result);
    await router.push({ name: 'attempt', params: { attemptId: attempt.id } });
  } catch (reason) {
    learning.notify.error('开始重练失败', errorMessage(reason));
  } finally {
    starting.value = '';
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      title="错题集"
      eyebrow="REVIEW & MASTERY"
      description="只收录已评分且未得满分的题目；部分得分也值得回顾，待评分不会误入错题。"
    />
    <form class="card filter-bar" @submit.prevent="load">
      <div class="form-field">
        <label for="mastery-filter">掌握状态</label
        ><AppSelect id="mastery-filter" v-model="mastery" :items="masteryOptions" />
      </div>
      <button class="button" type="submit">应用筛选</button>
    </form>
    <section class="card" aria-label="错题重练用途" style="margin-bottom: 16px">
      <AttemptPurposeSelect
        id="wrong-practice-purpose"
        v-model="purpose"
        :disabled="Boolean(starting)"
      />
    </section>
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取错题</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="错题读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
    >
    <div v-else-if="items.length" class="list-stack">
      <article v-for="item in items" :key="item.id" class="card list-card">
        <RouterLink
          class="list-card__icon"
          :to="{ name: 'wrong-question-detail', params: { questionId: item.questionId } }"
          aria-label="查看错题详情"
          ><AppIcon name="wrong"
        /></RouterLink>
        <div class="list-card__body">
          <h3>
            <RouterLink
              :to="{ name: 'wrong-question-detail', params: { questionId: item.questionId } }"
              >{{ item.stem }}</RouterLink
            >
          </h3>
          <p>累计答错 {{ item.wrongCount }} 次 · 最近于 {{ formatDate(item.lastWrongAt) }}</p>
          <div class="list-card__meta">
            <span>{{ item.topicTitle }}</span
            ><span v-if="item.lastPracticedAt"
              >最近重练 {{ formatDate(item.lastPracticedAt) }}</span
            >
          </div>
        </div>
        <div class="list-card__aside">
          <span
            class="badge"
            :class="item.masteryStatus === 'mastered' ? 'badge--green' : 'badge--amber'"
            >{{ labels[item.masteryStatus] }}</span
          ><button
            class="button button--small"
            type="button"
            :disabled="starting === item.questionId"
            @click="practice(item.questionId)"
          >
            <span v-if="starting === item.questionId" class="spinner" />重练
          </button>
        </div>
      </article>
    </div>
    <EmptyState
      v-else
      title="当前没有错题"
      description="完成真实评分后，未得满分的题目会按服务端规则进入这里。没有记录时不显示虚构的正确率。"
      ><RouterLink class="button" :to="{ name: 'topics' }">前往学习主题</RouterLink></EmptyState
    >
  </div>
</template>
