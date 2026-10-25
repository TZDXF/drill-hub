<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Assessment, AttemptView, LearningPlan } from '@drill-hub/contracts';
import { useLearning } from '#learning-client/injection';
import { planNavigationQuery, planReturnLocation } from '#learning-client/planNavigation';
import { asAttemptView } from '#learning-client/types';
import { errorMessage, formatDuration, formatScore } from '#learning-client/utils';
import PageHeader from '#learning-client/components/PageHeader.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import EmptyState from '#learning-client/components/EmptyState.vue';
import PlanOutlineNav from '#learning-client/components/PlanOutlineNav.vue';
import AttemptPurposeSelect from '#learning-client/components/AttemptPurposeSelect.vue';

const { t } = useI18n();

const learning = useLearning();
const route = useRoute();
const router = useRouter();
const assessment = ref<Assessment | null>(null);
const plan = ref<LearningPlan | null>(null);
const currentTaskId = computed(() =>
  typeof route.query.taskId === 'string' ? route.query.taskId : null,
);
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
    await loadPlan();
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('learning.assessment.loadFailed'), error.value);
  } finally {
    loading.value = false;
  }
}
// 从学习计划进入时拉取来源计划，用于左侧目录展示；失败不影响开始答题。
async function loadPlan() {
  const { planId } = planNavigationQuery(route.query);
  if (!assessment.value || !planId) {
    plan.value = null;
    return;
  }
  try {
    const plans = await learning.get<LearningPlan[]>(
      `/topics/${assessment.value.topicId}/plans?archiveState=all`,
    );
    plan.value = plans.find((item) => item.id === planId) ?? null;
  } catch (reason) {
    plan.value = null;
    learning.notify.error(t('learning.plan.notifyLoadFailed'), errorMessage(reason));
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
      {
        purpose: assessment.value.kind === 'practice' ? 'learning' : purpose.value,
        ...(taskId ? { taskId } : {}),
      },
    );
    const attempt = asAttemptView(result);
    await router.push({
      name: 'attempt',
      params: { attemptId: attempt.id },
      query: planNavigationQuery(route.query),
    });
  } catch (reason) {
    learning.notify.error(t('learning.assessment.notifyStartError'), errorMessage(reason));
  } finally {
    starting.value = false;
  }
}
onMounted(load);
// 计划目录会引入“简报 → 简报”的同组件切换，参数变化时需要重新加载。
watch(
  () => [route.params.assessmentId, route.query.taskId, route.query.planId],
  () => {
    purpose.value = 'learning';
    void load();
  },
);
</script>

<template>
  <div>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('learning.assessment.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('learning.assessment.loadFailed')"
      :description="t('learning.common.networkHint')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('learning.common.retry') }}
      </button></EmptyState
    >
    <template v-else-if="assessment">
      <PageHeader
        :title="assessment.title"
        :eyebrow="assessment.kind === 'exam' ? 'EXAM BRIEFING' : 'PRACTICE BRIEFING'"
        :description="
          assessment.kind === 'exam'
            ? t('learning.assessment.examDescription')
            : t('learning.assessment.practiceDescription')
        "
      >
        <template #back
          ><RouterLink
            class="back-link"
            :to="planReturn ?? { name: 'topic-detail', params: { topicId: assessment.topicId } }"
            ><AppIcon name="back" :size="16" />{{
              planReturn ? t('learning.content.backToPlan') : t('learning.plan.backToTopic')
            }}</RouterLink
          ></template
        >
      </PageHeader>
      <div class="focus-layout" :class="{ 'focus-layout--plan': plan }">
        <PlanOutlineNav
          v-if="plan"
          class="focus-layout__aside"
          :plan="plan"
          :current-task-id="currentTaskId"
        />
        <div class="focus-layout__main">
          <div
            v-if="assessment.archivedAt"
            class="notice notice--pending"
            style="margin-bottom: 16px"
          >
            <AppIcon name="archive" />
            <div>
              <strong>{{ t('learning.assessment.archivedTitle') }}</strong>
              <p>{{ t('learning.assessment.archivedDescription') }}</p>
            </div>
          </div>
          <section class="paper-panel assessment-hero" aria-labelledby="assessment-overview">
            <div>
              <span
                class="badge"
                :class="assessment.kind === 'exam' ? 'badge--amber' : 'badge--teal'"
                >{{
                  assessment.kind === 'exam'
                    ? t('learning.assessment.badgeExam')
                    : t('learning.assessment.badgePractice')
                }}</span
              >
              <h2 id="assessment-overview">{{ t('learning.assessment.overviewTitle') }}</h2>
              <div class="assessment-facts">
                <div class="assessment-fact">
                  <strong>{{ assessment.items.length }}</strong
                  ><span>{{ t('learning.assessment.factQuestionCount') }}</span>
                </div>
                <div class="assessment-fact">
                  <strong>{{ formatScore(totalScore(assessment.items)) }}</strong
                  ><span>{{ t('learning.assessment.factFullScore') }}</span>
                </div>
                <div class="assessment-fact">
                  <strong>{{ formatDuration(assessment.durationSeconds) }}</strong
                  ><span>{{ t('learning.assessment.factDuration') }}</span>
                </div>
              </div>
              <p>
                {{
                  assessment.kind === 'exam'
                    ? t('learning.assessment.rulesExam')
                    : t('learning.assessment.rulesPractice')
                }}
              </p>
              <AttemptPurposeSelect
                v-if="assessment.kind === 'exam'"
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
                  starting ? t('learning.assessment.preparing') : t('learning.assessment.start')
                }}
              </button>
            </div>
            <aside class="assessment-side">
              <h3>{{ t('learning.assessment.sideTitle') }}</h3>
              <ul>
                <li>{{ t('learning.assessment.sideItem1') }}</li>
                <li>{{ t('learning.assessment.sideItem2') }}</li>
                <li>{{ t('learning.assessment.sideItem3') }}</li>
                <li>{{ t('learning.assessment.sideItem4') }}</li>
              </ul>
            </aside>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
