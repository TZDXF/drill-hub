<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Assessment, Content, LearningPlan, Topic } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { resourceTypeLabels, type ArchiveEntry, type ArchiveResourceType } from '../types';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import AppSelect from '../components/AppSelect.vue';

const learning = useLearning();
const entries = ref<ArchiveEntry[]>([]);
const type = ref('all');
const loading = ref(true);
const error = ref('');
const selected = ref<ArchiveEntry | null>(null);
const restoring = ref(false);
const typeOptions = [
  { value: 'all', label: '全部类型' },
  { value: 'topic', label: '主题' },
  { value: 'plan', label: '计划' },
  { value: 'content', label: '内容' },
  { value: 'question', label: '题目' },
  { value: 'assessment', label: '练习 / 考试' },
];

function normalize(value: unknown): ArchiveEntry[] {
  if (!Array.isArray(value)) throw new Error('服务器归档响应格式不正确');
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('归档记录格式不正确');
    const record = raw as Record<string, unknown>;
    const resource =
      record.resource && typeof record.resource === 'object'
        ? (record.resource as Record<string, unknown>)
        : record;
    const resourceType = (record.resourceType ?? record.type) as ArchiveResourceType;
    if (!['topic', 'plan', 'content', 'question', 'assessment'].includes(resourceType))
      throw new Error('归档记录包含未知资源类型');
    const id = String(record.id ?? resource.id ?? '');
    if (!id) throw new Error('归档记录缺少资源标识');
    return {
      resourceType,
      id,
      title: String(record.title ?? resource.title ?? id),
      archivedAt:
        typeof (record.archivedAt ?? resource.archivedAt) === 'string'
          ? String(record.archivedAt ?? resource.archivedAt)
          : null,
      revision:
        typeof (record.revision ?? resource.revision) === 'number'
          ? Number(record.revision ?? resource.revision)
          : null,
    };
  });
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = normalize(await learning.get<unknown>('/archive'));
    entries.value =
      type.value === 'all' ? result : result.filter((entry) => entry.resourceType === type.value);
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error('归档读取失败', error.value);
  } finally {
    loading.value = false;
  }
}
async function resolveRevision(entry: ArchiveEntry): Promise<number> {
  if (entry.revision !== null) return entry.revision;
  if (entry.resourceType === 'topic') {
    return (await learning.get<Topic>(`/topics/${entry.id}`)).revision;
  }
  if (entry.resourceType === 'content') {
    return (await learning.get<Content>(`/contents/${entry.id}`)).revision;
  }
  if (entry.resourceType === 'assessment') {
    return (await learning.get<Assessment>(`/assessments/${entry.id}`)).revision;
  }
  if (entry.resourceType === 'plan') {
    const topics = await learning.get<Topic[]>('/topics?archiveState=all');
    const plans = (
      await Promise.all(
        topics.map((topic) =>
          learning.get<LearningPlan[]>(`/topics/${topic.id}/plans?archiveState=all`),
        ),
      )
    ).flat();
    const plan = plans.find((item) => item.id === entry.id);
    if (!plan) throw new Error('服务端未找到这份归档计划，无法安全恢复');
    return plan.revision;
  }
  throw new Error(
    '题目归档记录未返回 expectedRevision；为避免覆盖并发修改，已停止恢复。需要后端在归档列表契约中补充 revision',
  );
}
async function restore() {
  if (!selected.value) return;
  restoring.value = true;
  error.value = '';
  try {
    const revision = await resolveRevision(selected.value);
    await learning.post(`/archive/${selected.value.resourceType}/${selected.value.id}/restore`, {
      expectedRevision: revision,
    });
    learning.notify.success('资源已恢复', '该资源已重新可用，历史记录保持不变。');
    selected.value = null;
    await load();
  } catch (reason) {
    learning.notify.error('恢复资源失败', errorMessage(reason));
  } finally {
    restoring.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      title="归档资源"
      eyebrow="ARCHIVE"
      description="归档不会删除作答、评分或错题历史。恢复父资源不会自动恢复独立归档的子资源。"
    />
    <form class="card filter-bar" @submit.prevent="load">
      <div class="form-field">
        <label for="archive-type">资源类型</label
        ><AppSelect id="archive-type" v-model="type" :items="typeOptions" />
      </div>
      <button class="button" type="submit">应用筛选</button>
    </form>
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取归档</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="归档读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
    >
    <div v-else-if="entries.length" class="list-stack">
      <article
        v-for="entry in entries"
        :key="`${entry.resourceType}-${entry.id}`"
        class="card list-card"
      >
        <span class="list-card__icon"><AppIcon name="archive" /></span>
        <div class="list-card__body">
          <h3>{{ entry.title }}</h3>
          <p>
            {{ resourceTypeLabels[entry.resourceType] }} · 归档于 {{ formatDate(entry.archivedAt) }}
          </p>
          <div class="list-card__meta">
            <span>资源标识 {{ entry.id }}</span>
          </div>
        </div>
        <button class="button button--small" type="button" @click="selected = entry">恢复</button>
      </article>
    </div>
    <EmptyState
      v-else
      title="归档中是空的"
      description="没有符合条件的已归档资源。首版不提供永久删除，因此这里也不会出现伪造的回收站项目。"
    />
    <ConfirmDialog
      :open="Boolean(selected)"
      title="恢复这项资源？"
      :description="
        selected
          ? `${resourceTypeLabels[selected.resourceType]}「${selected.title}」将恢复为可用状态。`
          : ''
      "
      confirm-label="确认恢复"
      :busy="restoring"
      @update:open="!$event && (selected = null)"
      @confirm="restore"
      ><p class="muted small">恢复后可开始新的学习操作；既有历史与关联保持不变。</p></ConfirmDialog
    >
  </div>
</template>
