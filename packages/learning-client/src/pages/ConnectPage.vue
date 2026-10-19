<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { ServerConnection, ServerInfo } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage } from '../utils';
import AuthLayout from '../components/AuthLayout.vue';
import AppIcon from '../components/AppIcon.vue';
import AppCheckbox from '../components/AppCheckbox.vue';

const { t } = useI18n();
const learning = useLearning();
const router = useRouter();
const address = ref('');
const busy = ref(false);
const confirming = ref(false);
const accepted = ref(false);
const pending = ref<{ connection: ServerConnection; info: ServerInfo } | null>(null);

async function verify() {
  if (!address.value.trim()) {
    learning.notify.warning(
      t('management.connect.verifyUnavailable'),
      t('management.connect.verifyUnavailableDesc'),
    );
    return;
  }
  busy.value = true;
  pending.value = null;
  accepted.value = false;
  try {
    pending.value = await learning.verifyConnection(address.value);
    learning.notify.success(t('management.connect.verifyOk'), t('management.connect.verifyOkDesc'));
  } catch (reason) {
    learning.notify.error(t('management.connect.verifyFailed'), errorMessage(reason));
  } finally {
    busy.value = false;
  }
}

async function confirm() {
  if (!pending.value || !accepted.value) return;
  confirming.value = true;
  try {
    await learning.confirmConnection(pending.value.connection, pending.value.info);
    learning.notify.success(t('management.connect.connected'));
    await router.replace({ name: 'login' });
  } catch (reason) {
    learning.notify.error(t('management.connect.connectFailed'), errorMessage(reason));
  } finally {
    confirming.value = false;
  }
}
</script>

<template>
  <AuthLayout
    :title="t('management.connect.title')"
    :description="t('management.connect.description')"
  >
    <form v-if="!pending" class="auth-form" @submit.prevent="verify">
      <div class="form-field">
        <label for="server-address">{{ t('management.connect.address') }}</label>
        <input
          id="server-address"
          v-model.trim="address"
          class="input"
          type="url"
          inputmode="url"
          autocomplete="url"
          placeholder="https://study.example.com/learn"
          required
          aria-describedby="server-address-hint"
        />
        <p id="server-address-hint" class="field-hint">
          {{ t('management.connect.addressHint') }}
        </p>
      </div>
      <button class="button button--primary button--large" type="submit" :disabled="busy">
        <span v-if="busy" class="spinner" /><AppIcon v-else name="server" :size="18" />{{
          t('management.connect.verify')
        }}
      </button>
    </form>
    <template v-else>
      <div class="connection-preview">
        <dl>
          <dt>{{ t('management.connect.serverName') }}</dt>
          <dd>{{ pending.info.displayName }}</dd>
          <dt>{{ t('management.connect.fullAddress') }}</dt>
          <dd>{{ pending.connection.baseUrl }}</dd>
          <dt>{{ t('management.connect.instanceId') }}</dt>
          <dd>{{ pending.connection.instanceId }}</dd>
          <dt>{{ t('management.connect.apiMajor') }}</dt>
          <dd>{{ pending.info.apiMajor }}</dd>
        </dl>
      </div>
      <div style="margin-top: 18px">
        <AppCheckbox v-model="accepted">
          {{ t('management.connect.trust') }}
        </AppCheckbox>
      </div>
      <div class="form-actions">
        <button class="button" type="button" :disabled="confirming" @click="pending = null">
          {{ t('management.connect.back') }}
        </button>
        <button
          class="button button--primary"
          type="button"
          :disabled="!accepted || confirming"
          @click="confirm"
        >
          <span v-if="confirming" class="spinner" />{{ t('management.connect.trustAndContinue') }}
        </button>
      </div>
    </template>
  </AuthLayout>
</template>
