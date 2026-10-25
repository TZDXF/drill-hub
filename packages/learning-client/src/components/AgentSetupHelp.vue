<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, ref } from 'vue';
import { useLearning } from '#learning-client/injection';
import { copyTextToClipboard } from '#learning-client/utils';
import AppIcon from '#learning-client/components/AppIcon.vue';

const { t } = useI18n();

const learning = useLearning();
const showInstructions = ref(false);
const deploymentBase = computed(() => learning.state.serverInfo?.publicBaseUrl ?? '');
const apiBase = computed(() => `${deploymentBase.value}/api/v1`);
const skillDownloadUrl = computed(() => `${deploymentBase.value}/downloads/drill-hub-skill.zip`);
const capabilityUrl = computed(() => `${apiBase.value}/agent/capabilities`);
const agentInstructions = computed(() =>
  t('components.agentSetup.instructions', {
    baseUrl: deploymentBase.value,
    apiBase: apiBase.value,
    skillUrl: skillDownloadUrl.value,
    capabilityUrl: capabilityUrl.value,
  }),
);

async function copyInstructions() {
  if (await copyTextToClipboard(agentInstructions.value)) {
    learning.notify.success(t('components.agentSetup.notifyCopied'));
  } else {
    showInstructions.value = true;
    learning.notify.error(
      t('components.agentSetup.notifyClipboardFailed'),
      t('components.agentSetup.notifyClipboardFailedDescription'),
    );
  }
}
</script>

<template>
  <section
    v-if="learning.state.serverInfo"
    class="paper-panel agent-setup-help"
    aria-labelledby="agent-setup-title"
  >
    <div class="agent-setup-heading">
      <div>
        <h2 id="agent-setup-title">
          <AppIcon name="book" />{{ t('components.agentSetup.heading') }}
        </h2>
        <p class="muted">{{ t('components.agentSetup.description') }}</p>
      </div>
      <button class="button button--small" type="button" @click="copyInstructions">
        {{ t('components.agentSetup.copyButton') }}
      </button>
    </div>
    <p v-if="learning.state.serverInfo.isLoopback" class="field-hint" role="status">
      {{ t('components.agentSetup.loopbackHint') }}
    </p>
    <textarea
      v-if="showInstructions"
      class="textarea"
      :aria-label="t('components.agentSetup.instructionsLabel')"
      :value="agentInstructions"
      rows="8"
      readonly
    />
  </section>
</template>

<style scoped>
.agent-setup-help {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
  padding: 20px;
}
.agent-setup-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.agent-setup-heading h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 16px;
}
.agent-setup-heading p {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
}
.agent-setup-heading .button {
  flex-shrink: 0;
}
@media (max-width: 600px) {
  .agent-setup-heading {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
