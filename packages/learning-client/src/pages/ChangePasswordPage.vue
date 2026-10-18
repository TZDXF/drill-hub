<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useLearning } from '../injection';
import { errorMessage } from '../utils';
import AuthLayout from '../components/AuthLayout.vue';
import AppIcon from '../components/AppIcon.vue';

const learning = useLearning();
const router = useRouter();
const currentPassword = ref('');
const newPassword = ref('');
const confirmation = ref('');
const showCurrentPassword = ref(false);
const showNewPassword = ref(false);
const showConfirmation = ref(false);
const busy = ref(false);
const confirmationError = computed(() =>
  confirmation.value && newPassword.value !== confirmation.value ? '两次输入的新密码不一致。' : '',
);

async function submit() {
  if (confirmationError.value) return;
  busy.value = true;
  try {
    await learning.patch<{ changed: boolean }>('/me/password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    });
    currentPassword.value = '';
    newPassword.value = '';
    confirmation.value = '';
    await learning.logout().catch(() => undefined);
    await router.replace({ name: 'login', query: { changed: '1' } });
  } catch (reason) {
    learning.notify.error('修改密码失败', errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout title="修改密码" description="验证当前密码，并设置一个仅用于 Drill Hub 的新密码。">
    <template #back>
      <RouterLink
        v-if="!learning.state.user?.mustChangePassword"
        class="back-link"
        :to="{ name: 'settings' }"
      >
        <AppIcon name="back" :size="16" />返回个人设置
      </RouterLink>
    </template>

    <form class="auth-form" @submit.prevent="submit">
      <div class="form-field">
        <label for="current-password">当前密码</label>
        <div class="password-input">
          <input
            id="current-password"
            v-model="currentPassword"
            class="input"
            :type="showCurrentPassword ? 'text' : 'password'"
            autocomplete="current-password"
            required
          />
          <button
            class="icon-button password-input__toggle"
            type="button"
            :aria-label="showCurrentPassword ? '隐藏当前密码' : '显示当前密码'"
            :aria-pressed="showCurrentPassword"
            @click="showCurrentPassword = !showCurrentPassword"
          >
            <AppIcon :name="showCurrentPassword ? 'eye-off' : 'eye'" :size="18" />
          </button>
        </div>
      </div>

      <div class="form-field">
        <label for="new-password">新密码</label>
        <div class="password-input">
          <input
            id="new-password"
            v-model="newPassword"
            class="input"
            :type="showNewPassword ? 'text' : 'password'"
            autocomplete="new-password"
            required
            minlength="4"
            aria-describedby="new-password-hint"
          />
          <button
            class="icon-button password-input__toggle"
            type="button"
            :aria-label="showNewPassword ? '隐藏新密码' : '显示新密码'"
            :aria-pressed="showNewPassword"
            @click="showNewPassword = !showNewPassword"
          >
            <AppIcon :name="showNewPassword ? 'eye-off' : 'eye'" :size="18" />
          </button>
        </div>
        <p id="new-password-hint" class="field-hint">
          密码长度至少为 4 个字符，请勿与其他服务重复。
        </p>
      </div>

      <div class="form-field">
        <label for="confirm-password">确认新密码</label>
        <div class="password-input">
          <input
            id="confirm-password"
            v-model="confirmation"
            class="input"
            :type="showConfirmation ? 'text' : 'password'"
            autocomplete="new-password"
            required
            :aria-invalid="Boolean(confirmationError)"
            :aria-describedby="confirmationError ? 'confirm-password-error' : undefined"
          />
          <button
            class="icon-button password-input__toggle"
            type="button"
            :aria-label="showConfirmation ? '隐藏确认密码' : '显示确认密码'"
            :aria-pressed="showConfirmation"
            @click="showConfirmation = !showConfirmation"
          >
            <AppIcon :name="showConfirmation ? 'eye-off' : 'eye'" :size="18" />
          </button>
        </div>
        <p v-if="confirmationError" id="confirm-password-error" class="field-error" role="alert">
          {{ confirmationError }}
        </p>
      </div>

      <button
        class="button button--primary button--large"
        type="submit"
        :disabled="busy || Boolean(confirmationError)"
      >
        <span v-if="busy" class="spinner" />{{ busy ? '正在修改…' : '确认修改' }}
      </button>
    </form>

    <div class="password-notice">
      <AppIcon name="lock" :size="17" />
      <p>修改成功后，当前及其他设备的登录会话都会失效，请使用新密码重新登录。</p>
    </div>
  </AuthLayout>
</template>
