<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui';
import { useLearning } from '../injection';
import { useAssistant } from '../assistant/store';
import { useLocale } from '../i18n';
import { cycleThemePreference, themePreference } from '../theme';
import { errorMessage } from '../utils';
import AppIcon from './AppIcon.vue';
import AppScrollArea from './AppScrollArea.vue';
import AppTooltip from './AppTooltip.vue';
import AssistantPanel from './assistant/AssistantPanel.vue';

const { t } = useI18n();

const { toggleLocale } = useLocale();
const themeIcons = { auto: 'system', light: 'sun', dark: 'moon' } as const;
const themeIcon = computed(() => themeIcons[themePreference.value]);
const themeLabel = computed(() => t(`components.theme.${themePreference.value}`));
const learning = useLearning();
const assistant = useAssistant();
const route = useRoute();
const router = useRouter();
const immersive = computed(() => Boolean(route.meta.immersive));
const focused = computed(() => Boolean(route.meta.focus));
const assistantActive = computed(
  () =>
    assistant.state.open &&
    !immersive.value &&
    Boolean(learning.state.user) &&
    assistant.state.layoutMode !== 'content',
);
const title = computed(() => {
  const names: Record<string, string> = {
    home: t('components.shell.titles.home'),
    assistant: t('components.shell.titles.assistant'),
    topics: t('components.shell.titles.topics'),
    'topic-detail': t('components.shell.titles.topicDetail'),
    plan: t('components.shell.titles.plan'),
    content: t('components.shell.titles.content'),
    assessment: t('components.shell.titles.assessment'),
    attempt: t('components.shell.titles.attempt'),
    report: t('components.shell.titles.report'),
    'wrong-questions': t('components.shell.titles.wrongQuestions'),
    'wrong-question-detail': t('components.shell.titles.wrongQuestionDetail'),
    history: t('components.shell.titles.history'),
    archive: t('components.shell.titles.archive'),
    settings: t('components.shell.titles.settings'),
    'token-usage': t('components.shell.titles.tokenUsage'),
    'agent-tokens': t('components.shell.titles.agentTokens'),
    'admin-users': t('components.shell.titles.adminUsers'),
    'admin-models': t('components.shell.titles.adminModels'),
    'admin-grading': t('components.shell.titles.adminGrading'),
    'admin-audit': t('components.shell.titles.adminAudit'),
  };
  return names[String(route.name)] ?? t('components.shell.brandSubtitle');
});
const primaryNav = computed(() => [
  { name: 'home', label: t('components.shell.titles.home'), icon: 'home' },
  { name: 'assistant', label: t('components.shell.titles.assistant'), icon: 'assistant' },
  { name: 'topics', label: t('components.shell.titles.topics'), icon: 'topics' },
  {
    name: 'wrong-questions',
    label: t('components.shell.titles.wrongQuestions'),
    icon: 'wrong',
    count: null,
  },
  { name: 'history', label: t('components.shell.titles.history'), icon: 'history' },
]);
const secondaryNav = computed(() => [
  { name: 'token-usage', label: t('components.shell.titles.tokenUsage'), icon: 'usage' },
  { name: 'archive', label: t('components.shell.nav.archive'), icon: 'archive' },
  { name: 'settings', label: t('components.shell.titles.settings'), icon: 'settings' },
  { name: 'agent-tokens', label: t('components.shell.titles.agentTokens'), icon: 'token' },
]);
const adminNav = computed(() => [
  { name: 'admin-users', label: t('components.shell.titles.adminUsers'), icon: 'users' },
  { name: 'admin-models', label: t('components.shell.titles.adminModels'), icon: 'model' },
  {
    name: 'admin-assistant',
    label: t('components.shell.titles.adminAssistant'),
    icon: 'assistant',
  },
  { name: 'admin-grading', label: t('components.shell.titles.adminGrading'), icon: 'server' },
  { name: 'admin-audit', label: t('components.shell.titles.adminAudit'), icon: 'history' },
]);
const mobileNav = computed(() => [
  { name: 'home', label: t('components.shell.navMobile.home'), icon: 'home' },
  { name: 'topics', label: t('components.shell.navMobile.topics'), icon: 'topics' },
  { name: 'wrong-questions', label: t('components.shell.navMobile.wrongQuestions'), icon: 'wrong' },
  { name: 'settings', label: t('components.shell.navMobile.settings'), icon: 'user' },
]);

watch(
  () => learning.state.online,
  (online, previous) => {
    if (!online) {
      learning.notify.warning(
        t('components.shell.offlineTitle'),
        t('components.shell.offlineDescription'),
      );
    } else if (previous === false) {
      learning.notify.success(
        t('components.shell.onlineTitle'),
        t('components.shell.onlineDescription'),
      );
    }
  },
  { immediate: true },
);

function isActive(name: string) {
  if (name === 'topics')
    return ['topics', 'topic-detail', 'plan', 'content', 'assessment'].includes(String(route.name));
  if (name === 'wrong-questions')
    return ['wrong-questions', 'wrong-question-detail'].includes(String(route.name));
  if (name === 'settings')
    return [
      'settings',
      'agent-tokens',
      'admin-users',
      'admin-models',
      'admin-assistant',
      'admin-grading',
    ].includes(String(route.name));
  return route.name === name;
}

function go(name: string) {
  void router.push({ name });
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
</script>

<template>
  <RouterView v-if="immersive" />
  <div
    v-else
    class="app-layout"
    :class="{
      'app-layout--focused': focused,
      'app-layout--assistant': assistantActive && !focused,
    }"
    :style="assistantActive ? { '--assistant-width': `${assistant.state.chatWidth}px` } : undefined"
  >
    <a class="skip-link" href="#main-content">{{ t('components.shell.skipToContent') }}</a>
    <aside v-if="!focused" class="sidebar">
      <RouterLink
        class="brand"
        :to="{ name: 'home' }"
        :aria-label="t('components.shell.brandHome')"
      >
        <span class="brand-mark"><AppIcon name="book" :size="22" /></span>
        <span
          ><strong>Drill Hub</strong><small>{{ t('components.shell.brandSubtitle') }}</small></span
        >
      </RouterLink>
      <AppScrollArea class="sidebar-nav-scroll" orientation="vertical" type="hover">
        <nav class="sidebar-nav" :aria-label="t('components.shell.mainNav')">
          <span class="nav-section-label">{{ t('components.shell.sectionLearn') }}</span>
          <RouterLink
            v-for="item in primaryNav"
            :key="item.name"
            :to="{ name: item.name }"
            class="nav-link"
            :class="{ active: isActive(item.name) }"
          >
            <AppIcon :name="item.icon" :size="19" /><span>{{ item.label }}</span>
          </RouterLink>
          <span class="nav-section-label">{{ t('components.shell.sectionManage') }}</span>
          <RouterLink
            v-for="item in secondaryNav"
            :key="item.name"
            :to="{ name: item.name }"
            class="nav-link"
            :class="{ active: isActive(item.name) }"
          >
            <AppIcon :name="item.icon" :size="19" /><span>{{ item.label }}</span>
          </RouterLink>
          <template v-if="learning.state.user?.role === 'admin'">
            <span class="nav-section-label">{{ t('components.shell.sectionSystem') }}</span>
            <RouterLink
              v-for="item in adminNav"
              :key="item.name"
              :to="{ name: item.name }"
              class="nav-link"
              :class="{ active: isActive(item.name) }"
            >
              <AppIcon :name="item.icon" :size="19" /><span>{{ item.label }}</span>
            </RouterLink>
          </template>
        </nav>
      </AppScrollArea>
    </aside>

    <aside
      v-if="assistantActive"
      class="assistant-pane"
      data-testid="assistant-pane"
      aria-label="学习助手"
    >
      <AssistantPanel />
    </aside>

    <div class="app-main">
      <header class="topbar">
        <h2>{{ title }}</h2>
        <div class="flex items-center gap-3.5">
          <AppTooltip :label="t('components.assistant.open')">
            <button
              class="icon-button"
              type="button"
              data-testid="assistant-toggle"
              :aria-label="t('components.assistant.open')"
              @click="assistant.state.open ? assistant.closePanel() : assistant.openPanel()"
            >
              <AppIcon name="assistant" :size="18" />
            </button>
          </AppTooltip>
          <button
            v-if="learning.platform.kind === 'web'"
            class="button button--small"
            type="button"
            data-testid="desktop-language-toggle"
            :aria-label="t('components.language.switch')"
            @click="toggleLocale"
          >
            中 / EN
          </button>
          <AppTooltip :label="themeLabel">
            <button
              class="icon-button"
              type="button"
              data-testid="desktop-theme-toggle"
              :aria-label="t('components.theme.switch')"
              @click="cycleThemePreference"
            >
              <AppIcon :name="themeIcon" :size="18" />
            </button>
          </AppTooltip>
          <DropdownMenuRoot>
            <DropdownMenuTrigger as-child>
              <button class="user-trigger" type="button">
                <span class="avatar">{{ learning.state.user?.displayName.slice(0, 1) }}</span>
                <span class="user-trigger__copy"
                  ><strong>{{ learning.state.user?.displayName }}</strong
                  ><small>{{
                    learning.state.user?.role === 'admin'
                      ? t('components.shell.roleAdmin')
                      : t('components.shell.roleLearner')
                  }}</small></span
                >
                <AppIcon name="down" :size="16" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="dropdown-content" align="end" :side-offset="8">
                <DropdownMenuLabel class="dropdown-label">{{
                  learning.state.user?.username
                }}</DropdownMenuLabel>
                <DropdownMenuItem class="dropdown-item" @select="go('settings')"
                  ><AppIcon name="settings" :size="17" />{{
                    t('components.shell.menuPersonal')
                  }}</DropdownMenuItem
                >
                <DropdownMenuItem class="dropdown-item" @select="go('agent-tokens')"
                  ><AppIcon name="token" :size="17" />{{
                    t('components.shell.titles.agentTokens')
                  }}</DropdownMenuItem
                >
                <template v-if="learning.state.user?.role === 'admin'">
                  <DropdownMenuSeparator class="dropdown-separator" />
                  <DropdownMenuItem class="dropdown-item" @select="go('admin-users')"
                    ><AppIcon name="users" :size="17" />{{
                      t('components.shell.titles.adminUsers')
                    }}</DropdownMenuItem
                  >
                  <DropdownMenuItem class="dropdown-item" @select="go('admin-models')"
                    ><AppIcon name="model" :size="17" />{{
                      t('components.shell.menuAdminModels')
                    }}</DropdownMenuItem
                  >
                  <DropdownMenuItem class="dropdown-item" @select="go('admin-audit')"
                    ><AppIcon name="history" :size="17" />{{
                      t('components.shell.titles.adminAudit')
                    }}</DropdownMenuItem
                  >
                </template>
                <DropdownMenuSeparator class="dropdown-separator" />
                <DropdownMenuItem class="dropdown-item dropdown-item--danger" @select="logout"
                  ><AppIcon name="logout" :size="17" />{{
                    t('components.shell.menuLogout')
                  }}</DropdownMenuItem
                >
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>
      </header>
      <main id="main-content" class="page-container" tabindex="-1"><RouterView /></main>
    </div>

    <nav v-if="!focused" class="bottom-nav" :aria-label="t('components.shell.mobileNav')">
      <RouterLink
        v-for="item in mobileNav"
        :key="item.name"
        :to="{ name: item.name }"
        :class="{ active: isActive(item.name) }"
      >
        <AppIcon :name="item.icon" :size="21" /><span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
