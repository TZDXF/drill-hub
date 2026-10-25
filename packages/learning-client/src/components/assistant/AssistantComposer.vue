<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAssistant } from '#learning-client/assistant/store';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppTooltip from '#learning-client/components/AppTooltip.vue';
import AssistantModelSelect from '#learning-client/components/assistant/AssistantModelSelect.vue';

const { t } = useI18n();
const assistant = useAssistant();
const state = assistant.state;

const input = ref('');

const busy = computed(() => Boolean(state.activeTurnId));

async function submit() {
  const text = input.value.trim();
  if (!text || busy.value) return;
  input.value = '';
  await assistant.send(text);
}

function onInputKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void submit();
  }
}
</script>

<template>
  <footer class="assistant-panel__footer">
    <div class="assistant-composer__toolbar">
      <AssistantModelSelect />
    </div>
    <div class="assistant-composer">
      <textarea
        v-model="input"
        rows="2"
        :placeholder="t('components.assistant.placeholder')"
        :disabled="busy"
        data-testid="assistant-input"
        @keydown="onInputKey"
      ></textarea>
      <AppTooltip v-if="busy" :label="t('components.assistant.stop')">
        <button
          class="assistant-composer__button"
          type="button"
          data-testid="assistant-cancel"
          :aria-label="t('components.assistant.stop')"
          @click="assistant.cancelTurn()"
        >
          <AppIcon name="square" :size="15" />
        </button>
      </AppTooltip>
      <AppTooltip v-else :label="t('components.assistant.send')">
        <button
          class="assistant-composer__button"
          type="button"
          data-testid="assistant-send"
          :disabled="!input.trim()"
          :aria-label="t('components.assistant.send')"
          @click="submit"
        >
          <AppIcon name="send" :size="15" />
        </button>
      </AppTooltip>
    </div>
  </footer>
</template>
