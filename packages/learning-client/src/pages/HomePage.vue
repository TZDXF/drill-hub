<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Dashboard } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { canContinueAttempt } from '../attemptPresentation';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';

const learning = useLearning();
const dashboard = ref<Dashboard | null>(null);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    dashboard.value = await learning.get<Dashboard>('/dashboard');
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error('概览读取失败', error.value);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="`${learning.state.user?.displayName}，继续向前`"
      eyebrow="TODAY'S LEARNING"
      description="从真实待办与最近记录开始，按自己的节奏完成今天的学习。"
    />
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取学习概览</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="概览读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
    >
    <template v-else-if="dashboard">
      <section class="stats-grid" aria-label="学习概览统计">
        <article class="card stat-card">
          <div class="stat-card__icon"><AppIcon name="topics" /></div>
          <strong>{{ dashboard.topics }}</strong
          ><span>进行中的学习主题</span>
        </article>
        <article class="card stat-card">
          <div class="stat-card__icon"><AppIcon name="plan" /></div>
          <strong>{{ dashboard.pendingTasks }}</strong
          ><span>待完成计划任务</span>
        </article>
        <article class="card stat-card stat-card--amber">
          <div class="stat-card__icon"><AppIcon name="clock" /></div>
          <strong>{{ dashboard.pendingGrading }}</strong
          ><span>等待评分，不按零分计</span>
        </article>
        <article class="card stat-card">
          <div class="stat-card__icon"><AppIcon name="wrong" /></div>
          <strong>{{ dashboard.wrongQuestions }}</strong
          ><span>需要复习的错题</span>
        </article>
      </section>
      <div class="dashboard-grid">
        <section aria-labelledby="recent-title">
          <div class="section-heading">
            <div>
              <h2 id="recent-title">最近作答</h2>
              <p>继续未完成的会话，或查看已经提交的报告</p>
            </div>
            <RouterLink :to="{ name: 'history' }">全部历史</RouterLink>
          </div>
          <div v-if="dashboard.recentAttempts.length" class="list-stack">
            <RouterLink
              v-for="attempt in dashboard.recentAttempts"
              :key="attempt.id"
              class="card list-card"
              :to="
                canContinueAttempt(attempt)
                  ? { name: 'attempt', params: { attemptId: attempt.id } }
                  : { name: 'report', params: { attemptId: attempt.id } }
              "
            >
              <span class="list-card__icon"
                ><AppIcon :name="attempt.kind === 'exam' ? 'lock' : 'content'"
              /></span>
              <div class="list-card__body">
                <h3>{{ attempt.title }}</h3>
                <span class="badge">{{
                  attempt.purpose === 'test' ? '测试作答' : '正式作答'
                }}</span>
                <p>
                  {{ attempt.kind === 'exam' ? '考试' : '练习' }} ·
                  {{
                    attempt.status === 'in_progress'
                      ? `开始于 ${formatDate(attempt.startedAt)}`
                      : `提交于 ${formatDate(attempt.submittedAt)}`
                  }}
                </p>
              </div>
              <div class="list-card__aside">
                <span
                  class="badge"
                  :class="attempt.status === 'completed' ? 'badge--green' : 'badge--amber'"
                  >{{
                    attempt.voidedAt
                      ? '已作废'
                      : canContinueAttempt(attempt)
                        ? '继续作答'
                        : attempt.status === 'pending_grading'
                          ? '待评分'
                          : '查看报告'
                  }}</span
                ><AppIcon name="chevron" :size="17" />
              </div>
            </RouterLink>
          </div>
          <EmptyState
            v-else
            compact
            title="还没有作答记录"
            description="学习内容与练习可由你的外部 Agent 创建；完成后，真实记录会出现在这里。"
          >
            <RouterLink class="text-link" :to="{ name: 'topics' }"
              >查看学习主题<AppIcon name="arrow" :size="15"
            /></RouterLink>
          </EmptyState>
        </section>
        <aside class="quick-panel" aria-labelledby="quick-title">
          <div>
            <h2 id="quick-title">学习工具</h2>
            <p>复习不足、回顾历史，或授权 Agent 为你准备接下来的内容。</p>
            <RouterLink class="button" :to="{ name: 'agent-tokens' }"
              ><AppIcon name="token" :size="17" />管理 Agent 授权</RouterLink
            >
          </div>
          <div class="quick-links">
            <RouterLink class="quick-link" :to="{ name: 'topics' }"
              ><AppIcon name="topics" :size="17" />浏览主题<AppIcon name="arrow" :size="15"
            /></RouterLink>
            <RouterLink class="quick-link" :to="{ name: 'wrong-questions' }"
              ><AppIcon name="wrong" :size="17" />复习错题<AppIcon name="arrow" :size="15"
            /></RouterLink>
            <RouterLink class="quick-link" :to="{ name: 'archive' }"
              ><AppIcon name="archive" :size="17" />恢复归档<AppIcon name="arrow" :size="15"
            /></RouterLink>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>
