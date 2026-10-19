<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { UserView } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { useLocale } from '../i18n';
import type { SessionView } from '../types';
import { errorMessage, formatDate } from '../utils';
import PageHeader from '../components/PageHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';

const { t } = useI18n();

const { locale, toggleLocale } = useLocale();
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
    learning.notify.error(t('components.settings.sessionsErrorTitle'), sessionsError.value);
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
    learning.notify.success(
      isMobile.value
        ? t('components.settings.notifyProfileUpdatedMobile')
        : t('components.settings.notifyProfileSaved'),
    );
  } catch (reason) {
    learning.notify.error(
      isMobile.value
        ? t('components.settings.notifyProfileSaveFailedMobile')
        : t('components.settings.notifyProfileSaveFailed'),
      errorMessage(reason),
    );
  } finally {
    saving.value = false;
  }
}
function sessionLabel(session: SessionView) {
  const channel = session.kind ?? session.channel;
  return channel === 'web' ? t('components.settings.sessionWeb') : 'Android';
}
async function revokeSession() {
  if (!selectedSession.value) return;
  revoking.value = true;
  try {
    await learning.post(`/me/sessions/${selectedSession.value.id}/revoke`, {});
    learning.notify.success(t('components.settings.notifySessionRevoked'));
    selectedSession.value = null;
    await loadSessions();
  } catch (reason) {
    learning.notify.error(t('components.settings.notifySessionRevokeFailed'), errorMessage(reason));
  } finally {
    revoking.value = false;
  }
}
async function logout() {
  try {
    await learning.logout();
  } catch (reason) {
    learning.notify.error(t('components.shell.logoutFailed'), errorMessage(reason));
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
    learning.notify.error(t('components.settings.notifySwitchServerFailed'), errorMessage(reason));
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
      :title="
        isMobile ? t('components.shell.navMobile.settings') : t('components.shell.titles.settings')
      "
      :eyebrow="isMobile ? 'MY PROFILE' : 'PERSONAL SETTINGS'"
      :description="
        isMobile
          ? t('components.settings.descriptionMobile')
          : t('components.settings.descriptionDesktop')
      "
    />
    <div class="settings-grid" :class="{ 'settings-grid--mobile': isMobile }">
      <section class="card settings-card" aria-labelledby="profile-title">
        <div class="settings-card__heading">
          <span class="list-card__icon"><AppIcon name="user" /></span>
          <h2 id="profile-title">
            {{
              isMobile
                ? t('components.settings.profileTitleMobile')
                : t('components.settings.profileTitleDesktop')
            }}
          </h2>
        </div>
        <div v-if="isMobile && !editingProfile">
          <button
            class="profile-display"
            type="button"
            :aria-label="t('components.settings.profileEditLabel')"
            @click="startProfileEdit"
          >
            <span class="avatar profile-display__avatar">{{
              learning.state.user?.displayName.slice(0, 1)
            }}</span>
            <span class="profile-display__copy">
              <strong>{{ learning.state.user?.displayName }}</strong>
              <small>@{{ learning.state.user?.username }}</small>
            </span>
            <span class="profile-display__action"
              >{{ t('components.settings.profileEditAction') }}<AppIcon name="chevron" :size="16"
            /></span>
          </button>
          <dl class="definition-list">
            <div>
              <dt>{{ t('components.settings.fieldRole') }}</dt>
              <dd>
                {{
                  learning.state.user?.role === 'admin'
                    ? t('components.shell.roleAdmin')
                    : t('components.shell.roleLearner')
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t('components.settings.fieldStatus') }}</dt>
              <dd>
                {{
                  learning.state.user?.status === 'active'
                    ? t('components.settings.statusActive')
                    : t('components.settings.statusDisabled')
                }}
              </dd>
            </div>
          </dl>
        </div>
        <form v-else @submit.prevent="saveProfile">
          <div class="form-grid">
            <div class="form-field form-field--full">
              <label for="profile-name">{{ t('components.settings.displayName') }}</label>
              <input
                id="profile-name"
                v-model="displayName"
                class="input"
                required
                autocomplete="name"
              />
              <p class="field-hint">{{ t('components.settings.displayNameHint') }}</p>
            </div>
          </div>
          <div class="form-actions">
            <button v-if="isMobile" class="button" type="button" @click="cancelProfileEdit">
              {{ t('components.settings.cancel') }}
            </button>
            <RouterLink v-else class="button" :to="{ name: 'change-password' }">
              {{ t('components.settings.changePassword') }}
            </RouterLink>
            <button class="button button--primary" type="submit" :disabled="saving">
              <span v-if="saving" class="spinner" />{{
                isMobile ? t('components.settings.save') : t('components.settings.saveProfile')
              }}
            </button>
          </div>
        </form>
      </section>

      <section class="card settings-card" aria-labelledby="security-title">
        <div class="settings-card__heading">
          <span class="list-card__icon"><AppIcon name="lock" /></span>
          <h2 id="security-title">
            {{
              isMobile
                ? t('components.settings.securityTitleMobile')
                : t('components.settings.securityTitleDesktop')
            }}
          </h2>
        </div>
        <dl v-if="!isMobile" class="definition-list">
          <div>
            <dt>{{ t('components.settings.fieldUsername') }}</dt>
            <dd>{{ learning.state.user?.username }}</dd>
          </div>
          <div>
            <dt>{{ t('components.settings.fieldRole') }}</dt>
            <dd>
              {{
                learning.state.user?.role === 'admin'
                  ? t('components.shell.roleAdmin')
                  : t('components.shell.roleLearner')
              }}
            </dd>
          </div>
          <div>
            <dt>{{ t('components.settings.fieldStatus') }}</dt>
            <dd>
              {{
                learning.state.user?.status === 'active'
                  ? t('components.settings.statusActive')
                  : t('components.settings.statusDisabled')
              }}
            </dd>
          </div>
        </dl>
        <div v-if="isMobile" class="mobile-setting-list">
          <button
            class="mobile-setting-link"
            type="button"
            data-testid="settings-language-toggle"
            :aria-label="t('components.language.switch')"
            @click="toggleLocale"
          >
            <AppIcon name="settings" :size="18" />
            <span>{{ t('components.language.label') }}</span>
            <span class="language-current">{{ locale === 'zh-CN' ? '中文' : 'English' }}</span>
          </button>
          <RouterLink class="mobile-setting-link" :to="{ name: 'change-password' }">
            <AppIcon name="lock" :size="18" />
            <span>{{ t('components.settings.changePassword') }}</span>
            <AppIcon name="chevron" :size="17" />
          </RouterLink>
          <RouterLink class="mobile-setting-link" :to="{ name: 'agent-tokens' }">
            <AppIcon name="token" :size="18" />
            <span>{{ t('components.shell.titles.agentTokens') }}</span>
            <AppIcon name="chevron" :size="17" />
          </RouterLink>
          <RouterLink class="mobile-setting-link" :to="{ name: 'token-usage' }">
            <AppIcon name="usage" :size="18" />
            <span>{{ t('components.shell.titles.tokenUsage') }}</span>
            <AppIcon name="chevron" :size="17" />
          </RouterLink>
          <button
            v-if="learning.platform.kind === 'android'"
            class="mobile-setting-link"
            type="button"
            @click="switchOpen = true"
          >
            <AppIcon name="server" :size="18" />
            <span>{{ t('components.settings.switchServer') }}</span>
            <AppIcon name="chevron" :size="17" />
          </button>
        </div>
        <div v-else class="button-row settings-account-actions">
          <RouterLink class="button" :to="{ name: 'token-usage' }">
            <AppIcon name="usage" :size="16" />{{ t('components.shell.titles.tokenUsage') }}
          </RouterLink>
          <RouterLink class="button" :to="{ name: 'agent-tokens' }">
            <AppIcon name="token" :size="16" />{{ t('components.shell.titles.agentTokens') }}
          </RouterLink>
          <button class="button button--danger" type="button" @click="logout">
            <AppIcon name="logout" :size="16" />{{ t('components.shell.menuLogout') }}
          </button>
        </div>
        <button
          v-if="isMobile"
          class="button button--danger mobile-logout"
          type="button"
          @click="logout"
        >
          <AppIcon name="logout" :size="17" />{{ t('components.shell.menuLogout') }}
        </button>
      </section>

      <section v-if="!isMobile" class="card settings-card" aria-labelledby="sessions-title">
        <div class="settings-card__heading">
          <span class="list-card__icon"><AppIcon name="history" /></span>
          <h2 id="sessions-title">{{ t('components.settings.sessionsTitle') }}</h2>
        </div>
        <div v-if="loadingSessions" class="loading-block settings-loading">
          <span class="spinner" />{{ t('components.settings.sessionsLoading') }}
        </div>
        <EmptyState
          v-else-if="sessionsError"
          compact
          icon="alert"
          :title="t('components.settings.sessionsErrorTitle')"
          :description="t('components.settings.sessionsErrorDescription')"
        >
          <button class="button button--small" type="button" @click="loadSessions">
            {{ t('components.settings.retry') }}
          </button>
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
                <span v-if="session.current" class="badge badge--green">{{
                  t('components.settings.sessionCurrent')
                }}</span>
              </strong>
              <span>{{
                t('components.settings.sessionLastUsed', {
                  date: formatDate(session.lastUsedAt ?? session.createdAt),
                })
              }}</span>
            </div>
            <button
              class="button button--small button--danger"
              type="button"
              :disabled="session.current"
              @click="selectedSession = session"
            >
              {{ t('components.settings.sessionRevoke') }}
            </button>
          </article>
        </div>
        <p v-else class="muted small">{{ t('components.settings.sessionsEmpty') }}</p>
      </section>

      <section v-if="!isMobile" class="card settings-card" aria-labelledby="server-title">
        <div class="settings-card__heading">
          <span class="list-card__icon"><AppIcon name="server" /></span>
          <h2 id="server-title">{{ t('components.settings.serverTitle') }}</h2>
        </div>
        <dl class="definition-list">
          <div>
            <dt>{{ t('components.settings.serverName') }}</dt>
            <dd>{{ learning.state.serverInfo?.displayName }}</dd>
          </div>
          <div>
            <dt>{{ t('components.settings.serverAddress') }}</dt>
            <dd>{{ learning.state.connection?.baseUrl }}</dd>
          </div>
          <div>
            <dt>{{ t('components.settings.serverInstance') }}</dt>
            <dd>{{ learning.state.connection?.instanceId }}</dd>
          </div>
          <div>
            <dt>{{ t('components.settings.serverApiMajor') }}</dt>
            <dd>{{ learning.state.serverInfo?.apiMajor }}</dd>
          </div>
        </dl>
        <button
          v-if="learning.platform.kind === 'android'"
          class="button button--danger settings-server-action"
          type="button"
          @click="switchOpen = true"
        >
          {{ t('components.settings.switchServer') }}
        </button>
        <p v-else class="field-hint settings-server-action">
          {{ t('components.settings.serverWebHint') }}
        </p>
      </section>
    </div>

    <ConfirmDialog
      v-if="!isMobile"
      :open="Boolean(selectedSession)"
      :title="t('components.settings.revokeTitle')"
      :description="t('components.settings.revokeDescription')"
      :confirm-label="t('components.settings.revokeConfirm')"
      danger
      :busy="revoking"
      @update:open="!$event && (selectedSession = null)"
      @confirm="revokeSession"
    />
    <ConfirmDialog
      v-model:open="switchOpen"
      :title="t('components.settings.switchTitle')"
      :description="t('components.settings.switchDescription')"
      :confirm-label="t('components.settings.switchServer')"
      danger
      :busy="switching"
      @confirm="switchServer"
    >
      <p class="muted small">{{ t('components.settings.switchNotice') }}</p>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.language-current {
  margin-left: auto;
  color: var(--ink-soft);
}
</style>
