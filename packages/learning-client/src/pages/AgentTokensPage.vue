<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import {
  AGENT_SCOPES,
  type AgentTokenScopesUpdate,
  type AgentTokenSecret,
  type AgentTokenView,
  type Scope,
} from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { scopeLabels, type AgentTokenCreated } from '../types';
import { copyTextToClipboard, errorMessage, formatDate, isApiError } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import AgentSetupHelp from '../components/AgentSetupHelp.vue';
import AppCheckbox from '../components/AppCheckbox.vue';
import AppDateTimePicker from '../components/AppDateTimePicker.vue';
import AppScrollArea from '../components/AppScrollArea.vue';

const learning = useLearning();
const tokens = ref<AgentTokenView[]>([]);
const loading = ref(true);
const error = ref('');
const createOpen = ref(false);
const creating = ref(false);
const editing = ref<AgentTokenView | null>(null);
const editScopes = ref<Scope[]>([]);
const savingScopes = ref(false);
const name = ref('');
const scopes = ref<Scope[]>([...AGENT_SCOPES]);
const scopesOpen = ref(false);
const expiresAt = ref('');
const selected = ref<AgentTokenView | null>(null);
const revoking = ref(false);
const secret = ref('');
const secretOpen = ref(false);
const copied = ref(false);
const copyingTokenId = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    tokens.value = await learning.get<AgentTokenView[]>('/me/agent-tokens');
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error('Agent 授权读取失败', error.value);
  } finally {
    loading.value = false;
  }
}
function openCreate() {
  scopes.value = [...AGENT_SCOPES];
  scopesOpen.value = false;
  createOpen.value = true;
}
async function create() {
  if (!name.value.trim() || !scopes.value.length) {
    learning.notify.warning('无法创建令牌', '请填写令牌名称并至少选择一项权限。');
    return;
  }
  creating.value = true;
  try {
    const result = await learning.post<AgentTokenCreated>('/me/agent-tokens', {
      name: name.value.trim(),
      scopes: scopes.value,
      expiresAt: expiresAt.value ? new Date(expiresAt.value).toISOString() : null,
    });
    if (typeof result.token !== 'string' || !result.token)
      throw new Error('服务器未返回 Agent 令牌');
    secret.value = result.token;
    secretOpen.value = true;
    copied.value = false;
    createOpen.value = false;
    name.value = '';
    scopes.value = [...AGENT_SCOPES];
    expiresAt.value = '';
    learning.notify.success('Agent 令牌已创建', '请妥善保存，之后也可在授权列表复制。');
    await load();
  } catch (reason) {
    learning.notify.error('创建 Agent 令牌失败', errorMessage(reason));
  } finally {
    creating.value = false;
  }
}
function toggleScope(scope: Scope) {
  scopes.value = scopes.value.includes(scope)
    ? scopes.value.filter((item) => item !== scope)
    : [...scopes.value, scope];
}
function openEdit(token: AgentTokenView) {
  editing.value = token;
  editScopes.value = [...token.scopes];
}
function toggleEditScope(scope: Scope) {
  editScopes.value = editScopes.value.includes(scope)
    ? editScopes.value.filter((item) => item !== scope)
    : [...editScopes.value, scope];
}
async function saveScopes() {
  if (!editing.value || savingScopes.value) return;
  if (!editScopes.value.length) {
    learning.notify.warning('无法保存权限', '请至少选择一项权限。');
    return;
  }
  savingScopes.value = true;
  try {
    const body: AgentTokenScopesUpdate = {
      expectedRevision: editing.value.revision,
      scopes: [...editScopes.value],
    };
    await learning.patch<AgentTokenView>(`/me/agent-tokens/${editing.value.id}`, body);
    editing.value = null;
    learning.notify.success('Agent 令牌权限已更新', '新权限立即生效，无需更换原密钥。');
    await load();
  } catch (reason) {
    learning.notify.error('更新 Agent 令牌权限失败', errorMessage(reason));
    if (isApiError(reason, 409) || isApiError(reason, 404)) {
      editing.value = null;
      await load();
    }
  } finally {
    savingScopes.value = false;
  }
}
async function revoke() {
  if (!selected.value) return;
  revoking.value = true;
  try {
    await learning.post(`/me/agent-tokens/${selected.value.id}/revoke`, {});
    learning.notify.success('Agent 令牌已撤销并删除');
    selected.value = null;
    await load();
  } catch (reason) {
    learning.notify.error('撤销 Agent 令牌失败', errorMessage(reason));
  } finally {
    revoking.value = false;
  }
}
function isTokenExpired(token: AgentTokenView) {
  return Boolean(token.expiresAt && Date.parse(token.expiresAt) <= Date.now());
}
async function writeSecretToClipboard() {
  if (await copyTextToClipboard(secret.value)) {
    copied.value = true;
    learning.notify.success('令牌已复制');
    return true;
  }
  copied.value = false;
  learning.notify.error('无法访问剪贴板', '请在弹窗中手动复制令牌并保存到受控 Agent 配置中。');
  return false;
}
async function copySecret() {
  await writeSecretToClipboard();
}
async function copyTokenSecret(token: AgentTokenView) {
  if (copyingTokenId.value) return;
  copyingTokenId.value = token.id;
  try {
    const result = await learning.post<AgentTokenSecret>(`/me/agent-tokens/${token.id}/reveal`, {});
    if (typeof result.token !== 'string' || !result.token)
      throw new Error('服务器未返回 Agent 令牌');
    secret.value = result.token;
    copied.value = false;
    if (await writeSecretToClipboard()) secret.value = '';
    else secretOpen.value = true;
  } catch (reason) {
    learning.notify.error('复制 Agent 令牌失败', errorMessage(reason));
  } finally {
    copyingTokenId.value = null;
  }
}
function closeSecret(open: boolean) {
  secretOpen.value = open;
  if (!open) {
    secret.value = '';
    copied.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="Agent 授权" eyebrow="AGENT ACCESS" description="管理外部 Agent 的访问令牌。">
      <template #back
        ><RouterLink class="back-link" :to="{ name: 'settings' }"
          ><AppIcon name="back" :size="16" />我的设置</RouterLink
        ></template
      >
      <template #actions
        ><button class="button button--primary" type="button" @click="openCreate()">
          <AppIcon name="plus" :size="17" />新建令牌
        </button></template
      >
    </PageHeader>
    <AgentSetupHelp />
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取授权</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="Agent 授权读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
    >
    <AppScrollArea
      v-else-if="tokens.length"
      class="paper-panel table-wrap"
      orientation="horizontal"
      type="auto"
    >
      <table class="data-table responsive-table">
        <thead>
          <tr>
            <th>名称与前缀</th>
            <th>权限</th>
            <th>有效期</th>
            <th>最近使用</th>
            <th>状态</th>
            <th><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="token in tokens" :key="token.id">
            <td data-label="令牌">
              <span class="table-primary">{{ token.name }}</span
              ><span class="table-secondary">{{ token.prefix }}…</span>
            </td>
            <td data-label="权限">
              <div class="tag-list">
                <span
                  v-for="scope in token.scopes"
                  :key="scope"
                  class="badge"
                  :title="scopeLabels[scope]"
                  >{{ scope }}</span
                >
              </div>
            </td>
            <td data-label="有效期">
              {{ token.expiresAt ? formatDate(token.expiresAt) : '无固定期限' }}
            </td>
            <td data-label="最近使用">{{ formatDate(token.lastUsedAt) }}</td>
            <td data-label="状态">
              <span class="badge" :class="isTokenExpired(token) ? 'badge--red' : 'badge--green'">{{
                isTokenExpired(token) ? '已过期' : '有效'
              }}</span>
            </td>
            <td>
              <div class="table-actions">
                <button
                  v-if="!isTokenExpired(token)"
                  class="button button--small"
                  type="button"
                  :disabled="Boolean(copyingTokenId)"
                  @click="copyTokenSecret(token)"
                >
                  <span v-if="copyingTokenId === token.id" class="spinner" />{{
                    copyingTokenId === token.id ? '复制中…' : '复制密钥'
                  }}
                </button>
                <button class="button button--small" type="button" @click="openEdit(token)">
                  编辑权限
                </button>
                <button
                  class="button button--small button--danger"
                  type="button"
                  @click="selected = token"
                >
                  撤销
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </AppScrollArea>
    <EmptyState v-else title="还没有 Agent 令牌" description="创建令牌，授权你信任的 Agent 接入。"
      ><button class="button button--primary" type="button" @click="openCreate()">
        <AppIcon name="plus" :size="17" />创建第一个令牌
      </button></EmptyState
    >
    <ConfirmDialog
      v-model:open="createOpen"
      title="新建 Agent 令牌"
      description="默认授予全部权限，可展开调整。请仅交给你信任的 Agent。"
      confirm-label="创建令牌"
      :busy="creating"
      :confirm-disabled="!name.trim() || !scopes.length"
      @confirm="create"
      ><div class="form-grid">
        <div class="form-field form-field--full">
          <label for="token-name">令牌名称</label
          ><input
            id="token-name"
            v-model="name"
            class="input"
            required
            placeholder="例如：我的学习计划助手"
          />
        </div>
        <div class="form-field form-field--full">
          <label id="token-expiry-label">到期时间（可选）</label>
          <AppDateTimePicker
            id="token-expiry"
            v-model="expiresAt"
            labelled-by="token-expiry-label"
            :disabled="creating"
          />
          <p class="field-hint">留空则无固定期限。</p>
        </div>
        <CollapsibleRoot v-model:open="scopesOpen" class="form-field form-field--full token-scopes">
          <CollapsibleTrigger class="token-scopes-trigger">
            <span
              >权限范围
              <span class="subtle"
                >已选 {{ scopes.length }}/{{ AGENT_SCOPES.length }} 项</span
              ></span
            >
            <AppIcon name="down" :size="16" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <fieldset class="token-scopes-fieldset" :disabled="creating">
              <legend class="sr-only">权限范围</legend>
              <div class="scope-list">
                <AppCheckbox
                  v-for="scope in AGENT_SCOPES"
                  :key="scope"
                  :model-value="scopes.includes(scope)"
                  :disabled="creating"
                  @update:model-value="toggleScope(scope)"
                >
                  <strong>{{ scope }}</strong
                  ><br /><span class="subtle">{{ scopeLabels[scope] }}</span>
                </AppCheckbox>
              </div>
            </fieldset>
          </CollapsibleContent>
        </CollapsibleRoot>
      </div></ConfirmDialog
    >
    <ConfirmDialog
      :open="Boolean(editing)"
      title="编辑 Agent 令牌权限"
      :description="
        editing
          ? `修改「${editing.name}」的权限，保存后立即生效。原密钥、名称和有效期保持不变。`
          : ''
      "
      confirm-label="保存权限"
      :busy="savingScopes"
      :confirm-disabled="!editScopes.length"
      @update:open="!$event && (editing = null)"
      @confirm="saveScopes"
    >
      <fieldset class="form-field" style="border: 0; padding: 0; margin: 0">
        <legend class="field-label" style="margin-bottom: 8px">权限范围（至少选择一项）</legend>
        <div class="scope-list">
          <AppCheckbox
            v-for="scope in AGENT_SCOPES"
            :key="scope"
            :model-value="editScopes.includes(scope)"
            :disabled="savingScopes"
            @update:model-value="toggleEditScope(scope)"
          >
            <strong>{{ scope }}</strong
            ><br /><span class="subtle">{{ scopeLabels[scope] }}</span>
          </AppCheckbox>
        </div>
      </fieldset>
    </ConfirmDialog>
    <ConfirmDialog
      :open="Boolean(selected)"
      title="撤销 Agent 令牌？"
      :description="
        selected ? `「${selected.name}」将立即失效并永久删除，不保留令牌记录，无法恢复。` : ''
      "
      confirm-label="撤销并删除"
      danger
      :busy="revoking"
      @update:open="!$event && (selected = null)"
      @confirm="revoke"
    />
    <ConfirmDialog
      :open="secretOpen"
      title="保存 Agent 令牌"
      description="请保存到你的密码管理器或受控 Agent 配置中；之后仍可从授权列表复制。"
      confirm-label="复制令牌"
      cancel-label="关闭"
      @update:open="closeSecret"
      @confirm="copySecret"
      ><div class="secret-box">
        <strong>Agent Token</strong><code>{{ secret }}</code
        ><span v-if="copied" class="badge badge--green">已复制</span>
      </div></ConfirmDialog
    >
  </div>
</template>

<style scoped>
.token-scopes {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.token-scopes-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.token-scopes-trigger .subtle {
  margin-left: 8px;
}
.token-scopes-trigger[data-state='open'] > .app-icon {
  transform: rotate(180deg);
}
.token-scopes-fieldset {
  margin: 8px 0 0;
  padding: 0;
  border: 0;
}
</style>
