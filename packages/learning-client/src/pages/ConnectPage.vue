<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ServerConnection, ServerInfo } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { errorMessage } from '../utils';
import AuthLayout from '../components/AuthLayout.vue';
import AppIcon from '../components/AppIcon.vue';
import AppCheckbox from '../components/AppCheckbox.vue';

const learning = useLearning();
const router = useRouter();
const address = ref('');
const busy = ref(false);
const confirming = ref(false);
const accepted = ref(false);
const pending = ref<{ connection: ServerConnection; info: ServerInfo } | null>(null);

async function verify() {
  if (!address.value.trim()) {
    learning.notify.warning('无法验证服务器', '请输入服务器地址。');
    return;
  }
  busy.value = true;
  pending.value = null;
  accepted.value = false;
  try {
    pending.value = await learning.verifyConnection(address.value);
    learning.notify.success('服务验证通过', '已确认 Drill Hub 服务标记与兼容 API 主版本。');
  } catch (reason) {
    learning.notify.error('服务器验证失败', errorMessage(reason));
  } finally {
    busy.value = false;
  }
}

async function confirm() {
  if (!pending.value || !accepted.value) return;
  confirming.value = true;
  try {
    await learning.confirmConnection(pending.value.connection, pending.value.info);
    learning.notify.success('学习服务器已连接');
    await router.replace({ name: 'login' });
  } catch (reason) {
    learning.notify.error('连接服务器失败', errorMessage(reason));
  } finally {
    confirming.value = false;
  }
}
</script>

<template>
  <AuthLayout
    title="连接学习服务器"
    description="先验证服务身份与协议版本，确认后才会向该地址发送账号密码。"
  >
    <form v-if="!pending" class="auth-form" @submit.prevent="verify">
      <div class="form-field">
        <label for="server-address">服务器地址</label>
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
          支持部署路径前缀与 HTTP/HTTPS。使用 HTTP
          时数据不加密，请只在可信网络中部署；不提供忽略证书错误选项。
        </p>
      </div>
      <button class="button button--primary button--large" type="submit" :disabled="busy">
        <span v-if="busy" class="spinner" /><AppIcon v-else name="server" :size="18" />验证服务器
      </button>
    </form>
    <template v-else>
      <div class="connection-preview">
        <dl>
          <dt>服务器名称</dt>
          <dd>{{ pending.info.displayName }}</dd>
          <dt>完整连接地址</dt>
          <dd>{{ pending.connection.baseUrl }}</dd>
          <dt>实例标识</dt>
          <dd>{{ pending.connection.instanceId }}</dd>
          <dt>API 主版本</dt>
          <dd>{{ pending.info.apiMajor }}</dd>
        </dl>
      </div>
      <div style="margin-top: 18px">
        <AppCheckbox v-model="accepted">
          我确认以上地址是要连接的学习服务器，并了解服务标记不能替代对地址与传输安全的核对。
        </AppCheckbox>
      </div>
      <div class="form-actions">
        <button class="button" type="button" :disabled="confirming" @click="pending = null">
          返回修改
        </button>
        <button
          class="button button--primary"
          type="button"
          :disabled="!accepted || confirming"
          @click="confirm"
        >
          <span v-if="confirming" class="spinner" />确认信任并继续
        </button>
      </div>
    </template>
  </AuthLayout>
</template>
