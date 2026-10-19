<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Assessment, Content, LearningPlan, Topic } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import type { ArchiveEntry, ArchiveResourceType } from '../types';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import AppSelect from '../components/AppSelect.vue';

const { t } = useI18n();
const learning = useLearning();
const entries = ref<ArchiveEntry[]>([]);
const type = ref('all');
const loading = ref(true);
const error = ref('');
const selected = ref<ArchiveEntry | null>(null);
const restoring = ref(false);
const typeOptions = computed(() => [
  { value: 'all', label: t('management.archive.filter.all') },
  { value: 'topic', label: t('management.archive.filter.topic') },
  { value: 'plan', label: t('management.archive.filter.plan') },
  { value: 'content', label: t('management.archive.filter.content') },
  { value: 'question', label: t('management.archive.filter.question') },
  { value: 'assessment', label: t('management.archive.filter.assessment') },
]);

function typeLabel(resourceType: ArchiveResourceType): string {
  return t(`management.archive.filter.${resourceType}`);
}

function normalize(value: unknown): ArchiveEntry[] {
  if (!Array.isArray(value)) throw new Error(t('management.archive.invalidResponse'));
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error(t('management.archive.invalidRecord'));
    const record = raw as Record<string, unknown>;
    const resource =
      record.resource && typeof record.resource === 'object'
        ? (record.resource as Record<string, unknown>)
        : record;
    const resourceType = (record.resourceType ?? record.type) as ArchiveResourceType;
    if (!['topic', 'plan', 'content', 'question', 'assessment'].includes(resourceType))
      throw new Error(t('management.archive.unknownType'));
    const id = String(record.id ?? resource.id ?? '');
    if (!id) throw new Error(t('management.archive.missingId'));
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
    learning.notify.error(t('management.archive.loadFailed'), error.value);
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
    if (!plan) throw new Error(t('management.archive.planMissing'));
    return plan.revision;
  }
  throw new Error(t('management.archive.missingRevision'));
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
    learning.notify.success(t('management.archive.restored'), t('management.archive.restoredDesc'));
    selected.value = null;
    await load();
  } catch (reason) {
    learning.notify.error(t('management.archive.restoreFailed'), errorMessage(reason));
  } finally {
    restoring.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('management.archive.title')"
      eyebrow="ARCHIVE"
      :description="t('management.archive.description')"
    />
    <form class="card filter-bar" @submit.prevent="load">
      <div class="form-field">
        <label for="archive-type">{{ t('management.archive.resourceType') }}</label
        ><AppSelect id="archive-type" v-model="type" :items="typeOptions" />
      </div>
      <button class="button" type="submit">{{ t('management.common.applyFilter') }}</button>
    </form>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('management.archive.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('management.archive.loadFailed')"
      :description="t('management.common.networkRetry')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('management.common.retry') }}
      </button></EmptyState
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
            {{ typeLabel(entry.resourceType) }} ·
            {{ t('management.archive.archivedAt', { date: formatDate(entry.archivedAt) }) }}
          </p>
          <div class="list-card__meta">
            <span>{{ t('management.archive.resourceId', { id: entry.id }) }}</span>
          </div>
        </div>
        <button class="button button--small" type="button" @click="selected = entry">
          {{ t('management.archive.restore') }}
        </button>
      </article>
    </div>
    <EmptyState
      v-else
      :title="t('management.archive.empty')"
      :description="t('management.archive.emptyDesc')"
    />
    <ConfirmDialog
      :open="Boolean(selected)"
      :title="t('management.archive.restoreTitle')"
      :description="
        selected
          ? t('management.archive.restoreDesc', {
              type: typeLabel(selected.resourceType),
              title: selected.title,
            })
          : ''
      "
      :confirm-label="t('management.archive.restoreConfirm')"
      :busy="restoring"
      @update:open="!$event && (selected = null)"
      @confirm="restore"
      ><p class="muted small">{{ t('management.archive.restoreNote') }}</p></ConfirmDialog
    >
  </div>
</template>
