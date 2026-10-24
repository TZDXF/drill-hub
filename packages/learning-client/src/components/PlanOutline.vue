<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import type { LearningPlan, LearningTask } from '@drill-hub/contracts';
import { planTaskLocation } from '../planNavigation';
import AppIcon from './AppIcon.vue';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    plan: LearningPlan;
    currentTaskId?: string | null;
  }>(),
  { currentTaskId: null },
);
const tasks = computed(() => props.plan.phases.flatMap((phase) => phase.tasks));
const completedCount = computed(
  () => tasks.value.filter((task) => task.status === 'completed').length,
);
const kindLabels = computed(() => ({
  reading: t('learning.plan.kinds.reading'),
  practice: t('learning.common.practice'),
  exam: t('learning.common.exam'),
  manual: t('learning.plan.kinds.manual'),
}));

function location(task: LearningTask) {
  return planTaskLocation(props.plan.id, task);
}
</script>

<template>
  <nav class="plan-outline" :aria-label="t('components.planOutline.navLabel')">
    <RouterLink
      class="plan-outline__header"
      :to="{ name: 'plan', params: { topicId: plan.topicId, planId: plan.id } }"
      :title="t('components.planOutline.viewPlan')"
    >
      <span class="plan-outline__icon"><AppIcon name="plan" :size="17" /></span>
      <span class="plan-outline__heading">
        <strong>{{ plan.title }}</strong>
        <small>{{
          t('components.planOutline.progress', {
            done: completedCount,
            total: tasks.length,
          })
        }}</small>
      </span>
    </RouterLink>
    <section v-for="phase in plan.phases" :key="phase.id" class="plan-outline__phase">
      <h3>{{ phase.title }}</h3>
      <ul v-if="phase.tasks.length">
        <li v-for="task in phase.tasks" :key="task.id">
          <RouterLink
            v-if="location(task)"
            class="plan-outline__task"
            :class="[task.status, { current: task.id === currentTaskId }]"
            :to="location(task)!"
            :aria-current="task.id === currentTaskId ? 'true' : undefined"
            :title="task.title"
          >
            <span class="plan-outline__status" aria-hidden="true"
              ><AppIcon v-if="task.status === 'completed'" name="check" :size="12"
            /></span>
            <span class="plan-outline__task-body">
              <strong>{{ task.title }}</strong>
              <small>{{ kindLabels[task.kind] }}</small>
            </span>
          </RouterLink>
          <span
            v-else
            class="plan-outline__task plan-outline__task--static"
            :class="[task.status, { current: task.id === currentTaskId }]"
            :title="task.title"
          >
            <span class="plan-outline__status" aria-hidden="true"
              ><AppIcon v-if="task.status === 'completed'" name="check" :size="12"
            /></span>
            <span class="plan-outline__task-body">
              <strong>{{ task.title }}</strong>
              <small>{{ kindLabels[task.kind] }}</small>
            </span>
          </span>
        </li>
      </ul>
      <p v-else class="plan-outline__empty">{{ t('learning.plan.emptyPhase') }}</p>
    </section>
  </nav>
</template>
