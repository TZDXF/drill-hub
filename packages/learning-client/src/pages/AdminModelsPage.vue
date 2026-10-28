<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  DiscoveredProviderModel,
  GradingProfile,
  ModelCatalogMatch,
  ModelConnectionView,
  ModelProtocol,
  ProviderModel,
  ProviderModelImportResult,
} from '@drill-hub/contracts';
import { useModelDiscoverySelection } from '#learning-client/modelDiscoverySelection';
import { useLearning } from '#learning-client/injection';
import type { ModelAdapter } from '#learning-client/types';
import { errorMessage } from '#learning-client/utils';
import PageHeader from '#learning-client/components/PageHeader.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppFormField from '#learning-client/components/AppFormField.vue';
import EmptyState from '#learning-client/components/EmptyState.vue';
import ConfirmDialog from '#learning-client/components/ConfirmDialog.vue';
import AppSelect from '#learning-client/components/AppSelect.vue';
import AppCheckbox from '#learning-client/components/AppCheckbox.vue';
import AppScrollArea from '#learning-client/components/AppScrollArea.vue';

const { t } = useI18n();
const learning = useLearning();
const adapters = ref<ModelAdapter[]>([]);
const connections = ref<ModelConnectionView[]>([]);
const models = ref<ProviderModel[]>([]);
const profiles = ref<GradingProfile[]>([]);
const selectedId = ref('');
const loading = ref(true);
const loadingModels = ref(false);
const error = ref('');
const modelLoadError = ref('');
const busy = ref(false);
const testing = ref('');
const connectionOpen = ref(false);
const editingConnection = ref<ModelConnectionView | null>(null);
const connectionName = ref('');
const protocol = ref<ModelProtocol>('chat_completions');
const baseUrl = ref('');
const apiKey = ref('');
const connectionTesting = ref(false);
const modelOpen = ref(false);
const modelKey = ref('');
const modelName = ref('');
const editingModel = ref<ProviderModel | null>(null);
const contextWindow = ref<number | null>(null);
const maxTokens = ref<number | null>(null);
const reasoning = ref(false);
const inputImage = ref(false);
const costInput = ref<number | null>(null);
const costOutput = ref<number | null>(null);
const costCacheRead = ref<number | null>(null);
const costCacheWrite = ref<number | null>(null);
const catalogSearching = ref(false);
const catalogSearched = ref(false);
const catalogMatches = ref<ModelCatalogMatch[]>([]);
const catalogApplied = ref<ModelCatalogMatch | null>(null);
let catalogRequestId = 0;
let catalogTimer: ReturnType<typeof setTimeout> | undefined;
const catalogQueries = computed(() => {
  const key = modelKey.value.trim();
  const unprefixed = key.slice(key.lastIndexOf('/') + 1);
  return [...new Set([key, unprefixed])].filter(
    (query) => query.length >= 2 && query.length <= 200,
  );
});
watch([modelKey, modelOpen], () => {
  catalogRequestId += 1;
  if (catalogTimer) clearTimeout(catalogTimer);
  catalogSearching.value = false;
  catalogSearched.value = false;
  catalogMatches.value = [];
  catalogApplied.value = null;
  if (modelOpen.value && catalogQueries.value.length) {
    catalogTimer = setTimeout(() => void searchCatalog(), 350);
  }
});
const discoverOpen = ref(false);
const discovering = ref(false);
const deletingModel = ref<ProviderModel | null>(null);
const defaultProfile = computed(() => profiles.value.find((item) => item.isDefault));
const selected = computed(
  () => connections.value.find((item) => item.id === selectedId.value) ?? null,
);
const existingModelKeys = computed(() => new Set(models.value.map((item) => item.modelKey)));
const {
  discoveredModels,
  selectedDiscoveredKeys,
  discoveryFilter,
  filteredDiscoveredModels,
  selectableDiscoveredModels,
  allFilteredDiscoveredSelected,
  toggleDiscovered,
  toggleAllDiscovered,
} = useModelDiscoverySelection(existingModelKeys);
const protocolOptions = computed(() =>
  adapters.value.map((adapter) => ({
    value: adapter.protocol,
    label: adapter.displayName ?? adapter.name ?? adapter.protocol,
  })),
);
const protocolValue = computed({
  get: () => protocol.value,
  set: (value: string) => {
    protocol.value = value as ModelProtocol;
  },
});
const discoveryConfirmLabel = computed(() =>
  selectedDiscoveredKeys.value.length
    ? t('management.models.importLabel', { count: selectedDiscoveredKeys.value.length })
    : t('management.models.importLabelPlain'),
);

async function load(initial = false) {
  if (initial) loading.value = true;
  error.value = '';
  try {
    const [adapterResult, connectionResult, profileResult] = await Promise.all([
      learning.get<ModelAdapter[]>('/admin/model-adapters'),
      learning.get<ModelConnectionView[]>('/admin/model-connections'),
      learning.get<GradingProfile[]>('/admin/grading-profiles'),
    ]);
    adapters.value = adapterResult;
    connections.value = connectionResult;
    profiles.value = profileResult;
    if (!selectedId.value || !connections.value.some((item) => item.id === selectedId.value))
      selectedId.value = connections.value[0]?.id ?? '';
    if (selectedId.value) await loadModels();
    else models.value = [];
  } catch (reason) {
    const message = errorMessage(reason);
    if (initial || !connections.value.length) error.value = message;
    learning.notify.error(t('management.models.loadError'), message);
  } finally {
    loading.value = false;
  }
}
let modelLoadTicket = 0;
async function loadModels() {
  const ticket = ++modelLoadTicket;
  modelLoadError.value = '';
  if (!selectedId.value) {
    models.value = [];
    loadingModels.value = false;
    return;
  }
  loadingModels.value = true;
  try {
    const result = await learning.get<ProviderModel[]>(
      `/admin/model-connections/${selectedId.value}/models`,
    );
    if (ticket === modelLoadTicket) models.value = result;
  } catch (reason) {
    if (ticket !== modelLoadTicket) return;
    modelLoadError.value = errorMessage(reason);
    learning.notify.error(t('management.models.modelListError'), modelLoadError.value);
  } finally {
    if (ticket === modelLoadTicket) loadingModels.value = false;
  }
}
async function selectConnection(id: string) {
  selectedId.value = id;
  await loadModels();
}
function openConnection(connection: ModelConnectionView | null) {
  editingConnection.value = connection;
  connectionName.value = connection?.displayName ?? '';
  protocol.value = connection?.protocol ?? adapters.value[0]?.protocol ?? 'chat_completions';
  baseUrl.value = connection?.baseUrl ?? '';
  apiKey.value = '';
  connectionOpen.value = true;
}
async function testConnectionForm() {
  if (!baseUrl.value.trim()) {
    learning.notify.warning(
      t('management.models.testUnavailable'),
      t('management.models.testUnavailableUrl'),
    );
    return;
  }
  if (!editingConnection.value && !apiKey.value) {
    learning.notify.warning(
      t('management.models.testUnavailable'),
      t('management.models.testUnavailableKey'),
    );
    return;
  }
  connectionTesting.value = true;
  try {
    await learning.post('/admin/model-connections/test', {
      baseUrl: baseUrl.value,
      ...(apiKey.value ? { apiKey: apiKey.value } : {}),
      ...(editingConnection.value ? { connectionId: editingConnection.value.id } : {}),
    });
    learning.notify.success(t('management.models.testOk'), t('management.models.testOkDesc'));
  } catch (reason) {
    learning.notify.error(t('management.models.testFailed'), errorMessage(reason));
  } finally {
    connectionTesting.value = false;
  }
}
async function saveConnection() {
  busy.value = true;
  const creating = !editingConnection.value;
  try {
    const body: Record<string, unknown> = {
      displayName: connectionName.value,
      baseUrl: baseUrl.value,
    };
    if (!editingConnection.value) body.protocol = protocol.value;
    if (apiKey.value) body.apiKey = apiKey.value;
    if (editingConnection.value) {
      body.expectedRevision = editingConnection.value.revision;
      await learning.patch(`/admin/model-connections/${editingConnection.value.id}`, body);
    } else {
      const created = await learning.post<ModelConnectionView>('/admin/model-connections', body);
      selectedId.value = created.id;
    }
    connectionOpen.value = false;
    apiKey.value = '';
    learning.notify.success(
      creating ? t('management.models.connectionCreated') : t('management.models.connectionSaved'),
      creating
        ? t('management.models.connectionCreatedDesc')
        : t('management.models.connectionSavedDesc'),
    );
    await load();
  } catch (reason) {
    learning.notify.error(t('management.models.connectionSaveFailed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
async function testConnection() {
  if (!selected.value) return;
  testing.value = `connection-${selected.value.id}`;
  try {
    await learning.post(`/admin/model-connections/${selected.value.id}/test`, {});
    learning.notify.success(
      t('management.models.connectionTestOk'),
      t('management.models.connectionTestOkDesc'),
    );
  } catch (reason) {
    learning.notify.error(t('management.models.testFailed'), errorMessage(reason));
  } finally {
    testing.value = '';
  }
}
async function discoverModels() {
  if (!selected.value) return;
  discovering.value = true;
  try {
    const result = await learning.post<{ models: DiscoveredProviderModel[] }>(
      `/admin/model-connections/${selected.value.id}/models/discover`,
      {},
    );
    discoveredModels.value = result.models;
    discoveryFilter.value = '';
    const existing = existingModelKeys.value;
    selectedDiscoveredKeys.value = result.models
      .filter((item) => !existing.has(item.modelKey))
      .map((item) => item.modelKey);
    if (!result.models.length) {
      discoverOpen.value = false;
      learning.notify.info(
        t('management.models.noModelsReturned'),
        t('management.models.noModelsReturnedDesc'),
      );
    } else if (!selectedDiscoveredKeys.value.length) {
      discoverOpen.value = false;
      learning.notify.info(
        t('management.models.allAdded'),
        t('management.models.allAddedDesc', { count: result.models.length }),
      );
    } else {
      discoverOpen.value = true;
    }
  } catch (reason) {
    learning.notify.error(t('management.models.discoverFailed'), errorMessage(reason));
  } finally {
    discovering.value = false;
  }
}
async function importDiscoveredModels() {
  if (!selected.value || !selectedDiscoveredKeys.value.length) return;
  busy.value = true;
  try {
    const byKey = new Map(discoveredModels.value.map((item) => [item.modelKey, item]));
    const payload = selectedDiscoveredKeys.value.map((key) => {
      const item = byKey.get(key);
      return { modelKey: key, ...(item?.displayName ? { displayName: item.displayName } : {}) };
    });
    const result = await learning.post<ProviderModelImportResult>(
      `/admin/model-connections/${selected.value.id}/models/import`,
      { models: payload },
    );
    discoverOpen.value = false;
    await loadModels();
    learning.notify.success(
      result.created.length
        ? t('management.models.imported')
        : t('management.models.nothingImported'),
      result.created.length
        ? t('management.models.importedDesc', { count: result.created.length })
        : t('management.models.importExists'),
    );
  } catch (reason) {
    learning.notify.error(t('management.models.importFailed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
function openModelDialog(model: ProviderModel | null) {
  editingModel.value = model;
  modelKey.value = model?.modelKey ?? '';
  modelName.value = model?.displayName ?? '';
  contextWindow.value = model?.contextWindow ?? null;
  maxTokens.value = model?.maxTokens ?? null;
  reasoning.value = model?.reasoning ?? false;
  inputImage.value = model?.input?.includes('image') ?? false;
  costInput.value = model?.costPerMillion?.input ?? null;
  costOutput.value = model?.costPerMillion?.output ?? null;
  costCacheRead.value = model?.costPerMillion?.cacheRead ?? null;
  costCacheWrite.value = model?.costPerMillion?.cacheWrite ?? null;
  modelOpen.value = true;
}

async function searchCatalog() {
  if (!catalogQueries.value.length) return;
  const requestId = ++catalogRequestId;
  catalogSearching.value = true;
  catalogSearched.value = false;
  catalogMatches.value = [];
  try {
    const results = await Promise.allSettled(
      catalogQueries.value.map((query) =>
        learning.get<ModelCatalogMatch[]>(`/admin/models-catalog?q=${encodeURIComponent(query)}`),
      ),
    );
    if (requestId !== catalogRequestId) return;
    const matches = new Map<string, ModelCatalogMatch>();
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const match of result.value) {
        const key = JSON.stringify([match.providerId, match.modelId]);
        if (!matches.has(key)) matches.set(key, match);
      }
    }
    catalogMatches.value = [...matches.values()];
    catalogSearched.value = results.some((result) => result.status === 'fulfilled');
    const exactMatch = catalogQueries.value
      .map((query) =>
        catalogMatches.value.find((match) => match.modelId.toLowerCase() === query.toLowerCase()),
      )
      .find((match) => match !== undefined);
    if (exactMatch) applyCatalogMatch(exactMatch, false);
    else catalogApplied.value = null;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected')
      learning.notify.error(t('management.models.catalogFailed'), errorMessage(failure.reason));
  } finally {
    if (requestId === catalogRequestId) catalogSearching.value = false;
  }
}

/** 用 models.dev 的匹配结果回填默认参数与价格（美元/百万 tokens）。 */
function applyCatalogMatch(match: ModelCatalogMatch, notify = true) {
  catalogApplied.value = match;
  if (!modelName.value || editingModel.value) modelName.value = match.name ?? match.modelId;
  contextWindow.value = match.contextWindow;
  maxTokens.value = match.maxTokens;
  reasoning.value = match.reasoning;
  inputImage.value = match.input.includes('image');
  costInput.value = match.costPerMillion?.input ?? null;
  costOutput.value = match.costPerMillion?.output ?? null;
  costCacheRead.value = match.costPerMillion?.cacheRead ?? null;
  costCacheWrite.value = match.costPerMillion?.cacheWrite ?? null;
  if (notify)
    learning.notify.success(
      t('management.models.catalogApplied'),
      `${match.providerName} / ${match.modelId}`,
    );
}

async function saveModel() {
  if (!selected.value) return;
  busy.value = true;
  try {
    const hasCost = costInput.value !== null && costOutput.value !== null;
    const costPerMillion = hasCost
      ? {
          input: costInput.value!,
          output: costOutput.value!,
          cacheRead: costCacheRead.value ?? 0,
          cacheWrite: costCacheWrite.value ?? 0,
        }
      : null;
    const payload = {
      displayName: modelName.value,
      contextWindow: contextWindow.value || null,
      maxTokens: maxTokens.value || null,
      reasoning: reasoning.value,
      input: inputImage.value ? ['text', 'image'] : ['text'],
      ...(hasCost || editingModel.value ? { costPerMillion } : {}),
    };
    if (editingModel.value) {
      await learning.patch(`/admin/provider-models/${editingModel.value.id}`, {
        ...payload,
        expectedRevision: editingModel.value.revision,
      });
    } else {
      await learning.post<ProviderModel>(`/admin/model-connections/${selected.value.id}/models`, {
        modelKey: modelKey.value,
        ...payload,
      });
    }
    modelOpen.value = false;
    await loadModels();
    learning.notify.success(
      editingModel.value ? t('management.models.modelSaved') : t('management.models.modelAdded'),
      modelName.value,
    );
  } catch (reason) {
    learning.notify.error(t('management.models.addModelFailed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
async function toggleModel(model: ProviderModel) {
  busy.value = true;
  try {
    await learning.patch(`/admin/provider-models/${model.id}`, {
      enabled: !model.enabled,
      expectedRevision: model.revision,
    });
    learning.notify.success(
      model.enabled ? t('management.models.modelDisabled') : t('management.models.modelEnabled'),
      model.displayName,
    );
    await loadModels();
  } catch (reason) {
    learning.notify.error(t('management.models.modelStateFailed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
async function useGradingModel(model: ProviderModel) {
  busy.value = true;
  try {
    const current = defaultProfile.value;
    if (current) {
      await learning.patch(`/admin/grading-profiles/${current.id}`, {
        expectedRevision: current.revision,
        providerModelId: model.id,
        isDefault: true,
      });
    } else {
      await learning.post('/admin/grading-profiles', {
        providerModelId: model.id,
        concurrency: 2,
        timeoutMs: 60000,
        maxRetries: 2,
        isDefault: true,
      });
    }
    await load();
    learning.notify.success(
      t('management.models.setGradingModel'),
      t('management.models.setGradingModelDesc'),
    );
  } catch (reason) {
    learning.notify.error(t('management.models.setGradingModelFailed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
async function deleteModel() {
  if (!deletingModel.value) return;
  const model = deletingModel.value;
  busy.value = true;
  try {
    await learning.del(`/admin/provider-models/${model.id}`, {
      expectedRevision: model.revision,
    });
    deletingModel.value = null;
    await loadModels();
    learning.notify.success(t('management.models.modelDeleted'), model.displayName);
  } catch (reason) {
    learning.notify.error(t('management.models.modelDeleteFailed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
onMounted(() => void load(true));
</script>

<template>
  <div>
    <PageHeader
      :title="t('management.models.title')"
      eyebrow="SYSTEM SETTINGS"
      :description="t('management.models.description')"
    >
      <template #actions
        ><button
          class="button button--primary"
          type="button"
          :disabled="!adapters.length"
          @click="openConnection(null)"
        >
          <AppIcon name="plus" :size="17" />{{ t('management.models.addProvider') }}
        </button></template
      >
    </PageHeader>
    <div class="notice" style="margin-bottom: 18px">
      <AppIcon name="lock" />
      <div>
        <strong>{{ t('management.models.separationTitle') }}</strong>
        <p>{{ t('management.models.separationDesc') }}</p>
      </div>
    </div>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('management.models.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('management.models.loadFailed')"
      :description="t('management.common.networkRetry')"
      ><button class="button button--small" type="button" @click="load(true)">
        {{ t('management.common.retry') }}
      </button></EmptyState
    >
    <div v-else class="tabs-content">
      <EmptyState
        v-if="!connections.length"
        :title="t('management.models.emptyProviders')"
        :description="t('management.models.emptyProvidersDesc')"
        ><button
          class="button button--primary"
          type="button"
          :disabled="!adapters.length"
          @click="openConnection(null)"
        >
          {{ t('management.models.addConnection') }}
        </button></EmptyState
      >
      <div v-else class="model-layout">
        <aside class="paper-panel model-sidebar" :aria-label="t('management.models.sidebarLabel')">
          <button
            v-for="connection in connections"
            :key="connection.id"
            class="model-connection"
            :class="{ active: connection.id === selectedId }"
            type="button"
            @click="selectConnection(connection.id)"
          >
            <AppIcon name="server" :size="18" />
            <div>
              <strong>{{ connection.displayName }}</strong
              ><span>{{ connection.protocol }} · v{{ connection.configVersion }}</span>
            </div>
            <span class="status-dot" :class="{ offline: !connection.enabled }" />
          </button>
        </aside>
        <section
          v-if="selected"
          class="paper-panel model-detail"
          :aria-labelledby="`connection-${selected.id}`"
        >
          <header class="model-detail__header">
            <div>
              <h2 :id="`connection-${selected.id}`">{{ selected.displayName }}</h2>
              <p>{{ selected.baseUrl }}</p>
            </div>
            <div class="button-row">
              <button
                class="button button--small"
                type="button"
                :disabled="testing === `connection-${selected.id}`"
                @click="testConnection"
              >
                <span v-if="testing === `connection-${selected.id}`" class="spinner" />{{
                  t('management.models.testConnection')
                }}</button
              ><button class="button button--small" type="button" @click="openConnection(selected)">
                {{ t('management.models.edit') }}
              </button>
            </div>
          </header>
          <div class="tag-list" style="margin-bottom: 20px">
            <span class="badge" :class="selected.enabled ? 'badge--green' : 'badge--red'">{{
              selected.enabled
                ? t('management.models.state.enabled')
                : t('management.models.state.disabled')
            }}</span
            ><span class="badge">{{
              t('management.models.configVersion', { version: selected.configVersion })
            }}</span
            ><span
              class="badge"
              :class="selected.apiKeyConfigured ? 'badge--teal' : 'badge--amber'"
              >{{
                selected.apiKeyConfigured
                  ? t('management.models.keyConfigured')
                  : t('management.models.keyMissing')
              }}</span
            >
          </div>
          <div class="section-heading section-heading--models">
            <div>
              <h3>{{ t('management.models.modelsHeading') }}</h3>
              <p>{{ t('management.models.modelsDesc') }}</p>
            </div>
            <div class="button-row">
              <button
                class="button button--small"
                type="button"
                :disabled="discovering"
                @click="discoverModels"
              >
                <span v-if="discovering" class="spinner" /><AppIcon
                  v-else
                  name="refresh"
                  :size="15"
                />{{ t('management.models.discover') }}
              </button>
              <button class="button button--small" type="button" @click="openModelDialog(null)">
                <AppIcon name="plus" :size="15" />{{ t('management.models.addModel') }}
              </button>
            </div>
          </div>
          <div v-if="loadingModels" class="loading-block" style="min-height: 120px">
            <span class="spinner" />{{ t('management.models.loadingModels') }}
          </div>
          <EmptyState
            v-else-if="modelLoadError"
            compact
            icon="alert"
            :title="t('management.models.modelLoadFailed')"
            :description="t('management.common.networkRetry')"
            ><button class="button button--small" type="button" @click="loadModels">
              {{ t('management.common.retry') }}
            </button></EmptyState
          >
          <AppScrollArea
            v-else-if="models.length"
            class="model-list-scroll"
            orientation="vertical"
            type="hover"
          >
            <div class="list-stack">
              <article
                v-for="model in models"
                :key="model.id"
                class="card list-card provider-model-card"
              >
                <span class="list-card__icon"><AppIcon name="model" /></span>
                <div class="list-card__body">
                  <h3>{{ model.displayName }}</h3>
                  <p>{{ model.modelKey }}</p>
                  <div class="list-card__meta">
                    <span
                      v-if="defaultProfile?.providerModelId === model.id"
                      class="badge badge--green"
                      >{{ t('management.models.gradingModel') }}</span
                    >
                    <span>{{
                      model.enabled
                        ? t('management.models.state.enabled')
                        : t('management.models.state.disabled')
                    }}</span
                    ><span v-if="model.contextWindow">{{
                      t('management.models.contextSummary', {
                        context: Math.round(model.contextWindow / 1000),
                      })
                    }}</span
                    ><span v-if="model.costPerMillion">{{
                      t('management.models.costSummary', {
                        input: model.costPerMillion.input,
                        output: model.costPerMillion.output,
                      })
                    }}</span
                    ><span v-if="model.reasoning" class="badge badge--teal">{{
                      t('management.models.reasoningTag')
                    }}</span>
                  </div>
                </div>
                <div class="list-card__aside">
                  <button
                    class="button button--small"
                    type="button"
                    :disabled="busy || testing !== ''"
                    @click="useGradingModel(model)"
                  >
                    {{ t('management.models.useAsGrading') }}
                  </button>
                  <button
                    class="button button--small"
                    type="button"
                    :disabled="busy"
                    @click="openModelDialog(model)"
                  >
                    {{ t('management.assistant.edit') }}</button
                  ><button
                    class="button button--small"
                    type="button"
                    :disabled="busy"
                    @click="toggleModel(model)"
                  >
                    {{
                      model.enabled
                        ? t('management.models.action.disable')
                        : t('management.models.action.enable')
                    }}
                  </button>
                  <button
                    class="button button--small button--danger"
                    type="button"
                    :disabled="busy"
                    @click="deletingModel = model"
                  >
                    {{ t('management.models.action.delete') }}
                  </button>
                </div>
              </article>
            </div>
          </AppScrollArea>
          <EmptyState
            v-else
            compact
            :title="t('management.models.noModels')"
            :description="t('management.models.noModelsDesc')"
          />
        </section>
      </div>
    </div>
    <ConfirmDialog
      :open="connectionOpen"
      :title="
        editingConnection
          ? t('management.models.connectionTitle')
          : t('management.models.connectionTitleNew')
      "
      :description="t('management.models.connectionDesc')"
      :confirm-label="t('management.models.connectionConfirm')"
      :busy="busy"
      @update:open="connectionOpen = $event"
      @confirm="saveConnection"
    >
      <template #actions>
        <button
          class="button"
          type="button"
          :disabled="busy || connectionTesting"
          @click="testConnectionForm"
        >
          <span v-if="connectionTesting" class="spinner" />{{
            t('management.models.testConnection')
          }}
        </button>
      </template>
      <div class="form-grid">
        <AppFormField
          class="form-field--full"
          id="connection-name"
          :label="t('management.models.field.connectionName')"
        >
          <input id="connection-name" v-model="connectionName" class="input" required />
        </AppFormField>
        <AppFormField
          class="form-field--full"
          id="connection-protocol"
          :label="t('management.models.field.protocol')"
        >
          <AppSelect
            id="connection-protocol"
            v-model="protocolValue"
            :items="protocolOptions"
            :disabled="Boolean(editingConnection)"
          />
        </AppFormField>
        <AppFormField
          class="form-field--full"
          id="connection-url"
          :label="t('management.models.field.apiUrl')"
          :hint="t('management.models.field.apiUrlHint')"
        >
          <input
            id="connection-url"
            v-model="baseUrl"
            class="input"
            type="url"
            required
            placeholder="https://provider.example.com/v1"
          />
        </AppFormField>
        <AppFormField
          class="form-field--full"
          id="connection-key"
          :label="t('management.models.field.apiKey')"
          :hint="t('management.models.field.apiKeyHint')"
        >
          <input
            id="connection-key"
            v-model="apiKey"
            class="input"
            type="password"
            autocomplete="new-password"
            :required="!editingConnection"
          />
        </AppFormField>
      </div>
    </ConfirmDialog>
    <ConfirmDialog
      v-model:open="discoverOpen"
      :title="t('management.models.discoverTitle')"
      :description="t('management.models.discoverDesc')"
      :confirm-label="discoveryConfirmLabel"
      :confirm-disabled="!selectedDiscoveredKeys.length"
      :busy="busy"
      @confirm="importDiscoveredModels"
    >
      <AppFormField id="discovery-filter" :label="t('management.models.field.discoveryFilter')">
        <input
          id="discovery-filter"
          v-model="discoveryFilter"
          class="input"
          :placeholder="t('management.models.field.discoveryFilterPlaceholder')"
        />
      </AppFormField>
      <div class="model-discovery-toolbar">
        <span class="field-hint">{{
          t('management.models.discoveryCount', {
            total: discoveredModels.length,
            selected: selectedDiscoveredKeys.length,
          })
        }}</span
        ><button
          class="button button--small"
          type="button"
          :disabled="!selectableDiscoveredModels.length"
          @click="toggleAllDiscovered"
        >
          {{
            allFilteredDiscoveredSelected
              ? t('management.models.clearAll')
              : t('management.models.selectAll')
          }}
        </button>
      </div>
      <AppScrollArea
        v-if="filteredDiscoveredModels.length"
        class="model-discovery-scroll"
        orientation="vertical"
        type="hover"
      >
        <div class="model-discovery-list">
          <div
            v-for="item in filteredDiscoveredModels"
            :key="item.modelKey"
            class="model-discovery-row"
            :class="{ 'model-discovery-row--existing': existingModelKeys.has(item.modelKey) }"
          >
            <AppCheckbox
              v-if="!existingModelKeys.has(item.modelKey)"
              :model-value="selectedDiscoveredKeys.includes(item.modelKey)"
              @update:model-value="toggleDiscovered(item.modelKey)"
            >
              <span class="model-discovery-row__text">
                <strong>{{ item.displayName || item.modelKey }}</strong>
                <code v-if="item.displayName && item.displayName !== item.modelKey">{{
                  item.modelKey
                }}</code>
              </span>
            </AppCheckbox>
            <template v-else>
              <span class="badge">{{ t('management.models.alreadyAdded') }}</span>
              <span class="model-discovery-row__text">
                <strong>{{ item.displayName || item.modelKey }}</strong>
                <code v-if="item.displayName && item.displayName !== item.modelKey">{{
                  item.modelKey
                }}</code>
              </span>
            </template>
          </div>
        </div>
      </AppScrollArea>
      <p v-else class="field-hint">{{ t('management.models.noMatch') }}</p>
    </ConfirmDialog>
    <ConfirmDialog
      v-model:open="modelOpen"
      :title="
        editingModel ? t('management.models.modelEditTitle') : t('management.models.modelIdTitle')
      "
      :description="t('management.models.modelIdDesc')"
      :confirm-label="t('management.models.modelIdConfirm')"
      :busy="busy"
      :confirm-disabled="!editingModel && !modelKey.trim()"
      @confirm="saveModel"
      ><div class="form-grid">
        <AppFormField
          class="form-field--full"
          id="model-key"
          :label="t('management.models.field.modelKey')"
        >
          <input
            id="model-key"
            v-model="modelKey"
            class="input"
            required
            autocomplete="off"
            :disabled="Boolean(editingModel)"
          />
        </AppFormField>
        <AppFormField
          class="form-field--full"
          id="model-name"
          :label="t('management.models.field.modelName')"
        >
          <input id="model-name" v-model="modelName" class="input" required />
        </AppFormField>
        <AppFormField id="model-context" :label="t('management.models.field.contextWindow')">
          <input
            id="model-context"
            v-model.number="contextWindow"
            class="input"
            type="number"
            min="1"
            placeholder="128000"
          />
        </AppFormField>
        <AppFormField id="model-max-tokens" :label="t('management.models.field.maxTokens')">
          <input
            id="model-max-tokens"
            v-model.number="maxTokens"
            class="input"
            type="number"
            min="1"
            placeholder="16384"
          />
        </AppFormField>
        <div class="form-field form-field--full model-dialog__checks">
          <AppCheckbox v-model="reasoning">{{
            t('management.models.field.reasoning')
          }}</AppCheckbox>
          <AppCheckbox v-model="inputImage">{{
            t('management.models.field.inputImage')
          }}</AppCheckbox>
        </div>
        <AppFormField id="cost-input" :label="t('management.models.field.costInput')">
          <input
            id="cost-input"
            v-model.number="costInput"
            class="input"
            type="number"
            min="0"
            step="0.01"
          />
        </AppFormField>
        <AppFormField id="cost-output" :label="t('management.models.field.costOutput')">
          <input
            id="cost-output"
            v-model.number="costOutput"
            class="input"
            type="number"
            min="0"
            step="0.01"
          />
        </AppFormField>
        <AppFormField id="cost-cache-read" :label="t('management.models.field.costCacheRead')">
          <input
            id="cost-cache-read"
            v-model.number="costCacheRead"
            class="input"
            type="number"
            min="0"
            step="0.01"
          />
        </AppFormField>
        <AppFormField id="cost-cache-write" :label="t('management.models.field.costCacheWrite')">
          <input
            id="cost-cache-write"
            v-model.number="costCacheWrite"
            class="input"
            type="number"
            min="0"
            step="0.01"
          />
        </AppFormField>
        <p class="field-hint form-field--full">{{ t('management.models.costUnitHint') }}</p>
        <AppFormField
          class="form-field--full model-dialog__catalog"
          id="catalog-fetch"
          :label="t('management.models.catalogTitle')"
          :hint="t('management.models.catalogHint')"
        >
          <p v-if="catalogSearching" class="field-hint">
            <span class="spinner" /> {{ t('management.models.catalogSearching') }}
          </p>
          <p v-else-if="catalogApplied" class="field-hint">
            {{ t('management.models.catalogApplied') }}：{{ catalogApplied.providerName }} /
            {{ catalogApplied.modelId }}
          </p>
          <ul v-if="catalogMatches.length" class="model-dialog__matches">
            <li v-for="match in catalogMatches" :key="`${match.providerId}/${match.modelId}`">
              <button type="button" @click="applyCatalogMatch(match)">
                <strong>{{ match.name ?? match.modelId }}</strong>
                <span>{{ match.providerName }} · {{ match.modelId }}</span>
                <span v-if="match.costPerMillion">{{
                  t('management.models.costSummary', {
                    input: match.costPerMillion.input,
                    output: match.costPerMillion.output,
                  })
                }}</span>
              </button>
            </li>
          </ul>
          <p v-else-if="!catalogSearching && catalogSearched" class="field-hint">
            {{ t('management.models.catalogEmpty') }}
          </p>
        </AppFormField>
      </div></ConfirmDialog
    >
    <ConfirmDialog
      :open="Boolean(deletingModel)"
      :title="t('management.models.deleteModelTitle')"
      :description="
        t('management.models.deleteModelDesc', { name: deletingModel?.displayName ?? '' })
      "
      :confirm-label="t('management.models.action.delete')"
      :busy="busy"
      danger
      @update:open="deletingModel = $event ? deletingModel : null"
      @confirm="deleteModel"
    />
  </div>
</template>

<style scoped>
.model-discovery-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}
.model-list-scroll {
  max-height: 560px;
}
.model-list-scroll :deep(.app-scroll-area__viewport) {
  max-height: inherit;
}
.model-discovery-scroll {
  max-height: 340px;
  margin-top: 12px;
}
.model-discovery-scroll :deep(.app-scroll-area__viewport) {
  max-height: inherit;
}
.model-discovery-list {
  display: grid;
  gap: 8px;
  padding-right: 4px;
}
.model-discovery-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
}
.model-discovery-row--existing {
  background: var(--paper-muted);
}
.model-discovery-row .checkbox-row {
  flex: 1;
  min-width: 0;
}
.model-discovery-row__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.model-discovery-row__text strong {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.model-discovery-row__text code {
  color: var(--ink-faint);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.provider-model-card .list-card__body h3,
.provider-model-card .list-card__body p {
  overflow-wrap: anywhere;
}
.model-dialog__checks {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.model-dialog__catalog-row {
  display: flex;
  gap: 8px;
}
.model-dialog__matches {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  max-height: 220px;
  overflow-y: auto;
}
.model-dialog__matches li + li {
  border-top: 1px solid var(--line);
}
.model-dialog__matches button {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.model-dialog__matches button:hover {
  background: var(--teal-soft);
}
.model-dialog__matches strong {
  font-size: 13px;
}
.model-dialog__matches span {
  color: var(--ink-faint);
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .provider-model-card {
    flex-wrap: wrap;
  }
  .provider-model-card .list-card__body {
    flex: 1 1 calc(100% - 58px);
  }
  .provider-model-card .list-card__aside {
    flex: 1 1 100%;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .section-heading--models {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
