<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { TokenUsageReport } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage } from '../utils';
import AppIcon from '../components/AppIcon.vue';
import AppScrollArea from '../components/AppScrollArea.vue';
import AppSelect from '../components/AppSelect.vue';
import EmptyState from '../components/EmptyState.vue';
import PageHeader from '../components/PageHeader.vue';

const learning = useLearning();
const days = ref('30');
const scope = ref('me');
const report = ref<TokenUsageReport | null>(null);
const loading = ref(true);
const error = ref('');
const isAdmin = computed(() => learning.state.user?.role === 'admin');
const dayOptions = [7, 30, 90].map((value) => ({
  value: String(value),
  label: `最近 ${value} 天`,
}));
const scopeOptions = [
  { value: 'me', label: '我的用量' },
  { value: 'admin', label: '全站用量' },
];
const number = (value: number) => value.toLocaleString('zh-CN');
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
      title="Token 用量"
      eyebrow="TOKEN USAGE"
      description="了解模型评分的消耗，让每一次学习投入都有迹可循。"
    >
      <template #actions>
        <button class="button" type="button" :disabled="loading" @click="load">
          <AppIcon name="refresh" :size="17" />刷新
        </button>
      </template>
    </PageHeader>
    <div class="card filter-bar">
      <div class="form-field">
        <label for="usage-days">统计范围</label>
        <AppSelect id="usage-days" v-model="days" :items="dayOptions" />
      </div>
      <div v-if="isAdmin" class="form-field">
        <label for="usage-scope">用量归属</label>
        <AppSelect id="usage-scope" v-model="scope" :items="scopeOptions" />
      </div>
      <p class="muted small usage-filter-hint">包含今天，按设备时区 {{ timezone }} 分日</p>
    </div>
    <div v-if="loading" class="loading-block" role="status">
      <span class="spinner" />正在读取用量统计
    </div>
    <EmptyState v-else-if="error" icon="alert" title="用量统计读取失败" :description="error">
      <button class="button button--small" type="button" @click="load">重试</button>
    </EmptyState>
    <template v-else-if="report">
      <section class="stats-grid" aria-label="Token 用量概览">
        <article class="card stat-card stat-card--teal">
          <div class="stat-card__icon"><AppIcon name="usage" /></div>
          <strong>{{ number(report.totals.totalTokens) }}</strong
          ><span>已知总 Token</span>
        </article>
        <article class="card stat-card">
          <div class="stat-card__icon"><AppIcon name="arrow" /></div>
          <strong>{{ number(report.totals.promptTokens) }}</strong
          ><span>输入 Token</span>
        </article>
        <article class="card stat-card">
          <div class="stat-card__icon"><AppIcon name="back" /></div>
          <strong>{{ number(report.totals.completionTokens) }}</strong
          ><span>输出 Token</span>
        </article>
        <article class="card stat-card stat-card--amber">
          <div class="stat-card__icon"><AppIcon name="model" /></div>
          <strong>{{ number(report.totals.calls) }}</strong
          ><span>模型调用次数（含重试）</span>
        </article>
      </section>
      <div class="usage-status" aria-live="polite">
        <span class="badge">{{ report.fromDate }} 至 {{ report.toDate }}</span>
        <span class="badge" :class="report.totals.failedCalls ? 'badge--red' : 'badge--green'"
          >失败 {{ number(report.totals.failedCalls) }} 次</span
        >
        <span class="badge" :class="report.totals.unknownUsageCalls ? 'badge--amber' : ''"
          >用量未知 {{ number(report.totals.unknownUsageCalls) }} 次</span
        >
        <span class="badge">模型测试 {{ number(report.totals.modelTestCalls) }} 次</span>
      </div>
      <EmptyState
        v-if="!report.totals.calls"
        icon="usage"
        title="这个时间段暂无模型调用"
        description="完成一次模型评分后，这里会展示实际用量。规则评分和外部 Agent 评分不产生本站模型调用。"
      />
      <template v-else>
        <section class="card usage-trend" aria-labelledby="usage-trend-title">
          <div class="section-heading">
            <div>
              <h2 id="usage-trend-title">每日用量</h2>
              <p class="muted small">仅累计供应商已返回的 Token；用量未知的调用不计入柱高。</p>
            </div>
            <div class="usage-legend"><span>输入</span><span>输出</span></div>
          </div>
          <AppScrollArea orientation="horizontal" type="auto">
            <ul
              class="usage-chart"
              :style="{ minWidth: `${report.days * 10}px` }"
              aria-label="每日 Token 趋势"
            >
              <li
                v-for="(day, index) in report.daily"
                :key="day.date"
                :title="`${day.date}：输入 ${number(day.promptTokens)}，输出 ${number(day.completionTokens)}，用量未知 ${day.unknownUsageCalls} 次`"
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
                <span class="sr-only"
                  >{{ day.date }}：{{ number(day.totalTokens) }} 个已知 Token，{{
                    day.unknownUsageCalls
                  }}
                  次用量未知</span
                >
              </li>
            </ul>
          </AppScrollArea>
          <details class="usage-daily-details">
            <summary>查看每日明细</summary>
            <AppScrollArea orientation="horizontal" type="auto">
              <table class="data-table">
                <caption class="sr-only">
                  每日用量明细
                </caption>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th>已知总量</th>
                    <th>调用</th>
                    <th>失败</th>
                    <th>用量未知</th>
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
          </details>
        </section>
        <section aria-labelledby="usage-models-title">
          <div class="section-heading">
            <h2 id="usage-models-title">模型用量排行</h2>
            <span class="muted small">按已知总 Token 排序</span>
          </div>
          <AppScrollArea class="paper-panel table-wrap" orientation="horizontal" type="auto">
            <table class="data-table responsive-table">
              <caption class="sr-only">
                模型用量排行
              </caption>
              <thead>
                <tr>
                  <th>模型 / 连接</th>
                  <th>输入 Token</th>
                  <th>输出 Token</th>
                  <th>已知总 Token</th>
                  <th>调用次数</th>
                  <th>用量未知</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="model in report.models" :key="`${model.connectionId}:${model.modelKey}`">
                  <td data-label="模型 / 连接">
                    <span class="table-primary usage-model-key">{{ model.modelKey }}</span
                    ><span class="table-secondary usage-model-key"
                      >连接 {{ model.connectionId }}</span
                    >
                  </td>
                  <td data-label="输入 Token">{{ number(model.promptTokens) }}</td>
                  <td data-label="输出 Token">{{ number(model.completionTokens) }}</td>
                  <td data-label="已知总 Token">
                    <strong>{{ number(model.totalTokens) }}</strong>
                  </td>
                  <td data-label="调用次数">{{ number(model.calls) }}</td>
                  <td data-label="用量未知">{{ number(model.unknownUsageCalls) }}</td>
                </tr>
              </tbody>
            </table>
          </AppScrollArea>
        </section>
      </template>
      <aside class="card usage-note" aria-label="统计口径">
        <h2>统计口径</h2>
        <p>
          仅统计本站服务端发起的模型评分与模型能力测试；每次重试、重评分别计数。供应商连接测试和模型列表读取不计入，外部
          Agent 自身的模型消耗也不在统计范围内。
        </p>
        <p>
          Token 来自供应商响应，不按文本长度估算。失败调用可能已消耗
          Token；未返回完整有效用量时记为“用量未知”，而非零消耗。历史调用不会补算，本页不等同于供应商账单，也不提供费用估算。
        </p>
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
.usage-daily-details summary {
  cursor: pointer;
  color: var(--teal);
  font-size: 13px;
  padding: 8px 0;
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
