<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { AttemptView, WrongQuestionListItem } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { asAttemptView, wrongPracticeRequest, type WrongQuestionDetailView } from '../types';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import AppSelect from '../components/AppSelect.vue';

const { t } = useI18n();

const learning = useLearning();
const router = useRouter();
const items = ref<WrongQuestionListItem[]>([]);
const mastery = ref('all');
const loading = ref(true);
const starting = ref('');
const error = ref('');
const labels = computed(() => ({
  pending: t('learning.common.mastery.pending'),
  reviewing: t('learning.common.mastery.reviewing'),
  mastered: t('learning.common.mastery.mastered'),
}));
const masteryOptions = computed(() => [
  { value: 'all', label: t('learning.history.filter.statusAll') },
  { value: 'pending', label: t('learning.common.mastery.pending') },
  { value: 'reviewing', label: t('learning.common.mastery.reviewing') },
  { value: 'mastered', label: t('learning.common.mastery.mastered') },
]);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    items.value = await learning.get<WrongQuestionListItem[]>(
      `/wrong-questions${mastery.value !== 'all' ? `?masteryStatus=${mastery.value}` : ''}`,
    );
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('learning.wrongQuestions.loadFailed'), error.value);
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
      { ...wrongPracticeRequest(detail), purpose: 'learning' },
    );
    const attempt = asAttemptView(result);
    await router.push({ name: 'attempt', params: { attemptId: attempt.id } });
  } catch (reason) {
    learning.notify.error(t('learning.wrongQuestions.notifyPracticeError'), errorMessage(reason));
  } finally {
    starting.value = '';
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('learning.wrongQuestions.title')"
      eyebrow="REVIEW & MASTERY"
      :description="t('learning.wrongQuestions.description')"
    />
    <form class="card filter-bar" @submit.prevent="load">
      <div class="form-field">
        <label for="mastery-filter">{{ t('learning.wrongQuestions.filterLabel') }}</label
        ><AppSelect id="mastery-filter" v-model="mastery" :items="masteryOptions" />
      </div>
      <button class="button" type="submit">{{ t('learning.wrongQuestions.applyFilter') }}</button>
    </form>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('learning.wrongQuestions.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('learning.wrongQuestions.loadFailed')"
      :description="t('learning.common.networkHint')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('learning.common.retry') }}
      </button></EmptyState
    >
    <div v-else-if="items.length" class="list-stack">
      <article v-for="item in items" :key="item.id" class="card list-card">
        <RouterLink
          class="list-card__icon"
          :to="{ name: 'wrong-question-detail', params: { questionId: item.questionId } }"
          :aria-label="t('learning.wrongQuestions.detailLabel')"
          ><AppIcon name="wrong"
        /></RouterLink>
        <div class="list-card__body">
          <h3>
            <RouterLink
              :to="{ name: 'wrong-question-detail', params: { questionId: item.questionId } }"
              >{{ item.stem }}</RouterLink
            >
          </h3>
          <p>
            {{
              t('learning.wrongQuestions.wrongCount', {
                count: item.wrongCount,
                date: formatDate(item.lastWrongAt),
              })
            }}
          </p>
          <div class="list-card__meta">
            <span>{{ item.topicTitle }}</span
            ><span v-if="item.lastPracticedAt">{{
              t('learning.wrongQuestions.lastPracticed', { date: formatDate(item.lastPracticedAt) })
            }}</span>
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
            <span v-if="starting === item.questionId" class="spinner" />{{
              t('learning.wrongQuestions.retryAction')
            }}
          </button>
        </div>
      </article>
    </div>
    <EmptyState
      v-else
      :title="t('learning.wrongQuestions.emptyTitle')"
      :description="t('learning.wrongQuestions.emptyDescription')"
      ><RouterLink class="button" :to="{ name: 'topics' }">{{
        t('learning.wrongQuestions.goTopics')
      }}</RouterLink></EmptyState
    >
  </div>
</template>
