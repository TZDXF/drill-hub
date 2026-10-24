<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import type { LearningPlan } from '@drill-hub/contracts';
import AppIcon from './AppIcon.vue';
import AppScrollArea from './AppScrollArea.vue';
import PlanOutline from './PlanOutline.vue';

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
  <DialogRoot v-model:open="open">
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
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="question-nav-sheet plan-outline-sheet" @click.capture="onOutlineClick">
        <div class="question-nav-sheet__handle" aria-hidden="true" />
        <div class="dialog-heading">
          <div>
            <DialogTitle class="dialog-title">{{ plan.title }}</DialogTitle>
            <DialogDescription class="dialog-description">
              {{
                t('components.planOutline.sheetDescription', {
                  done: completedCount,
                  total: tasks.length,
                })
              }}
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button
              class="icon-button"
              type="button"
              :aria-label="t('components.planOutline.closeLabel')"
            >
              <AppIcon name="close" />
            </button>
          </DialogClose>
        </div>
        <AppScrollArea class="dialog-body" viewport-class="dialog-body__viewport">
          <PlanOutline :plan="plan" :current-task-id="currentTaskId" />
        </AppScrollArea>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
