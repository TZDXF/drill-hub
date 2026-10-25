<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { LearningPlan } from '@drill-hub/contracts';
import AppDialog from '#learning-client/components/AppDialog.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import PlanOutline from '#learning-client/components/PlanOutline.vue';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    plan: LearningPlan;
    currentTaskId?: string | null;
    fabRaised?: boolean;
  }>(),
  { currentTaskId: null, fabRaised: false },
);
const open = ref(false);
const tasks = computed(() => props.plan.phases.flatMap((phase) => phase.tasks));
const completedCount = computed(
  () => tasks.value.filter((task) => task.status === 'completed').length,
);
let mobileQuery: MediaQueryList | undefined;
function closeOnDesktop() {
  if (!mobileQuery?.matches) open.value = false;
}
// 抽屉内点击任务后立即关闭；离开拦截（保存失败确认框）触发时抽屉不应停留在原处。
function onOutlineClick(event: Event) {
  if (event.target instanceof Element && event.target.closest('a')) open.value = false;
}
onMounted(() => {
  mobileQuery = window.matchMedia('(max-width: 780px)');
  mobileQuery.addEventListener('change', closeOnDesktop);
});
onBeforeUnmount(() => {
  mobileQuery?.removeEventListener('change', closeOnDesktop);
});
</script>

<template>
  <PlanOutline
    class="paper-panel plan-outline-nav--desktop"
    :plan="plan"
    :current-task-id="currentTaskId"
  />
  <button
    class="plan-outline-fab"
    :class="{ 'plan-outline-fab--raised': fabRaised }"
    type="button"
    :aria-label="t('components.planOutline.fabLabel')"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="open = true"
  >
    <AppIcon name="plan" :size="19" />
    <span>{{ t('components.planOutline.fabText') }}</span>
  </button>
  <AppDialog
    v-model:open="open"
    class="question-nav-sheet plan-outline-sheet"
    :title="plan.title"
    :description="
      t('components.planOutline.sheetDescription', { done: completedCount, total: tasks.length })
    "
    :close-label="t('components.planOutline.closeLabel')"
    @click.capture="onOutlineClick"
  >
    <template #top>
      <div class="question-nav-sheet__handle" aria-hidden="true" />
    </template>
    <PlanOutline :plan="plan" :current-task-id="currentTaskId" />
  </AppDialog>
</template>
