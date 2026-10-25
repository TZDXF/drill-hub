<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Dashboard } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { canContinueAttempt } from '../attemptPresentation';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';

const { t, n } = useI18n();
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
    learning.notify.error(t('learning.home.loadFailed'), error.value);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('learning.home.title', { name: learning.state.user?.displayName })"
      eyebrow="TODAY'S LEARNING"
      :description="t('learning.home.description')"
    />
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('learning.home.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('learning.home.loadFailed')"
      :description="t('learning.common.networkHint')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('learning.common.retry') }}
      </button></EmptyState
    >
    <template v-else-if="dashboard">
      <section class="stats-grid" :aria-label="t('learning.home.statsLabel')">
        <article class="card stat-card">
          <div class="stat-card__icon"><AppIcon name="topics" /></div>
          <strong>{{ n(dashboard.topics) }}</strong
          ><span>{{ t('learning.home.statTopics') }}</span>
        </article>
        <article class="card stat-card">
          <div class="stat-card__icon"><AppIcon name="plan" /></div>
          <strong>{{ n(dashboard.pendingTasks) }}</strong
          ><span>{{ t('learning.home.statPendingTasks') }}</span>
        </article>
        <article class="card stat-card stat-card--amber">
          <div class="stat-card__icon"><AppIcon name="clock" /></div>
          <strong>{{ n(dashboard.pendingGrading) }}</strong
          ><span>{{ t('learning.home.statPendingGrading') }}</span>
        </article>
        <article class="card stat-card">
          <div class="stat-card__icon"><AppIcon name="wrong" /></div>
          <strong>{{ n(dashboard.wrongQuestions) }}</strong
          ><span>{{ t('learning.home.statWrongQuestions') }}</span>
        </article>
      </section>
      <div class="dashboard-grid">
        <section aria-labelledby="recent-title">
          <div class="section-heading">
            <div>
              <h2 id="recent-title">{{ t('learning.home.recentTitle') }}</h2>
              <p>{{ t('learning.home.recentDescription') }}</p>
            </div>
            <RouterLink :to="{ name: 'history' }">{{ t('learning.home.allHistory') }}</RouterLink>
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
                  attempt.purpose === 'test'
                    ? t('core.attempt.purpose.test')
                    : t('core.attempt.purpose.learning')
                }}</span>
                <p>
                  {{
                    attempt.kind === 'exam'
                      ? t('learning.common.exam')
                      : t('learning.common.practice')
                  }}
                  ·
                  {{
                    attempt.status === 'in_progress'
                      ? t('learning.home.startedAt', { date: formatDate(attempt.startedAt) })
                      : t('learning.home.submittedAt', { date: formatDate(attempt.submittedAt) })
                  }}
                </p>
              </div>
              <div class="list-card__aside">
                <span
                  class="badge"
                  :class="attempt.status === 'completed' ? 'badge--green' : 'badge--amber'"
                  >{{
                    attempt.voidedAt
                      ? t('learning.home.voided')
                      : canContinueAttempt(attempt)
                        ? t('learning.home.continueAttempt')
                        : attempt.status === 'pending_grading'
                          ? t('learning.home.pendingGrading')
                          : t('learning.home.viewReport')
                  }}</span
                ><AppIcon name="chevron" :size="17" />
              </div>
            </RouterLink>
          </div>
          <EmptyState
            v-else
            compact
            :title="t('learning.home.emptyTitle')"
            :description="t('learning.home.emptyDescription')"
          >
            <RouterLink class="text-link" :to="{ name: 'topics' }"
              >{{ t('learning.home.viewTopics') }}<AppIcon name="arrow" :size="15"
            /></RouterLink>
          </EmptyState>
        </section>
        <aside class="quick-panel" aria-labelledby="quick-title">
          <div>
            <h2 id="quick-title">{{ t('learning.home.toolsTitle') }}</h2>
            <p>{{ t('learning.home.toolsDescription') }}</p>
            <RouterLink class="button" :to="{ name: 'agent-tokens' }"
              ><AppIcon name="token" :size="17" />{{
                t('learning.home.manageAgentTokens')
              }}</RouterLink
            >
          </div>
          <div class="quick-links">
            <RouterLink class="quick-link" :to="{ name: 'assistant' }"
              ><AppIcon name="assistant" :size="17" />{{ t('learning.home.openAssistant')
              }}<AppIcon name="arrow" :size="15"
            /></RouterLink>
            <RouterLink class="quick-link" :to="{ name: 'topics' }"
              ><AppIcon name="topics" :size="17" />{{ t('learning.home.browseTopics')
              }}<AppIcon name="arrow" :size="15"
            /></RouterLink>
            <RouterLink class="quick-link" :to="{ name: 'wrong-questions' }"
              ><AppIcon name="wrong" :size="17" />{{ t('learning.home.reviewWrongQuestions')
              }}<AppIcon name="arrow" :size="15"
            /></RouterLink>
            <RouterLink class="quick-link" :to="{ name: 'archive' }"
              ><AppIcon name="archive" :size="17" />{{ t('learning.home.restoreArchive')
              }}<AppIcon name="arrow" :size="15"
            /></RouterLink>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>
