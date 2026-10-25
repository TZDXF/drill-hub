<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import type { TokenUsageReport } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage } from '../utils';
import AppIcon from '../components/AppIcon.vue';
import AppScrollArea from '../components/AppScrollArea.vue';
import AppSelect from '../components/AppSelect.vue';
import EmptyState from '../components/EmptyState.vue';
import PageHeader from '../components/PageHeader.vue';
import AppFormField from '../components/AppFormField.vue';

const { t, n } = useI18n();
const learning = useLearning();
const days = ref('30');
const scope = ref('me');
const report = ref<TokenUsageReport | null>(null);
const loading = ref(true);
const error = ref('');
const isAdmin = computed(() => learning.state.user?.role === 'admin');
const dayOptions = computed(() =>
  [7, 30, 90].map((value) => ({
    value: String(value),
    label: t('management.usage.daysOption', { days: n(value) }),
  })),
);
const scopeOptions = computed(() => [
  { value: 'me', label: t('management.usage.scopeMe') },
  { value: 'admin', label: t('management.usage.scopeAdmin') },
]);
const dailyOpen = ref(false);
const number = (value: number) => n(value);
const peak = computed(() =>
  Math.max(1, ...(report.value?.daily.map((day) => day.totalTokens) ?? [])),
);
const timezone = computed(() => {
  const offset = report.value?.utcOffsetMinutes ?? -new Date().getTimezoneOffset();
  return `UTC${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
});
let requestId = 0;
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  report.value = null;
  try {
    const offset = -new Date().getTimezoneOffset();
    const result = await learning.get<TokenUsageReport>(
      `/${scope.value}/token-usage?days=${days.value}&utcOffsetMinutes=${offset}`,
    );
    if (id === requestId) report.value = result;
  } catch (reason) {
    if (id === requestId) error.value = errorMessage(reason);
  } finally {
    if (id === requestId) loading.value = false;
  }
}
watch([days, scope], load, { immediate: true });
onBeforeUnmount(() => {
  requestId += 1;
});
</script>

<template>
  <div class="usage-page">
    <PageHeader
      :title="t('management.usage.title')"
      eyebrow="TOKEN USAGE"
      :description="t('management.usage.description')"
    >
      <template #actions>
        <button class="button" type="button" :disabled="loading" @click="load">
          <AppIcon name="refresh" :size="17" />{{ t('management.common.refresh') }}
        </button>
      </template>
    </PageHeader>
    <div class="card filter-bar">
      <AppFormField id="usage-days" :label="t('management.usage.range')">
        <AppSelect id="usage-days" v-model="days" :items="dayOptions" />
      </AppFormField>
      <AppFormField v-if="isAdmin" id="usage-scope" :label="t('management.usage.scopeLabel')">
        <AppSelect id="usage-scope" v-model="scope" :items="scopeOptions" />
      </AppFormField>
      <p class="muted small usage-filter-hint">
        {{ t('management.usage.scopeHint', { timezone: timezone }) }}
      </p>
    </div>
    <div v-if="loading" class="loading-block" role="status">
      <span class="spinner" />{{ t('management.usage.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('management.usage.loadFailed')"
      :description="error"
    >
      <button class="button button--small" type="button" @click="load">
        {{ t('management.common.retry') }}
      </button>
    </EmptyState>
    <template v-else-if="report">
      <section class="stats-grid" :aria-label="t('management.usage.overviewLabel')">
        <article class="card stat-card stat-card--teal">
          <div class="stat-card__icon"><AppIcon name="usage" /></div>
          <strong>{{ number(report.totals.totalTokens) }}</strong
          ><span>{{ t('management.usage.totalTokens') }}</span>
        </article>
        <article class="card stat-card">
          <div class="stat-card__icon"><AppIcon name="arrow" /></div>
          <strong>{{ number(report.totals.promptTokens) }}</strong
          ><span>{{ t('management.usage.promptTokens') }}</span>
        </article>
        <article class="card stat-card">
          <div class="stat-card__icon"><AppIcon name="back" /></div>
          <strong>{{ number(report.totals.completionTokens) }}</strong
          ><span>{{ t('management.usage.completionTokens') }}</span>
        </article>
        <article class="card stat-card stat-card--amber">
          <div class="stat-card__icon"><AppIcon name="model" /></div>
          <strong>{{ number(report.totals.calls) }}</strong
          ><span>{{ t('management.usage.calls') }}</span>
        </article>
      </section>
      <div class="usage-status" aria-live="polite">
        <span class="badge">{{
          t('management.usage.rangeBadge', { from: report.fromDate, to: report.toDate })
        }}</span>
        <span class="badge" :class="report.totals.failedCalls ? 'badge--red' : 'badge--green'">{{
          t('management.usage.failedCalls', { count: number(report.totals.failedCalls) })
        }}</span>
        <span class="badge" :class="report.totals.unknownUsageCalls ? 'badge--amber' : ''">{{
          t('management.usage.unknownCalls', { count: number(report.totals.unknownUsageCalls) })
        }}</span>
        <span class="badge">{{
          t('management.usage.modelTestCalls', { count: number(report.totals.modelTestCalls) })
        }}</span>
      </div>
      <EmptyState
        v-if="!report.totals.calls"
        icon="usage"
        :title="t('management.usage.empty')"
        :description="t('management.usage.emptyDesc')"
      />
      <template v-else>
        <section class="card usage-trend" aria-labelledby="usage-trend-title">
          <div class="section-heading">
            <div>
              <h2 id="usage-trend-title">{{ t('management.usage.dailyTitle') }}</h2>
              <p class="muted small">{{ t('management.usage.dailyDesc') }}</p>
            </div>
            <div class="usage-legend">
              <span>{{ t('management.usage.legendInput') }}</span
              ><span>{{ t('management.usage.legendOutput') }}</span>
            </div>
          </div>
          <AppScrollArea orientation="horizontal" type="auto">
            <ul
              class="usage-chart"
              :style="{ minWidth: `${report.days * 10}px` }"
              :aria-label="t('management.usage.trendLabel')"
            >
              <li
                v-for="(day, index) in report.daily"
                :key="day.date"
                :title="
                  t('management.usage.dayTitle', {
                    date: day.date,
                    input: number(day.promptTokens),
                    output: number(day.completionTokens),
                    unknown: number(day.unknownUsageCalls),
                  })
                "
              >
                <div class="usage-chart__bar" aria-hidden="true">
                  <span
                    class="usage-chart__output"
                    :style="{ height: `${(day.completionTokens / peak) * 100}%` }"
                  />
                  <span
                    class="usage-chart__input"
                    :style="{ height: `${(day.promptTokens / peak) * 100}%` }"
                  />
                </div>
                <span class="usage-chart__label" aria-hidden="true">{{
                  index === 0 ||
                  index === report.days - 1 ||
                  index % Math.ceil(report.days / 7) === 0
                    ? day.date.slice(5)
                    : ''
                }}</span>
                <span class="sr-only">{{
                  t('management.usage.daySr', {
                    date: day.date,
                    total: number(day.totalTokens),
                    unknown: number(day.unknownUsageCalls),
                  })
                }}</span>
              </li>
            </ul>
          </AppScrollArea>
          <CollapsibleRoot v-model:open="dailyOpen" class="usage-daily-details">
            <CollapsibleTrigger class="usage-daily-details__trigger">
              <AppIcon name="down" :size="13" />
              {{ t('management.usage.dailyDetails') }}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <AppScrollArea orientation="horizontal" type="auto">
                <table class="data-table">
                  <caption class="sr-only">
                    {{
                      t('management.usage.dailyCaption')
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th>{{ t('management.usage.col.date') }}</th>
                      <th>{{ t('management.usage.col.input') }}</th>
                      <th>{{ t('management.usage.col.output') }}</th>
                      <th>{{ t('management.usage.col.knownTotal') }}</th>
                      <th>{{ t('management.usage.col.calls') }}</th>
                      <th>{{ t('management.usage.col.failed') }}</th>
                      <th>{{ t('management.usage.col.unknown') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="day in report.daily" :key="day.date">
                      <td>{{ day.date }}</td>
                      <td>{{ number(day.promptTokens) }}</td>
                      <td>{{ number(day.completionTokens) }}</td>
                      <td>{{ number(day.totalTokens) }}</td>
                      <td>{{ number(day.calls) }}</td>
                      <td>{{ number(day.failedCalls) }}</td>
                      <td>{{ number(day.unknownUsageCalls) }}</td>
                    </tr>
                  </tbody>
                </table>
              </AppScrollArea>
            </CollapsibleContent>
          </CollapsibleRoot>
        </section>
        <section aria-labelledby="usage-models-title">
          <div class="section-heading">
            <h2 id="usage-models-title">{{ t('management.usage.modelsTitle') }}</h2>
            <span class="muted small">{{ t('management.usage.modelsDesc') }}</span>
          </div>
          <AppScrollArea class="paper-panel table-wrap" orientation="horizontal" type="auto">
            <table class="data-table responsive-table">
              <caption class="sr-only">
                {{
                  t('management.usage.modelsCaption')
                }}
              </caption>
              <thead>
                <tr>
                  <th>{{ t('management.usage.col.modelConnection') }}</th>
                  <th>{{ t('management.usage.promptTokens') }}</th>
                  <th>{{ t('management.usage.completionTokens') }}</th>
                  <th>{{ t('management.usage.col.knownTotalTokens') }}</th>
                  <th>{{ t('management.usage.col.callCount') }}</th>
                  <th>{{ t('management.usage.col.unknown') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="model in report.models" :key="`${model.connectionId}:${model.modelKey}`">
                  <td :data-label="t('management.usage.col.modelConnection')">
                    <span class="table-primary usage-model-key">{{ model.modelKey }}</span
                    ><span class="table-secondary usage-model-key">{{
                      t('management.usage.connection', { id: model.connectionId })
                    }}</span>
                  </td>
                  <td :data-label="t('management.usage.promptTokens')">
                    {{ number(model.promptTokens) }}
                  </td>
                  <td :data-label="t('management.usage.completionTokens')">
                    {{ number(model.completionTokens) }}
                  </td>
                  <td :data-label="t('management.usage.col.knownTotalTokens')">
                    <strong>{{ number(model.totalTokens) }}</strong>
                  </td>
                  <td :data-label="t('management.usage.col.callCount')">
                    {{ number(model.calls) }}
                  </td>
                  <td :data-label="t('management.usage.col.unknown')">
                    {{ number(model.unknownUsageCalls) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </AppScrollArea>
        </section>
      </template>
      <aside class="card usage-note" :aria-label="t('management.usage.noteLabel')">
        <h2>{{ t('management.usage.noteTitle') }}</h2>
        <p>{{ t('management.usage.noteP1') }}</p>
        <p>{{ t('management.usage.noteP2') }}</p>
      </aside>
    </template>
  </div>
</template>

<style scoped>
.usage-page {
  display: grid;
  gap: 24px;
}
.usage-page > * {
  min-width: 0;
}
.usage-page :deep(.page-header),
.usage-page :deep(.filter-bar),
.usage-page :deep(.stats-grid) {
  margin-bottom: 0;
}
.usage-filter-hint {
  margin: 0;
  align-self: center;
  min-width: 0;
  flex: 1 1 220px;
}
.usage-status,
.usage-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.usage-trend {
  padding: 24px;
  min-width: 0;
}
.usage-trend .section-heading {
  flex-wrap: wrap;
  gap: 12px;
}
.usage-legend {
  font-size: 12px;
  color: var(--ink-soft);
}
.usage-legend span::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 2px;
  background: var(--teal);
}
.usage-legend span:last-child::before {
  background: var(--amber);
}
.usage-chart {
  list-style: none;
  display: flex;
  gap: 2px;
  margin: 0;
  padding: 12px 2px 32px;
}
.usage-chart li {
  position: relative;
  flex: 1;
  min-width: 6px;
}
.usage-chart__bar {
  height: 160px;
  display: flex;
  flex-direction: column;
  justify-content: end;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(transparent 49%, var(--line) 50%, transparent 51%);
}
.usage-chart__bar span {
  display: block;
  flex-shrink: 0;
}
.usage-chart__input {
  background: var(--teal);
}
.usage-chart__output {
  background: var(--amber);
}
.usage-chart__label {
  position: absolute;
  top: 160px;
  left: 0;
  display: block;
  height: 32px;
  padding-top: 8px;
  font-size: 10px;
  white-space: nowrap;
  color: var(--ink-faint);
}
.usage-chart li:last-child .usage-chart__label {
  left: auto;
  right: 0;
}
.usage-daily-details {
  margin-top: 12px;
}
.usage-daily-details__trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  border: 0;
  background: transparent;
  padding: 8px 0;
  color: var(--teal);
  font-size: 13px;
}
.usage-daily-details__trigger:hover {
  text-decoration: underline;
}
.usage-daily-details__trigger .app-icon {
  transition: transform 0.15s ease;
}
.usage-daily-details[data-state='open'] .usage-daily-details__trigger .app-icon {
  transform: rotate(180deg);
}
.usage-model-key {
  overflow-wrap: anywhere;
  white-space: normal;
}
.usage-note {
  padding: 24px;
  color: var(--ink-soft);
  font-size: 13px;
}
.usage-note h2 {
  color: var(--ink);
  font-size: 15px;
}
.usage-note p:last-child {
  margin-bottom: 0;
}
@media (max-width: 640px) {
  .usage-page {
    gap: 18px;
  }
  .usage-trend,
  .usage-note {
    padding: 18px;
  }
  .usage-filter-hint {
    flex: 0 1 auto;
    align-self: stretch;
  }
}
</style>
