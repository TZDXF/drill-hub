<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ExportBundle, UserView } from '@drill-hub/contracts';
import { useLearning } from '#learning-client/injection';
import { useLocale } from '#learning-client/i18n';
import { cycleThemePreference, themePreference } from '#learning-client/theme';
import { errorMessage } from '#learning-client/utils';
import PageHeader from '#learning-client/components/PageHeader.vue';
import AppFormField from '#learning-client/components/AppFormField.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import ConfirmDialog from '#learning-client/components/ConfirmDialog.vue';
import AppDialog from '#learning-client/components/AppDialog.vue';
import ChangePasswordForm from '#learning-client/components/ChangePasswordForm.vue';

const { t } = useI18n();

const { locale, toggleLocale } = useLocale();
const themeIcons = { auto: 'system', light: 'sun', dark: 'moon' } as const;
const themeIcon = computed(() => themeIcons[themePreference.value]);
const themeLabel = computed(() => t(`components.theme.${themePreference.value}`));
const learning = useLearning();
const route = useRoute();
const router = useRouter();
const displayName = ref(learning.state.user?.displayName ?? '');
const editingProfile = ref(false);
const saving = ref(false);
const passwordOpen = ref(false);
const changingPassword = ref(false);
const passwordTrigger = ref<HTMLButtonElement | null>(null);
const switchOpen = ref(false);
const switching = ref(false);
const exporting = ref(false);
const exportStatus = ref<'idle' | 'success' | 'error'>('idle');
const exportFileName = ref('');
const exportError = ref('');
const exportSection = ref<HTMLElement | null>(null);
const mobileQuery = typeof window === 'undefined' ? null : window.matchMedia('(max-width: 780px)');
const isMobile = ref(learning.platform.kind === 'android' || (mobileQuery?.matches ?? false));

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
async function logout() {
  try {
    await learning.logout();
  } catch (reason) {
    learning.notify.error(t('components.shell.logoutFailed'), errorMessage(reason));
  } finally {
    await router.replace({ name: 'login' });
  }
}
async function exportData() {
  exporting.value = true;
  exportStatus.value = 'idle';
  exportError.value = '';
  try {
    const bundle = await learning.get<ExportBundle>('/me/export');
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    exportFileName.value = `drill-hub-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.href = url;
    anchor.download = exportFileName.value;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    exportStatus.value = 'success';
    learning.notify.success(t('components.settings.exportDone'));
  } catch (reason) {
    exportError.value = errorMessage(reason);
    exportStatus.value = 'error';
  } finally {
    exporting.value = false;
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

onMounted(async () => {
  mobileQuery?.addEventListener('change', syncLayout);
  syncLayout();
  if (route.query.focus === 'export') {
    await nextTick();
    exportSection.value?.focus({ preventScroll: true });
    exportSection.value?.scrollIntoView({ block: 'center' });
  }
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
            <AppFormField
              class="form-field--full"
              id="profile-name"
              :label="t('components.settings.displayName')"
              :hint="t('components.settings.displayNameHint')"
            >
              <input
                id="profile-name"
                v-model="displayName"
                class="input"
                required
                autocomplete="name"
              />
            </AppFormField>
          </div>
          <div class="form-actions">
            <button v-if="isMobile" class="button" type="button" @click="cancelProfileEdit">
              {{ t('components.settings.cancel') }}
            </button>
            <button
              v-else
              ref="passwordTrigger"
              class="button"
              type="button"
              @click="passwordOpen = true"
            >
              {{ t('components.settings.changePassword') }}
            </button>
            <button class="button button--primary" type="submit" :disabled="saving">
              <span v-if="saving" class="spinner" />{{
                isMobile ? t('components.settings.save') : t('components.settings.saveProfile')
              }}
            </button>
          </div>
        </form>
      </section>

      <section v-if="isMobile" class="card settings-card" aria-labelledby="security-title">
        <div class="settings-card__heading">
          <span class="list-card__icon"><AppIcon name="lock" /></span>
          <h2 id="security-title">{{ t('components.settings.securityTitleMobile') }}</h2>
        </div>
        <div class="mobile-setting-list">
          <button
            class="mobile-setting-link"
            type="button"
            data-testid="settings-language-toggle"
            :aria-label="t('components.language.switch')"
            @click="toggleLocale"
          >
            <AppIcon name="settings" :size="18" />
            <span>{{ t('components.language.label') }}</span>
            <span class="ml-auto text-(--ink-soft)">{{
              locale === 'zh-CN' ? '中文' : 'English'
            }}</span>
          </button>
          <button
            class="mobile-setting-link"
            type="button"
            data-testid="settings-theme-toggle"
            :aria-label="t('components.theme.switch')"
            @click="cycleThemePreference"
          >
            <AppIcon :name="themeIcon" :size="18" />
            <span>{{ t('components.theme.label') }}</span>
            <span class="ml-auto text-(--ink-soft)">{{ themeLabel }}</span>
          </button>
          <RouterLink class="mobile-setting-link" :to="{ name: 'change-password' }">
            <AppIcon name="lock" :size="18" />
            <span>{{ t('components.settings.changePassword') }}</span>
            <AppIcon name="chevron" :size="17" />
          </RouterLink>
          <RouterLink class="mobile-setting-link" :to="{ name: 'search' }">
            <AppIcon name="search" :size="18" />
            <span>{{ t('components.shell.titles.search') }}</span>
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
        <button class="button button--danger mobile-logout" type="button" @click="logout">
          <AppIcon name="logout" :size="17" />{{ t('components.shell.menuLogout') }}
        </button>
      </section>

      <section
        id="data-export"
        ref="exportSection"
        class="card settings-card settings-export-card"
        aria-labelledby="export-title"
        tabindex="-1"
      >
        <div class="settings-card__heading">
          <span class="list-card__icon settings-export-card__icon"
            ><AppIcon name="download"
          /></span>
          <h2 id="export-title">{{ t('components.settings.exportTitle') }}</h2>
          <span class="badge badge--teal settings-export-card__badge">JSON</span>
        </div>
        <p class="settings-export-card__description">
          {{ t('components.settings.exportDescription') }}
        </p>
        <div class="settings-export-card__meta" aria-label="JSON">
          <span
            ><AppIcon name="content" :size="15" />{{ t('components.settings.exportFormat') }}</span
          >
          <span><AppIcon name="lock" :size="15" />{{ t('components.settings.exportLocal') }}</span>
        </div>
        <div class="settings-export-card__status" aria-live="polite">
          <div v-if="exportStatus === 'success'" class="notice notice--success">
            <AppIcon name="check" />
            <div>
              <strong>{{ t('components.settings.exportReady') }}</strong>
              <p>{{ exportFileName }}</p>
            </div>
          </div>
          <div v-else-if="exportStatus === 'error'" class="notice notice--error" role="alert">
            <AppIcon name="alert" />
            <div>
              <strong>{{ t('components.settings.exportFailed') }}</strong>
              <p>{{ exportError }}</p>
            </div>
          </div>
        </div>
        <div class="settings-export-card__footer">
          <button
            class="button button--primary"
            type="button"
            data-testid="settings-export"
            :disabled="exporting"
            @click="exportData"
          >
            <span v-if="exporting" class="spinner" /><AppIcon v-else name="download" :size="16" />
            {{
              exporting
                ? t('components.settings.exporting')
                : exportStatus === 'error'
                  ? t('components.settings.exportRetry')
                  : t('components.settings.exportData')
            }}
          </button>
          <span class="settings-export-card__hint">{{ t('components.settings.exportHint') }}</span>
        </div>
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
        </dl>
        <button
          v-if="learning.platform.kind === 'android'"
          class="button button--danger settings-server-action"
          type="button"
          @click="switchOpen = true"
        >
          {{ t('components.settings.switchServer') }}
        </button>
      </section>
    </div>

    <AppDialog
      v-if="passwordOpen"
      v-model:open="passwordOpen"
      class="dialog-content"
      :title="t('management.password.title')"
      :description="t('management.password.description')"
      :busy="changingPassword"
      @close-auto-focus.prevent="passwordTrigger?.focus()"
    >
      <ChangePasswordForm v-model:busy="changingPassword" />
    </AppDialog>
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
.settings-export-card {
  position: relative;
  overflow: hidden;
  border-color: var(--badge-teal-line);
}
.settings-export-card:focus {
  outline: none;
}
.settings-export-card__icon {
  background: var(--teal-soft);
  color: var(--teal);
}
.settings-export-card__badge {
  margin-left: auto;
}
.settings-export-card__description {
  max-width: 560px;
  margin: 0;
  line-height: 1.7;
}
.settings-export-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 16px;
  color: var(--ink-soft);
  font-size: 12px;
}
.settings-export-card__meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.settings-export-card__meta .app-icon {
  color: var(--teal);
}
.settings-export-card__status .notice {
  margin-top: 16px;
}
.settings-export-card__status .notice p {
  overflow-wrap: anywhere;
}
.settings-export-card__footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: auto;
  padding-top: 18px;
}
.settings-export-card__hint {
  color: var(--ink-faint);
  font-size: 11px;
  line-height: 1.5;
}
@media (max-width: 520px) {
  .settings-export-card__footer {
    align-items: stretch;
    flex-direction: column;
  }
  .settings-export-card__footer .button {
    width: 100%;
  }
}
</style>
