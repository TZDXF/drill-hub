<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
import { useLearning } from '#learning-client/injection';
import { useAssistant } from '#learning-client/assistant/store';
import {
  clampFloatingRect,
  moveFloatingRect,
  resizeFloatingRect,
  type AssistantFloatingRect,
  type AssistantResizeDirection,
} from '#learning-client/assistant/floating';
import { useLocale } from '#learning-client/i18n';
import { cycleThemePreference, themePreference } from '#learning-client/theme';
import { errorMessage } from '#learning-client/utils';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppScrollArea from '#learning-client/components/AppScrollArea.vue';
import AppTooltip from '#learning-client/components/AppTooltip.vue';
import AssistantPanel from '#learning-client/components/assistant/AssistantPanel.vue';

const { t } = useI18n();

const { locale, toggleLocale } = useLocale();
const themeIcons = { auto: 'system', light: 'sun', dark: 'moon' } as const;
const themeIcon = computed(() => themeIcons[themePreference.value]);
const themeLabel = computed(() => t(`components.theme.${themePreference.value}`));
const learning = useLearning();
const assistant = useAssistant();
const route = useRoute();
const router = useRouter();
const sidebarCollapsed = ref(false);
const sidebarWidth = ref(244);
const sidebarMinWidth = 200;
const sidebarMaxWidth = 360;
const sidebarDrag = ref<{ pointerId: number; startX: number; startWidth: number } | null>(null);
const sidebarToggleLabel = computed(() =>
  t(`components.shell.${sidebarCollapsed.value ? 'expandSidebar' : 'collapseSidebar'}`),
);

function setSidebarWidth(width: number) {
  sidebarWidth.value = Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, Math.round(width)));
}

function startSidebarResize(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary) return;
  const handle = event.currentTarget as HTMLElement;
  handle.focus();
  handle.setPointerCapture(event.pointerId);
  sidebarDrag.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: sidebarWidth.value,
  };
  event.preventDefault();
}

function resizeSidebar(event: PointerEvent) {
  const drag = sidebarDrag.value;
  if (drag?.pointerId !== event.pointerId) return;
  setSidebarWidth(drag.startWidth + event.clientX - drag.startX);
}

function stopSidebarResize(event: PointerEvent) {
  if (sidebarDrag.value?.pointerId !== event.pointerId) return;
  sidebarDrag.value = null;
  const handle = event.currentTarget as HTMLElement;
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
}

function resizeSidebarWithKeyboard(event: KeyboardEvent) {
  const widths: Record<string, number> = {
    ArrowLeft: sidebarWidth.value - 10,
    ArrowRight: sidebarWidth.value + 10,
    Home: sidebarMinWidth,
    End: sidebarMaxWidth,
  };
  const width = widths[event.key];
  if (width === undefined) return;
  event.preventDefault();
  setSidebarWidth(width);
}

const immersive = computed(() => Boolean(route.meta.immersive));
const focused = computed(() => Boolean(route.meta.focus || route.meta.immersive));
const assistantAvailable = computed(() => Boolean(route.meta.assistantPanel));
const assistantActive = computed(
  () =>
    assistant.state.open &&
    assistantAvailable.value &&
    Boolean(learning.state.user) &&
    assistant.state.layoutMode !== 'content',
);
const assistantDocked = computed(
  () => assistantActive.value && assistant.state.position !== 'floating',
);
const assistantFloating = computed(
  () => assistantActive.value && assistant.state.position === 'floating',
);
const viewportWidth = ref(window.innerWidth);
const assistantMinWidth = 320;
const assistantMaxWidth = computed(() =>
  Math.max(
    assistantMinWidth,
    Math.min(
      560,
      viewportWidth.value -
        (focused.value ? 0 : sidebarCollapsed.value ? 72 : sidebarWidth.value) -
        (focused.value ? 440 : 240),
    ),
  ),
);
const assistantWidth = computed(() => Math.min(assistant.state.chatWidth, assistantMaxWidth.value));
const assistantResizable = computed(
  () =>
    assistantDocked.value && assistant.state.layoutMode === 'split' && viewportWidth.value > 780,
);
const assistantDrag = ref<{
  pointerId: number;
  startX: number;
  startWidth: number;
  direction: number;
} | null>(null);

function setAssistantWidth(width: number) {
  assistant.setChatWidth(Math.min(assistantMaxWidth.value, width));
}

function startAssistantResize(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || !assistantResizable.value) return;
  const handle = event.currentTarget as HTMLElement;
  handle.focus();
  handle.setPointerCapture(event.pointerId);
  assistantDrag.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: assistantWidth.value,
    direction: assistant.state.position === 'right' ? -1 : 1,
  };
  event.preventDefault();
}

function resizeAssistant(event: PointerEvent) {
  const drag = assistantDrag.value;
  if (drag?.pointerId !== event.pointerId) return;
  setAssistantWidth(drag.startWidth + (event.clientX - drag.startX) * drag.direction);
}

function stopAssistantResize(event: PointerEvent) {
  if (assistantDrag.value?.pointerId !== event.pointerId) return;
  assistantDrag.value = null;
  const handle = event.currentTarget as HTMLElement;
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
}

function resizeAssistantWithKeyboard(event: KeyboardEvent) {
  const direction = assistant.state.position === 'right' ? -1 : 1;
  const widths: Record<string, number> = {
    ArrowLeft: assistantWidth.value - 10 * direction,
    ArrowRight: assistantWidth.value + 10 * direction,
    Home: assistantMinWidth,
    End: assistantMaxWidth.value,
  };
  const width = widths[event.key];
  if (width === undefined) return;
  event.preventDefault();
  setAssistantWidth(width);
}

watch([assistantResizable, () => assistant.state.position], () => (assistantDrag.value = null));
const assistantLauncherVisible = computed(
  () =>
    assistantAvailable.value &&
    (assistant.state.position === 'floating' || focused.value) &&
    !assistantActive.value &&
    Boolean(learning.state.user),
);
const assistantLauncherLabel = computed(() =>
  t(
    assistant.state.position === 'floating'
      ? 'components.assistant.openFloating'
      : 'components.assistant.open',
  ),
);

function openAssistant() {
  if (assistant.state.layoutMode === 'content') assistant.setLayout('split');
  assistant.openPanel();
}

function defaultFloatingRect(): AssistantFloatingRect {
  const width = Math.max(320, Math.min(420, window.innerWidth - 48));
  const height = Math.max(360, Math.min(640, window.innerHeight - 48));
  return { x: window.innerWidth - width - 24, y: window.innerHeight - height - 24, width, height };
}
const floatingRect = ref<AssistantFloatingRect>(defaultFloatingRect());
const floatingStyle = computed(() => ({
  left: `${floatingRect.value.x}px`,
  top: `${floatingRect.value.y}px`,
  width: `${floatingRect.value.width}px`,
  height: `${floatingRect.value.height}px`,
}));
let stopPointerInteraction: (() => void) | null = null;

function trackPointer(
  event: PointerEvent,
  update: (initial: AssistantFloatingRect, deltaX: number, deltaY: number) => AssistantFloatingRect,
) {
  if (
    !event.isPrimary ||
    (event.pointerType === 'mouse' && event.button !== 0) ||
    window.matchMedia('(max-width: 780px)').matches
  )
    return;
  event.preventDefault();
  stopPointerInteraction?.();
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const initial = { ...floatingRect.value };
  const previousUserSelect = document.body.style.userSelect;
  document.body.style.userSelect = 'none';
  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    floatingRect.value = clampFloatingRect(
      update(initial, moveEvent.clientX - startX, moveEvent.clientY - startY),
      window.innerWidth,
      window.innerHeight,
    );
  };
  const stop = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    document.body.style.userSelect = previousUserSelect;
    if (stopPointerInteraction === stop) stopPointerInteraction = null;
  };
  stopPointerInteraction = stop;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}

function startFloatingDrag(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button, input, textarea, select')) return;
  trackPointer(event, (initial, deltaX, deltaY) =>
    moveFloatingRect(initial, deltaX, deltaY, window.innerWidth, window.innerHeight),
  );
}

function startFloatingResize(event: PointerEvent, direction: AssistantResizeDirection) {
  trackPointer(event, (initial, deltaX, deltaY) =>
    resizeFloatingRect(initial, direction, deltaX, deltaY, window.innerWidth, window.innerHeight),
  );
}

function resizeWithKeyboard(event: KeyboardEvent, direction: AssistantResizeDirection) {
  const deltas = {
    ArrowLeft: [-16, 0],
    ArrowRight: [16, 0],
    ArrowUp: [0, -16],
    ArrowDown: [0, 16],
  } as const;
  const delta = deltas[event.key as keyof typeof deltas];
  if (!delta || window.matchMedia('(max-width: 780px)').matches) return;
  event.preventDefault();
  floatingRect.value = resizeFloatingRect(
    floatingRect.value,
    direction,
    delta[0],
    delta[1],
    window.innerWidth,
    window.innerHeight,
  );
}

function handleFloatingViewportResize() {
  viewportWidth.value = window.innerWidth;
  floatingRect.value = clampFloatingRect(floatingRect.value, window.innerWidth, window.innerHeight);
}

watch(assistantFloating, (active) => {
  if (active) handleFloatingViewportResize();
});
onMounted(() => window.addEventListener('resize', handleFloatingViewportResize));
onBeforeUnmount(() => {
  stopPointerInteraction?.();
  window.removeEventListener('resize', handleFloatingViewportResize);
});
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
  { name: 'search', label: t('components.shell.titles.search'), icon: 'search' },
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
  <div
    class="app-layout"
    :class="{
      'app-layout--focused': focused,
      'app-layout--sidebar-resizing': sidebarDrag !== null,
      'app-layout--assistant-resizing': assistantDrag !== null,
      'app-layout--assistant': assistantDocked,
      'app-layout--assistant-right': assistantDocked && assistant.state.position === 'right',
      'app-layout--assistant-chat': assistantDocked && assistant.state.layoutMode === 'chat',
    }"
    :style="{
      '--sidebar-width': `${sidebarCollapsed ? 72 : sidebarWidth}px`,
      '--assistant-width': assistantDocked ? `${assistantWidth}px` : undefined,
    }"
  >
    <a class="skip-link" href="#main-content">{{ t('components.shell.skipToContent') }}</a>
    <aside
      v-if="!focused"
      id="desktop-sidebar"
      class="sidebar"
      :class="{ 'sidebar--collapsed': sidebarCollapsed }"
    >
      <div class="sidebar-header">
        <RouterLink
          v-show="!sidebarCollapsed"
          class="brand"
          :to="{ name: 'home' }"
          :aria-label="t('components.shell.brandHome')"
        >
          <span class="brand-mark"><AppIcon name="book" :size="22" /></span>
          <span
            ><strong>Drill Hub</strong
            ><small>{{ t('components.shell.brandSubtitle') }}</small></span
          >
        </RouterLink>
        <AppTooltip :label="sidebarToggleLabel" side="right">
          <button
            class="sidebar-toggle icon-button"
            :class="{ 'sidebar-toggle--brand': sidebarCollapsed }"
            type="button"
            :aria-label="sidebarToggleLabel"
            :aria-expanded="!sidebarCollapsed"
            aria-controls="desktop-sidebar-nav"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <AppIcon v-if="sidebarCollapsed" class="sidebar-toggle__brand" name="book" :size="22" />
            <AppIcon
              class="sidebar-toggle__action"
              :name="sidebarCollapsed ? 'panelExpand' : 'panelCollapse'"
              :size="20"
            />
          </button>
        </AppTooltip>
      </div>
      <AppScrollArea class="sidebar-nav-scroll" orientation="vertical" type="hover">
        <nav
          id="desktop-sidebar-nav"
          class="sidebar-nav"
          :aria-label="t('components.shell.mainNav')"
        >
          <span class="nav-section-label">{{ t('components.shell.sectionLearn') }}</span>
          <AppTooltip v-for="item in primaryNav" :key="item.name" :label="item.label" side="right">
            <RouterLink
              :to="{ name: item.name }"
              class="nav-link"
              :class="{ active: isActive(item.name) }"
              :aria-label="item.label"
            >
              <AppIcon :name="item.icon" :size="19" /><span>{{ item.label }}</span>
            </RouterLink>
          </AppTooltip>
          <span class="nav-section-label">{{ t('components.shell.sectionManage') }}</span>
          <AppTooltip
            v-for="item in secondaryNav"
            :key="item.name"
            :label="item.label"
            side="right"
          >
            <RouterLink
              :to="{ name: item.name }"
              class="nav-link"
              :class="{ active: isActive(item.name) }"
              :aria-label="item.label"
            >
              <AppIcon :name="item.icon" :size="19" /><span>{{ item.label }}</span>
            </RouterLink>
          </AppTooltip>
          <template v-if="learning.state.user?.role === 'admin'">
            <span class="nav-section-label">{{ t('components.shell.sectionSystem') }}</span>
            <AppTooltip v-for="item in adminNav" :key="item.name" :label="item.label" side="right">
              <RouterLink
                :to="{ name: item.name }"
                class="nav-link"
                :class="{ active: isActive(item.name) }"
                :aria-label="item.label"
              >
                <AppIcon :name="item.icon" :size="19" /><span>{{ item.label }}</span>
              </RouterLink>
            </AppTooltip>
          </template>
        </nav>
      </AppScrollArea>
      <div
        v-if="!sidebarCollapsed"
        class="sidebar-resize-handle"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-controls="desktop-sidebar"
        :aria-label="t('components.shell.resizeSidebar')"
        :aria-valuemin="sidebarMinWidth"
        :aria-valuemax="sidebarMaxWidth"
        :aria-valuenow="sidebarWidth"
        @pointerdown="startSidebarResize"
        @pointermove="resizeSidebar"
        @pointerup="stopSidebarResize"
        @pointercancel="stopSidebarResize"
        @lostpointercapture="stopSidebarResize"
        @keydown="resizeSidebarWithKeyboard"
      />
    </aside>

    <aside
      v-if="assistantActive"
      id="assistant-pane"
      class="assistant-pane"
      :class="{ 'assistant-pane--floating': assistantFloating }"
      :style="assistantFloating ? floatingStyle : undefined"
      data-testid="assistant-pane"
      :aria-label="t('components.assistant.title')"
    >
      <div
        v-if="assistantResizable"
        class="assistant-dock-resize-handle"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-controls="assistant-pane"
        :aria-label="t('components.assistant.resizeWidth')"
        :aria-valuemin="assistantMinWidth"
        :aria-valuemax="assistantMaxWidth"
        :aria-valuenow="assistantWidth"
        data-testid="assistant-dock-resize"
        @pointerdown="startAssistantResize"
        @pointermove="resizeAssistant"
        @pointerup="stopAssistantResize"
        @pointercancel="stopAssistantResize"
        @lostpointercapture="stopAssistantResize"
        @keydown="resizeAssistantWithKeyboard"
      />
      <template v-if="assistantFloating">
        <button
          v-for="direction in ['top-left', 'top', 'left'] as const"
          :key="direction"
          class="assistant-resize-handle"
          :class="`assistant-resize-handle--${direction}`"
          type="button"
          :data-testid="`assistant-resize-${direction}`"
          :aria-label="t(`components.assistant.resize.${direction}`)"
          :title="t(`components.assistant.resize.${direction}`)"
          @pointerdown="startFloatingResize($event, direction)"
          @keydown="resizeWithKeyboard($event, direction)"
        />
      </template>
      <AssistantPanel @floating-drag-start="startFloatingDrag" />
    </aside>

    <AppTooltip v-if="assistantLauncherVisible" :label="assistantLauncherLabel">
      <button
        class="assistant-launcher"
        :class="{ 'assistant-launcher--focused': focused }"
        type="button"
        :data-testid="
          assistant.state.position === 'floating'
            ? 'assistant-floating-launcher'
            : 'assistant-launcher'
        "
        :aria-label="assistantLauncherLabel"
        @click="openAssistant"
      >
        <AppIcon name="assistant" :size="24" />
      </button>
    </AppTooltip>

    <div class="app-main">
      <header v-if="!immersive" class="topbar">
        <h2>{{ title }}</h2>
        <div class="flex items-center gap-3.5">
          <AppTooltip
            v-if="assistantAvailable && !focused && assistant.state.position !== 'floating'"
            :label="t('components.assistant.open')"
          >
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
            {{ locale === 'zh-CN' ? '中' : 'EN' }}
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
      <div v-if="immersive" id="main-content" tabindex="-1"><RouterView /></div>
      <main v-else id="main-content" class="page-container" tabindex="-1"><RouterView /></main>
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
