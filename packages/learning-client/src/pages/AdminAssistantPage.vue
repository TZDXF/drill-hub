<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import type {
  AssistantSettingsView,
  AssistantSkillView,
  McpServerView,
  ModelConnectionView,
  ProviderModel,
  SearchProviderView,
} from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage } from '../utils';
import EmptyState from '../components/EmptyState.vue';
import PageHeader from '../components/PageHeader.vue';

const { t } = useI18n();
const learning = useLearning();

const loading = ref(true);
const error = ref('');

const settings = ref<AssistantSettingsView | null>(null);
const connections = ref<ModelConnectionView[]>([]);
const models = ref<ProviderModel[]>([]);
const providers = ref<SearchProviderView[]>([]);
const mcpServers = ref<McpServerView[]>([]);
const skills = ref<AssistantSkillView[]>([]);

const settingsForm = reactive({
  defaultProviderModelId: '',
  maxSearchResults: 5,
  maxConcurrency: 1,
  turnTimeoutMs: 600000,
});

const searchForm = reactive({
  kind: 'tavily',
  displayName: '',
  baseUrl: '',
  modelKey: '',
  apiKey: '',
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
});

const skillForm = reactive({ name: '', description: '', content: '' });

const modelOptions = computed(() =>
  models.value
    .filter((model) => model.enabled)
    .map((model) => ({
      value: model.id,
      label: `${connections.value.find((item) => item.id === model.connectionId)?.displayName ?? model.connectionId} / ${model.displayName}`,
    })),
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    settings.value = await learning.get<AssistantSettingsView>('/admin/assistant-settings');
    settingsForm.defaultProviderModelId = settings.value.defaultProviderModelId ?? '';
    settingsForm.maxSearchResults = settings.value.maxSearchResults;
    settingsForm.maxConcurrency = settings.value.maxConcurrency;
    settingsForm.turnTimeoutMs = settings.value.turnTimeoutMs;
    providers.value = await learning.get<SearchProviderView[]>('/admin/search-providers');
    mcpServers.value = await learning.get<McpServerView[]>('/admin/mcp-servers');
    skills.value = await learning.get<AssistantSkillView[]>('/admin/assistant-skills');
    connections.value = await learning.get<ModelConnectionView[]>('/admin/model-connections');
    const collected: ProviderModel[] = [];
    for (const connection of connections.value) {
      const items = await learning.get<ProviderModel[]>(
        `/admin/model-connections/${connection.id}/models`,
      );
      collected.push(...items);
    }
    models.value = collected;
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function saveSettings(): Promise<void> {
  if (!settings.value) return;
  try {
    settings.value = await learning.patch<AssistantSettingsView>('/admin/assistant-settings', {
      expectedRevision: settings.value.revision,
      defaultProviderModelId: settingsForm.defaultProviderModelId || null,
      maxSearchResults: settingsForm.maxSearchResults,
      maxConcurrency: settingsForm.maxConcurrency,
      turnTimeoutMs: settingsForm.turnTimeoutMs,
    });
    learning.notify.success(t('management.assistant.saved'));
  } catch (reason) {
    learning.notify.error(t('management.assistant.saveFailed'), errorMessage(reason));
  }
}

async function createProvider(): Promise<void> {
  try {
    await learning.post('/admin/search-providers', {
      kind: searchForm.kind,
      displayName: searchForm.displayName,
      baseUrl: searchForm.baseUrl || null,
      modelKey: searchForm.modelKey || null,
      apiKey: searchForm.apiKey || null,
    });
    learning.notify.success(t('management.assistant.searchCreated'));
    searchForm.displayName = '';
    searchForm.baseUrl = '';
    searchForm.modelKey = '';
    searchForm.apiKey = '';
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.createFailed'), errorMessage(reason));
  }
}

async function toggleProvider(provider: SearchProviderView): Promise<void> {
  try {
    await learning.patch(`/admin/search-providers/${provider.id}`, {
      expectedRevision: provider.revision,
      enabled: !provider.enabled,
    });
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  }
}

async function testProvider(provider: SearchProviderView): Promise<void> {
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
  }
}

async function deleteProvider(provider: SearchProviderView): Promise<void> {
  try {
    await learning.del(`/admin/search-providers/${provider.id}`);
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  }
}

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

async function createMcp(): Promise<void> {
  try {
    await learning.post('/admin/mcp-servers', {
      name: mcpForm.name,
      transport: mcpForm.transport,
      command: mcpForm.transport === 'stdio' ? mcpForm.command : null,
      args: mcpForm.args ? mcpForm.args.split(/\s+/).filter(Boolean) : [],
      url: mcpForm.transport === 'http' ? mcpForm.url : null,
      headers: parseKeyValueBlock(mcpForm.headers, ':'),
      env: parseKeyValueBlock(mcpForm.env, '='),
      timeoutSeconds: mcpForm.timeoutSeconds,
      exposure: mcpForm.exposure,
    });
    learning.notify.success(t('management.assistant.mcpCreated'));
    mcpForm.name = '';
    mcpForm.command = '';
    mcpForm.args = '';
    mcpForm.url = '';
    mcpForm.headers = '';
    mcpForm.env = '';
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.createFailed'), errorMessage(reason));
  }
}

async function toggleMcp(server: McpServerView): Promise<void> {
  try {
    await learning.patch(`/admin/mcp-servers/${server.id}`, {
      expectedRevision: server.revision,
      enabled: !server.enabled,
    });
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  }
}

async function deleteMcp(server: McpServerView): Promise<void> {
  try {
    await learning.del(`/admin/mcp-servers/${server.id}`);
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  }
}

async function createSkill(): Promise<void> {
  try {
    await learning.post('/admin/assistant-skills', {
      name: skillForm.name,
      description: skillForm.description,
      content: skillForm.content,
    });
    learning.notify.success(t('management.assistant.skillCreated'));
    skillForm.name = '';
    skillForm.description = '';
    skillForm.content = '';
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.createFailed'), errorMessage(reason));
  }
}

async function toggleSkill(skill: AssistantSkillView): Promise<void> {
  try {
    await learning.patch(`/admin/assistant-skills/${skill.id}`, {
      expectedRevision: skill.revision,
      enabled: !skill.enabled,
    });
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  }
}

async function deleteSkill(skill: AssistantSkillView): Promise<void> {
  try {
    await learning.del(`/admin/assistant-skills/${skill.id}`);
    await load();
  } catch (reason) {
    learning.notify.error(t('management.assistant.updateFailed'), errorMessage(reason));
  }
}
</script>

<template>
  <div>
    <PageHeader :title="t('management.assistant.title')" />
    <div v-if="loading" class="loading-block"><span class="spinner"></span></div>
    <EmptyState v-else-if="error" :title="t('management.assistant.loadFailed')">
      <p>{{ error }}</p>
      <button class="button button--small" type="button" @click="load">
        {{ t('learning.common.retry') }}
      </button>
    </EmptyState>
    <TabsRoot v-else default-value="model" class="tabs">
      <TabsList class="tabs-list" aria-label="assistant settings">
        <TabsTrigger class="tabs-trigger" value="model">{{
          t('management.assistant.tabModel')
        }}</TabsTrigger>
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

      <TabsContent value="model" class="tabs-content settings-card">
        <div class="form-field">
          <label for="assistant-model">{{ t('management.assistant.defaultModel') }}</label>
          <select
            id="assistant-model"
            v-model="settingsForm.defaultProviderModelId"
            class="input"
            data-testid="assistant-model-select"
          >
            <option value="">{{ t('management.assistant.noModel') }}</option>
            <option v-for="option in modelOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <p class="field-hint">{{ t('management.assistant.defaultModelHint') }}</p>
        </div>
        <div class="form-grid">
          <div class="form-field">
            <label for="assistant-search-max">
              {{ t('management.assistant.maxSearchResults') }}
            </label>
            <input
              id="assistant-search-max"
              v-model.number="settingsForm.maxSearchResults"
              class="input"
              type="number"
              min="1"
              max="10"
            />
          </div>
          <div class="form-field">
            <label for="assistant-concurrency">
              {{ t('management.assistant.maxConcurrency') }}
            </label>
            <input
              id="assistant-concurrency"
              v-model.number="settingsForm.maxConcurrency"
              class="input"
              type="number"
              min="1"
              max="4"
            />
          </div>
          <div class="form-field">
            <label for="assistant-timeout">{{ t('management.assistant.turnTimeoutMs') }}</label>
            <input
              id="assistant-timeout"
              v-model.number="settingsForm.turnTimeoutMs"
              class="input"
              type="number"
              min="30000"
              max="900000"
              step="10000"
            />
          </div>
        </div>
        <div class="button-row">
          <button class="button button--primary" type="button" @click="saveSettings">
            {{ t('management.assistant.save') }}
          </button>
        </div>
      </TabsContent>

      <TabsContent value="search" class="tabs-content settings-card">
        <div class="form-grid">
          <div class="form-field">
            <label for="search-kind">{{ t('management.assistant.searchKind') }}</label>
            <select id="search-kind" v-model="searchForm.kind" class="input">
              <option value="tavily">Tavily</option>
              <option value="brave">Brave Search</option>
              <option value="searxng">SearXNG</option>
              <option value="openai_responses">OpenAI Responses</option>
            </select>
          </div>
          <div class="form-field">
            <label for="search-name">{{ t('management.assistant.displayName') }}</label>
            <input id="search-name" v-model="searchForm.displayName" class="input" />
          </div>
          <div class="form-field">
            <label for="search-url">Base URL</label>
            <input
              id="search-url"
              v-model="searchForm.baseUrl"
              class="input"
              :placeholder="t('management.assistant.baseUrlHint')"
            />
          </div>
          <div v-if="searchForm.kind === 'openai_responses'" class="form-field">
            <label for="search-model">Model</label>
            <input id="search-model" v-model="searchForm.modelKey" class="input" />
          </div>
          <div v-if="searchForm.kind !== 'searxng'" class="form-field">
            <label for="search-key">API Key</label>
            <input id="search-key" v-model="searchForm.apiKey" class="input" type="password" />
          </div>
        </div>
        <div class="button-row">
          <button class="button" type="button" @click="createProvider">
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
              <td>{{ provider.displayName }}</td>
              <td>{{ provider.kind }}</td>
              <td>
                <span class="badge" :class="{ 'badge--success': provider.enabled }">{{
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
                    @click="testProvider(provider)"
                  >
                    {{ t('management.assistant.test') }}
                  </button>
                  <button
                    class="button button--small"
                    type="button"
                    @click="toggleProvider(provider)"
                  >
                    {{
                      provider.enabled
                        ? t('management.assistant.disable')
                        : t('management.assistant.enable')
                    }}
                  </button>
                  <button
                    class="button button--small"
                    type="button"
                    @click="deleteProvider(provider)"
                  >
                    {{ t('management.assistant.remove') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </TabsContent>

      <TabsContent value="mcp" class="tabs-content settings-card">
        <p class="field-hint">{{ t('management.assistant.mcpHint') }}</p>
        <div class="form-grid">
          <div class="form-field">
            <label for="mcp-name">{{ t('management.assistant.mcpName') }}</label>
            <input id="mcp-name" v-model="mcpForm.name" class="input" />
          </div>
          <div class="form-field">
            <label for="mcp-transport">Transport</label>
            <select id="mcp-transport" v-model="mcpForm.transport" class="input">
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
          </div>
          <template v-if="mcpForm.transport === 'stdio'">
            <div class="form-field">
              <label for="mcp-command">Command</label>
              <input id="mcp-command" v-model="mcpForm.command" class="input" />
            </div>
            <div class="form-field">
              <label for="mcp-args">Args</label>
              <input
                id="mcp-args"
                v-model="mcpForm.args"
                class="input"
                placeholder="npx -y server"
              />
            </div>
            <div class="form-field">
              <label for="mcp-env">ENV</label>
              <textarea id="mcp-env" v-model="mcpForm.env" class="input" rows="2"></textarea>
            </div>
          </template>
          <template v-else>
            <div class="form-field">
              <label for="mcp-url">URL</label>
              <input id="mcp-url" v-model="mcpForm.url" class="input" />
            </div>
            <div class="form-field">
              <label for="mcp-headers">Headers</label>
              <textarea
                id="mcp-headers"
                v-model="mcpForm.headers"
                class="input"
                rows="2"
                placeholder="Authorization: Bearer ..."
              ></textarea>
            </div>
          </template>
          <div class="form-field">
            <label for="mcp-timeout">Timeout (s)</label>
            <input
              id="mcp-timeout"
              v-model.number="mcpForm.timeoutSeconds"
              class="input"
              type="number"
              min="5"
              max="600"
            />
          </div>
          <div class="form-field">
            <label for="mcp-exposure">Exposure</label>
            <select id="mcp-exposure" v-model="mcpForm.exposure" class="input">
              <option value="direct">direct</option>
              <option value="deferred">deferred</option>
            </select>
          </div>
        </div>
        <div class="button-row">
          <button class="button" type="button" @click="createMcp">
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
              <td>{{ server.name }}</td>
              <td>{{ server.transport }}</td>
              <td>
                <span class="badge" :class="{ 'badge--success': server.enabled }">{{
                  server.enabled
                    ? t('management.assistant.enabledOn')
                    : t('management.assistant.enabledOff')
                }}</span>
              </td>
              <td>
                <div class="button-row">
                  <button class="button button--small" type="button" @click="toggleMcp(server)">
                    {{
                      server.enabled
                        ? t('management.assistant.disable')
                        : t('management.assistant.enable')
                    }}
                  </button>
                  <button class="button button--small" type="button" @click="deleteMcp(server)">
                    {{ t('management.assistant.remove') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </TabsContent>

      <TabsContent value="skills" class="tabs-content settings-card">
        <p class="field-hint">{{ t('management.assistant.skillHint') }}</p>
        <div class="form-field">
          <label for="skill-name">{{ t('management.assistant.skillName') }}</label>
          <input id="skill-name" v-model="skillForm.name" class="input" placeholder="exam-review" />
        </div>
        <div class="form-field">
          <label for="skill-desc">{{ t('management.assistant.skillDescription') }}</label>
          <input id="skill-desc" v-model="skillForm.description" class="input" />
        </div>
        <div class="form-field">
          <label for="skill-content">{{ t('management.assistant.skillContent') }}</label>
          <textarea
            id="skill-content"
            v-model="skillForm.content"
            class="input"
            rows="6"
          ></textarea>
        </div>
        <div class="button-row">
          <button class="button" type="button" @click="createSkill">
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
              <td>{{ skill.description }}</td>
              <td>
                <span class="badge" :class="{ 'badge--success': skill.enabled }">{{
                  skill.enabled
                    ? t('management.assistant.enabledOn')
                    : t('management.assistant.enabledOff')
                }}</span>
              </td>
              <td>
                <div class="button-row">
                  <button class="button button--small" type="button" @click="toggleSkill(skill)">
                    {{
                      skill.enabled
                        ? t('management.assistant.disable')
                        : t('management.assistant.enable')
                    }}
                  </button>
                  <button class="button button--small" type="button" @click="deleteSkill(skill)">
                    {{ t('management.assistant.remove') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </TabsContent>
    </TabsRoot>
  </div>
</template>
