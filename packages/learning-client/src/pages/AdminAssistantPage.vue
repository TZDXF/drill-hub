<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import type {
  AssistantSkillView,
  McpServerView,
  SearchProviderKind,
  SearchProviderView,
} from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage } from '../utils';
import AppCheckbox from '../components/AppCheckbox.vue';
import AppFormField from '../components/AppFormField.vue';
import AppSelect from '../components/AppSelect.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import PageHeader from '../components/PageHeader.vue';

const { t } = useI18n();
const learning = useLearning();

const loading = ref(true);
const error = ref('');
const busy = ref(false);
const testing = ref('');

const providers = ref<SearchProviderView[]>([]);
const mcpServers = ref<McpServerView[]>([]);
const skills = ref<AssistantSkillView[]>([]);

const searchKindOptions = [
  { value: 'tavily', label: 'Tavily' },
  { value: 'brave', label: 'Brave Search' },
  { value: 'searxng', label: 'SearXNG' },
  { value: 'openai_responses', label: 'OpenAI Responses' },
];

const mcpTransportOptions = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'http' },
];

const mcpExposureOptions = [
  { value: 'direct', label: 'direct' },
  { value: 'deferred', label: 'deferred' },
];

const searchKinds = searchKindOptions.map((option) => option.value as SearchProviderKind);

const providerForm = reactive({
  kind: 'tavily' as SearchProviderKind,
  displayName: '',
  baseUrl: '',
  modelKey: '',
  apiKey: '',
  enabled: true,
});

const mcpForm = reactive({
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  headers: '',
  env: '',
  timeoutSeconds: 60,
  exposure: 'direct',
  enabled: false,
  clearEnv: false,
  clearHeaders: false,
});

const skillForm = reactive({
  name: '',
  description: '',
  content: '',
  enabled: true,
});

type DialogKind = 'provider' | 'mcp' | 'skill';
/** 当前打开的表单弹窗；editingId 为 null 表示新建。 */
const dialog = ref<{ kind: DialogKind; editingId: string | null } | null>(null);

function openCreate(kind: DialogKind): void {
  if (kind === 'provider') {
    Object.assign(providerForm, {
      kind: 'tavily',
      displayName: '',
      baseUrl: '',
      modelKey: '',
      apiKey: '',
      enabled: true,
    });
  } else if (kind === 'mcp') {
    Object.assign(mcpForm, {
      name: '',
      transport: 'stdio',
      command: '',
      args: '',
      url: '',
      headers: '',
      env: '',
      timeoutSeconds: 60,
      exposure: 'direct',
      enabled: false,
      clearEnv: false,
      clearHeaders: false,
    });
  } else {
    Object.assign(skillForm, { name: '', description: '', content: '', enabled: true });
  }
  dialog.value = { kind, editingId: null };
}

const editingProvider = computed(() =>
  dialog.value?.kind === 'provider' && dialog.value.editingId
    ? (providers.value.find((item) => item.id === dialog.value!.editingId) ?? null)
    : null,
);
const editingMcp = computed(() =>
  dialog.value?.kind === 'mcp' && dialog.value.editingId
    ? (mcpServers.value.find((item) => item.id === dialog.value!.editingId) ?? null)
    : null,
);
const editingSkill = computed(() =>
  dialog.value?.kind === 'skill' && dialog.value.editingId
    ? (skills.value.find((item) => item.id === dialog.value!.editingId) ?? null)
    : null,
);

const dialogOpen = computed({
  get: () => dialog.value !== null,
  set: (value: boolean) => {
    if (!value && !busy.value) dialog.value = null;
  },
});

const dialogTitle = computed(() => {
  if (!dialog.value) return '';
  const editing = Boolean(dialog.value.editingId);
  if (dialog.value.kind === 'provider')
    return t(
      editing ? 'management.assistant.searchEditTitle' : 'management.assistant.searchCreateTitle',
    );
  if (dialog.value.kind === 'mcp')
    return t(editing ? 'management.assistant.mcpEditTitle' : 'management.assistant.mcpCreateTitle');
  return t(
    editing ? 'management.assistant.skillEditTitle' : 'management.assistant.skillCreateTitle',
  );
});

async function openEdit(kind: DialogKind, id: string): Promise<void> {
  if (kind === 'provider') {
    const provider = providers.value.find((item) => item.id === id);
    if (!provider) return;
    Object.assign(providerForm, {
      kind: provider.kind,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl ?? '',
      modelKey: provider.modelKey ?? '',
      apiKey: '',
      enabled: provider.enabled,
    });
  } else if (kind === 'mcp') {
    const server = mcpServers.value.find((item) => item.id === id);
    if (!server) return;
    Object.assign(mcpForm, {
      name: server.name,
      transport: server.transport,
      command: server.command ?? '',
      args: server.args.join(' '),
      url: server.url ?? '',
      headers: '',
      env: '',
      timeoutSeconds: server.timeoutSeconds,
      exposure: server.exposure,
      enabled: server.enabled,
      clearEnv: false,
      clearHeaders: false,
    });
  } else {
    const skill = skills.value.find((item) => item.id === id);
    if (!skill) return;
    Object.assign(skillForm, {
      name: skill.name,
      description: skill.description,
      content: '',
      enabled: skill.enabled,
    });
    try {
      // 列表接口不含指令内容，编辑前单独拉取详情。
      const detail = await learning.get<AssistantSkillView & { content: string }>(
        `/admin/assistant-skills/${id}`,
      );
      if (dialog.value?.editingId === id) skillForm.content = detail.content;
    } catch (reason) {
      learning.notify.error(t('management.assistant.loadFailed'), errorMessage(reason));
    }
  }
  dialog.value = { kind, editingId: id };
}

async function load(initial = false): Promise<void> {
  if (initial) loading.value = true;
  error.value = '';
  try {
    const [providerResult, mcpResult, skillResult] = await Promise.all([
      learning.get<SearchProviderView[]>('/admin/search-providers'),
      learning.get<McpServerView[]>('/admin/mcp-servers'),
      learning.get<AssistantSkillView[]>('/admin/assistant-skills'),
    ]);
    providers.value = providerResult;
    mcpServers.value = mcpResult;
    skills.value = skillResult;
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(true));

function parseKeyValueBlock(block: string, separator: string): Record<string, string> | null {
  if (!block.trim()) return null;
  const result: Record<string, string> = {};
  for (const line of block.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(separator).map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    result[parts[0]] = parts[1];
  }
  return result;
}

async function saveProvider(): Promise<void> {
  busy.value = true;
  try {
    const payload = {
      kind: providerForm.kind,
      displayName: providerForm.displayName,
      baseUrl: providerForm.baseUrl || null,
      modelKey: providerForm.modelKey || null,
      ...(providerForm.apiKey ? { apiKey: providerForm.apiKey } : {}),
      enabled: providerForm.enabled,
    };
    if (editingProvider.value) {
      await learning.patch(`/admin/search-providers/${editingProvider.value.id}`, {
        expectedRevision: editingProvider.value.revision,
        ...payload,
      });
    } else {
      await learning.post('/admin/search-providers', payload);
    }
    learning.notify.success(t('management.assistant.saved'));
    dialog.value = null;
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}

async function saveMcp(): Promise<void> {
  busy.value = true;
  try {
    const env = parseKeyValueBlock(mcpForm.env, '=');
    const headers = parseKeyValueBlock(mcpForm.headers, ':');
    const payload = {
      transport: mcpForm.transport,
      command: mcpForm.transport === 'stdio' ? mcpForm.command : null,
      args: mcpForm.args ? mcpForm.args.split(/\s+/).filter(Boolean) : [],
      url: mcpForm.transport === 'http' ? mcpForm.url : null,
      timeoutSeconds: mcpForm.timeoutSeconds,
      exposure: mcpForm.exposure,
      enabled: mcpForm.enabled,
    };
    if (editingMcp.value) {
      await learning.patch(`/admin/mcp-servers/${editingMcp.value.id}`, {
        expectedRevision: editingMcp.value.revision,
        ...payload,
        ...(env ? { env } : {}),
        ...(mcpForm.clearEnv ? { env: null } : {}),
        ...(headers ? { headers } : {}),
        ...(mcpForm.clearHeaders ? { headers: null } : {}),
      });
    } else {
      await learning.post('/admin/mcp-servers', { name: mcpForm.name, ...payload, env, headers });
    }
    learning.notify.success(t('management.assistant.saved'));
    dialog.value = null;
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}

async function saveSkill(): Promise<void> {
  busy.value = true;
  try {
    const payload = {
      description: skillForm.description,
      content: skillForm.content,
      enabled: skillForm.enabled,
    };
    if (editingSkill.value) {
      await learning.patch(`/admin/assistant-skills/${editingSkill.value.id}`, {
        expectedRevision: editingSkill.value.revision,
        ...payload,
      });
    } else {
      await learning.post('/admin/assistant-skills', { name: skillForm.name, ...payload });
    }
    learning.notify.success(t('management.assistant.saved'));
    dialog.value = null;
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}

type DeleteTarget = { kind: 'provider' | 'mcp' | 'skill'; id: string; name: string };

const pendingDelete = ref<DeleteTarget | null>(null);
const deleteBusy = ref(false);
const deleteOpen = computed({
  get: () => pendingDelete.value !== null,
  set: (value: boolean) => {
    if (!value && !deleteBusy.value) pendingDelete.value = null;
  },
});
const deleteTargetName = computed(() => pendingDelete.value?.name ?? '');

function requestDelete(
  kind: DeleteTarget['kind'],
  item: { id: string; displayName?: string; name?: string },
): void {
  pendingDelete.value = {
    kind,
    id: item.id,
    name: (kind === 'provider' ? item.displayName : item.name) ?? '',
  };
}

async function confirmDelete(): Promise<void> {
  const target = pendingDelete.value;
  if (!target) return;
  deleteBusy.value = true;
  try {
    const path =
      target.kind === 'provider'
        ? `/admin/search-providers/${target.id}`
        : target.kind === 'mcp'
          ? `/admin/mcp-servers/${target.id}`
          : `/admin/assistant-skills/${target.id}`;
    await learning.del(path);
    pendingDelete.value = null;
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  } finally {
    deleteBusy.value = false;
  }
}

async function toggle(
  kind: 'provider' | 'mcp' | 'skill',
  item: SearchProviderView | McpServerView | AssistantSkillView,
): Promise<void> {
  try {
    const path =
      kind === 'provider'
        ? `/admin/search-providers/${item.id}`
        : kind === 'mcp'
          ? `/admin/mcp-servers/${item.id}`
          : `/admin/assistant-skills/${item.id}`;
    await learning.patch(path, {
      expectedRevision: item.revision,
      enabled: !item.enabled,
    });
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  }
}

async function testProvider(provider: SearchProviderView): Promise<void> {
  testing.value = provider.id;
  try {
    const result = await learning.post<{ ok: boolean; error?: string }>(
      `/admin/search-providers/${provider.id}/test`,
      {},
    );
    if (result.ok) learning.notify.success(t('management.assistant.testOk'));
    else learning.notify.warning(t('management.assistant.testFailed'), result.error);
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.testFailed'), errorMessage(reason));
  } finally {
    testing.value = '';
  }
}
</script>

<template>
  <div>
    <PageHeader :title="t('management.assistant.title')" />
    <div v-if="loading" class="loading-block"><span class="spinner"></span></div>
    <EmptyState v-else-if="error" :title="t('management.assistant.loadFailed')">
      <p>{{ error }}</p>
      <button class="button button--small" type="button" @click="load(true)">
        {{ t('learning.common.retry') }}
      </button>
    </EmptyState>
    <TabsRoot v-else default-value="search" class="tabs">
      <TabsList class="tabs-list" aria-label="assistant settings">
        <TabsTrigger class="tabs-trigger" value="search">{{
          t('management.assistant.tabSearch')
        }}</TabsTrigger>
        <TabsTrigger class="tabs-trigger" value="mcp">{{
          t('management.assistant.tabMcp')
        }}</TabsTrigger>
        <TabsTrigger class="tabs-trigger" value="skills">{{
          t('management.assistant.tabSkills')
        }}</TabsTrigger>
      </TabsList>

      <!-- 搜索服务 -->
      <TabsContent value="search" class="tabs-content settings-card">
        <div class="settings-card__toolbar">
          <p class="field-hint">{{ t('management.assistant.searchHint') }}</p>
          <button class="button button--primary" type="button" @click="openCreate('provider')">
            {{ t('management.assistant.create') }}
          </button>
        </div>
        <table v-if="providers.length" class="table-secondary">
          <thead>
            <tr>
              <th>{{ t('management.assistant.displayName') }}</th>
              <th>{{ t('management.assistant.searchKind') }}</th>
              <th>{{ t('management.assistant.enabled') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="provider in providers" :key="provider.id">
              <td>
                {{ provider.displayName }}
                <span v-if="provider.testError" class="badge badge--red">{{
                  provider.testError
                }}</span>
              </td>
              <td>{{ provider.kind }}</td>
              <td>
                <span class="badge" :class="provider.enabled ? 'badge--green' : ''">{{
                  provider.enabled
                    ? t('management.assistant.enabledOn')
                    : t('management.assistant.enabledOff')
                }}</span>
              </td>
              <td>
                <div class="button-row">
                  <button
                    class="button button--small"
                    type="button"
                    :disabled="testing === provider.id"
                    @click="testProvider(provider)"
                  >
                    {{ t('management.assistant.test') }}
                  </button>
                  <button
                    class="button button--small"
                    type="button"
                    @click="openEdit('provider', provider.id)"
                  >
                    {{ t('management.assistant.edit') }}
                  </button>
                  <button
                    class="button button--small"
                    type="button"
                    @click="toggle('provider', provider)"
                  >
                    {{
                      provider.enabled
                        ? t('management.assistant.disable')
                        : t('management.assistant.enable')
                    }}
                  </button>
                  <button
                    class="button button--small button--danger"
                    type="button"
                    @click="requestDelete('provider', provider)"
                  >
                    {{ t('management.assistant.remove') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-else :title="t('management.assistant.searchEmpty')" />
      </TabsContent>

      <!-- MCP 服务器 -->
      <TabsContent value="mcp" class="tabs-content settings-card">
        <div class="settings-card__toolbar">
          <p class="field-hint">{{ t('management.assistant.mcpHint') }}</p>
          <button class="button button--primary" type="button" @click="openCreate('mcp')">
            {{ t('management.assistant.create') }}
          </button>
        </div>
        <table v-if="mcpServers.length" class="table-secondary">
          <thead>
            <tr>
              <th>{{ t('management.assistant.mcpName') }}</th>
              <th>Transport</th>
              <th>{{ t('management.assistant.enabled') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="server in mcpServers" :key="server.id">
              <td>
                {{ server.name }}
                <span v-if="server.testError" class="badge badge--red">{{ server.testError }}</span>
              </td>
              <td>{{ server.transport }}</td>
              <td>
                <span class="badge" :class="server.enabled ? 'badge--green' : ''">{{
                  server.enabled
                    ? t('management.assistant.enabledOn')
                    : t('management.assistant.enabledOff')
                }}</span>
              </td>
              <td>
                <div class="button-row">
                  <button
                    class="button button--small"
                    type="button"
                    @click="openEdit('mcp', server.id)"
                  >
                    {{ t('management.assistant.edit') }}
                  </button>
                  <button class="button button--small" type="button" @click="toggle('mcp', server)">
                    {{
                      server.enabled
                        ? t('management.assistant.disable')
                        : t('management.assistant.enable')
                    }}
                  </button>
                  <button
                    class="button button--small button--danger"
                    type="button"
                    @click="requestDelete('mcp', server)"
                  >
                    {{ t('management.assistant.remove') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-else :title="t('management.assistant.mcpEmpty')" />
      </TabsContent>

      <!-- Skills -->
      <TabsContent value="skills" class="tabs-content settings-card">
        <div class="settings-card__toolbar">
          <p class="field-hint">{{ t('management.assistant.skillHint') }}</p>
          <button class="button button--primary" type="button" @click="openCreate('skill')">
            {{ t('management.assistant.create') }}
          </button>
        </div>
        <table v-if="skills.length" class="table-secondary">
          <thead>
            <tr>
              <th>{{ t('management.assistant.skillName') }}</th>
              <th>{{ t('management.assistant.skillDescription') }}</th>
              <th>{{ t('management.assistant.enabled') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="skill in skills" :key="skill.id">
              <td>{{ skill.name }}</td>
              <td class="table-secondary__clamp">{{ skill.description }}</td>
              <td>
                <span class="badge" :class="skill.enabled ? 'badge--green' : ''">{{
                  skill.enabled
                    ? t('management.assistant.enabledOn')
                    : t('management.assistant.enabledOff')
                }}</span>
              </td>
              <td>
                <div class="button-row">
                  <button
                    class="button button--small"
                    type="button"
                    @click="openEdit('skill', skill.id)"
                  >
                    {{ t('management.assistant.edit') }}
                  </button>
                  <button
                    class="button button--small"
                    type="button"
                    @click="toggle('skill', skill)"
                  >
                    {{
                      skill.enabled
                        ? t('management.assistant.disable')
                        : t('management.assistant.enable')
                    }}
                  </button>
                  <button
                    class="button button--small button--danger"
                    type="button"
                    @click="requestDelete('skill', skill)"
                  >
                    {{ t('management.assistant.remove') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-else :title="t('management.assistant.skillEmpty')" />
      </TabsContent>
    </TabsRoot>

    <!-- 搜索服务弹窗：创建与编辑共用 -->
    <ConfirmDialog
      v-model:open="dialogOpen"
      :title="dialogTitle"
      :busy="busy"
      :confirm-label="t('management.assistant.save')"
      @confirm="dialog?.kind === 'provider' && saveProvider()"
    >
      <div v-if="dialog?.kind === 'provider'" class="form-grid">
        <AppFormField id="search-kind" :label="t('management.assistant.searchKind')">
          <AppSelect id="search-kind" v-model="providerForm.kind" :items="searchKindOptions" />
        </AppFormField>
        <AppFormField id="search-name" :label="t('management.assistant.displayName')">
          <input id="search-name" v-model="providerForm.displayName" class="input" />
        </AppFormField>
        <AppFormField id="search-url" label="Base URL" class="form-field--full">
          <input
            id="search-url"
            v-model="providerForm.baseUrl"
            class="input"
            :placeholder="t('management.assistant.baseUrlHint')"
          />
        </AppFormField>
        <AppFormField
          v-if="providerForm.kind === 'openai_responses'"
          id="search-model"
          label="Model"
        >
          <input id="search-model" v-model="providerForm.modelKey" class="input" />
        </AppFormField>
        <AppFormField v-if="providerForm.kind !== 'searxng'" id="search-key" label="API Key">
          <input
            id="search-key"
            v-model="providerForm.apiKey"
            class="input"
            type="password"
            :placeholder="editingProvider ? t('management.assistant.apiKeyKeep') : ''"
          />
        </AppFormField>
        <div class="form-field form-field--full">
          <AppCheckbox v-model="providerForm.enabled">
            {{ t('management.assistant.enabledOn') }}
          </AppCheckbox>
        </div>
      </div>
    </ConfirmDialog>

    <!-- MCP 弹窗：创建与编辑共用 -->
    <ConfirmDialog
      v-model:open="dialogOpen"
      :title="dialogTitle"
      :busy="busy"
      :confirm-label="t('management.assistant.save')"
      @confirm="dialog?.kind === 'mcp' && saveMcp()"
    >
      <div v-if="dialog?.kind === 'mcp'" class="form-grid">
        <AppFormField id="mcp-name" :label="t('management.assistant.mcpName')">
          <input
            id="mcp-name"
            v-model="mcpForm.name"
            class="input"
            :disabled="Boolean(editingMcp)"
          />
        </AppFormField>
        <AppFormField id="mcp-transport" label="Transport">
          <AppSelect id="mcp-transport" v-model="mcpForm.transport" :items="mcpTransportOptions" />
        </AppFormField>
        <template v-if="mcpForm.transport === 'stdio'">
          <AppFormField id="mcp-command" label="Command">
            <input id="mcp-command" v-model="mcpForm.command" class="input" />
          </AppFormField>
          <AppFormField id="mcp-args" label="Args">
            <input id="mcp-args" v-model="mcpForm.args" class="input" placeholder="npx -y server" />
          </AppFormField>
          <AppFormField
            id="mcp-env"
            label="ENV"
            class="form-field--full"
            :hint="editingMcp?.envConfigured ? t('management.assistant.secretKeepHint') : undefined"
          >
            <textarea
              id="mcp-env"
              v-model="mcpForm.env"
              class="input"
              rows="2"
              placeholder="KEY=value"
            ></textarea>
          </AppFormField>
          <div v-if="editingMcp?.envConfigured" class="form-field form-field--full">
            <AppCheckbox v-model="mcpForm.clearEnv">
              {{ t('management.assistant.mcpClearEnv') }}
            </AppCheckbox>
          </div>
        </template>
        <template v-else>
          <AppFormField id="mcp-url" label="URL" class="form-field--full">
            <input id="mcp-url" v-model="mcpForm.url" class="input" />
          </AppFormField>
          <AppFormField
            id="mcp-headers"
            label="Headers"
            class="form-field--full"
            :hint="
              editingMcp?.headersConfigured ? t('management.assistant.secretKeepHint') : undefined
            "
          >
            <textarea
              id="mcp-headers"
              v-model="mcpForm.headers"
              class="input"
              rows="2"
              placeholder="Authorization: Bearer ..."
            ></textarea>
          </AppFormField>
          <div v-if="editingMcp?.headersConfigured" class="form-field form-field--full">
            <AppCheckbox v-model="mcpForm.clearHeaders">
              {{ t('management.assistant.mcpClearHeaders') }}
            </AppCheckbox>
          </div>
        </template>
        <AppFormField id="mcp-timeout" :label="t('management.assistant.mcpTimeout')">
          <input
            id="mcp-timeout"
            v-model.number="mcpForm.timeoutSeconds"
            class="input"
            type="number"
            min="5"
            max="600"
          />
        </AppFormField>
        <AppFormField id="mcp-exposure" label="Exposure">
          <AppSelect id="mcp-exposure" v-model="mcpForm.exposure" :items="mcpExposureOptions" />
        </AppFormField>
        <div class="form-field form-field--full">
          <AppCheckbox v-model="mcpForm.enabled">
            {{ t('management.assistant.enabledOn') }}
          </AppCheckbox>
        </div>
      </div>
    </ConfirmDialog>

    <!-- Skill 弹窗：创建与编辑共用 -->
    <ConfirmDialog
      v-model:open="dialogOpen"
      :title="dialogTitle"
      :busy="busy"
      :confirm-label="t('management.assistant.save')"
      @confirm="dialog?.kind === 'skill' && saveSkill()"
    >
      <div v-if="dialog?.kind === 'skill'" class="form-grid">
        <AppFormField
          id="skill-name"
          :label="t('management.assistant.skillName')"
          :hint="editingSkill ? t('management.assistant.skillNameImmutable') : undefined"
        >
          <input
            id="skill-name"
            v-model="skillForm.name"
            class="input"
            placeholder="exam-review"
            :disabled="Boolean(editingSkill)"
          />
        </AppFormField>
        <div class="form-field">
          <AppCheckbox v-model="skillForm.enabled">
            {{ t('management.assistant.enabledOn') }}
          </AppCheckbox>
        </div>
        <AppFormField
          id="skill-desc"
          :label="t('management.assistant.skillDescription')"
          class="form-field--full"
        >
          <input id="skill-desc" v-model="skillForm.description" class="input" />
        </AppFormField>
        <AppFormField
          id="skill-content"
          :label="t('management.assistant.skillContent')"
          class="form-field--full"
        >
          <textarea
            id="skill-content"
            v-model="skillForm.content"
            class="input"
            rows="8"
          ></textarea>
        </AppFormField>
      </div>
    </ConfirmDialog>

    <!-- 删除确认 -->
    <ConfirmDialog
      v-model:open="deleteOpen"
      :title="t('management.assistant.deleteTitle')"
      :description="t('management.assistant.deleteDescription', { name: deleteTargetName })"
      :confirm-label="t('management.assistant.remove')"
      danger
      :busy="deleteBusy"
      @confirm="confirmDelete"
    />
  </div>
</template>
