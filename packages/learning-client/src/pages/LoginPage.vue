<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useLearning } from '#learning-client/injection';
import { errorMessage } from '#learning-client/utils';
import AuthLayout from '#learning-client/components/AuthLayout.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppFormField from '#learning-client/components/AppFormField.vue';
import ConfirmDialog from '#learning-client/components/ConfirmDialog.vue';

const { t } = useI18n();
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
    learning.notify.error(t('management.login.loginFailed'), errorMessage(reason));
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
    learning.notify.error(t('management.login.switchFailed'), errorMessage(reason));
  } finally {
    switching.value = false;
    switchOpen.value = false;
  }
}

onMounted(() => {
  if (learning.state.authNotice) {
    learning.notify.warning(t('management.login.sessionExpired'), learning.state.authNotice);
    learning.state.authNotice = '';
  }
});

watch(
  () => route.query.changed,
  (changed) => {
    if (changed === '1') {
      learning.notify.success(
        t('management.login.passwordChanged'),
        t('management.login.passwordChangedNote'),
      );
    }
  },
  { immediate: true },
);
</script>

<template>
  <AuthLayout :title="t('management.login.title')" :description="t('management.login.description')">
    <div class="server-chip">
      <AppIcon name="server" :size="19" />
      <div>
        <strong>{{
          learning.state.serverInfo?.displayName ?? learning.state.connection?.displayName
        }}</strong
        ><span>{{ learning.state.connection?.baseUrl }}</span>
      </div>
      <span class="badge badge--green">{{ t('management.login.verified') }}</span>
    </div>
    <form class="auth-form" @submit.prevent="submit">
      <AppFormField id="username" :label="t('management.login.username')">
        <input
          id="username"
          v-model="username"
          class="input"
          name="username"
          autocomplete="username"
          required
          autofocus
        />
      </AppFormField>
      <AppFormField id="password" :label="t('management.login.password')">
        <input
          id="password"
          v-model="password"
          class="input"
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </AppFormField>
      <button class="button button--primary button--large" type="submit" :disabled="busy">
        <span v-if="busy" class="spinner" />{{
          busy ? t('management.login.submitting') : t('management.login.submit')
        }}
      </button>
    </form>
    <div v-if="learning.platform.kind === 'android'" class="auth-secondary">
      {{ t('management.login.otherServer')
      }}<button type="button" @click="switchOpen = true">
        {{ t('management.login.switchConnection') }}
      </button>
    </div>
    <ConfirmDialog
      v-model:open="switchOpen"
      :title="t('management.login.switchTitle')"
      :description="t('management.login.switchDescription')"
      :confirm-label="t('management.login.switchConfirm')"
      danger
      :busy="switching"
      @confirm="switchServer"
    >
      <p class="muted small">{{ t('management.login.switchNote') }}</p>
    </ConfirmDialog>
  </AuthLayout>
</template>
