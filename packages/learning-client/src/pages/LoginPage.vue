<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useLearning } from '../injection';
import { errorMessage } from '../utils';
import AuthLayout from '../components/AuthLayout.vue';
import AppIcon from '../components/AppIcon.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const learning = useLearning();
const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const busy = ref(false);
const switchOpen = ref(false);
const switching = ref(false);

async function submit() {
  busy.value = true;
  try {
    await learning.login(username.value, password.value);
    password.value = '';
    const redirect =
      typeof route.query.redirect === 'string' &&
      route.query.redirect.startsWith('/') &&
      !route.query.redirect.startsWith('//')
        ? route.query.redirect
        : '/';
    await router.replace(redirect);
  } catch (reason) {
    learning.notify.error('登录失败', errorMessage(reason));
  } finally {
    busy.value = false;
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

onMounted(() => {
  if (learning.state.authNotice) {
    learning.notify.warning('登录状态已失效', learning.state.authNotice);
    learning.state.authNotice = '';
  }
  if (route.query.changed === '1') {
    learning.notify.success('密码已修改', '请使用新密码重新登录。');
  }
});
</script>

<template>
  <AuthLayout title="欢迎回来" description="登录后继续你的学习计划与作答记录。">
    <div class="server-chip">
      <AppIcon name="server" :size="19" />
      <div>
        <strong>{{
          learning.state.serverInfo?.displayName ?? learning.state.connection?.displayName
        }}</strong
        ><span>{{ learning.state.connection?.baseUrl }}</span>
      </div>
      <span class="badge badge--green">已验证</span>
    </div>
    <form class="auth-form" @submit.prevent="submit">
      <div class="form-field">
        <label for="username">用户名</label>
        <input
          id="username"
          v-model="username"
          class="input"
          name="username"
          autocomplete="username"
          required
          autofocus
        />
      </div>
      <div class="form-field">
        <label for="password">密码</label>
        <input
          id="password"
          v-model="password"
          class="input"
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </div>
      <button class="button button--primary button--large" type="submit" :disabled="busy">
        <span v-if="busy" class="spinner" />{{ busy ? '正在登录…' : '登录' }}
      </button>
    </form>
    <div v-if="learning.platform.kind === 'android'" class="auth-secondary">
      不是这台服务器？<button type="button" @click="switchOpen = true">切换连接</button>
    </div>
    <ConfirmDialog
      v-model:open="switchOpen"
      title="切换学习服务器？"
      description="将中止当前连接的全部在途请求并清除本机当前会话；原服务器上的考试不会暂停。"
      confirm-label="切换服务器"
      danger
      :busy="switching"
      @confirm="switchServer"
    >
      <p class="muted small">未成功保存的答案不会转移到新服务器，也不会自动上传到原服务器。</p>
    </ConfirmDialog>
  </AuthLayout>
</template>
