<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UserView } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import type { PasswordResetResult } from '../types';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import AppScrollArea from '../components/AppScrollArea.vue';

const { t } = useI18n();
const learning = useLearning();
const users = ref<UserView[]>([]);
const loading = ref(true);
const error = ref('');
const createOpen = ref(false);
const creating = ref(false);
const username = ref('');
const displayName = ref('');
const password = ref('');
const statusUser = ref<UserView | null>(null);
const changingStatus = ref(false);
const resettingUser = ref<UserView | null>(null);
const resetting = ref(false);
const temporaryPassword = ref('');
const secretOpen = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    users.value = await learning.get<UserView[]>('/admin/users');
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('management.users.loadFailed'), error.value);
  } finally {
    loading.value = false;
  }
}
async function createUser() {
  creating.value = true;
  error.value = '';
  try {
    const createdUsername = username.value;
    await learning.post<UserView>('/admin/users', {
      username: createdUsername,
      password: password.value,
      displayName: displayName.value,
    });
    createOpen.value = false;
    username.value = '';
    displayName.value = '';
    password.value = '';
    learning.notify.success(t('management.users.created'), createdUsername);
    await load();
  } catch (reason) {
    learning.notify.error(t('management.users.createFailed'), errorMessage(reason));
  } finally {
    creating.value = false;
  }
}
async function changeStatus() {
  if (!statusUser.value) return;
  changingStatus.value = true;
  error.value = '';
  try {
    const status = statusUser.value.status === 'active' ? 'disabled' : 'active';
    await learning.patch(`/admin/users/${statusUser.value.id}/status`, {
      status,
      expectedRevision: statusUser.value.revision,
    });
    learning.notify.success(
      status === 'active' ? t('management.users.enabled') : t('management.users.disabled'),
    );
    statusUser.value = null;
    await load();
  } catch (reason) {
    learning.notify.error(t('management.users.statusFailed'), errorMessage(reason));
  } finally {
    changingStatus.value = false;
  }
}
async function resetPassword() {
  if (!resettingUser.value) return;
  resetting.value = true;
  error.value = '';
  try {
    const result = await learning.post<PasswordResetResult>(
      `/admin/users/${resettingUser.value.id}/reset-password`,
      {},
    );
    const value = result.temporaryPassword ?? result.password;
    if (!value) throw new Error(t('management.users.missingPassword'));
    temporaryPassword.value = value;
    secretOpen.value = true;
    learning.notify.success(t('management.users.resetDone'), t('management.users.resetDoneDesc'));
    resettingUser.value = null;
    await load();
  } catch (reason) {
    learning.notify.error(t('management.users.resetFailed'), errorMessage(reason));
  } finally {
    resetting.value = false;
  }
}
function closeSecret(open: boolean) {
  secretOpen.value = open;
  if (!open) temporaryPassword.value = '';
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('management.users.title')"
      eyebrow="ADMINISTRATION"
      :description="t('management.users.description')"
    >
      <template #actions
        ><button class="button button--primary" type="button" @click="createOpen = true">
          <AppIcon name="plus" :size="17" />{{ t('management.users.create') }}
        </button></template
      >
    </PageHeader>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('management.users.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('management.users.loadFailed')"
      :description="t('management.common.networkRetry')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('management.common.retry') }}
      </button></EmptyState
    >
    <AppScrollArea v-else class="paper-panel table-wrap" orientation="horizontal" type="auto">
      <table class="data-table responsive-table">
        <thead>
          <tr>
            <th>{{ t('management.users.col.account') }}</th>
            <th>{{ t('management.users.col.role') }}</th>
            <th>{{ t('management.users.col.status') }}</th>
            <th>{{ t('management.users.col.createdAt') }}</th>
            <th>
              <span class="sr-only">{{ t('management.common.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td :data-label="t('management.users.col.account')">
              <span class="table-primary">{{ user.displayName }}</span
              ><span class="table-secondary">{{ user.username }}</span>
            </td>
            <td :data-label="t('management.users.col.role')">
              {{
                user.role === 'admin'
                  ? t('management.users.role.admin')
                  : t('management.users.role.learner')
              }}
            </td>
            <td :data-label="t('management.users.col.status')">
              <span
                class="badge"
                :class="user.status === 'active' ? 'badge--green' : 'badge--red'"
                >{{
                  user.status === 'active'
                    ? t('management.users.status.active')
                    : t('management.users.status.disabled')
                }}</span
              >
            </td>
            <td :data-label="t('management.users.col.createdAt')">
              {{ formatDate(user.createdAt) }}
            </td>
            <td>
              <div class="table-actions">
                <button class="button button--small" type="button" @click="resettingUser = user">
                  {{ t('management.users.action.reset') }}
                </button>
                <button
                  v-if="user.id !== learning.state.user?.id"
                  class="button button--small"
                  :class="user.status === 'active' ? 'button--danger' : ''"
                  type="button"
                  @click="statusUser = user"
                >
                  {{
                    user.status === 'active'
                      ? t('management.users.action.disable')
                      : t('management.users.action.enable')
                  }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </AppScrollArea>
    <ConfirmDialog
      v-model:open="createOpen"
      :title="t('management.users.createTitle')"
      :description="t('management.users.createDesc')"
      :confirm-label="t('management.users.createConfirm')"
      :busy="creating"
      @confirm="createUser"
      ><div class="form-grid">
        <div class="form-field form-field--full">
          <label for="new-user-name">{{ t('management.users.field.displayName') }}</label
          ><input id="new-user-name" v-model="displayName" class="input" required />
        </div>
        <div class="form-field form-field--full">
          <label for="new-user-username">{{ t('management.users.field.username') }}</label
          ><input
            id="new-user-username"
            v-model="username"
            class="input"
            autocomplete="off"
            required
          />
        </div>
        <div class="form-field form-field--full">
          <label for="new-user-password">{{ t('management.users.field.password') }}</label
          ><input
            id="new-user-password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="new-password"
            minlength="4"
            required
          />
        </div></div
    ></ConfirmDialog>
    <ConfirmDialog
      :open="Boolean(statusUser)"
      :title="
        statusUser?.status === 'active'
          ? t('management.users.disableTitle')
          : t('management.users.enableTitle')
      "
      :description="
        statusUser?.status === 'active'
          ? t('management.users.disableDesc')
          : t('management.users.enableDesc')
      "
      :confirm-label="
        statusUser?.status === 'active'
          ? t('management.users.disableConfirm')
          : t('management.users.enableConfirm')
      "
      :danger="statusUser?.status === 'active'"
      :busy="changingStatus"
      @update:open="!$event && (statusUser = null)"
      @confirm="changeStatus"
    />
    <ConfirmDialog
      :open="Boolean(resettingUser)"
      :title="t('management.users.resetTitle')"
      :description="
        resettingUser ? t('management.users.resetDesc', { name: resettingUser.displayName }) : ''
      "
      :confirm-label="t('management.users.resetConfirm')"
      danger
      :busy="resetting"
      @update:open="!$event && (resettingUser = null)"
      @confirm="resetPassword"
    />
    <ConfirmDialog
      :open="secretOpen"
      :title="t('management.users.secretTitle')"
      :description="t('management.users.secretDesc')"
      :confirm-label="t('management.users.secretConfirm')"
      :cancel-label="t('management.users.secretCancel')"
      @update:open="closeSecret"
      @confirm="closeSecret(false)"
      ><div class="secret-box">
        <strong>{{ t('management.users.secretLabel') }}</strong
        ><code>{{ temporaryPassword }}</code>
      </div></ConfirmDialog
    >
  </div>
</template>
