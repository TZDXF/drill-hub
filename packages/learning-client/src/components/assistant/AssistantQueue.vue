<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AssistantQueueMode, AssistantQueuedMessage } from '@drill-hub/contracts';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppTooltip from '#learning-client/components/AppTooltip.vue';
const props = defineProps<{ items: AssistantQueuedMessage[] }>();
const emit = defineEmits<{
  update: [item: AssistantQueuedMessage, content: string, mode: AssistantQueueMode];
  remove: [item: AssistantQueuedMessage];
}>();
const { t } = useI18n();
const editing = ref<string | null>(null);
const draft = ref('');
const mode = ref<AssistantQueueMode>('followUp');
function start(item: AssistantQueuedMessage) {
  editing.value = item.id;
  draft.value = item.content;
  mode.value = item.mode;
}
function save(item: AssistantQueuedMessage) {
  if (draft.value.trim()) {
    emit('update', item, draft.value.trim(), mode.value);
    editing.value = null;
  }
}
</script>
<template>
  <section v-if="props.items.length" class="assistant-queue" aria-label="待发送消息">
    <header>
      <AppIcon name="list" :size="14" />{{
        t('components.assistant.queued', { count: props.items.length })
      }}
    </header>
    <div v-for="item in props.items" :key="item.id" class="assistant-queue-item">
      <template v-if="editing === item.id">
        <textarea v-model="draft" rows="2" @keydown.enter.exact.prevent="save(item)" /><select
          v-model="mode"
        >
          <option value="followUp">{{ t('components.assistant.followUp') }}</option>
          <option value="steer">{{ t('components.assistant.steer') }}</option></select
        ><button class="button button--primary" type="button" @click="save(item)">
          {{ t('components.assistant.saveQueue') }}
        </button></template
      >
      <template v-else
        ><span class="assistant-queue-item__mode">{{
          item.mode === 'steer'
            ? t('components.assistant.steer')
            : t('components.assistant.followUp')
        }}</span
        ><span class="assistant-queue-item__text">{{ item.content }}</span
        ><AppTooltip :label="t('components.assistant.editQueue')"
          ><button
            class="icon-button"
            type="button"
            :aria-label="t('components.assistant.editQueue')"
            @click="start(item)"
          >
            <AppIcon name="edit" :size="13" /></button></AppTooltip
        ><AppTooltip :label="t('components.assistant.removeQueue')"
          ><button
            class="icon-button"
            type="button"
            :aria-label="t('components.assistant.removeQueue')"
            @click="emit('remove', item)"
          >
            <AppIcon name="close" :size="13" /></button></AppTooltip
      ></template>
    </div>
  </section>
</template>
