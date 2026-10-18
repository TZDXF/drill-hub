<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Topic } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';

const learning = useLearning();
const topics = ref<Topic[]>([]);
const loading = ref(true);
const error = ref('');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    topics.value = await learning.get<Topic[]>('/topics?archiveState=active');
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error('主题读取失败', error.value);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      title="学习主题"
      eyebrow="LEARNING TOPICS"
      description="每个主题围绕一个清晰目标，组织计划、阅读内容、练习与考试。"
    />
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取主题</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="主题读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
    >
    <div v-else-if="topics.length" class="card-grid">
      <RouterLink
        v-for="topic in topics"
        :key="topic.id"
        class="card topic-card"
        :to="{ name: 'topic-detail', params: { topicId: topic.id } }"
      >
        <div class="topic-card__top">
          <span class="list-card__icon"><AppIcon name="target" /></span
          ><AppIcon name="arrow" :size="18" class="subtle" />
        </div>
        <h2>{{ topic.title }}</h2>
        <p>{{ topic.goalText }}</p>
        <div class="topic-card__footer">
          <span>更新于 {{ formatDate(topic.updatedAt) }}</span
          ><span>第 {{ topic.revision }} 版</span>
        </div>
      </RouterLink>
    </div>
    <EmptyState
      v-else
      title="从一个学习目标开始"
      description="当前没有进行中的主题。请在你的外部 Agent 中说明学习目标，让它通过授权接口创建主题、计划与内容；这里不会展示虚构的示例课程。"
    >
      <RouterLink class="button button--primary" :to="{ name: 'agent-tokens' }"
        ><AppIcon name="token" :size="17" />配置 Agent 授权</RouterLink
      >
    </EmptyState>
  </div>
</template>
