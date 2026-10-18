<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
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
const promptVersion = ref('');
const timeoutMs = ref(60000);
const maxRetries = ref(2);
const isDefault = ref(true);
const selected = computed(
  () => connections.value.find((item) => item.id === selectedId.value) ?? null,
);
const verifiedModels = computed(() =>
  models.value.filter(
    (item) =>
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
  verifiedModels.value.map((model) => ({
    value: model.id,
    label: `${model.displayName}（${model.modelKey}）`,
  })),
);
const promptVersionOptions = computed(() => {
  const adapter = adapters.value.find((item) => item.protocol === selected.value?.protocol);
  return (adapter?.promptVersions ?? []).map((version) => ({ value: version, label: version }));
});
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
    ? `导入 ${selectedDiscoveredKeys.value.length} 个模型`
    : '导入模型',
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
    learning.notify.error('系统配置读取失败', message);
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
    learning.notify.error('模型列表读取失败', modelLoadError.value);
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
    learning.notify.warning('无法测试连接', '请填写 API 地址。');
    return;
  }
  if (!editingConnection.value && !apiKey.value) {
    learning.notify.warning('无法测试连接', '添加连接时请填写 API 密钥。');
    return;
  }
  connectionTesting.value = true;
  try {
    await learning.post('/admin/model-connections/test', {
      baseUrl: baseUrl.value,
      ...(apiKey.value ? { apiKey: apiKey.value } : {}),
      ...(editingConnection.value ? { connectionId: editingConnection.value.id } : {}),
    });
    learning.notify.success('连接与鉴权测试通过', '可以保存此连接。');
  } catch (reason) {
    learning.notify.error('连接测试未通过', errorMessage(reason));
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
      creating ? '供应商连接已创建' : '供应商连接已保存',
      creating ? '请先测试连接，再自动获取或手动添加模型。' : '已生成新的配置版本。',
    );
    await load();
  } catch (reason) {
    learning.notify.error('保存供应商连接失败', errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
async function testConnection() {
  if (!selected.value) return;
  testing.value = `connection-${selected.value.id}`;
  try {
    await learning.post(`/admin/model-connections/${selected.value.id}/test`, {});
    learning.notify.success('连接测试通过', '服务端已确认连接与鉴权；仍需逐模型验证评分能力。');
  } catch (reason) {
    learning.notify.error('连接测试未通过', errorMessage(reason));
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
      learning.notify.info('供应商没有返回可用模型', '仍可手动添加模型 ID。');
    } else if (!selectedDiscoveredKeys.value.length) {
      discoverOpen.value = false;
      learning.notify.info(
        '模型均已添加',
        `供应商返回 ${result.models.length} 个模型，均已在当前连接中。`,
      );
    } else {
      discoverOpen.value = true;
    }
  } catch (reason) {
    learning.notify.error('获取供应商模型失败', errorMessage(reason));
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
      result.created.length ? '模型已导入' : '没有新增模型',
      result.created.length
        ? `已添加 ${result.created.length} 个模型，请逐一运行评分测试。`
        : '选中的模型已存在。',
    );
  } catch (reason) {
    learning.notify.error('导入模型失败', errorMessage(reason));
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
    learning.notify.success('模型已添加', '请运行合成题得分项测试。');
  } catch (reason) {
    learning.notify.error('添加模型失败', errorMessage(reason));
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
    learning.notify.success(model.enabled ? '模型已停用' : '模型已启用', model.displayName);
    await loadModels();
  } catch (reason) {
    learning.notify.error('更新模型状态失败', errorMessage(reason));
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
      learning.notify.error('模型评分测试未通过', testedModel.testError);
    } else {
      learning.notify.success('模型评分测试已完成', '请核对验证配置版本后再用于默认评分。');
    }
  } catch (reason) {
    learning.notify.error('模型评分测试未通过', errorMessage(reason));
  } finally {
    testing.value = '';
  }
}
function openProfile() {
  providerModelId.value = verifiedModels.value[0]?.id ?? '';
  promptVersion.value = promptVersionOptions.value[0]?.value ?? '';
  isDefault.value = !profiles.value.some((item) => item.isDefault);
  profileOpen.value = true;
}
async function addProfile() {
  busy.value = true;
  try {
    await learning.post('/admin/grading-profiles', {
      providerModelId: providerModelId.value,
      promptVersion: promptVersion.value,
      timeoutMs: timeoutMs.value,
      maxRetries: maxRetries.value,
      isDefault: isDefault.value,
    });
    profileOpen.value = false;
    await load();
    learning.notify.success('评分配置已创建', '既有评分任务仍绑定原配置，新任务将使用当前配置。');
  } catch (reason) {
    learning.notify.error('创建评分配置失败', errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
onMounted(() => void load(true));
</script>

<template>
  <div>
    <PageHeader
      title="供应商与模型"
      eyebrow="SYSTEM SETTINGS"
      description="集中管理评分服务连接、模型标识与默认评分配置。供应商和型号不写死，密钥永不回显。"
    >
      <template #actions
        ><button
          class="button button--primary"
          type="button"
          :disabled="!adapters.length"
          @click="openConnection(null)"
        >
          <AppIcon name="plus" :size="17" />添加供应商
        </button></template
      >
    </PageHeader>
    <div class="notice" style="margin-bottom: 18px">
      <AppIcon name="lock" />
      <div>
        <strong>配置与评分事实分离</strong>
        <p>
          连接测试不携带真实用户答案；模型测试使用合成题。新配置只影响新任务，不会自动重评历史或修改成绩。
        </p>
      </div>
    </div>
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取系统配置</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="系统配置读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load(true)">
        重试
      </button></EmptyState
    >
    <TabsRoot v-else default-value="connections">
      <AppScrollArea class="tabs-scroll" orientation="horizontal" type="auto">
        <TabsList class="tabs-list" aria-label="模型系统设置"
          ><TabsTrigger class="tabs-trigger" value="connections"
            ><AppIcon name="server" :size="17" />连接与模型</TabsTrigger
          ><TabsTrigger class="tabs-trigger" value="profiles"
            ><AppIcon name="model" :size="17" />评分配置
            <span class="badge">{{ profiles.length }}</span></TabsTrigger
          ></TabsList
        >
      </AppScrollArea>
      <TabsContent class="tabs-content" value="connections">
        <EmptyState
          v-if="!connections.length"
          title="还没有评分供应商"
          description="添加服务器已实现的协议适配器、受控 API 地址和密钥引用。保存后先测试连接，再逐模型验证得分项输出。"
          ><button
            class="button button--primary"
            type="button"
            :disabled="!adapters.length"
            @click="openConnection(null)"
          >
            添加供应商连接
          </button></EmptyState
        >
        <div v-else class="model-layout">
          <aside class="paper-panel model-sidebar" aria-label="供应商连接">
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
                  <span
                    v-if="testing === `connection-${selected.id}`"
                    class="spinner"
                  />测试连接</button
                ><button
                  class="button button--small"
                  type="button"
                  @click="openConnection(selected)"
                >
                  编辑
                </button>
              </div>
            </header>
            <div class="tag-list" style="margin-bottom: 20px">
              <span class="badge" :class="selected.enabled ? 'badge--green' : 'badge--red'">{{
                selected.enabled ? '已启用' : '已停用'
              }}</span
              ><span class="badge">配置版本 {{ selected.configVersion }}</span
              ><span
                class="badge"
                :class="selected.apiKeyConfigured ? 'badge--teal' : 'badge--amber'"
                >{{ selected.apiKeyConfigured ? '密钥已配置' : '未配置密钥' }}</span
              >
            </div>
            <div class="section-heading section-heading--models">
              <div>
                <h3>模型</h3>
                <p>优先从供应商 /models 接口自动获取，也可手动维护模型 ID，并逐模型运行评分测试</p>
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
                  />自动获取
                </button>
                <button class="button button--small" type="button" @click="modelOpen = true">
                  <AppIcon name="plus" :size="15" />添加模型
                </button>
              </div>
            </div>
            <div v-if="loadingModels" class="loading-block" style="min-height: 120px">
              <span class="spinner" />读取模型
            </div>
            <EmptyState
              v-else-if="modelLoadError"
              compact
              icon="alert"
              title="模型列表读取失败"
              description="请检查网络连接后重试。"
              ><button class="button button--small" type="button" @click="loadModels">
                重试
              </button></EmptyState
            >
            <AppScrollArea
              v-else-if="models.length"
              class="model-list-scroll"
              orientation="vertical"
              type="hover"
            >
              <div class="list-stack">
                <article v-for="model in models" :key="model.id" class="card list-card">
                  <span class="list-card__icon"><AppIcon name="model" /></span>
                  <div class="list-card__body">
                    <h3>{{ model.displayName }}</h3>
                    <p>{{ model.modelKey }}</p>
                    <div class="list-card__meta">
                      <span>{{ model.enabled ? '已启用' : '已停用' }}</span
                      ><span>验证版本 {{ model.verifiedConfigVersion ?? '未验证' }}</span
                      ><span v-if="model.testError" class="badge badge--red">评分测试未通过</span>
                    </div>
                  </div>
                  <div class="list-card__aside">
                    <button
                      class="button button--small"
                      type="button"
                      :disabled="testing === model.id"
                      @click="testModel(model)"
                    >
                      <span v-if="testing === model.id" class="spinner" />评分测试</button
                    ><button
                      class="button button--small"
                      type="button"
                      :disabled="busy"
                      @click="toggleModel(model)"
                    >
                      {{ model.enabled ? '停用' : '启用' }}
                    </button>
                  </div>
                </article>
              </div>
            </AppScrollArea>
            <EmptyState
              v-else
              compact
              title="尚未添加模型"
              description="可从供应商 /models 接口自动获取，也可手动填写模型 ID；添加后需逐模型运行评分测试。"
            />
          </section>
        </div>
      </TabsContent>
      <TabsContent class="tabs-content" value="profiles">
        <div class="section-heading">
          <div>
            <h2>评分配置版本</h2>
            <p>选择经过验证的模型，设置提示词版本、超时和重试；默认配置只应用于新任务</p>
          </div>
          <button
            class="button button--primary"
            type="button"
            :disabled="!verifiedModels.length"
            @click="openProfile"
          >
            <AppIcon name="plus" :size="16" />新建配置
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
                <th>模型快照</th>
                <th>提示词版本</th>
                <th>超时</th>
                <th>最大重试</th>
                <th>创建时间</th>
                <th>用途</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="profile in profiles" :key="profile.id">
                <td data-label="模型快照">
                  <span class="table-primary">{{ profile.modelIdSnapshot }}</span
                  ><span class="table-secondary">{{ profile.providerModelId }}</span>
                </td>
                <td data-label="提示词版本">{{ profile.promptVersion }}</td>
                <td data-label="超时">{{ profile.timeoutMs }} ms</td>
                <td data-label="最大重试">{{ profile.maxRetries }}</td>
                <td data-label="创建时间">{{ formatDate(profile.createdAt) }}</td>
                <td data-label="用途">
                  <span v-if="profile.isDefault" class="badge badge--green">默认评分</span
                  ><span v-else class="badge">历史版本</span>
                </td>
              </tr>
            </tbody>
          </table>
        </AppScrollArea>
        <EmptyState
          v-else
          title="还没有评分配置"
          description="先在当前供应商下添加并验证模型，再创建默认评分配置。未配置时学习与交卷仍可进行，模型题保持待评分。"
        />
        <div v-if="!verifiedModels.length" class="notice notice--pending" style="margin-top: 14px">
          <AppIcon name="alert" />当前连接没有已启用且通过验证的模型，不能新建默认评分配置。
        </div>
      </TabsContent>
    </TabsRoot>
    <ConfirmDialog
      :open="connectionOpen"
      :title="editingConnection ? '编辑供应商连接' : '添加供应商连接'"
      description="可先测试当前填写的地址与密钥，测试不会保存配置；旧密钥不会回显，留空表示不更换。"
      confirm-label="保存连接"
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
          <span v-if="connectionTesting" class="spinner" />测试连接
        </button>
      </template>
      <div class="form-grid">
        <div class="form-field form-field--full">
          <label for="connection-name">供应商显示名称</label
          ><input id="connection-name" v-model="connectionName" class="input" required />
        </div>
        <div class="form-field form-field--full">
          <label for="connection-protocol">协议适配器</label
          ><AppSelect
            id="connection-protocol"
            v-model="protocolValue"
            :items="protocolOptions"
            :disabled="Boolean(editingConnection)"
          />
        </div>
        <div class="form-field form-field--full">
          <label for="connection-url">API 地址</label
          ><input
            id="connection-url"
            v-model="baseUrl"
            class="input"
            type="url"
            required
            placeholder="https://provider.example.com/v1"
          />
          <p class="field-hint">服务端会执行出站地址策略，不能用于探测任意内网服务。</p>
        </div>
        <div class="form-field form-field--full">
          <label for="connection-key">API 密钥</label
          ><input
            id="connection-key"
            v-model="apiKey"
            class="input"
            type="password"
            autocomplete="new-password"
            :required="!editingConnection"
          />
          <p class="field-hint">密钥不会回显，也不会出现在公共 server-info 或学习页面。</p>
        </div>
      </div>
    </ConfirmDialog>
    <ConfirmDialog
      v-model:open="discoverOpen"
      title="自动获取模型"
      description="从供应商 /models 接口读取模型；已存在的模型不会重复创建，导入后仍需逐模型运行评分测试。"
      :confirm-label="discoveryConfirmLabel"
      :confirm-disabled="!selectedDiscoveredKeys.length"
      :busy="busy"
      @confirm="importDiscoveredModels"
    >
      <div class="form-field">
        <label for="discovery-filter">筛选模型</label
        ><input
          id="discovery-filter"
          v-model="discoveryFilter"
          class="input"
          placeholder="按模型名称或 ID 筛选"
        />
      </div>
      <div class="model-discovery-toolbar">
        <span class="field-hint"
          >共 {{ discoveredModels.length }} 个模型，已选
          {{ selectedDiscoveredKeys.length }} 个</span
        ><button
          class="button button--small"
          type="button"
          :disabled="!selectableDiscoveredModels.length"
          @click="toggleAllDiscovered"
        >
          {{ allFilteredDiscoveredSelected ? '取消全选' : '全选可导入' }}
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
              <span class="badge">已添加</span>
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
      <p v-else class="field-hint">没有匹配的模型。</p>
    </ConfirmDialog>
    <ConfirmDialog
      v-model:open="modelOpen"
      title="添加模型 ID"
      description="请填写供应商实际支持的模型标识；添加后还需通过合成题得分项测试。"
      confirm-label="添加模型"
      :busy="busy"
      @confirm="addModel"
      ><div class="form-grid">
        <div class="form-field form-field--full">
          <label for="model-key">模型 ID</label
          ><input id="model-key" v-model="modelKey" class="input" required autocomplete="off" />
        </div>
        <div class="form-field form-field--full">
          <label for="model-name">显示名称</label
          ><input id="model-name" v-model="modelName" class="input" required />
        </div></div
    ></ConfirmDialog>
    <ConfirmDialog
      v-model:open="profileOpen"
      title="新建评分配置版本"
      description="只能使用当前连接中已启用且通过验证的模型。创建版本不会修改既有任务。"
      confirm-label="创建配置"
      :busy="busy"
      @confirm="addProfile"
      ><div class="form-grid">
        <div class="form-field form-field--full">
          <label for="profile-model">评分模型</label
          ><AppSelect id="profile-model" v-model="providerModelId" :items="profileModelOptions" />
        </div>
        <div class="form-field form-field--full">
          <label for="prompt-version">提示词版本</label
          ><AppSelect id="prompt-version" v-model="promptVersion" :items="promptVersionOptions" />
        </div>
        <div class="form-field">
          <label for="timeout-ms">超时（毫秒）</label
          ><input
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
          <label for="max-retries">最大重试</label
          ><input
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
          <AppCheckbox v-model="isDefault">设为新的默认评分配置</AppCheckbox>
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
.model-discovery-scroll {
  max-height: 340px;
  margin-top: 12px;
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
@media (max-width: 640px) {
  .section-heading--models {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
