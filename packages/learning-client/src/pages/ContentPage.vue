<script lang="ts">
const readingPositions = new Map<string, number>();
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { Content, LearningPlan } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { planReturnLocation } from '../planNavigation';
import { errorMessage, formatDate } from '../utils';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import MessageResponse from '../components/ai-elements/message/MessageResponse.vue';

const learning = useLearning();
const route = useRoute();
const content = ref<Content | null>(null);
const planReturn = computed(() =>
  content.value ? planReturnLocation(content.value.topicId, route.query) : null,
);
const loading = ref(true);
const loadError = ref('');
const completionError = ref('');
const completing = ref(false);
const positions = readingPositions;
// 内容来自外部 Agent，只解析 Markdown；禁用原始 HTML、组件与自定义属性语法。
const parserOptions = { registerDefaultPlugins: false };
let scrollTimer: ReturnType<typeof setTimeout> | null = null;
let positionKey = '';
let positionListenerAttached = false;

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    content.value = await learning.get<Content>(`/contents/${String(route.params.contentId)}`);
    positionKey = `${learning.state.connection?.baseUrl}:${learning.state.connection?.instanceId}:${learning.state.user?.id}:${content.value.id}`;
    await completeReadingTask();
  } catch (reason) {
    loadError.value = errorMessage(reason);
    learning.notify.error('内容读取失败', loadError.value);
  } finally {
    loading.value = false;
  }
}
async function completeReadingTask() {
  const { planId, taskId } = route.query;
  if (!content.value || typeof planId !== 'string' || typeof taskId !== 'string') return;
  completing.value = true;
  completionError.value = '';
  try {
    const plans = await learning.get<LearningPlan[]>(
      `/topics/${content.value.topicId}/plans?archiveState=all`,
    );
    const plan = plans.find((item) => item.id === planId);
    const task = plan?.phases.flatMap((phase) => phase.tasks).find((item) => item.id === taskId);
    // 仅完成当前入口对应的阅读任务，不能误完成其他计划或目标的任务。
    if (
      !plan ||
      plan.archivedAt ||
      !task ||
      task.kind !== 'reading' ||
      task.targetId !== content.value.id ||
      task.status === 'completed'
    ) {
      return;
    }
    await learning.post(`/tasks/${task.id}/complete`, { expectedRevision: plan.revision });
  } catch (reason) {
    completionError.value = errorMessage(reason);
    learning.notify.error('阅读任务自动完成失败', completionError.value);
  } finally {
    completing.value = false;
  }
}
function restorePosition() {
  const top = positions.get(positionKey);
  if (top) window.scrollTo({ top, behavior: 'instant' });
  if (!positionListenerAttached) {
    window.addEventListener('scroll', rememberPosition, { passive: true });
    positionListenerAttached = true;
  }
}
function rememberPosition() {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    if (positionKey) positions.set(positionKey, window.scrollY);
  }, 120);
}
onMounted(load);
onBeforeUnmount(() => {
  if (positionListenerAttached) window.removeEventListener('scroll', rememberPosition);
  if (scrollTimer) clearTimeout(scrollTimer);
});
</script>

<template>
  <div>
    <div v-if="loading" class="loading-block"><span class="spinner" />正在打开阅读内容</div>
    <EmptyState
      v-else-if="loadError"
      icon="alert"
      title="内容读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
    >
    <EmptyState v-else-if="!content" title="内容不存在" />
    <template v-else>
      <RouterLink
        class="back-link"
        :to="planReturn ?? { name: 'topic-detail', params: { topicId: content.topicId } }"
        ><AppIcon name="back" :size="16" />{{
          planReturn ? '返回学习计划' : '返回主题'
        }}</RouterLink
      >
      <div v-if="completionError" class="notice notice--pending" role="alert">
        <p>阅读内容已打开，但任务未能自动标记完成：{{ completionError }}</p>
        <button
          class="button button--small"
          type="button"
          :disabled="completing"
          @click="completeReadingTask"
        >
          <span v-if="completing" class="spinner" />重试
        </button>
      </div>
      <article class="paper-panel reading-paper">
        <h1>{{ content.title }}</h1>
        <div class="reading-meta">Markdown 内容 · 更新于 {{ formatDate(content.updatedAt) }}</div>
        <MessageResponse
          class="reading-body"
          :content="content.bodyText"
          mode="static"
          :enable-animate="false"
          :controls="false"
          :parser-options="parserOptions"
          :link-options="{ favicon: false }"
          :harden-options="{
            allowedProtocols: ['http', 'https', 'mailto'],
            allowDataImages: false,
          }"
          @end="restorePosition"
        />
      </article>
    </template>
  </div>
</template>
