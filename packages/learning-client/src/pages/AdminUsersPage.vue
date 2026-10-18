<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { UserView } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import type { PasswordResetResult } from '../types';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import AppScrollArea from '../components/AppScrollArea.vue';

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
    learning.notify.error('账号读取失败', error.value);
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
    learning.notify.success('学习账号已创建', createdUsername);
    await load();
  } catch (reason) {
    learning.notify.error('创建学习账号失败', errorMessage(reason));
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
    learning.notify.success(status === 'active' ? '账号已启用' : '账号已停用');
    statusUser.value = null;
    await load();
  } catch (reason) {
    learning.notify.error('更新账号状态失败', errorMessage(reason));
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
    if (!value) throw new Error('服务器未返回一次性临时密码');
    temporaryPassword.value = value;
    secretOpen.value = true;
    learning.notify.success('账号密码已重置', '请安全交付一次性临时密码。');
    resettingUser.value = null;
    await load();
  } catch (reason) {
    learning.notify.error('重置账号密码失败', errorMessage(reason));
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
      title="账号管理"
      eyebrow="ADMINISTRATION"
      description="创建独立学习账号、启停访问与重置密码。首版不开放公开注册，也没有默认管理员密码。"
    >
      <template #actions
        ><button class="button button--primary" type="button" @click="createOpen = true">
          <AppIcon name="plus" :size="17" />创建账号
        </button></template
      >
    </PageHeader>
    <div v-if="loading" class="loading-block"><span class="spinner" />正在读取账号</div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      title="账号读取失败"
      description="请检查网络连接后重试。"
      ><button class="button button--small" type="button" @click="load">重试</button></EmptyState
    >
    <AppScrollArea v-else class="paper-panel table-wrap" orientation="horizontal" type="auto">
      <table class="data-table responsive-table">
        <thead>
          <tr>
            <th>账号</th>
            <th>角色</th>
            <th>状态</th>
            <th>创建时间</th>
            <th><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td data-label="账号">
              <span class="table-primary">{{ user.displayName }}</span
              ><span class="table-secondary">{{ user.username }}</span>
            </td>
            <td data-label="角色">{{ user.role === 'admin' ? '管理员' : '学习者' }}</td>
            <td data-label="状态">
              <span
                class="badge"
                :class="user.status === 'active' ? 'badge--green' : 'badge--red'"
                >{{ user.status === 'active' ? '正常' : '已停用' }}</span
              >
            </td>
            <td data-label="创建时间">{{ formatDate(user.createdAt) }}</td>
            <td>
              <div class="table-actions">
                <button class="button button--small" type="button" @click="resettingUser = user">
                  重置密码</button
                ><button
                  v-if="user.id !== learning.state.user?.id"
                  class="button button--small"
                  :class="user.status === 'active' ? 'button--danger' : ''"
                  type="button"
                  @click="statusUser = user"
                >
                  {{ user.status === 'active' ? '停用' : '启用' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </AppScrollArea>
    <ConfirmDialog
      v-model:open="createOpen"
      title="创建学习账号"
      description="由管理员设置初始密码；用户可直接使用该密码登录，也可稍后自行修改。不要在代码或页面中预置密码。"
      confirm-label="创建账号"
      :busy="creating"
      @confirm="createUser"
      ><div class="form-grid">
        <div class="form-field form-field--full">
          <label for="new-user-name">显示名称</label
          ><input id="new-user-name" v-model="displayName" class="input" required />
        </div>
        <div class="form-field form-field--full">
          <label for="new-user-username">用户名</label
          ><input
            id="new-user-username"
            v-model="username"
            class="input"
            autocomplete="off"
            required
          />
        </div>
        <div class="form-field form-field--full">
          <label for="new-user-password">初始密码</label
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
      :title="statusUser?.status === 'active' ? '停用这个账号？' : '重新启用账号？'"
      :description="
        statusUser?.status === 'active'
          ? '停用后访问权限立即受服务端限制，学习数据与历史不会删除。'
          : '启用后该用户可重新登录自己的学习空间。'
      "
      :confirm-label="statusUser?.status === 'active' ? '确认停用' : '确认启用'"
      :danger="statusUser?.status === 'active'"
      :busy="changingStatus"
      @update:open="!$event && (statusUser = null)"
      @confirm="changeStatus"
    />
    <ConfirmDialog
      :open="Boolean(resettingUser)"
      title="重置账号密码？"
      :description="
        resettingUser ? `将为「${resettingUser.displayName}」生成新密码，原密码会立即失效。` : ''
      "
      confirm-label="重置密码"
      danger
      :busy="resetting"
      @update:open="!$event && (resettingUser = null)"
      @confirm="resetPassword"
    />
    <ConfirmDialog
      :open="secretOpen"
      title="保存重置后的密码"
      description="完整密码只显示这一次。关闭后请通过安全渠道交给对应用户。"
      confirm-label="我已保存"
      cancel-label="关闭"
      @update:open="closeSecret"
      @confirm="closeSecret(false)"
      ><div class="secret-box">
        <strong>新密码</strong><code>{{ temporaryPassword }}</code>
      </div></ConfirmDialog
    >
  </div>
</template>
