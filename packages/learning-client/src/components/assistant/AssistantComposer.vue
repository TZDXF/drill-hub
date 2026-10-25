<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AssistantImageAttachment, AssistantQueueMode } from '@drill-hub/contracts';
import type { AssistantSelectionQuote } from '#learning-client/assistant/selection';
import { useAssistant } from '#learning-client/assistant/store';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppTooltip from '#learning-client/components/AppTooltip.vue';
import AssistantModelSelect from '#learning-client/components/assistant/AssistantModelSelect.vue';
const text = defineModel<string>('text', { default: '' });
const quotes = defineModel<AssistantSelectionQuote[]>('quotes', { default: () => [] });
const props = withDefaults(defineProps<{ busy?: boolean; sending?: boolean }>(), {
  busy: false,
  sending: false,
});
const emit = defineEmits<{
  submit: [mode: AssistantQueueMode];
  editQuote: [quote: AssistantSelectionQuote];
  locateQuote: [quote: AssistantSelectionQuote];
}>();
const { t } = useI18n();
const assistant = useAssistant();
const images = ref<AssistantImageAttachment[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const composing = ref(false);
const queueMode = ref<AssistantQueueMode>('followUp');
const readingFiles = ref(false);
const canSubmit = computed(
  () =>
    !props.sending &&
    !readingFiles.value &&
    Boolean(text.value.trim() || images.value.length || quotes.value.length),
);
function onInputKey(event: KeyboardEvent) {
  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    composing.value ||
    event.isComposing ||
    event.keyCode === 229
  )
    return;
  event.preventDefault();
  void submit();
}
async function readFiles(files: FileList | File[]) {
  const selected = Array.from(files)
    .filter((file) => file.type.startsWith('image/'))
    .slice(0, 4 - images.value.length);
  if (!selected.length) return;
  readingFiles.value = true;
  try {
    for (const file of selected) {
      if (
        file.size > 5 * 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)
      )
        continue;
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (data)
        images.value.push({
          name: file.name,
          mimeType: file.type as AssistantImageAttachment['mimeType'],
          data,
        });
    }
  } finally {
    readingFiles.value = false;
  }
}
function onPaste(event: ClipboardEvent) {
  if (event.clipboardData?.files.length) {
    event.preventDefault();
    void readFiles(event.clipboardData.files);
  }
}
function onDrop(event: DragEvent) {
  if (event.dataTransfer?.files.length) {
    event.preventDefault();
    void readFiles(event.dataTransfer.files);
  }
}
async function submit() {
  if (!canSubmit.value) return;
  emit('submit', props.busy ? queueMode.value : 'followUp');
}
function clear() {
  text.value = '';
  quotes.value = [];
  images.value = [];
}
defineExpose({ clear, images });
</script>
<template>
  <footer class="assistant-panel__footer" @drop="onDrop" @dragover.prevent>
    <div class="assistant-composer__toolbar">
      <AssistantModelSelect /><span v-if="busy" class="assistant-composer__live-label">{{
        t('components.assistant.replyInProgress')
      }}</span>
    </div>
    <div v-if="quotes.length" class="assistant-composer-quotes">
      <span v-for="quote in quotes" :key="quote.id" class="assistant-quote-chip">
        <AppIcon name="quote" :size="12" /><span :title="quote.text">{{ quote.text }}</span
        ><small v-if="quote.comment"> · {{ quote.comment }}</small>
        <button
          v-if="quote.anchor"
          type="button"
          :aria-label="t('components.assistant.locateQuote')"
          :title="t('components.assistant.locateQuote')"
          @click="emit('locateQuote', quote)"
        >
          <AppIcon name="target" :size="11" />
        </button>
        <button
          type="button"
          :aria-label="t('components.assistant.editQuote')"
          @click="emit('editQuote', quote)"
        >
          <AppIcon name="edit" :size="11" />
        </button>
        <button
          type="button"
          :aria-label="t('components.assistant.removeQuote')"
          @click="quotes = quotes.filter((item) => item.id !== quote.id)"
        >
          <AppIcon name="close" :size="11" />
        </button>
      </span>
    </div>
    <div v-if="images.length" class="assistant-composer-images">
      <span
        v-for="(image, index) in images"
        :key="image.name + index"
        class="assistant-composer-image"
        ><img :src="`data:${image.mimeType};base64,${image.data}`" :alt="image.name" /><button
          type="button"
          :aria-label="t('components.assistant.removeImage')"
          @click="images.splice(index, 1)"
        >
          <AppIcon name="close" :size="11" /></button
      ></span>
    </div>
    <div class="assistant-composer">
      <textarea
        v-model="text"
        rows="2"
        :placeholder="t('components.assistant.placeholder')"
        :disabled="sending"
        data-testid="assistant-input"
        @keydown="onInputKey"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @paste="onPaste"
      />
      <div class="assistant-composer__buttons">
        <AppTooltip :label="t('components.assistant.attach')"
          ><button
            class="icon-button"
            type="button"
            :disabled="sending || images.length >= 4"
            :aria-label="t('components.assistant.attach')"
            @click="fileInput?.click()"
          >
            <AppIcon name="paperclip" :size="16" /></button
        ></AppTooltip>
        <select
          v-if="busy"
          v-model="queueMode"
          class="assistant-queue-mode"
          :aria-label="t('components.assistant.queueMode')"
        >
          <option value="followUp">{{ t('components.assistant.followUp') }}</option>
          <option value="steer">{{ t('components.assistant.steer') }}</option>
        </select>
        <AppTooltip v-if="busy" :label="t('components.assistant.stop')"
          ><button
            class="assistant-composer__button"
            type="button"
            data-testid="assistant-cancel"
            :aria-label="t('components.assistant.stop')"
            @click="assistant.cancelTurn()"
          >
            <AppIcon name="square" :size="15" /></button
        ></AppTooltip>
        <AppTooltip v-else :label="t('components.assistant.send')"
          ><button
            class="assistant-composer__button"
            type="button"
            data-testid="assistant-send"
            :disabled="!canSubmit"
            :aria-label="t('components.assistant.send')"
            @click="submit"
          >
            <AppIcon name="send" :size="15" /></button
        ></AppTooltip>
        <AppTooltip v-if="busy" :label="t('components.assistant.queueSend')"
          ><button
            class="assistant-composer__button assistant-composer__button--queue"
            type="button"
            :disabled="!canSubmit"
            :aria-label="t('components.assistant.queueSend')"
            @click="submit"
          >
            <AppIcon name="send" :size="15" /></button
        ></AppTooltip>
      </div>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      hidden
      @change="readFiles(($event.target as HTMLInputElement).files ?? [])"
    />
  </footer>
</template>
