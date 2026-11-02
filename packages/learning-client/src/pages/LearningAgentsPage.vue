<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  AssistantModelOption,
  LearningAgentDraft,
  LearningAgentTone,
  LearningAgentView,
  LearningApproachTag,
} from '@drill-hub/contracts';
import { LEARNING_APPROACH_TAGS } from '@drill-hub/contracts';
import { useLearning } from '#learning-client/injection';
import { errorMessage } from '#learning-client/utils';
import { useAssistant } from '#learning-client/assistant/store';
import { LEARNING_AGENT_PRESETS } from '#learning-client/learningAgents/presets';
import PageHeader from '#learning-client/components/PageHeader.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import EmptyState from '#learning-client/components/EmptyState.vue';
import AppFormField from '#learning-client/components/AppFormField.vue';
import AppSelect from '#learning-client/components/AppSelect.vue';
import AppTextarea from '#learning-client/components/AppTextarea.vue';
import AppDialog from '#learning-client/components/AppDialog.vue';
import ConfirmDialog from '#learning-client/components/ConfirmDialog.vue';

const { t } = useI18n();
const learning = useLearning();
const assistant = useAssistant();

const ICON_CHOICES = ['🤖', '🧠', '💡', '🎯', '🌱', '⏰', '🔥', '📚', '🔬', '📐', '✏️', '🧭'];

const agents = ref<LearningAgentView[]>([]);
const models = ref<AssistantModelOption[]>([]);
const loading = ref(true);
const error = ref('');
const archiveFilter = ref('active');

const dialogOpen = ref(false);
const busy = ref(false);
const formError = ref('');
const editingId = ref<string | null>(null);
const editingRevision = ref(0);
const form = ref({
  name: '',
  icon: '🤖',
  description: '',
  approachTags: [] as LearningApproachTag[],
  tone: 'encouraging' as LearningAgentTone,
  detailLevel: 'balanced' as LearningAgentView['detailLevel'],
  instructions: '',
  defaultProviderModelId: '',
});

const aiOpen = ref(false);
const aiDescription = ref('');
const aiBusy = ref(false);
const aiError = ref('');

const deleteTarget = ref<LearningAgentView | null>(null);
const deleteBusy = ref(false);

const toneOptions = computed(() => [
  { value: 'encouraging', label: t('learning.agents.tone.encouraging') },
  { value: 'rigorous', label: t('learning.agents.tone.rigorous') },
  { value: 'concise', label: t('learning.agents.tone.concise') },
  { value: 'humorous', label: t('learning.agents.tone.humorous') },
]);
const detailOptions = computed(() => [
  { value: 'brief', label: t('learning.agents.detail.brief') },
  { value: 'balanced', label: t('learning.agents.detail.balanced') },
  { value: 'deep', label: t('learning.agents.detail.deep') },
]);
const filterOptions = computed(() => [
  { value: 'active', label: t('learning.agents.filterActive') },
  { value: 'archived', label: t('learning.agents.filterArchived') },
  { value: 'all', label: t('learning.agents.filterAll') },
]);
const modelOptions = computed(() => [
  { value: '', label: t('learning.agents.autoModel') },
  ...models.value.map((model) => ({ value: model.id, label: model.displayName })),
]);

const tagLabels = computed<Record<LearningApproachTag, string>>(() => ({
  active_recall: t('learning.agents.tag.active_recall'),
  spaced_review: t('learning.agents.tag.spaced_review'),
  feynman: t('learning.agents.tag.feynman'),
  socratic: t('learning.agents.tag.socratic'),
  example_driven: t('learning.agents.tag.example_driven'),
  step_by_step: t('learning.agents.tag.step_by_step'),
  mistake_focused: t('learning.agents.tag.mistake_focused'),
  exam_practice: t('learning.agents.tag.exam_practice'),
  interleaving: t('learning.agents.tag.interleaving'),
  self_check: t('learning.agents.tag.self_check'),
}));

const visibleAgents = computed(() =>
  archiveFilter.value === 'all'
    ? agents.value
    : archiveFilter.value === 'archived'
      ? agents.value.filter((agent) => agent.archivedAt !== null)
      : agents.value.filter((agent) => agent.archivedAt === null),
);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    agents.value = await learning.get<LearningAgentView[]>('/me/learning-agents?archiveState=all');
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('learning.agents.loadFailedTitle'), error.value);
  } finally {
    loading.value = false;
  }
}
async function loadModels() {
  try {
    models.value = await learning.get<AssistantModelOption[]>('/me/assistant/models');
  } catch {
    models.value = [];
  }
}
onMounted(() => {
  void load();
  void loadModels();
});

function fillForm(values: Partial<typeof form.value>) {
  Object.assign(form.value, {
    name: '',
    icon: '🤖',
    description: '',
    approachTags: [],
    tone: 'encouraging',
    detailLevel: 'balanced',
    instructions: '',
    defaultProviderModelId: '',
    ...values,
  });
}
function openCreate() {
  editingId.value = null;
  fillForm({});
  formError.value = '';
  dialogOpen.value = true;
}
function openPreset(preset: (typeof LEARNING_AGENT_PRESETS)[number]) {
  editingId.value = null;
  fillForm({
    name: preset.name,
    icon: preset.icon,
    description: preset.description,
    approachTags: [...preset.form.approachTags],
    tone: preset.form.tone,
    detailLevel: preset.form.detailLevel,
    instructions: preset.form.instructions,
  });
  formError.value = '';
  dialogOpen.value = true;
}
function openEdit(agent: LearningAgentView) {
  editingId.value = agent.id;
  editingRevision.value = agent.revision;
  fillForm({
    name: agent.name,
    icon: agent.icon ?? '🤖',
    description: agent.description ?? '',
    approachTags: [...agent.approachTags],
    tone: agent.tone,
    detailLevel: agent.detailLevel,
    instructions: agent.instructions ?? '',
    defaultProviderModelId: agent.defaultProviderModelId ?? '',
  });
  formError.value = '';
  dialogOpen.value = true;
}
function toggleTag(tag: LearningApproachTag) {
  form.value.approachTags = form.value.approachTags.includes(tag)
    ? form.value.approachTags.filter((item) => item !== tag)
    : [...form.value.approachTags, tag];
}

async function save() {
  if (busy.value) return;
  const payload = {
    name: form.value.name.trim(),
    icon: form.value.icon || null,
    description: form.value.description.trim() || null,
    approachTags: form.value.approachTags,
    tone: form.value.tone,
    detailLevel: form.value.detailLevel,
    instructions: form.value.instructions.trim() || null,
    defaultProviderModelId: form.value.defaultProviderModelId || null,
  };
  busy.value = true;
  formError.value = '';
  try {
    if (editingId.value) {
      await learning.patch(`/me/learning-agents/${editingId.value}`, {
        ...payload,
        expectedRevision: editingRevision.value,
      });
      learning.notify.success(
        t('learning.agents.updatedTitle'),
        t('learning.agents.updatedDescription', { name: payload.name }),
      );
    } else {
      await learning.post('/me/learning-agents', payload);
      learning.notify.success(
        t('learning.agents.createdTitle'),
        t('learning.agents.createdDescription', { name: payload.name }),
      );
    }
    dialogOpen.value = false;
    await load();
  } catch (reason) {
    formError.value = errorMessage(reason);
    learning.notify.error(t('learning.agents.saveFailedTitle'), formError.value);
  } finally {
    busy.value = false;
  }
}

async function generateDraft() {
  if (aiBusy.value) return;
  aiBusy.value = true;
  aiError.value = '';
  try {
    const draft = await learning.post<LearningAgentDraft>('/me/learning-agents/generate-draft', {
      description: aiDescription.value.trim(),
    });
    aiOpen.value = false;
    aiDescription.value = '';
    editingId.value = null;
    fillForm({
      name: draft.name,
      icon: draft.icon ?? '🤖',
      description: draft.description ?? '',
      approachTags: [...draft.approachTags],
      tone: draft.tone,
      detailLevel: draft.detailLevel,
      instructions: draft.instructions ?? '',
    });
    dialogOpen.value = true;
    learning.notify.success(
      t('learning.agents.draftReadyTitle'),
      t('learning.agents.draftReadyDescription'),
    );
  } catch (reason) {
    aiError.value = errorMessage(reason);
  } finally {
    aiBusy.value = false;
  }
}

async function startConversation(agent: LearningAgentView) {
  try {
    await assistant.startAgentThread(agent.id);
  } catch (reason) {
    learning.notify.error(
      t('learning.agents.startFailedTitle'),
      t('learning.agents.startFailedDescription', {
        name: agent.name,
        reason: errorMessage(reason),
      }),
    );
  }
}

async function toggleArchive(agent: LearningAgentView) {
  const action = agent.archivedAt ? 'restore' : 'archive';
  try {
    await learning.post(`/me/learning-agents/${agent.id}/${action}`, {
      expectedRevision: agent.revision,
    });
    learning.notify.success(
      t(`learning.agents.${action}dTitle`),
      t(`learning.agents.${action}dDescription`, { name: agent.name }),
    );
    await load();
  } catch (reason) {
    learning.notify.error(t('learning.agents.updateFailedTitle'), errorMessage(reason));
  }
}

async function removeAgent() {
  if (!deleteTarget.value || deleteBusy.value) return;
  deleteBusy.value = true;
  try {
    await learning.del(`/me/learning-agents/${deleteTarget.value.id}`);
    learning.notify.success(
      t('learning.agents.deletedTitle'),
      t('learning.agents.deletedDescription', { name: deleteTarget.value.name }),
    );
    deleteTarget.value = null;
    await load();
  } catch (reason) {
    learning.notify.error(t('learning.agents.deleteFailedTitle'), errorMessage(reason));
  } finally {
    deleteBusy.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader
      :title="t('learning.agents.title')"
      eyebrow="LEARNING AGENTS"
      :description="t('learning.agents.description')"
    />

    <div class="card agents-toolbar">
      <AppFormField id="agents-filter" :label="t('learning.agents.filterLabel')">
        <AppSelect id="agents-filter" v-model="archiveFilter" :items="filterOptions" />
      </AppFormField>
      <div class="agents-toolbar__actions">
        <button class="button" type="button" data-testid="agents-ai-create" @click="aiOpen = true">
          <AppIcon name="assistant" :size="15" />{{ t('learning.agents.aiButton') }}
        </button>
        <button
          class="button button--primary"
          type="button"
          data-testid="agents-create"
          @click="openCreate"
        >
          <AppIcon name="plus" :size="15" />{{ t('learning.agents.createButton') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-block"><span class="spinner" /></div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('learning.agents.loadFailedTitle')"
      :description="error"
    >
      <button class="button" type="button" @click="load">{{ t('learning.common.retry') }}</button>
    </EmptyState>
    <EmptyState
      v-else-if="!visibleAgents.length"
      icon="assistant"
      :title="t('learning.agents.emptyTitle')"
      :description="t('learning.agents.emptyDescription')"
    >
      <button class="button button--primary" type="button" @click="openCreate">
        {{ t('learning.agents.createButton') }}
      </button>
    </EmptyState>
    <div v-else class="agents-grid">
      <article
        v-for="agent in visibleAgents"
        :key="agent.id"
        class="card agent-card"
        :class="{ 'agent-card--archived': agent.archivedAt !== null }"
        :data-testid="`agent-card-${agent.id}`"
      >
        <header class="agent-card__header">
          <span class="agent-card__icon">{{ agent.icon ?? '🤖' }}</span>
          <div>
            <h3>{{ agent.name }}</h3>
            <p v-if="agent.description" class="muted small">{{ agent.description }}</p>
          </div>
        </header>
        <div v-if="agent.approachTags.length" class="agent-card__tags">
          <span v-for="tag in agent.approachTags" :key="tag" class="badge">{{
            tagLabels[tag]
          }}</span>
        </div>
        <p v-if="agent.instructions" class="agent-card__instructions muted small">
          {{ agent.instructions }}
        </p>
        <footer class="agent-card__actions">
          <button
            v-if="agent.archivedAt === null"
            class="button button--primary button--small"
            type="button"
            @click="startConversation(agent)"
          >
            <AppIcon name="message" :size="14" />{{ t('learning.agents.chatButton') }}
          </button>
          <button
            class="button button--small"
            type="button"
            :data-testid="`agent-edit-${agent.id}`"
            @click="openEdit(agent)"
          >
            <AppIcon name="edit" :size="14" />{{ t('learning.agents.editButton') }}
          </button>
          <button class="button button--small" type="button" @click="toggleArchive(agent)">
            <AppIcon name="archive" :size="14" />{{
              t(
                agent.archivedAt
                  ? 'learning.agents.restoreButton'
                  : 'learning.agents.archiveButton',
              )
            }}
          </button>
          <button
            class="button button--small button--danger"
            type="button"
            :disabled="agent.archivedAt === null"
            :title="t('learning.agents.deleteHint')"
            @click="deleteTarget = agent"
          >
            <AppIcon name="trash" :size="14" />{{ t('learning.agents.deleteButton') }}
          </button>
        </footer>
      </article>
    </div>

    <section class="agents-presets">
      <h2>{{ t('learning.agents.presetsTitle') }}</h2>
      <p class="muted small">{{ t('learning.agents.presetsDescription') }}</p>
      <div class="agents-grid">
        <article
          v-for="preset in LEARNING_AGENT_PRESETS"
          :key="preset.id"
          class="card agent-card agent-card--preset"
        >
          <header class="agent-card__header">
            <span class="agent-card__icon">{{ preset.icon }}</span>
            <div>
              <h3>{{ preset.name }}</h3>
              <p class="muted small">{{ preset.description }}</p>
            </div>
          </header>
          <div class="agent-card__tags">
            <span v-for="tag in preset.form.approachTags" :key="tag" class="badge">{{
              tagLabels[tag]
            }}</span>
          </div>
          <button class="button button--small" type="button" @click="openPreset(preset)">
            <AppIcon name="plus" :size="14" />{{ t('learning.agents.usePresetButton') }}
          </button>
        </article>
      </div>
    </section>

    <AppDialog
      v-model:open="dialogOpen"
      class="dialog-content"
      :title="editingId ? t('learning.agents.editTitle') : t('learning.agents.createTitle')"
      :busy="busy"
    >
      <form class="form-grid" @submit.prevent="save">
        <AppFormField id="agent-name" :label="t('learning.agents.nameLabel')">
          <input
            id="agent-name"
            v-model="form.name"
            class="input"
            maxlength="64"
            required
            :disabled="busy"
          />
        </AppFormField>
        <AppFormField id="agent-icon" :label="t('learning.agents.iconLabel')">
          <div class="agent-icon-picker">
            <button
              v-for="emoji in ICON_CHOICES"
              :key="emoji"
              type="button"
              class="agent-icon-picker__item"
              :class="{ 'is-active': form.icon === emoji }"
              @click="form.icon = emoji"
            >
              {{ emoji }}
            </button>
          </div>
        </AppFormField>
        <AppFormField
          id="agent-description"
          :label="t('learning.agents.descriptionLabel')"
          class="form-field--full"
        >
          <input
            id="agent-description"
            v-model="form.description"
            class="input"
            maxlength="200"
            :disabled="busy"
          />
        </AppFormField>
        <AppFormField
          id="agent-tags"
          :label="t('learning.agents.tagsLabel')"
          :hint="t('learning.agents.tagsHint')"
          class="form-field--full"
        >
          <div class="agent-tag-picker">
            <button
              v-for="tag in LEARNING_APPROACH_TAGS"
              :key="tag"
              type="button"
              class="agent-tag"
              :class="{ 'is-active': form.approachTags.includes(tag) }"
              @click="toggleTag(tag)"
            >
              {{ tagLabels[tag] }}
            </button>
          </div>
        </AppFormField>
        <AppFormField id="agent-tone" :label="t('learning.agents.toneLabel')">
          <AppSelect id="agent-tone" v-model="form.tone" :items="toneOptions" :disabled="busy" />
        </AppFormField>
        <AppFormField id="agent-detail" :label="t('learning.agents.detailLabel')">
          <AppSelect
            id="agent-detail"
            v-model="form.detailLevel"
            :items="detailOptions"
            :disabled="busy"
          />
        </AppFormField>
        <AppFormField
          id="agent-model"
          :label="t('learning.agents.modelLabel')"
          :hint="t('learning.agents.modelHint')"
          class="form-field--full"
        >
          <AppSelect
            id="agent-model"
            v-model="form.defaultProviderModelId"
            :items="modelOptions"
            :disabled="busy"
          />
        </AppFormField>
        <AppFormField
          id="agent-instructions"
          :label="t('learning.agents.instructionsLabel')"
          :hint="t('learning.agents.instructionsHint')"
          class="form-field--full"
        >
          <AppTextarea
            id="agent-instructions"
            v-model="form.instructions"
            class="textarea"
            rows="5"
            :disabled="busy"
          />
        </AppFormField>
        <p v-if="formError" class="notice form-field--full" role="alert">{{ formError }}</p>
      </form>
      <template #actions>
        <button class="button" type="button" :disabled="busy" @click="dialogOpen = false">
          {{ t('components.confirm.cancel') }}
        </button>
        <button
          class="button button--primary"
          type="button"
          data-testid="agents-save"
          :disabled="busy || !form.name.trim()"
          @click="save"
        >
          <span v-if="busy" class="spinner" />{{ t('components.confirm.confirm') }}
        </button>
      </template>
    </AppDialog>

    <AppDialog
      v-model:open="aiOpen"
      class="dialog-content"
      :title="t('learning.agents.aiTitle')"
      :description="t('learning.agents.aiDescription')"
      :busy="aiBusy"
    >
      <form class="form-field" @submit.prevent="generateDraft">
        <label for="agent-ai-description">{{ t('learning.agents.aiInputLabel') }}</label>
        <AppTextarea
          id="agent-ai-description"
          v-model="aiDescription"
          class="textarea"
          rows="6"
          :placeholder="t('learning.agents.aiPlaceholder')"
          :disabled="aiBusy"
        />
        <p class="field-hint">{{ t('learning.agents.aiHint') }}</p>
        <p v-if="aiError" class="notice" role="alert">{{ aiError }}</p>
      </form>
      <template #actions>
        <button class="button" type="button" :disabled="aiBusy" @click="aiOpen = false">
          {{ t('components.confirm.cancel') }}
        </button>
        <button
          class="button button--primary"
          type="button"
          data-testid="agents-ai-generate"
          :disabled="aiBusy || !aiDescription.trim()"
          @click="generateDraft"
        >
          <span v-if="aiBusy" class="spinner" />{{ t('learning.agents.aiGenerate') }}
        </button>
      </template>
    </AppDialog>

    <ConfirmDialog
      :open="Boolean(deleteTarget)"
      :title="t('learning.agents.deleteTitle')"
      :description="
        deleteTarget ? t('learning.agents.deleteDescription', { name: deleteTarget.name }) : ''
      "
      :busy="deleteBusy"
      danger
      @confirm="removeAgent"
      @update:open="!$event && (deleteTarget = null)"
    />
  </div>
</template>

<style scoped>
.agents-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.agents-toolbar__actions {
  display: flex;
  gap: 8px;
}
.agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.agent-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}
.agent-card--archived {
  opacity: 0.65;
}
.agent-card--preset {
  background: var(--paper-muted);
}
.agent-card__header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.agent-card__header h3 {
  margin: 0;
  font-size: 15px;
}
.agent-card__header p {
  margin: 2px 0 0;
}
.agent-card__icon {
  font-size: 26px;
  line-height: 1.2;
}
.agent-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.agent-card__instructions {
  margin: 0;
  white-space: pre-line;
}
.agent-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
}
.agents-presets {
  margin-top: 24px;
}
.agents-presets h2 {
  margin: 0 0 4px;
  font-size: 16px;
}
.agent-icon-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.agent-icon-picker__item {
  width: 34px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  font-size: 18px;
  cursor: pointer;
}
.agent-icon-picker__item.is-active {
  border-color: var(--teal-dark);
  background: var(--paper-muted);
}
.agent-tag-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.agent-tag {
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  font-size: 12px;
  cursor: pointer;
}
.agent-tag.is-active {
  border-color: var(--teal-dark);
  color: var(--teal-dark);
  background: var(--paper-muted);
  font-weight: 600;
}
@media (max-width: 780px) {
  .agents-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .agents-toolbar__actions {
    justify-content: flex-end;
  }
  .agents-grid {
    grid-template-columns: 1fr;
  }
}
</style>
