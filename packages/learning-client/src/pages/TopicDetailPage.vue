<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import type { Assessment, Content, LearningPlan, Topic } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage, formatDate, formatDuration, formatScore } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';

const { t, n } = useI18n();
const learning = useLearning();
const route = useRoute();
const topic = ref<Topic | null>(null);
const plans = ref<LearningPlan[]>([]);
const contents = ref<Content[]>([]);
const assessments = ref<Assessment[]>([]);
const loading = ref(true);
const error = ref('');
const topicId = computed(() => String(route.params.topicId));
const practices = computed(() => assessments.value.filter((item) => item.kind === 'practice'));
const exams = computed(() => assessments.value.filter((item) => item.kind === 'exam'));
const compactLayoutQuery =
  typeof window === 'undefined'
    ? null
    : window.matchMedia('(max-width: 900px), (hover: none) and (pointer: coarse)');
const compactCategories = ref(
  learning.platform.kind === 'android' || (compactLayoutQuery?.matches ?? false),
);
function syncCompactCategories() {
  compactCategories.value =
    learning.platform.kind === 'android' || (compactLayoutQuery?.matches ?? false);
}
const categories = computed(() => [
  {
    value: 'plans',
    label: t('learning.topicDetail.categories.plans'),
    icon: 'plan',
    count: plans.value.length,
    unit: t('learning.topicDetail.units.plans'),
  },
  {
    value: 'contents',
    label: t('learning.topicDetail.categories.contents'),
    icon: 'content',
    count: contents.value.length,
    unit: t('learning.topicDetail.units.contents'),
  },
  {
    value: 'practices',
    label: t('learning.topicDetail.categories.practices'),
    icon: 'wrong',
    count: practices.value.length,
    unit: t('learning.topicDetail.units.practices'),
  },
  {
    value: 'exams',
    label: t('learning.topicDetail.categories.exams'),
    icon: 'lock',
    count: exams.value.length,
    unit: t('learning.topicDetail.units.exams'),
  },
]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [topicResult, planResult, contentResult, assessmentResult] = await Promise.all([
      learning.get<Topic>(`/topics/${topicId.value}`),
      learning.get<LearningPlan[]>(`/topics/${topicId.value}/plans?archiveState=active`),
      learning.get<Content[]>(`/topics/${topicId.value}/contents?archiveState=active`),
      learning.get<Assessment[]>(`/topics/${topicId.value}/assessments?archiveState=active`),
    ]);
    topic.value = topicResult;
    plans.value = planResult;
    contents.value = contentResult;
    assessments.value = assessmentResult;
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('learning.topicDetail.loadFailed'), error.value);
  } finally {
    loading.value = false;
  }
}
function totalScore(assessment: Assessment) {
  return assessment.items.reduce((sum, item) => sum + Number(item.maxScore), 0).toString();
}
onMounted(() => {
  syncCompactCategories();
  compactLayoutQuery?.addEventListener('change', syncCompactCategories);
  void load();
});
onBeforeUnmount(() => compactLayoutQuery?.removeEventListener('change', syncCompactCategories));
watch(topicId, load);
</script>

<template>
  <div>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('learning.topicDetail.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('learning.topicDetail.loadFailed')"
      :description="t('learning.common.networkHint')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('learning.common.retry') }}
      </button></EmptyState
    >
    <template v-else-if="topic">
      <PageHeader :title="topic.title" eyebrow="LEARNING TOPIC" :description="topic.goalText">
        <template #back
          ><RouterLink class="back-link" :to="{ name: 'topics' }"
            ><AppIcon name="back" :size="16" />{{
              t('learning.topicDetail.backToTopics')
            }}</RouterLink
          ></template
        >
      </PageHeader>
      <div v-if="topic.archivedAt" class="notice notice--pending" style="margin-bottom: 18px">
        <AppIcon name="archive" />
        <div>
          <strong>{{ t('learning.topicDetail.archivedTitle') }}</strong>
          <p>{{ t('learning.topicDetail.archivedDescription') }}</p>
        </div>
      </div>
      <TabsRoot default-value="plans">
        <TabsList
          class="tabs-list topic-categories"
          :class="{ 'topic-categories--compact': compactCategories }"
          :aria-label="t('learning.topicDetail.categoriesLabel')"
        >
          <TabsTrigger
            v-for="category in categories"
            :key="category.value"
            class="tabs-trigger topic-category"
            :value="category.value"
          >
            <span class="topic-category__icon"><AppIcon :name="category.icon" :size="18" /></span>
            <span class="topic-category__label">{{ category.label }}</span>
            <span class="badge topic-category__count">
              {{ category.count }}<span class="topic-category__unit"> {{ category.unit }}</span>
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent class="tabs-content" value="plans">
          <div v-if="plans.length" class="list-stack">
            <RouterLink
              v-for="plan in plans"
              :key="plan.id"
              class="card list-card"
              :to="{ name: 'plan', params: { topicId: topic.id, planId: plan.id } }"
            >
              <span class="list-card__icon"><AppIcon name="plan" /></span>
              <div class="list-card__body">
                <h3>{{ plan.title }}</h3>
                <p>
                  {{
                    t('learning.topicDetail.planSummary', {
                      phases: n(plan.phases.length),
                      tasks: n(plan.phases.reduce((sum, phase) => sum + phase.tasks.length, 0)),
                    })
                  }}
                </p>
                <div class="list-card__meta">
                  <span>{{
                    t('learning.common.updatedAt', { date: formatDate(plan.updatedAt) })
                  }}</span>
                </div>
              </div>
              <AppIcon name="chevron" :size="18" class="subtle" />
            </RouterLink>
          </div>
          <EmptyState
            v-else
            :title="t('learning.topicDetail.emptyPlansTitle')"
            :description="t('learning.topicDetail.emptyPlansDescription')"
          />
        </TabsContent>
        <TabsContent class="tabs-content" value="contents">
          <div v-if="contents.length" class="list-stack">
            <RouterLink
              v-for="content in contents"
              :key="content.id"
              class="card list-card"
              :to="{ name: 'content', params: { contentId: content.id } }"
            >
              <span class="list-card__icon"><AppIcon name="content" /></span>
              <div class="list-card__body">
                <h3>{{ content.title }}</h3>
                <p>{{ t('learning.topicDetail.contentKind') }}</p>
                <div class="list-card__meta">
                  <span>{{
                    t('learning.common.updatedAt', { date: formatDate(content.updatedAt) })
                  }}</span>
                </div>
              </div>
              <AppIcon name="chevron" :size="18" class="subtle" />
            </RouterLink>
          </div>
          <EmptyState
            v-else
            :title="t('learning.topicDetail.emptyContentsTitle')"
            :description="t('learning.topicDetail.emptyContentsDescription')"
          />
        </TabsContent>
        <TabsContent
          v-for="kind in ['practices', 'exams']"
          :key="kind"
          class="tabs-content"
          :value="kind"
        >
          <div v-if="(kind === 'practices' ? practices : exams).length" class="list-stack">
            <RouterLink
              v-for="assessment in kind === 'practices' ? practices : exams"
              :key="assessment.id"
              class="card list-card"
              :to="{ name: 'assessment', params: { assessmentId: assessment.id } }"
            >
              <span class="list-card__icon"
                ><AppIcon :name="kind === 'exams' ? 'lock' : 'wrong'"
              /></span>
              <div class="list-card__body">
                <h3>{{ assessment.title }}</h3>
                <div class="list-card__meta">
                  <span>{{
                    t('learning.common.questionCount', { count: n(assessment.items.length) })
                  }}</span
                  ><span>{{
                    t('learning.topicDetail.fullScore', {
                      score: formatScore(totalScore(assessment)),
                    })
                  }}</span
                  ><span>{{ formatDuration(assessment.durationSeconds) }}</span>
                </div>
              </div>
              <span class="badge" :class="kind === 'exams' ? 'badge--amber' : 'badge--teal'">{{
                kind === 'exams' ? t('learning.common.exam') : t('learning.common.practice')
              }}</span
              ><AppIcon name="chevron" :size="18" class="subtle" />
            </RouterLink>
          </div>
          <EmptyState
            v-else
            :title="
              kind === 'exams'
                ? t('learning.topicDetail.emptyExamsTitle')
                : t('learning.topicDetail.emptyPracticesTitle')
            "
            :description="t('learning.topicDetail.emptyAssessmentsDescription')"
          />
        </TabsContent>
      </TabsRoot>
    </template>
  </div>
</template>

<style scoped>
.topic-category__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.topic-category__unit {
  display: none;
}
.topic-categories--compact {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.topic-categories--compact .topic-category {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  column-gap: 10px;
  row-gap: 4px;
  min-width: 0;
  min-height: 78px;
  padding: 14px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  text-align: left;
  white-space: normal;
}
.topic-categories--compact .topic-category[data-state='active'] {
  border-color: var(--teal);
  background: var(--teal-soft);
  box-shadow: inset 0 0 0 1px var(--teal);
}
.topic-categories--compact .topic-category__icon {
  grid-row: span 2;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--paper-muted);
}
.topic-categories--compact .topic-category[data-state='active'] .topic-category__icon {
  background: var(--teal);
  color: var(--paper);
}
.topic-categories--compact .topic-category__label {
  align-self: end;
  font-size: 14px;
  line-height: 1.3;
}
.topic-categories--compact .topic-category__count {
  justify-self: start;
  align-self: start;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
}
.topic-categories--compact .topic-category__unit {
  display: inline;
}
</style>
