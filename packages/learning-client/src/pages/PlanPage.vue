<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { LearningPlan, LearningTask } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';

const { t } = useI18n();

const learning = useLearning();
const route = useRoute();
const plans = ref<LearningPlan[]>([]);
const loading = ref(true);
const error = ref('');
const completing = ref('');
const plan = computed(
  () => plans.value.find((item) => item.id === String(route.params.planId)) ?? null,
);
const kindLabels = computed(() => ({
  reading: t('learning.plan.kinds.reading'),
  practice: t('learning.common.practice'),
  exam: t('learning.common.exam'),
  manual: t('learning.plan.kinds.manual'),
}));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    plans.value = await learning.get<LearningPlan[]>(
      `/topics/${String(route.params.topicId)}/plans?archiveState=all`,
    );
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('learning.plan.notifyLoadFailed'), error.value);
  } finally {
    loading.value = false;
  }
}
function taskLink(task: LearningTask) {
  if (!task.targetId) return null;
  if (task.kind === 'reading')
    return {
      name: 'content',
      params: { contentId: task.targetId },
      query: { taskId: task.id, planId: String(route.params.planId) },
    };
  if (task.kind === 'practice' || task.kind === 'exam')
    return {
      name: 'assessment',
      params: { assessmentId: task.targetId },
      query: { taskId: task.id, planId: String(route.params.planId) },
    };
  return null;
}
async function complete(task: LearningTask) {
  if (!plan.value) return;
  completing.value = task.id;
  error.value = '';
  try {
    await learning.post(`/tasks/${task.id}/complete`, { expectedRevision: plan.value.revision });
    learning.notify.success(t('learning.plan.notifyCompleteTitle'), task.title);
    await load();
  } catch (reason) {
    learning.notify.error(t('learning.plan.notifyCompleteError'), errorMessage(reason));
  } finally {
    completing.value = '';
  }
}
onMounted(load);
</script>

<template>
  <div>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('learning.plan.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('learning.plan.loadFailed')"
      :description="t('learning.common.networkHint')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('learning.common.retry') }}
      </button></EmptyState
    >
    <EmptyState
      v-else-if="!plan"
      :title="t('learning.plan.notFoundTitle')"
      :description="t('learning.plan.notFoundDescription')"
      ><RouterLink
        class="button"
        :to="{ name: 'topic-detail', params: { topicId: String(route.params.topicId) } }"
        >{{ t('learning.plan.backToTopic') }}</RouterLink
      ></EmptyState
    >
    <template v-else>
      <PageHeader
        :title="plan.title"
        eyebrow="LEARNING PLAN"
        :description="t('learning.plan.description', { count: plan.phases.length })"
      >
        <template #back
          ><RouterLink
            class="back-link"
            :to="{ name: 'topic-detail', params: { topicId: plan.topicId } }"
            ><AppIcon name="back" :size="16" />{{ t('learning.plan.backToTopic') }}</RouterLink
          ></template
        >
      </PageHeader>
      <div v-if="plan.archivedAt" class="notice notice--pending" style="margin-bottom: 18px">
        <AppIcon name="archive" />{{ t('learning.plan.archivedNotice') }}
      </div>
      <section
        v-for="(phase, phaseIndex) in plan.phases"
        :key="phase.id"
        class="paper-panel plan-phase"
        :aria-labelledby="`phase-${phase.id}`"
      >
        <header class="plan-phase__header">
          <span class="plan-phase__number">{{ phaseIndex + 1 }}</span>
          <h2 :id="`phase-${phase.id}`">{{ phase.title }}</h2>
        </header>
        <div v-if="phase.tasks.length">
          <article v-for="task in phase.tasks" :key="task.id" class="task-row">
            <span class="task-check" :class="{ completed: task.status === 'completed' }"
              ><AppIcon v-if="task.status === 'completed'" name="check" :size="14"
            /></span>
            <div class="task-row__body">
              <strong>{{ task.title }}</strong
              ><span
                >{{ kindLabels[task.kind]
                }}<template v-if="task.scheduledDate">
                  · {{ formatDate(task.scheduledDate, false) }}</template
                ><template v-if="task.estimatedMinutes">
                  ·
                  {{
                    t('learning.plan.estimatedMinutes', { count: task.estimatedMinutes })
                  }}</template
                ></span
              >
            </div>
            <div class="task-row__actions">
              <span
                class="badge"
                :class="
                  task.status === 'completed'
                    ? 'badge--green'
                    : task.status === 'in_progress'
                      ? 'badge--amber'
                      : ''
                "
                >{{
                  task.status === 'completed'
                    ? t('learning.plan.statusCompleted')
                    : task.status === 'in_progress'
                      ? t('learning.plan.statusInProgress')
                      : t('learning.plan.statusPending')
                }}</span
              >
              <RouterLink
                v-if="taskLink(task)"
                class="button button--small"
                :to="taskLink(task)!"
                >{{
                  task.status === 'in_progress'
                    ? t('learning.plan.continueAction')
                    : t('learning.plan.goAction')
                }}</RouterLink
              >
              <button
                v-else-if="task.kind === 'manual' && task.status !== 'completed'"
                class="button button--small"
                type="button"
                :disabled="completing === task.id"
                @click="complete(task)"
              >
                <span v-if="completing === task.id" class="spinner" />{{
                  t('learning.plan.markComplete')
                }}
              </button>
            </div>
          </article>
        </div>
        <EmptyState v-else compact :title="t('learning.plan.emptyPhase')" />
      </section>
    </template>
  </div>
</template>
