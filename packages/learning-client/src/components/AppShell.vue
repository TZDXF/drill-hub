<script setup lang="ts">
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
import { errorMessage } from '../utils';
import AppIcon from './AppIcon.vue';
import AppScrollArea from './AppScrollArea.vue';

const learning = useLearning();
const route = useRoute();
const router = useRouter();
const immersive = computed(() => Boolean(route.meta.immersive));
const title = computed(() => {
  const names: Record<string, string> = {
    home: '今日学习',
    topics: '学习主题',
    'topic-detail': '主题详情',
    plan: '学习计划',
    content: '内容阅读',
    assessment: '参与说明',
    attempt: '作答',
    report: '学习报告',
    'wrong-questions': '错题集',
    'wrong-question-detail': '错题详情',
    history: '学习历史',
    archive: '归档',
    settings: '我的设置',
    'agent-tokens': 'Agent 授权',
    'admin-users': '账号管理',
    'admin-models': '供应商与模型',
    'admin-grading': '评分运维',
  };
  return names[String(route.name)] ?? '学习工作台';
});
const primaryNav = computed(() => [
  { name: 'home', label: '今日学习', icon: 'home' },
  { name: 'topics', label: '学习主题', icon: 'topics' },
  { name: 'wrong-questions', label: '错题集', icon: 'wrong', count: null },
  { name: 'history', label: '学习历史', icon: 'history' },
]);
const secondaryNav = computed(() => [
  { name: 'archive', label: '归档资源', icon: 'archive' },
  { name: 'settings', label: '我的设置', icon: 'settings' },
  { name: 'agent-tokens', label: 'Agent 授权', icon: 'token' },
]);
const adminNav = [
  { name: 'admin-users', label: '账号管理', icon: 'users' },
  { name: 'admin-models', label: '供应商与模型', icon: 'model' },
  { name: 'admin-grading', label: '评分运维', icon: 'server' },
];
const mobileNav = [
  { name: 'home', label: '今日', icon: 'home' },
  { name: 'topics', label: '主题', icon: 'topics' },
  { name: 'wrong-questions', label: '错题', icon: 'wrong' },
  { name: 'settings', label: '我的', icon: 'user' },
];

watch(
  () => learning.state.online,
  (online, previous) => {
    if (!online) {
      learning.notify.warning('网络连接已断开', '未保存的答案不会被视为已提交。');
    } else if (previous === false) {
      learning.notify.success('网络连接已恢复', '可以继续保存答案与读取最新状态。');
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
    return ['settings', 'agent-tokens', 'admin-users', 'admin-models', 'admin-grading'].includes(
      String(route.name),
    );
  return route.name === name;
}

function go(name: string) {
  void router.push({ name });
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
</script>

<template>
  <RouterView v-if="immersive" />
  <div v-else class="app-layout">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <aside class="sidebar">
      <RouterLink class="brand" :to="{ name: 'home' }" aria-label="Drill Hub 首页">
        <span class="brand-mark"><AppIcon name="book" :size="22" /></span>
        <span><strong>Drill Hub</strong><small>学习工作台</small></span>
      </RouterLink>
      <AppScrollArea class="sidebar-nav-scroll" orientation="vertical" type="hover">
        <nav class="sidebar-nav" aria-label="主导航">
          <span class="nav-section-label">学习</span>
          <RouterLink
            v-for="item in primaryNav"
            :key="item.name"
            :to="{ name: item.name }"
            class="nav-link"
            :class="{ active: isActive(item.name) }"
          >
            <AppIcon :name="item.icon" :size="19" /><span>{{ item.label }}</span>
          </RouterLink>
          <span class="nav-section-label">管理</span>
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
            <span class="nav-section-label">系统</span>
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
      <div class="sidebar-server">
        <AppIcon name="server" :size="17" />
        <div>
          <strong>{{
            learning.state.serverInfo?.displayName ?? learning.state.connection?.displayName
          }}</strong
          ><span>{{ learning.platform.kind === 'web' ? 'Web 会话' : 'Android 已连接' }}</span>
        </div>
        <span class="status-dot" :class="{ offline: !learning.state.online }" />
      </div>
    </aside>

    <div class="app-main">
      <header class="topbar">
        <h2>{{ title }}</h2>
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <button class="user-trigger" type="button">
              <span class="avatar">{{ learning.state.user?.displayName.slice(0, 1) }}</span>
              <span class="user-trigger__copy"
                ><strong>{{ learning.state.user?.displayName }}</strong
                ><small>{{
                  learning.state.user?.role === 'admin' ? '管理员' : '学习者'
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
                ><AppIcon name="settings" :size="17" />个人设置</DropdownMenuItem
              >
              <DropdownMenuItem class="dropdown-item" @select="go('agent-tokens')"
                ><AppIcon name="token" :size="17" />Agent 授权</DropdownMenuItem
              >
              <template v-if="learning.state.user?.role === 'admin'">
                <DropdownMenuSeparator class="dropdown-separator" />
                <DropdownMenuItem class="dropdown-item" @select="go('admin-users')"
                  ><AppIcon name="users" :size="17" />账号管理</DropdownMenuItem
                >
                <DropdownMenuItem class="dropdown-item" @select="go('admin-models')"
                  ><AppIcon name="model" :size="17" />系统模型设置</DropdownMenuItem
                >
              </template>
              <DropdownMenuSeparator class="dropdown-separator" />
              <DropdownMenuItem class="dropdown-item dropdown-item--danger" @select="logout"
                ><AppIcon name="logout" :size="17" />退出登录</DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </header>
      <main id="main-content" class="page-container" tabindex="-1"><RouterView /></main>
    </div>

    <nav class="bottom-nav" aria-label="手机主导航">
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
