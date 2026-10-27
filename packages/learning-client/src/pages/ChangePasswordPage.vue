<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useLearning } from '#learning-client/injection';
import { errorMessage } from '#learning-client/utils';
import AuthLayout from '#learning-client/components/AuthLayout.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppFormField from '#learning-client/components/AppFormField.vue';

const { t } = useI18n();
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
  confirmation.value && newPassword.value !== confirmation.value
    ? t('management.password.mismatch')
    : '',
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
    learning.notify.error(t('management.password.failed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout
    :title="t('management.password.title')"
    :description="t('management.password.description')"
  >
    <template #back>
      <RouterLink
        v-if="!learning.state.user?.mustChangePassword"
        class="back-link"
        :to="{ name: 'settings' }"
      >
        <AppIcon name="back" :size="16" />{{ t('management.password.back') }}
      </RouterLink>
    </template>

    <form class="auth-form" @submit.prevent="submit">
      <AppFormField id="current-password" :label="t('management.password.current')">
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
            :aria-label="
              showCurrentPassword
                ? t('management.password.hideCurrent')
                : t('management.password.showCurrent')
            "
            :aria-pressed="showCurrentPassword"
            @click="showCurrentPassword = !showCurrentPassword"
          >
            <AppIcon :name="showCurrentPassword ? 'eye-off' : 'eye'" :size="18" />
          </button>
        </div>
      </AppFormField>

      <AppFormField id="new-password" :label="t('management.password.new')">
        <div class="password-input">
          <input
            id="new-password"
            v-model="newPassword"
            class="input"
            :type="showNewPassword ? 'text' : 'password'"
            autocomplete="new-password"
            required
            minlength="8"
            maxlength="1024"
            aria-describedby="new-password-hint"
          />
          <button
            class="icon-button password-input__toggle"
            type="button"
            :aria-label="
              showNewPassword ? t('management.password.hideNew') : t('management.password.showNew')
            "
            :aria-pressed="showNewPassword"
            @click="showNewPassword = !showNewPassword"
          >
            <AppIcon :name="showNewPassword ? 'eye-off' : 'eye'" :size="18" />
          </button>
        </div>
        <p id="new-password-hint" class="field-hint">
          {{ t('management.password.newHint') }}
        </p>
      </AppFormField>

      <AppFormField id="confirm-password" :label="t('management.password.confirm')">
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
            :aria-label="
              showConfirmation
                ? t('management.password.hideConfirm')
                : t('management.password.showConfirm')
            "
            :aria-pressed="showConfirmation"
            @click="showConfirmation = !showConfirmation"
          >
            <AppIcon :name="showConfirmation ? 'eye-off' : 'eye'" :size="18" />
          </button>
        </div>
        <p v-if="confirmationError" id="confirm-password-error" class="field-error" role="alert">
          {{ confirmationError }}
        </p>
      </AppFormField>

      <button
        class="button button--primary button--large"
        type="submit"
        :disabled="busy || Boolean(confirmationError)"
      >
        <span v-if="busy" class="spinner" />{{
          busy ? t('management.password.submitting') : t('management.password.submit')
        }}
      </button>
    </form>

    <div class="password-notice">
      <AppIcon name="lock" :size="17" />
      <p>{{ t('management.password.notice') }}</p>
    </div>
  </AuthLayout>
</template>
