<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AssistantQueueMode, AssistantQueuedMessage } from '@drill-hub/contracts';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppTextarea from '#learning-client/components/AppTextarea.vue';
import AppTooltip from '#learning-client/components/AppTooltip.vue';
const props = defineProps<{ items: AssistantQueuedMessage[] }>();
const emit = defineEmits<{
  update: [item: AssistantQueuedMessage, content: string, mode: AssistantQueueMode];
  remove: [item: AssistantQueuedMessage];
  send: [item: AssistantQueuedMessage];
  reorder: [ids: string[]];
}>();
const { t } = useI18n();
const editing = ref<string | null>(null);
const draft = ref('');
const dragged = ref<string | null>(null);
function start(item: AssistantQueuedMessage) {
  editing.value = item.id;
  draft.value = item.content;
}
function save(item: AssistantQueuedMessage) {
  if (!draft.value.trim()) return;
  emit('update', item, draft.value.trim(), item.mode);
  editing.value = null;
}
function move(index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= props.items.length) return;
  const ids = props.items.map((item) => item.id);
  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  emit('reorder', ids);
}
function drop(targetId: string) {
  if (!dragged.value || dragged.value === targetId) return;
  const ids = props.items.map((item) => item.id);
  const from = ids.indexOf(dragged.value);
  const to = ids.indexOf(targetId);
  if (from >= 0 && to >= 0) ids.splice(to, 0, ids.splice(from, 1)[0]!);
  dragged.value = null;
  emit('reorder', ids);
}
</script>
<template>
  <section v-if="props.items.length" class="assistant-queue" aria-label="待发送消息">
    <header>
      <AppIcon name="list" :size="14" />{{
        t('components.assistant.queued', { count: props.items.length })
      }}
    </header>
    <div
      v-for="(item, index) in props.items"
      :key="item.id"
      class="assistant-queue-item"
      :class="{ 'assistant-queue-item--dragged': dragged === item.id }"
      @dragover.prevent
      @drop.prevent="drop(item.id)"
    >
      <span
        class="assistant-queue-item__drag"
        draggable="true"
        :title="t('components.assistant.dragQueue')"
        @dragstart="dragged = item.id"
        @dragend="dragged = null"
        ><AppIcon name="grip" :size="14"
      /></span>
      <template v-if="editing === item.id">
        <AppTextarea
          v-model="draft"
          rows="2"
          :aria-label="t('components.assistant.editQueue')"
          @keydown.enter.exact.prevent="save(item)"
          @keydown.esc="editing = null"
        />
        <div class="assistant-queue-item__actions">
          <button class="button button--primary" type="button" @click="save(item)">
            {{ t('components.assistant.saveQueue') }}
          </button>
          <button class="button" type="button" @click="editing = null">
            {{ t('components.assistant.cancelQueueEdit') }}
          </button>
        </div>
      </template>
      <template v-else>
        <span class="assistant-queue-item__text" :title="item.content">{{ item.content }}</span>
        <div class="assistant-queue-item__actions">
          <button class="assistant-queue-item__send" type="button" @click="emit('send', item)">
            {{ t('components.assistant.sendQueueNow') }}
          </button>
          <AppTooltip :label="t('components.assistant.moveQueueUp')"
            ><button
              class="icon-button"
              type="button"
              :disabled="index === 0"
              :aria-label="t('components.assistant.moveQueueUp')"
              @click="move(index, -1)"
            >
              <AppIcon name="arrowUp" :size="13" /></button
          ></AppTooltip>
          <AppTooltip :label="t('components.assistant.moveQueueDown')"
            ><button
              class="icon-button"
              type="button"
              :disabled="index === props.items.length - 1"
              :aria-label="t('components.assistant.moveQueueDown')"
              @click="move(index, 1)"
            >
              <AppIcon name="arrowDown" :size="13" /></button
          ></AppTooltip>
          <AppTooltip :label="t('components.assistant.editQueue')"
            ><button
              class="icon-button"
              type="button"
              :aria-label="t('components.assistant.editQueue')"
              @click="start(item)"
            >
              <AppIcon name="edit" :size="13" /></button
          ></AppTooltip>
          <AppTooltip :label="t('components.assistant.removeQueue')"
            ><button
              class="icon-button"
              type="button"
              :aria-label="t('components.assistant.removeQueue')"
              @click="emit('remove', item)"
            >
              <AppIcon name="trash" :size="13" /></button
          ></AppTooltip>
        </div>
      </template>
    </div>
  </section>
</template>
