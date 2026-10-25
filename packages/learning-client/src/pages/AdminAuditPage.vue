<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import type { ApiLogView, AuditLogView, LoginLogView, LogPage } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppFormField from '../components/AppFormField.vue';
import AppIcon from '../components/AppIcon.vue';
import AppSelect from '../components/AppSelect.vue';
import AppScrollArea from '../components/AppScrollArea.vue';
import EmptyState from '../components/EmptyState.vue';

const { t, d } = useI18n();
const learning = useLearning();
const tab = ref('audit');
const tabs = computed(() => [
  { value: 'audit', label: t('management.audit.tab.audit'), icon: 'history' },
  { value: 'api', label: t('management.audit.tab.api'), icon: 'server' },
  { value: 'login', label: t('management.audit.tab.login'), icon: 'user' },
]);
const q = ref('');
const from = ref('');
const until = ref('');
const channel = ref('all');
const method = ref('all');
const outcome = ref('all');
const statusCode = ref('');
const rows = ref<(AuditLogView | ApiLogView | LoginLogView)[]>([]);
const auditRows = computed(() => rows.value as AuditLogView[]);
const apiRows = computed(() => rows.value as ApiLogView[]);
const loginRows = computed(() => rows.value as LoginLogView[]);
const page = ref(1);
const total = ref(0);
const pageSize = 20;
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const loading = ref(true);
const error = ref('');
let ticket = 0;
let applied = new URLSearchParams();
const channelLabelKeys: Record<string, string> = {
  web: 'management.audit.channel.web',
  mobile: 'management.audit.channel.mobile',
  agent: 'management.audit.channel.agent',
  public: 'management.audit.channel.public',
  anonymous: 'management.audit.channel.anonymous',
};
const channelNames = computed<Record<string, string>>(() => ({
  web: t('management.audit.channel.web'),
  mobile: t('management.audit.channel.mobile'),
  agent: t('management.audit.channel.agent'),
  public: t('management.audit.channel.public'),
  anonymous: t('management.audit.channel.anonymous'),
}));
const channelOptions = computed(() => [
  { value: 'all', label: t('management.audit.filter.allChannels') },
  ...Object.entries(channelNames.value)
    .filter(([key]) => tab.value !== 'login' || ['web', 'mobile'].includes(key))
    .map(([value, label]) => ({ value, label })),
]);
const methodOptions = computed(() => [
  { value: 'all', label: t('management.audit.filter.allMethods') },
  ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((value) => ({
    value,
    label: value,
  })),
]);
const outcomeOptions = computed(() => [
  { value: 'all', label: t('management.audit.filter.allOutcomes') },
  { value: 'succeeded', label: t('management.audit.outcome.succeeded') },
  { value: 'failed', label: t('management.audit.outcome.failed') },
]);
const searchHint = computed(() =>
  tab.value === 'audit'
    ? t('management.audit.searchHint.audit')
    : tab.value === 'api'
      ? t('management.audit.searchHint.api')
      : t('management.audit.searchHint.login'),
);
const actionLabelKeys: Record<string, string> = {
  'password.changed': 'management.audit.action.passwordChanged',
  'user.created': 'management.audit.action.userCreated',
  'user.status_changed': 'management.audit.action.userStatusChanged',
  'user.password_reset': 'management.audit.action.userPasswordReset',
  'agent_token.created': 'management.audit.action.agentTokenCreated',
  'agent_token.scopes_updated': 'management.audit.action.agentTokenScopesUpdated',
  'agent_token.revoked': 'management.audit.action.agentTokenRevoked',
  'agent_token.secret_revealed': 'management.audit.action.agentTokenSecretRevealed',
  'topic.create': 'management.audit.action.topicCreate',
  'topic.update': 'management.audit.action.topicUpdate',
  'content.create': 'management.audit.action.contentCreate',
  'content.update': 'management.audit.action.contentUpdate',
  'question.batch-create': 'management.audit.action.questionBatchCreate',
  'question.new-version': 'management.audit.action.questionNewVersion',
  'assessment.create': 'management.audit.action.assessmentCreate',
  'assessment.update': 'management.audit.action.assessmentUpdate',
  'plan.create': 'management.audit.action.planCreate',
  'plan.update': 'management.audit.action.planUpdate',
  'task.update': 'management.audit.action.taskUpdate',
  'task.complete': 'management.audit.action.taskComplete',
  'answer-link.create': 'management.audit.action.answerLinkCreate',
  'attempt.start': 'management.audit.action.attemptStart',
  'attempt-item.submit': 'management.audit.action.attemptItemSubmit',
  'attempt.submit': 'management.audit.action.attemptSubmit',
  'attempt.void': 'management.audit.action.attemptVoid',
  'wrong-question-practice.start': 'management.audit.action.wrongQuestionPracticeStart',
  'wrong-question.mastery': 'management.audit.action.wrongQuestionMastery',
  'assistant.thread.delete': 'management.audit.action.assistantThreadDelete',
  'search-provider.create': 'management.audit.action.searchProviderCreate',
  'search-provider.update': 'management.audit.action.searchProviderUpdate',
  'search-provider.delete': 'management.audit.action.searchProviderDelete',
  'mcp-server.create': 'management.audit.action.mcpServerCreate',
  'mcp-server.update': 'management.audit.action.mcpServerUpdate',
  'mcp-server.delete': 'management.audit.action.mcpServerDelete',
  'assistant-skill.create': 'management.audit.action.assistantSkillCreate',
  'assistant-skill.update': 'management.audit.action.assistantSkillUpdate',
  'assistant-skill.delete': 'management.audit.action.assistantSkillDelete',
  'external_grade.created': 'management.audit.action.externalGradeCreated',
  'external_grade.corrected': 'management.audit.action.externalGradeCorrected',
  'grading_job.retried': 'management.audit.action.gradingJobRetried',
  'grading_job.admin_retried': 'management.audit.action.gradingJobAdminRetried',
  'model_regrade.requested': 'management.audit.action.modelRegradeRequested',
  'grading_profile.created': 'management.audit.action.gradingProfileCreated',
  'grading_profile.updated': 'management.audit.action.gradingProfileUpdated',
  'grading_profile.default_changed': 'management.audit.action.gradingProfileDefaultChanged',
  'model_connection.created': 'management.audit.action.modelConnectionCreated',
  'model_connection.updated': 'management.audit.action.modelConnectionUpdated',
  'model_connection.tested': 'management.audit.action.modelConnectionTested',
  'model_connection.test_failed': 'management.audit.action.modelConnectionTestFailed',
  'model_connection.config_tested': 'management.audit.action.modelConnectionConfigTested',
  'model_connection.config_test_failed': 'management.audit.action.modelConnectionConfigTestFailed',
  'provider_model.created': 'management.audit.action.providerModelCreated',
  'provider_model.updated': 'management.audit.action.providerModelUpdated',
  'provider_model.tested': 'management.audit.action.providerModelTested',
  'provider_model.test_failed': 'management.audit.action.providerModelTestFailed',
  'provider_models.discovered': 'management.audit.action.providerModelsDiscovered',
  'provider_models.discovery_failed': 'management.audit.action.providerModelsDiscoveryFailed',
  'provider_models.imported': 'management.audit.action.providerModelsImported',
  'resource.archive': 'management.audit.action.resourceArchive',
  'resource.restore': 'management.audit.action.resourceRestore',
};
const actionNames = computed<Record<string, string>>(() =>
  Object.fromEntries(Object.entries(actionLabelKeys).map(([action, key]) => [action, t(key)])),
);
function time(value: string) {
  return d(new Date(value), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
async function load(reset = false, target = page.value) {
  const current = ++ticket;
  loading.value = true;
  error.value = '';
  try {
    if (reset) {
      const next = new URLSearchParams();
      if (q.value.trim()) next.set('q', q.value.trim());
      for (const [key, value] of [
        ['from', from.value],
        ['until', until.value],
      ] as const) {
        if (value) {
          const date = new Date(value);
          if (!Number.isFinite(date.getTime()))
            throw new Error(t('management.audit.invalidFilterTime'));
          next.set(key, date.toISOString());
        }
      }
      if (next.get('from') && next.get('until') && next.get('from')! >= next.get('until')!) {
        throw new Error(t('management.audit.invalidRange'));
      }
      if (tab.value !== 'audit') {
        if (channel.value !== 'all') next.set('channel', channel.value);
        if (statusCode.value) next.set('statusCode', statusCode.value);
      }
      if (tab.value === 'api' && method.value !== 'all') next.set('method', method.value);
      if (tab.value === 'login' && outcome.value !== 'all') next.set('outcome', outcome.value);
      applied = next;
      target = 1;
    }
    const query = new URLSearchParams(applied);
    query.set('page', String(target));
    query.set('pageSize', String(pageSize));
    const result = await learning.get<LogPage<AuditLogView | ApiLogView | LoginLogView>>(
      `/admin/${tab.value}-logs?${query}`,
    );
    if (current !== ticket) return;
    rows.value = result.items;
    page.value = result.page;
    total.value = result.total;
  } catch (reason) {
    if (current === ticket) {
      rows.value = [];
      error.value = errorMessage(reason);
    }
  } finally {
    if (current === ticket) loading.value = false;
  }
}
function resetFilters() {
  q.value = '';
  from.value = '';
  until.value = '';
  channel.value = 'all';
  method.value = 'all';
  outcome.value = 'all';
  statusCode.value = '';
  void load(true);
}
watch(tab, () => {
  rows.value = [];
  total.value = 0;
  page.value = 1;
  channel.value = 'all';
  method.value = 'all';
  outcome.value = 'all';
  statusCode.value = '';
  void load(true);
});
onMounted(() => load(true));
onBeforeUnmount(() => {
  ticket += 1;
});
</script>

<template>
  <div class="audit-page">
    <PageHeader
      :title="t('management.audit.title')"
      eyebrow="AUDIT LOGS"
      :description="t('management.audit.description')"
    >
      <template #actions
        ><button class="button" type="button" :disabled="loading" @click="load()">
          <AppIcon name="refresh" :size="17" />{{ t('management.common.refresh') }}
        </button></template
      >
    </PageHeader>
    <TabsRoot v-model="tab">
      <AppScrollArea class="tabs-scroll" orientation="horizontal" type="auto">
        <TabsList class="tabs-list" :aria-label="t('management.audit.tabsLabel')">
          <TabsTrigger
            v-for="item in tabs"
            :key="item.value"
            class="tabs-trigger"
            :value="item.value"
            ><AppIcon :name="item.icon" :size="17" />{{ item.label }}</TabsTrigger
          >
        </TabsList>
      </AppScrollArea>
      <form class="card filter-bar audit-filters" @submit.prevent="load(true)">
        <AppFormField
          class="audit-search"
          id="log-search"
          :label="t('management.audit.field.keyword')"
        >
          <input
            id="log-search"
            v-model="q"
            class="input"
            :placeholder="searchHint"
            maxlength="200"
            type="search"
          />
        </AppFormField>
        <AppFormField id="log-from" :label="t('management.audit.field.from')">
          <input id="log-from" v-model="from" class="input" type="datetime-local" />
        </AppFormField>
        <AppFormField id="log-until" :label="t('management.audit.field.until')">
          <input id="log-until" v-model="until" class="input" type="datetime-local" />
        </AppFormField>
        <template v-if="tab !== 'audit'">
          <AppFormField id="log-channel" :label="t('management.audit.field.channel')">
            <AppSelect id="log-channel" v-model="channel" :items="channelOptions" />
          </AppFormField>
          <AppFormField id="log-status" :label="t('management.audit.field.statusCode')">
            <input
              id="log-status"
              v-model="statusCode"
              class="input"
              type="number"
              min="100"
              max="599"
              step="1"
              :placeholder="t('management.audit.field.statusCodePlaceholder')"
            />
          </AppFormField>
        </template>
        <AppFormField
          v-if="tab === 'api'"
          id="log-method"
          :label="t('management.audit.field.method')"
        >
          <AppSelect id="log-method" v-model="method" :items="methodOptions" />
        </AppFormField>
        <AppFormField
          v-if="tab === 'login'"
          id="log-outcome"
          :label="t('management.audit.field.outcome')"
        >
          <AppSelect id="log-outcome" v-model="outcome" :items="outcomeOptions" />
        </AppFormField>
        <div class="audit-filter-actions">
          <button class="button button--primary" type="submit" :disabled="loading">
            {{ t('management.common.applyFilter') }}</button
          ><button class="button" type="button" :disabled="loading" @click="resetFilters">
            {{ t('management.audit.reset') }}
          </button>
        </div>
      </form>
      <div v-if="loading" class="loading-block" role="status">
        <span class="spinner" />{{ t('management.audit.loading') }}
      </div>
      <EmptyState
        v-else-if="error"
        :title="t('management.audit.loadFailed')"
        :description="error"
        icon="alert"
        ><button class="button" type="button" @click="load(true)">
          {{ t('management.common.retry') }}
        </button></EmptyState
      >
      <template v-else>
        <p class="muted small audit-count" role="status">
          {{ t('management.audit.count', { total: total }) }}
        </p>
        <EmptyState
          v-if="!rows.length"
          :title="t('management.audit.empty')"
          :description="t('management.audit.emptyDesc')"
          icon="history"
        />
        <TabsContent value="audit" class="tabs-content">
          <AppScrollArea
            v-if="rows.length"
            class="paper-panel table-wrap"
            orientation="horizontal"
            type="auto"
          >
            <table class="data-table responsive-table">
              <caption class="sr-only">
                {{
                  t('management.audit.caption.audit')
                }}
              </caption>
              <thead>
                <tr>
                  <th>{{ t('management.audit.col.time') }}</th>
                  <th>{{ t('management.audit.col.actorAccount') }}</th>
                  <th>{{ t('management.audit.col.action') }}</th>
                  <th>{{ t('management.audit.col.resource') }}</th>
                  <th>{{ t('management.audit.col.actorId') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in auditRows" :key="row.id">
                  <td :data-label="t('management.audit.col.time')">
                    <time :datetime="row.createdAt" :title="time(row.createdAt)">{{
                      time(row.createdAt)
                    }}</time>
                  </td>
                  <td :data-label="t('management.audit.col.actorAccount')">
                    <span class="table-primary">{{
                      row.username ?? t('management.audit.unknownAccount')
                    }}</span
                    ><span class="table-secondary log-code">{{ row.ownerId ?? '—' }}</span>
                  </td>
                  <td :data-label="t('management.audit.col.action')">
                    <span class="table-primary">{{ actionNames[row.action] ?? row.action }}</span
                    ><span v-if="actionNames[row.action]" class="table-secondary log-code">{{
                      row.action
                    }}</span>
                  </td>
                  <td :data-label="t('management.audit.col.resource')">
                    <span class="table-primary">{{ row.resourceType }}</span
                    ><span class="table-secondary log-code">{{ row.resourceId }}</span>
                  </td>
                  <td :data-label="t('management.audit.col.actorId')" class="log-code">
                    {{ row.actorId }}
                  </td>
                </tr>
              </tbody>
            </table>
          </AppScrollArea>
        </TabsContent>
        <TabsContent value="api" class="tabs-content">
          <AppScrollArea
            v-if="rows.length"
            class="paper-panel table-wrap"
            orientation="horizontal"
            type="auto"
          >
            <table class="data-table responsive-table">
              <caption class="sr-only">
                {{
                  t('management.audit.caption.api')
                }}
              </caption>
              <thead>
                <tr>
                  <th>{{ t('management.audit.col.timeRequestId') }}</th>
                  <th>{{ t('management.audit.col.endpoint') }}</th>
                  <th>{{ t('management.audit.col.statusDuration') }}</th>
                  <th>{{ t('management.audit.col.accountChannel') }}</th>
                  <th>{{ t('management.audit.col.ip') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in apiRows" :key="row.id">
                  <td :data-label="t('management.audit.col.timeRequestId')">
                    <time :datetime="row.createdAt">{{ time(row.createdAt) }}</time
                    ><span class="table-secondary log-code">{{ row.requestId }}</span>
                  </td>
                  <td :data-label="t('management.audit.col.endpoint')">
                    <span class="badge">{{ row.method }}</span
                    ><span class="table-secondary log-code">{{ row.route }}</span>
                  </td>
                  <td :data-label="t('management.audit.col.statusDuration')">
                    <span
                      class="badge"
                      :class="row.statusCode >= 400 ? 'badge--amber' : 'badge--teal'"
                      >{{ row.statusCode }}</span
                    ><span class="table-secondary">{{ row.durationMs }} ms</span
                    ><span v-if="row.errorCode" class="table-secondary log-code">{{
                      row.errorCode
                    }}</span>
                  </td>
                  <td :data-label="t('management.audit.col.accountChannel')">
                    <span class="table-primary">{{
                      row.username ?? t('management.audit.unauthenticated')
                    }}</span
                    ><span class="table-secondary">{{ channelNames[row.channel] }}</span>
                  </td>
                  <td :data-label="t('management.audit.col.ip')" class="log-code">{{ row.ip }}</td>
                </tr>
              </tbody>
            </table>
          </AppScrollArea>
        </TabsContent>
        <TabsContent value="login" class="tabs-content">
          <AppScrollArea
            v-if="rows.length"
            class="paper-panel table-wrap"
            orientation="horizontal"
            type="auto"
          >
            <table class="data-table responsive-table">
              <caption class="sr-only">
                {{
                  t('management.audit.caption.login')
                }}
              </caption>
              <thead>
                <tr>
                  <th>{{ t('management.audit.col.timeRequestId') }}</th>
                  <th>{{ t('management.audit.col.loginAccount') }}</th>
                  <th>{{ t('management.audit.col.result') }}</th>
                  <th>{{ t('management.audit.col.channel') }}</th>
                  <th>{{ t('management.audit.col.ip') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in loginRows" :key="row.id">
                  <td :data-label="t('management.audit.col.timeRequestId')">
                    <time :datetime="row.createdAt">{{ time(row.createdAt) }}</time
                    ><span class="table-secondary log-code">{{ row.requestId }}</span>
                  </td>
                  <td :data-label="t('management.audit.col.loginAccount')">
                    <span class="table-primary">{{
                      row.username ?? t('management.audit.loginUnmatched')
                    }}</span
                    ><span class="table-secondary log-code">{{ row.ownerId ?? '—' }}</span>
                  </td>
                  <td :data-label="t('management.audit.col.result')">
                    <span
                      class="badge"
                      :class="row.outcome === 'succeeded' ? 'badge--teal' : 'badge--amber'"
                      >{{
                        row.outcome === 'succeeded'
                          ? t('management.audit.outcome.succeeded')
                          : t('management.audit.outcome.failed')
                      }}</span
                    ><span class="table-secondary">HTTP {{ row.statusCode }}</span
                    ><span v-if="row.errorCode" class="table-secondary log-code">{{
                      row.errorCode
                    }}</span>
                  </td>
                  <td :data-label="t('management.audit.col.channel')">
                    {{ channelNames[row.channel] }}
                  </td>
                  <td :data-label="t('management.audit.col.ip')" class="log-code">{{ row.ip }}</td>
                </tr>
              </tbody>
            </table>
          </AppScrollArea>
        </TabsContent>
        <nav class="audit-pagination" :aria-label="t('management.audit.paginationLabel')">
          <span class="muted small">{{
            t('management.audit.paginationInfo', { page: page, pages: pages, size: pageSize })
          }}</span>
          <div>
            <button
              class="button"
              type="button"
              :disabled="page <= 1"
              @click="load(false, page - 1)"
            >
              {{ t('management.audit.previous') }}</button
            ><button
              class="button"
              type="button"
              :disabled="page >= pages"
              @click="load(false, page + 1)"
            >
              {{ t('management.audit.next') }}
            </button>
          </div>
        </nav>
      </template>
    </TabsRoot>
    <aside class="card audit-note">
      <h2>{{ t('management.audit.noteTitle') }}</h2>
      <p>{{ t('management.audit.noteP1') }}</p>
      <p>{{ t('management.audit.noteP2') }}</p>
    </aside>
  </div>
</template>

<style scoped>
.audit-page {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.audit-page :deep(.page-header) {
  margin-bottom: 0;
}
.audit-filters {
  margin-top: 20px;
  flex-wrap: wrap;
}
.audit-search {
  flex: 2 1 260px;
}
.audit-filter-actions,
.audit-pagination,
.audit-pagination > div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.audit-pagination {
  justify-content: space-between;
  margin-top: 20px;
}
.audit-count {
  margin: 0 0 12px;
}
.log-code {
  overflow-wrap: anywhere;
  white-space: normal;
  max-width: 340px;
}
.audit-note {
  padding: 24px;
  font-size: 13px;
  color: var(--ink-soft);
}
.audit-note h2 {
  font-size: 15px;
  color: var(--ink);
}
.audit-note p:last-child {
  margin-bottom: 0;
}
@media (max-width: 640px) {
  .audit-page {
    gap: 18px;
  }
  .audit-filters {
    gap: 14px;
  }
  .audit-filters .form-field {
    flex: 1 1 100%;
    min-width: 0;
  }
  .audit-filters .input {
    width: 100%;
    min-width: 0;
  }
  .log-code {
    max-width: none;
  }
  .audit-note {
    padding: 18px;
  }
}
</style>
