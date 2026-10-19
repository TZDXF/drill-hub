<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { UserView } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import type { SessionView } from '../types';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';

const learning = useLearning();
const router = useRouter();
const displayName = ref(learning.state.user?.displayName ?? '');
const editingProfile = ref(false);
const sessions = ref<SessionView[]>([]);
const loadingSessions = ref(false);
const saving = ref(false);
const sessionsError = ref('');
const selectedSession = ref<SessionView | null>(null);
const revoking = ref(false);
const switchOpen = ref(false);
const switching = ref(false);
const mobileQuery = typeof window === 'undefined' ? null : window.matchMedia('(max-width: 780px)');
const isMobile = ref(learning.platform.kind === 'android' || (mobileQuery?.matches ?? false));
let sessionsRequested = false;

function syncLayout() {
  isMobile.value = learning.platform.kind === 'android' || (mobileQuery?.matches ?? false);
}
function startProfileEdit() {
  displayName.value = learning.state.user?.displayName ?? '';
  editingProfile.value = true;
}
function cancelProfileEdit() {
  displayName.value = learning.state.user?.displayName ?? '';
  editingProfile.value = false;
}
async function loadSessions() {
  sessionsRequested = true;
  loadingSessions.value = true;
  sessionsError.value = '';
  try {
    sessions.value = await learning.get<SessionView[]>('/me/sessions');
  } catch (reason) {
    sessionsError.value = errorMessage(reason);
    learning.notify.error('登录会话读取失败', sessionsError.value);
  } finally {
    loadingSessions.value = false;
  }
}
async function saveProfile() {
  if (!learning.state.user) return;
  saving.value = true;
  try {
    const user = await learning.patch<UserView>('/me', {
      displayName: displayName.value,
      expectedRevision: learning.state.user.revision,
    });
    learning.state.user = user;
    displayName.value = user.displayName;
    editingProfile.value = false;
    learning.notify.success(isMobile.value ? '个人信息已更新' : '个人设置已保存');
  } catch (reason) {
    learning.notify.error(
      isMobile.value ? '保存个人信息失败' : '保存个人设置失败',
      errorMessage(reason),
    );
  } finally {
    saving.value = false;
  }
}
function sessionLabel(session: SessionView) {
  const channel = session.kind ?? session.channel;
  return channel === 'web' ? 'Web 浏览器' : 'Android';
}
async function revokeSession() {
  if (!selectedSession.value) return;
  revoking.value = true;
  try {
    await learning.post(`/me/sessions/${selectedSession.value.id}/revoke`, {});
    learning.notify.success('登录会话已撤销');
    selectedSession.value = null;
    await loadSessions();
  } catch (reason) {
    learning.notify.error('撤销登录会话失败', errorMessage(reason));
  } finally {
    revoking.value = false;
  }
}
async function logout() {
  try {
    await learning.logout();
  } catch (reason) {
    learning.notify.error('退出登录未完成', errorMessage(reason));
  } finally {
    await router.replace({ name: 'login' });
  }
}
async function switchServer() {
  switching.value = true;
  try {
    await learning.disconnect();
    await router.replace({ name: 'connect' });
  } catch (reason) {
    learning.notify.error('切换服务器失败', errorMessage(reason));
  } finally {
    switching.value = false;
    switchOpen.value = false;
  }
}

watch(
  isMobile,
  (mobile) => {
    if (!mobile && !sessionsRequested) void loadSessions();
  },
  { immediate: true },
);
onMounted(() => {
  mobileQuery?.addEventListener('change', syncLayout);
  syncLayout();
});
onBeforeUnmount(() => mobileQuery?.removeEventListener('change', syncLayout));
</script>

<template>
  <div>
    <PageHeader
      :title="isMobile ? '我的' : '我的设置'"
      :eyebrow="isMobile ? 'MY PROFILE' : 'PERSONAL SETTINGS'"
      :description="
        isMobile
          ? '查看个人信息，管理账号与安全设置。'
          : '管理个人资料、登录会话与服务器连接。凭据不会写入 localStorage。'
      "
    />
    <div class="settings-grid" :class="{ 'settings-grid--mobile': isMobile }">
      <section class="card settings-card" aria-labelledby="profile-title">
        <div class="settings-card__heading">
          <span class="list-card__icon"><AppIcon name="user" /></span>
          <h2 id="profile-title">{{ isMobile ? '个人信息' : '个人资料' }}</h2>
        </div>
        <div v-if="isMobile && !editingProfile">
          <button
            class="profile-display"
            type="button"
            aria-label="编辑个人信息"
            @click="startProfileEdit"
          >
            <span class="avatar profile-display__avatar">{{
              learning.state.user?.displayName.slice(0, 1)
            }}</span>
            <span class="profile-display__copy">
              <strong>{{ learning.state.user?.displayName }}</strong>
              <small>@{{ learning.state.user?.username }}</small>
            </span>
            <span class="profile-display__action">编辑<AppIcon name="chevron" :size="16" /></span>
          </button>
          <dl class="definition-list">
            <div>
              <dt>角色</dt>
              <dd>{{ learning.state.user?.role === 'admin' ? '管理员' : '学习者' }}</dd>
            </div>
            <div>
              <dt>账号状态</dt>
              <dd>{{ learning.state.user?.status === 'active' ? '正常' : '已停用' }}</dd>
            </div>
          </dl>
        </div>
        <form v-else @submit.prevent="saveProfile">
          <div class="form-grid">
            <div class="form-field form-field--full">
              <label for="profile-name">显示名称</label>
              <input
                id="profile-name"
                v-model="displayName"
                class="input"
                required
                autocomplete="name"
              />
              <p class="field-hint">时间会按当前设备的时区显示，无需单独设置。</p>
            </div>
          </div>
          <div class="form-actions">
            <button v-if="isMobile" class="button" type="button" @click="cancelProfileEdit">
              取消
            </button>
            <RouterLink v-else class="button" :to="{ name: 'change-password' }">
              修改密码
            </RouterLink>
            <button class="button button--primary" type="submit" :disabled="saving">
              <span v-if="saving" class="spinner" />{{ isMobile ? '保存' : '保存资料' }}
            </button>
          </div>
        </form>
      </section>

      <section class="card settings-card" aria-labelledby="security-title">
        <div class="settings-card__heading">
          <span class="list-card__icon"><AppIcon name="lock" /></span>
          <h2 id="security-title">{{ isMobile ? '账号与安全' : '账号与授权' }}</h2>
        </div>
        <dl v-if="!isMobile" class="definition-list">
          <div>
            <dt>用户名</dt>
            <dd>{{ learning.state.user?.username }}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>{{ learning.state.user?.role === 'admin' ? '管理员' : '学习者' }}</dd>
          </div>
          <div>
            <dt>账号状态</dt>
            <dd>{{ learning.state.user?.status === 'active' ? '正常' : '已停用' }}</dd>
          </div>
        </dl>
        <div v-if="isMobile" class="mobile-setting-list">
          <RouterLink class="mobile-setting-link" :to="{ name: 'change-password' }">
            <AppIcon name="lock" :size="18" />
            <span>修改密码</span>
            <AppIcon name="chevron" :size="17" />
          </RouterLink>
          <RouterLink class="mobile-setting-link" :to="{ name: 'agent-tokens' }">
            <AppIcon name="token" :size="18" />
            <span>Agent 授权</span>
            <AppIcon name="chevron" :size="17" />
          </RouterLink>
          <RouterLink class="mobile-setting-link" :to="{ name: 'token-usage' }">
            <AppIcon name="usage" :size="18" />
            <span>Token 用量</span>
            <AppIcon name="chevron" :size="17" />
          </RouterLink>
          <button
            v-if="learning.platform.kind === 'android'"
            class="mobile-setting-link"
            type="button"
            @click="switchOpen = true"
          >
            <AppIcon name="server" :size="18" />
            <span>切换服务器</span>
            <AppIcon name="chevron" :size="17" />
          </button>
        </div>
        <div v-else class="button-row settings-account-actions">
          <RouterLink class="button" :to="{ name: 'token-usage' }">
            <AppIcon name="usage" :size="16" />Token 用量
          </RouterLink>
          <RouterLink class="button" :to="{ name: 'agent-tokens' }">
            <AppIcon name="token" :size="16" />Agent 授权
          </RouterLink>
          <button class="button button--danger" type="button" @click="logout">
            <AppIcon name="logout" :size="16" />退出登录
          </button>
        </div>
        <button
          v-if="isMobile"
          class="button button--danger mobile-logout"
          type="button"
          @click="logout"
        >
          <AppIcon name="logout" :size="17" />退出登录
        </button>
      </section>

      <section v-if="!isMobile" class="card settings-card" aria-labelledby="sessions-title">
        <div class="settings-card__heading">
          <span class="list-card__icon"><AppIcon name="history" /></span>
          <h2 id="sessions-title">登录会话</h2>
        </div>
        <div v-if="loadingSessions" class="loading-block settings-loading">
          <span class="spinner" />读取会话
        </div>
        <EmptyState
          v-else-if="sessionsError"
          compact
          icon="alert"
          title="登录会话读取失败"
          description="请检查网络连接后重试。"
        >
          <button class="button button--small" type="button" @click="loadSessions">重试</button>
        </EmptyState>
        <div v-else-if="sessions.length" class="list-stack">
          <article
            v-for="session in sessions"
            :key="session.id"
            class="task-row settings-session-row"
          >
            <div class="task-row__body">
              <strong>
                {{ sessionLabel(session) }}
                <span v-if="session.current" class="badge badge--green">当前</span>
              </strong>
              <span>最近使用 {{ formatDate(session.lastUsedAt ?? session.createdAt) }}</span>
            </div>
            <button
              class="button button--small button--danger"
              type="button"
              :disabled="session.current"
              @click="selectedSession = session"
            >
              撤销
            </button>
          </article>
        </div>
        <p v-else class="muted small">没有可显示的其他会话。</p>
      </section>

      <section v-if="!isMobile" class="card settings-card" aria-labelledby="server-title">
        <div class="settings-card__heading">
          <span class="list-card__icon"><AppIcon name="server" /></span>
          <h2 id="server-title">学习服务器</h2>
        </div>
        <dl class="definition-list">
          <div>
            <dt>名称</dt>
            <dd>{{ learning.state.serverInfo?.displayName }}</dd>
          </div>
          <div>
            <dt>地址</dt>
            <dd>{{ learning.state.connection?.baseUrl }}</dd>
          </div>
          <div>
            <dt>实例</dt>
            <dd>{{ learning.state.connection?.instanceId }}</dd>
          </div>
          <div>
            <dt>API 主版本</dt>
            <dd>{{ learning.state.serverInfo?.apiMajor }}</dd>
          </div>
        </dl>
        <button
          v-if="learning.platform.kind === 'android'"
          class="button button--danger settings-server-action"
          type="button"
          @click="switchOpen = true"
        >
          切换服务器
        </button>
        <p v-else class="field-hint settings-server-action">
          Web 始终使用当前部署来源与基础路径，通过 HttpOnly Cookie 维持会话。
        </p>
      </section>
    </div>

    <ConfirmDialog
      v-if="!isMobile"
      :open="Boolean(selectedSession)"
      title="撤销这个会话？"
      description="目标设备需要重新登录，撤销不会删除学习记录。"
      confirm-label="撤销会话"
      danger
      :busy="revoking"
      @update:open="!$event && (selectedSession = null)"
      @confirm="revokeSession"
    />
    <ConfirmDialog
      v-model:open="switchOpen"
      title="切换学习服务器？"
      description="将中止旧连接的全部在途请求并清除当前会话；原服务器上的考试不会暂停。"
      confirm-label="切换服务器"
      danger
      :busy="switching"
      @confirm="switchServer"
    >
      <p class="muted small">未保存答案和草稿不会迁移，也不会自动上传。</p>
    </ConfirmDialog>
  </div>
</template>
