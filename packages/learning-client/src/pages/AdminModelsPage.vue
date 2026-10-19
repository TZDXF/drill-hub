<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import type {
  DiscoveredProviderModel,
  GradingProfile,
  ModelConnectionView,
  ModelProtocol,
  ProviderModel,
  ProviderModelImportResult,
} from '@drill-hub/contracts';
import { useLearning } from '../injection';
import type { ModelAdapter } from '../types';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import AppSelect from '../components/AppSelect.vue';
import AppCheckbox from '../components/AppCheckbox.vue';
import AppScrollArea from '../components/AppScrollArea.vue';

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
const discoverOpen = ref(false);
const discovering = ref(false);
const discoveredModels = ref<DiscoveredProviderModel[]>([]);
const selectedDiscoveredKeys = ref<string[]>([]);
const discoveryFilter = ref('');
const profileOpen = ref(false);
const providerModelId = ref('');
const editingProfile = ref<GradingProfile | null>(null);
const profileModels = ref<ProviderModel[]>([]);
const concurrency = ref(2);
const defaultProfile = computed(() => profiles.value.find((item) => item.isDefault));
const timeoutMs = ref(60000);
const maxRetries = ref(2);
const isDefault = ref(true);
const selected = computed(
  () => connections.value.find((item) => item.id === selectedId.value) ?? null,
);
const verifiedModels = computed(() =>
  models.value.filter(
    (item) =>
      selected.value?.enabled &&
      item.enabled &&
      item.verifiedConfigVersion !== null &&
      item.verifiedConfigVersion === selected.value?.configVersion,
  ),
);
const existingModelKeys = computed(() => new Set(models.value.map((item) => item.modelKey)));
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
const profileModelOptions = computed(() =>
  profileModels.value.map((model) => ({
    value: model.id,
    label: `${connections.value.find((item) => item.id === model.connectionId)?.displayName} / ${model.displayName}（${model.modelKey}）`,
  })),
);
const profileFormValid = computed(
  () =>
    profileModels.value.some((model) => model.id === providerModelId.value) &&
    Number.isInteger(concurrency.value) &&
    concurrency.value >= 1 &&
    concurrency.value <= 20 &&
    Number.isInteger(timeoutMs.value) &&
    timeoutMs.value >= 100 &&
    timeoutMs.value <= 120000 &&
    Number.isInteger(maxRetries.value) &&
    maxRetries.value >= 0 &&
    maxRetries.value <= 5,
);
const filteredDiscoveredModels = computed(() => {
  const query = discoveryFilter.value.trim().toLowerCase();
  if (!query) return discoveredModels.value;
  return discoveredModels.value.filter(
    (item) =>
      item.modelKey.toLowerCase().includes(query) ||
      (item.displayName ?? '').toLowerCase().includes(query),
  );
});
const selectableDiscoveredModels = computed(() =>
  filteredDiscoveredModels.value.filter((item) => !existingModelKeys.value.has(item.modelKey)),
);
const allFilteredDiscoveredSelected = computed(
  () =>
    selectableDiscoveredModels.value.length > 0 &&
    selectableDiscoveredModels.value.every((item) =>
      selectedDiscoveredKeys.value.includes(item.modelKey),
    ),
);
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
async function loadModels() {
  modelLoadError.value = '';
  if (!selectedId.value) {
    models.value = [];
    return;
  }
  loadingModels.value = true;
  try {
    models.value = await learning.get<ProviderModel[]>(
      `/admin/model-connections/${selectedId.value}/models`,
    );
  } catch (reason) {
    modelLoadError.value = errorMessage(reason);
    learning.notify.error(t('management.models.modelListError'), modelLoadError.value);
  } finally {
    loadingModels.value = false;
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
function toggleDiscovered(key: string) {
  selectedDiscoveredKeys.value = selectedDiscoveredKeys.value.includes(key)
    ? selectedDiscoveredKeys.value.filter((item) => item !== key)
    : [...selectedDiscoveredKeys.value, key];
}
function toggleAllDiscovered() {
  const keys = selectableDiscoveredModels.value.map((item) => item.modelKey);
  if (allFilteredDiscoveredSelected.value) {
    const remove = new Set(keys);
    selectedDiscoveredKeys.value = selectedDiscoveredKeys.value.filter((key) => !remove.has(key));
  } else {
    selectedDiscoveredKeys.value = [...new Set([...selectedDiscoveredKeys.value, ...keys])];
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
async function addModel() {
  if (!selected.value) return;
  busy.value = true;
  try {
    await learning.post<ProviderModel>(`/admin/model-connections/${selected.value.id}/models`, {
      modelKey: modelKey.value,
      displayName: modelName.value,
    });
    modelOpen.value = false;
    modelKey.value = '';
    modelName.value = '';
    await loadModels();
    learning.notify.success(
      t('management.models.modelAdded'),
      t('management.models.modelAddedDesc'),
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
async function testModel(model: ProviderModel) {
  testing.value = model.id;
  try {
    const result = await learning.post<ProviderModel | { providerModel: ProviderModel }>(
      `/admin/provider-models/${model.id}/test`,
      {},
    );
    const testedModel = 'providerModel' in result ? result.providerModel : result;
    await loadModels();
    if (testedModel.testError) {
      learning.notify.error(t('management.models.modelTestFailed'), testedModel.testError);
    } else {
      learning.notify.success(
        t('management.models.modelTestDone'),
        t('management.models.modelTestDoneDesc'),
      );
    }
  } catch (reason) {
    learning.notify.error(t('management.models.modelTestFailed'), errorMessage(reason));
  } finally {
    testing.value = '';
  }
}
async function openProfile(profile: GradingProfile | null = null) {
  busy.value = true;
  try {
    const available = await Promise.all(
      connections.value
        .filter((item) => item.enabled)
        .map(async (connection) => {
          const items = await learning.get<ProviderModel[]>(
            `/admin/model-connections/${connection.id}/models`,
          );
          return items.filter(
            (model) => model.enabled && model.verifiedConfigVersion === connection.configVersion,
          );
        }),
    );
    profileModels.value = available.flat();
    editingProfile.value = profile;
    providerModelId.value =
      profile?.providerModelId ?? verifiedModels.value[0]?.id ?? profileModels.value[0]?.id ?? '';
    concurrency.value = profile?.concurrency ?? 2;
    timeoutMs.value = profile?.timeoutMs ?? 60000;
    maxRetries.value = profile?.maxRetries ?? 2;
    isDefault.value = profile?.isDefault ?? !defaultProfile.value;
    profileOpen.value = true;
  } catch (reason) {
    learning.notify.error(t('management.models.profileModelError'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
async function saveProfile() {
  if (!profileFormValid.value) return;
  busy.value = true;
  try {
    const body = {
      providerModelId: providerModelId.value,
      concurrency: concurrency.value,
      timeoutMs: timeoutMs.value,
      maxRetries: maxRetries.value,
      isDefault: isDefault.value,
    };
    if (editingProfile.value) {
      await learning.patch(`/admin/grading-profiles/${editingProfile.value.id}`, {
        ...body,
        expectedRevision: editingProfile.value.revision,
      });
    } else {
      await learning.post('/admin/grading-profiles', body);
    }
    profileOpen.value = false;
    await load();
    learning.notify.success(
      t('management.models.profileSaved'),
      t('management.models.profileSavedDesc'),
    );
  } catch (reason) {
    learning.notify.error(t('management.models.profileSaveFailed'), errorMessage(reason));
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
async function useProfile(profile: GradingProfile) {
  busy.value = true;
  try {
    await learning.post(`/admin/grading-profiles/${profile.id}/default`, {
      expectedRevision: profile.revision,
    });
    await load();
    learning.notify.success(
      t('management.models.defaultSwitched'),
      t('management.models.defaultSwitchedDesc'),
    );
  } catch (reason) {
    learning.notify.error(t('management.models.defaultSwitchFailed'), errorMessage(reason));
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
    <TabsRoot v-else default-value="connections">
      <AppScrollArea class="tabs-scroll" orientation="horizontal" type="auto">
        <TabsList class="tabs-list" :aria-label="t('management.models.tabsLabel')"
          ><TabsTrigger class="tabs-trigger" value="connections"
            ><AppIcon name="server" :size="17" />{{
              t('management.models.tabConnections')
            }}</TabsTrigger
          ><TabsTrigger class="tabs-trigger" value="profiles"
            ><AppIcon name="model" :size="17" />{{ t('management.models.tabProfiles') }}
            <span class="badge">{{ profiles.length }}</span></TabsTrigger
          ></TabsList
        >
      </AppScrollArea>
      <TabsContent class="tabs-content" value="connections">
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
          <aside
            class="paper-panel model-sidebar"
            :aria-label="t('management.models.sidebarLabel')"
          >
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
                ><button
                  class="button button--small"
                  type="button"
                  @click="openConnection(selected)"
                >
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
                <button class="button button--small" type="button" @click="modelOpen = true">
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
                      ><span>{{
                        model.verifiedConfigVersion !== null
                          ? t('management.models.verifiedVersion', {
                              version: model.verifiedConfigVersion,
                            })
                          : t('management.models.notVerified')
                      }}</span
                      ><span v-if="model.testError" class="badge badge--red">{{
                        t('management.models.gradingTestFailed')
                      }}</span>
                    </div>
                  </div>
                  <div class="list-card__aside">
                    <button
                      class="button button--small"
                      type="button"
                      :disabled="
                        busy ||
                        testing !== '' ||
                        !verifiedModels.some((item) => item.id === model.id)
                      "
                      @click="useGradingModel(model)"
                    >
                      {{ t('management.models.useAsGrading') }}
                    </button>
                    <button
                      class="button button--small"
                      type="button"
                      :disabled="busy || testing !== ''"
                      @click="testModel(model)"
                    >
                      <span v-if="testing === model.id" class="spinner" />{{
                        t('management.models.gradingTest')
                      }}</button
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
      </TabsContent>
      <TabsContent class="tabs-content" value="profiles">
        <div class="section-heading">
          <div>
            <h2>{{ t('management.models.profilesTitle') }}</h2>
            <p>{{ t('management.models.profilesDesc') }}</p>
          </div>
          <button
            class="button button--primary"
            type="button"
            :disabled="busy || !verifiedModels.length"
            @click="openProfile()"
          >
            <AppIcon name="plus" :size="16" />{{ t('management.models.newProfile') }}
          </button>
        </div>
        <AppScrollArea
          v-if="profiles.length"
          class="paper-panel table-wrap"
          orientation="horizontal"
          type="auto"
        >
          <table class="data-table responsive-table">
            <thead>
              <tr>
                <th>{{ t('management.models.col.snapshot') }}</th>
                <th>{{ t('management.models.col.concurrency') }}</th>
                <th>{{ t('management.models.col.timeout') }}</th>
                <th>{{ t('management.models.col.maxRetries') }}</th>
                <th>{{ t('management.models.col.createdAt') }}</th>
                <th>{{ t('management.models.col.usage') }}</th>
                <th>{{ t('management.common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="profile in profiles" :key="profile.id">
                <td :data-label="t('management.models.col.snapshot')">
                  <span class="table-primary">{{ profile.modelIdSnapshot }}</span
                  ><span class="table-secondary">{{ profile.providerModelId }}</span>
                </td>
                <td :data-label="t('management.models.col.concurrency')">
                  {{ profile.concurrency }}
                </td>
                <td :data-label="t('management.models.col.timeout')">{{ profile.timeoutMs }} ms</td>
                <td :data-label="t('management.models.col.maxRetries')">
                  {{ profile.maxRetries }}
                </td>
                <td :data-label="t('management.models.col.createdAt')">
                  {{ formatDate(profile.createdAt) }}
                </td>
                <td :data-label="t('management.models.col.usage')">
                  <span v-if="profile.isDefault" class="badge badge--green">{{
                    t('management.models.defaultGrading')
                  }}</span
                  ><span v-else class="badge">{{ t('management.models.nonDefault') }}</span>
                </td>
                <td :data-label="t('management.common.actions')">
                  <div class="button-row">
                    <button
                      class="button button--small"
                      type="button"
                      :disabled="busy"
                      @click="openProfile(profile)"
                    >
                      {{ t('management.models.edit') }}
                    </button>
                    <button
                      v-if="!profile.isDefault"
                      class="button button--small"
                      type="button"
                      :disabled="busy"
                      @click="useProfile(profile)"
                    >
                      {{ t('management.models.setDefault') }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </AppScrollArea>
        <EmptyState
          v-else
          :title="t('management.models.noProfiles')"
          :description="t('management.models.noProfilesDesc')"
        />
        <div v-if="!verifiedModels.length" class="notice notice--pending" style="margin-top: 14px">
          <AppIcon name="alert" />{{ t('management.models.noVerifiedModels') }}
        </div>
      </TabsContent>
    </TabsRoot>
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
        <div class="form-field form-field--full">
          <label for="connection-name">{{ t('management.models.field.connectionName') }}</label
          ><input id="connection-name" v-model="connectionName" class="input" required />
        </div>
        <div class="form-field form-field--full">
          <label for="connection-protocol">{{ t('management.models.field.protocol') }}</label
          ><AppSelect
            id="connection-protocol"
            v-model="protocolValue"
            :items="protocolOptions"
            :disabled="Boolean(editingConnection)"
          />
        </div>
        <div class="form-field form-field--full">
          <label for="connection-url">{{ t('management.models.field.apiUrl') }}</label
          ><input
            id="connection-url"
            v-model="baseUrl"
            class="input"
            type="url"
            required
            placeholder="https://provider.example.com/v1"
          />
          <p class="field-hint">{{ t('management.models.field.apiUrlHint') }}</p>
        </div>
        <div class="form-field form-field--full">
          <label for="connection-key">{{ t('management.models.field.apiKey') }}</label
          ><input
            id="connection-key"
            v-model="apiKey"
            class="input"
            type="password"
            autocomplete="new-password"
            :required="!editingConnection"
          />
          <p class="field-hint">{{ t('management.models.field.apiKeyHint') }}</p>
        </div>
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
      <div class="form-field">
        <label for="discovery-filter">{{ t('management.models.field.discoveryFilter') }}</label
        ><input
          id="discovery-filter"
          v-model="discoveryFilter"
          class="input"
          :placeholder="t('management.models.field.discoveryFilterPlaceholder')"
        />
      </div>
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
      :title="t('management.models.modelIdTitle')"
      :description="t('management.models.modelIdDesc')"
      :confirm-label="t('management.models.modelIdConfirm')"
      :busy="busy"
      @confirm="addModel"
      ><div class="form-grid">
        <div class="form-field form-field--full">
          <label for="model-key">{{ t('management.models.field.modelKey') }}</label
          ><input id="model-key" v-model="modelKey" class="input" required autocomplete="off" />
        </div>
        <div class="form-field form-field--full">
          <label for="model-name">{{ t('management.models.field.modelName') }}</label
          ><input id="model-name" v-model="modelName" class="input" required />
        </div></div
    ></ConfirmDialog>
    <ConfirmDialog
      v-model:open="profileOpen"
      :title="
        editingProfile
          ? t('management.models.profileTitleEdit')
          : t('management.models.profileTitleNew')
      "
      :description="t('management.models.profileDesc')"
      :confirm-label="
        editingProfile
          ? t('management.models.profileConfirmEdit')
          : t('management.models.profileConfirmNew')
      "
      :busy="busy"
      :confirm-disabled="!profileFormValid"
      @confirm="saveProfile"
      ><div class="form-grid">
        <div class="form-field form-field--full">
          <label for="profile-model">{{ t('management.models.field.profileModel') }}</label
          ><AppSelect id="profile-model" v-model="providerModelId" :items="profileModelOptions" />
        </div>
        <div class="form-field">
          <label for="profile-concurrency">{{ t('management.models.field.concurrency') }}</label>
          <input
            id="profile-concurrency"
            v-model.number="concurrency"
            class="input"
            type="number"
            min="1"
            max="20"
            required
          />
        </div>
        <div class="form-field">
          <label for="timeout-ms">{{ t('management.models.field.timeoutMs') }}</label>
          <input
            id="timeout-ms"
            v-model.number="timeoutMs"
            class="input"
            type="number"
            min="100"
            max="120000"
            required
          />
        </div>
        <div class="form-field">
          <label for="max-retries">{{ t('management.models.field.maxRetries') }}</label>
          <input
            id="max-retries"
            v-model.number="maxRetries"
            class="input"
            type="number"
            min="0"
            max="5"
            required
          />
        </div>
        <div class="form-field--full">
          <AppCheckbox v-model="isDefault" :disabled="editingProfile?.isDefault">{{
            t('management.models.field.setDefaultProfile')
          }}</AppCheckbox>
        </div>
      </div></ConfirmDialog
    >
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
