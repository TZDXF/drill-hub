<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { LearningPlan, LearningTask } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';

const learning = useLearning();
const route = useRoute();
const plans = ref<LearningPlan[]>([]);
const loading = ref(true);
const error = ref('');
const completing = ref('');
const plan = computed(
  () => plans.value.find((item) => item.id === String(route.params.planId)) ?? null,
);
const kindLabels = { reading: '阅读', practice: '练习', exam: '考试', manual: '任务' };

async function load() {
  loading.value = true;
  error.value = '';
  try {
    plans.value = await learning.get<LearningPlan[]>(
      `/topics/${String(route.params.topicId)}/plans?archiveState=all`,
    );
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error('学习计划读取失败', error.value);
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
    learning.notify.success('任务已标记完成', task.title);
    await load();
  } catch (reason) {
    learning.notify.error('完成任务失败', errorMessage(reason));
  } finally {
    completing.value = '';
  }
}
onMounted(load);
</script>

<template>
  <div>
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取计划</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="计划读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
    >
    <EmptyState
      v-else-if="!plan"
      title="没有找到这份计划"
      description="计划可能已归档或不再可用，请返回主题查看现有计划。"
      ><RouterLink
        class="button"
        :to="{ name: 'topic-detail', params: { topicId: String(route.params.topicId) } }"
        >返回主题</RouterLink
      ></EmptyState
    >
    <template v-else>
      <PageHeader
        :title="plan.title"
        eyebrow="LEARNING PLAN"
        :description="`${plan.phases.length} 个阶段，按顺序推进；阅读内容打开即完成，普通任务需手动标记完成。`"
      >
        <template #back
          ><RouterLink
            class="back-link"
            :to="{ name: 'topic-detail', params: { topicId: plan.topicId } }"
            ><AppIcon name="back" :size="16" />返回主题</RouterLink
          ></template
        >
      </PageHeader>
      <div v-if="plan.archivedAt" class="notice notice--pending" style="margin-bottom: 18px">
        <AppIcon name="archive" />这份计划已归档，历史记录仍可查看。
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
                  · 约 {{ task.estimatedMinutes }} 分钟</template
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
                    ? '已完成'
                    : task.status === 'in_progress'
                      ? '进行中'
                      : '待开始'
                }}</span
              >
              <RouterLink
                v-if="taskLink(task)"
                class="button button--small"
                :to="taskLink(task)!"
                >{{ task.status === 'in_progress' ? '继续' : '前往' }}</RouterLink
              >
              <button
                v-else-if="task.kind === 'manual' && task.status !== 'completed'"
                class="button button--small"
                type="button"
                :disabled="completing === task.id"
                @click="complete(task)"
              >
                <span v-if="completing === task.id" class="spinner" />标记完成
              </button>
            </div>
          </article>
        </div>
        <EmptyState v-else compact title="这个阶段还没有任务" />
      </section>
    </template>
  </div>
</template>
