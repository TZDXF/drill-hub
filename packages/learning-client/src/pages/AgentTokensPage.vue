<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import {
  AGENT_SCOPES,
  type AgentTokenScopesUpdate,
  type AgentTokenSecret,
  type AgentTokenView,
  type Scope,
} from '@drill-hub/contracts';
import { useLearning } from '../injection';
import type { AgentTokenCreated } from '../types';
import { copyTextToClipboard, errorMessage, formatDate, isApiError } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import AgentSetupHelp from '../components/AgentSetupHelp.vue';
import AppCheckbox from '../components/AppCheckbox.vue';
import AppDateTimePicker from '../components/AppDateTimePicker.vue';
import AppScrollArea from '../components/AppScrollArea.vue';

const { t } = useI18n();
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

const scopeLabelKeys: Record<Scope, string> = {
  read: 'management.tokens.scope.read',
  'content:write': 'management.tokens.scope.contentWrite',
  'assessment:write': 'management.tokens.scope.assessmentWrite',
  'attempt:write': 'management.tokens.scope.attemptWrite',
  'grading:request': 'management.tokens.scope.gradingRequest',
  'grade:write': 'management.tokens.scope.gradeWrite',
  'archive:write': 'management.tokens.scope.archiveWrite',
};

function scopeDescription(scope: Scope): string {
  return t(scopeLabelKeys[scope]);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    tokens.value = await learning.get<AgentTokenView[]>('/me/agent-tokens');
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('management.tokens.loadError'), error.value);
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
    learning.notify.warning(
      t('management.tokens.createUnavailable'),
      t('management.tokens.createUnavailableDesc'),
    );
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
      throw new Error(t('management.tokens.missingToken'));
    secret.value = result.token;
    secretOpen.value = true;
    copied.value = false;
    createOpen.value = false;
    name.value = '';
    scopes.value = [...AGENT_SCOPES];
    expiresAt.value = '';
    learning.notify.success(t('management.tokens.created'), t('management.tokens.createdDesc'));
    await load();
  } catch (reason) {
    learning.notify.error(t('management.tokens.createFailed'), errorMessage(reason));
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
    learning.notify.warning(
      t('management.tokens.scopeUnavailable'),
      t('management.tokens.scopeUnavailableDesc'),
    );
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
    learning.notify.success(
      t('management.tokens.scopeUpdated'),
      t('management.tokens.scopeUpdatedDesc'),
    );
    await load();
  } catch (reason) {
    learning.notify.error(t('management.tokens.scopeFailed'), errorMessage(reason));
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
    learning.notify.success(t('management.tokens.revoked'));
    selected.value = null;
    await load();
  } catch (reason) {
    learning.notify.error(t('management.tokens.revokeFailed'), errorMessage(reason));
  } finally {
    revoking.value = false;
  }
}
function isTokenExpired(token: AgentTokenView) {
  return Boolean(token.expiresAt && Date.parse(token.expiresAt) <= Date.now());
}
async function writeSecretToClipboard() {
  try {
    await copyTextToClipboard(secret.value);
    copied.value = true;
    learning.notify.success(t('management.tokens.copiedToast'));
    return true;
  } catch {
    copied.value = false;
    learning.notify.error(
      t('management.tokens.clipboardError'),
      t('management.tokens.clipboardErrorDesc'),
    );
    return false;
  }
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
      throw new Error(t('management.tokens.missingToken'));
    secret.value = result.token;
    copied.value = false;
    if (await writeSecretToClipboard()) secret.value = '';
    else secretOpen.value = true;
  } catch (reason) {
    learning.notify.error(t('management.tokens.copyFailed'), errorMessage(reason));
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
    <PageHeader
      :title="t('management.tokens.title')"
      eyebrow="AGENT ACCESS"
      :description="t('management.tokens.description')"
    >
      <template #back
        ><RouterLink class="back-link" :to="{ name: 'settings' }"
          ><AppIcon name="back" :size="16" />{{ t('management.tokens.back') }}</RouterLink
        ></template
      >
      <template #actions
        ><button class="button button--primary" type="button" @click="openCreate()">
          <AppIcon name="plus" :size="17" />{{ t('management.tokens.create') }}
        </button></template
      >
    </PageHeader>
    <AgentSetupHelp />
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('management.tokens.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('management.tokens.loadFailed')"
      :description="t('management.common.networkRetry')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('management.common.retry') }}
      </button></EmptyState
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
            <th>{{ t('management.tokens.col.name') }}</th>
            <th>{{ t('management.tokens.col.scopes') }}</th>
            <th>{{ t('management.tokens.col.expires') }}</th>
            <th>{{ t('management.tokens.col.lastUsed') }}</th>
            <th>{{ t('management.tokens.col.status') }}</th>
            <th>
              <span class="sr-only">{{ t('management.common.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="token in tokens" :key="token.id">
            <td :data-label="t('management.tokens.col.name')">
              <span class="table-primary">{{ token.name }}</span
              ><span class="table-secondary">{{ token.prefix }}…</span>
            </td>
            <td :data-label="t('management.tokens.col.scopes')">
              <div class="tag-list">
                <span
                  v-for="scope in token.scopes"
                  :key="scope"
                  class="badge"
                  :title="scopeDescription(scope)"
                  >{{ scope }}</span
                >
              </div>
            </td>
            <td :data-label="t('management.tokens.col.expires')">
              {{ token.expiresAt ? formatDate(token.expiresAt) : t('management.tokens.noExpiry') }}
            </td>
            <td :data-label="t('management.tokens.col.lastUsed')">
              {{ formatDate(token.lastUsedAt) }}
            </td>
            <td :data-label="t('management.tokens.col.status')">
              <span class="badge" :class="isTokenExpired(token) ? 'badge--red' : 'badge--green'">{{
                isTokenExpired(token)
                  ? t('management.tokens.expired')
                  : t('management.tokens.valid')
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
                    copyingTokenId === token.id
                      ? t('management.tokens.copying')
                      : t('management.tokens.copy')
                  }}
                </button>
                <button class="button button--small" type="button" @click="openEdit(token)">
                  {{ t('management.tokens.editScopes') }}
                </button>
                <button
                  class="button button--small button--danger"
                  type="button"
                  @click="selected = token"
                >
                  {{ t('management.tokens.revoke') }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </AppScrollArea>
    <EmptyState
      v-else
      :title="t('management.tokens.empty')"
      :description="t('management.tokens.emptyDesc')"
      ><button class="button button--primary" type="button" @click="openCreate()">
        <AppIcon name="plus" :size="17" />{{ t('management.tokens.createFirst') }}
      </button></EmptyState
    >
    <ConfirmDialog
      v-model:open="createOpen"
      :title="t('management.tokens.createTitle')"
      :description="t('management.tokens.createDesc')"
      :confirm-label="t('management.tokens.createConfirm')"
      :busy="creating"
      :confirm-disabled="!name.trim() || !scopes.length"
      @confirm="create"
      ><div class="form-grid">
        <div class="form-field form-field--full">
          <label for="token-name">{{ t('management.tokens.field.name') }}</label
          ><input
            id="token-name"
            v-model="name"
            class="input"
            required
            :placeholder="t('management.tokens.field.namePlaceholder')"
          />
        </div>
        <div class="form-field form-field--full">
          <label id="token-expiry-label">{{ t('management.tokens.field.expires') }}</label>
          <AppDateTimePicker
            id="token-expiry"
            v-model="expiresAt"
            labelled-by="token-expiry-label"
            :disabled="creating"
          />
          <p class="field-hint">{{ t('management.tokens.expiresHint') }}</p>
        </div>
        <CollapsibleRoot v-model:open="scopesOpen" class="form-field form-field--full token-scopes">
          <CollapsibleTrigger class="token-scopes-trigger">
            <span
              >{{ t('management.tokens.scopeLabel') }}
              <span class="subtle">{{
                t('management.tokens.scopeSelected', {
                  selected: scopes.length,
                  total: AGENT_SCOPES.length,
                })
              }}</span></span
            >
            <AppIcon name="down" :size="16" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <fieldset class="token-scopes-fieldset" :disabled="creating">
              <legend class="sr-only">{{ t('management.tokens.scopeLegend') }}</legend>
              <div class="scope-list">
                <AppCheckbox
                  v-for="scope in AGENT_SCOPES"
                  :key="scope"
                  :model-value="scopes.includes(scope)"
                  :disabled="creating"
                  @update:model-value="toggleScope(scope)"
                >
                  <strong>{{ scope }}</strong
                  ><br /><span class="subtle">{{ scopeDescription(scope) }}</span>
                </AppCheckbox>
              </div>
            </fieldset>
          </CollapsibleContent>
        </CollapsibleRoot>
      </div></ConfirmDialog
    >
    <ConfirmDialog
      :open="Boolean(editing)"
      :title="t('management.tokens.editTitle')"
      :description="editing ? t('management.tokens.editDesc', { name: editing.name }) : ''"
      :confirm-label="t('management.tokens.editConfirm')"
      :busy="savingScopes"
      :confirm-disabled="!editScopes.length"
      @update:open="!$event && (editing = null)"
      @confirm="saveScopes"
    >
      <fieldset class="form-field" style="border: 0; padding: 0; margin: 0">
        <legend class="field-label" style="margin-bottom: 8px">
          {{ t('management.tokens.scopeLegendRequired') }}
        </legend>
        <div class="scope-list">
          <AppCheckbox
            v-for="scope in AGENT_SCOPES"
            :key="scope"
            :model-value="editScopes.includes(scope)"
            :disabled="savingScopes"
            @update:model-value="toggleEditScope(scope)"
          >
            <strong>{{ scope }}</strong
            ><br /><span class="subtle">{{ scopeDescription(scope) }}</span>
          </AppCheckbox>
        </div>
      </fieldset>
    </ConfirmDialog>
    <ConfirmDialog
      :open="Boolean(selected)"
      :title="t('management.tokens.revokeTitle')"
      :description="selected ? t('management.tokens.revokeDesc', { name: selected.name }) : ''"
      :confirm-label="t('management.tokens.revokeConfirm')"
      danger
      :busy="revoking"
      @update:open="!$event && (selected = null)"
      @confirm="revoke"
    />
    <ConfirmDialog
      :open="secretOpen"
      :title="t('management.tokens.secretTitle')"
      :description="t('management.tokens.secretDesc')"
      :confirm-label="t('management.tokens.secretConfirm')"
      :cancel-label="t('management.tokens.secretCancel')"
      @update:open="closeSecret"
      @confirm="copySecret"
      ><div class="secret-box">
        <strong>Agent Token</strong><code>{{ secret }}</code
        ><span v-if="copied" class="badge badge--green">{{ t('management.tokens.copied') }}</span>
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
