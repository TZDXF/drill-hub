<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui';
import { useAssistant } from '#learning-client/assistant/store';
import { buildHistory } from '#learning-client/assistant/turns';
import { errorMessage } from '#learning-client/utils';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppTooltip from '#learning-client/components/AppTooltip.vue';
import ConfirmDialog from '#learning-client/components/ConfirmDialog.vue';
import MessageResponse from '#learning-client/components/ai-elements/message/MessageResponse.vue';
import AssistantComposer from '#learning-client/components/assistant/AssistantComposer.vue';
import AssistantProcessLine from '#learning-client/components/assistant/AssistantProcessLine.vue';

const { t } = useI18n();
const assistant = useAssistant();
const state = assistant.state;

const messageList = ref<HTMLElement | null>(null);
const threadToDelete = ref<{ id: string; title: string } | null>(null);
const deletingThread = ref(false);
const deleteError = ref('');

const currentThread = computed(
  () => state.threads.find((thread) => thread.id === state.currentThreadId) ?? null,
);

/** 按轮组装：用户消息 → 过程折叠行 → 助手回复；乐观活动轮追加在末尾。 */
const history = computed(() =>
  buildHistory({
    messages: state.messages,
    turns: state.turns,
    events: state.events,
    activeTurnId: state.activeTurnId,
    streamingText: state.streamingText,
  }),
);

const streaming = computed(() => Boolean(state.streamingText));

function itemKey(item: (typeof history.value)[number], index: number): string {
  if (item.kind === 'message') return item.message.id;
  return item.turn.turnId ?? `turn-${index}`;
}

function requestRemoveThread() {
  if (!currentThread.value || deletingThread.value) return;
  threadToDelete.value = { id: currentThread.value.id, title: currentThread.value.title };
  deleteError.value = '';
}

async function removeThread() {
  if (!threadToDelete.value || deletingThread.value) return;
  const threadId = threadToDelete.value.id;
  deletingThread.value = true;
  deleteError.value = '';
  try {
    await assistant.deleteThread(threadId);
    threadToDelete.value = null;
  } catch (reason) {
    deleteError.value = errorMessage(reason);
  } finally {
    deletingThread.value = false;
  }
}

async function switchThread(threadId: string) {
  try {
    await assistant.selectThread(threadId);
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}

async function createThread() {
  try {
    await assistant.newThread();
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}

watch(
  () => [state.messages.length, state.turns.length, state.streamingText, state.events.length],
  async () => {
    await nextTick();
    messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' });
  },
);
</script>

<template>
  <div class="assistant-panel" data-testid="assistant-panel">
    <header class="assistant-panel__header">
      <div class="assistant-panel__title" :title="currentThread?.title ?? ''">
        <AppIcon name="assistant" :size="17" />
        <strong>{{ currentThread?.title || t('components.assistant.title') }}</strong>
      </div>
      <div class="assistant-panel__actions">
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <button
              class="icon-button"
              type="button"
              data-testid="assistant-threads"
              :aria-label="t('components.assistant.threads')"
              :title="t('components.assistant.threads')"
            >
              <AppIcon name="message" :size="17" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="dropdown-content" align="end" :side-offset="6">
              <DropdownMenuItem
                v-for="thread in state.threads.slice(0, 8)"
                :key="thread.id"
                class="dropdown-item"
                @select="switchThread(thread.id)"
              >
                <AppIcon
                  :name="thread.id === state.currentThreadId ? 'check' : 'message'"
                  :size="16"
                />{{ thread.title }}
              </DropdownMenuItem>
              <DropdownMenuSeparator class="dropdown-separator" />
              <DropdownMenuItem class="dropdown-item" @select="createThread"
                ><AppIcon name="plus" :size="16" />{{
                  t('components.assistant.newThread')
                }}</DropdownMenuItem
              >
              <DropdownMenuItem
                v-if="currentThread"
                class="dropdown-item dropdown-item--danger"
                @select="requestRemoveThread"
                ><AppIcon name="trash" :size="16" />{{
                  t('components.assistant.deleteThread')
                }}</DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
        <AppTooltip :label="t('components.assistant.layoutSplit')">
          <button
            class="icon-button"
            type="button"
            :aria-label="t('components.assistant.layoutSplit')"
            @click="assistant.setLayout('split')"
          >
            <AppIcon name="panel" :size="17" />
          </button>
        </AppTooltip>
        <AppTooltip :label="t('components.assistant.close')">
          <button
            class="icon-button"
            type="button"
            :aria-label="t('components.assistant.close')"
            data-testid="assistant-close"
            @click="assistant.closePanel()"
          >
            <AppIcon name="close" :size="17" />
          </button>
        </AppTooltip>
      </div>
    </header>

    <div ref="messageList" class="assistant-panel__messages" data-testid="assistant-messages">
      <p v-if="!history.length" class="assistant-panel__empty">
        {{ t('components.assistant.welcome') }}
      </p>
      <template v-for="(item, index) in history" :key="itemKey(item, index)">
        <template v-if="item.kind === 'turn'">
          <div
            v-if="item.turn.userMessage"
            class="assistant-message assistant-message--user"
            data-testid="assistant-user-message"
          >
            {{ item.turn.userMessage.content }}
          </div>
          <AssistantProcessLine
            :actions="item.turn.actions"
            :active="item.turn.active"
            :streaming="streaming"
            :duration-ms="item.turn.durationMs"
            :failed="item.turn.failed"
          />
          <div
            v-if="item.turn.active && streaming"
            class="assistant-message assistant-message--streaming"
            data-testid="assistant-reply"
          >
            <MessageResponse :content="state.streamingText" class="assistant-markdown" />
          </div>
          <div
            v-else-if="item.turn.assistantMessage"
            class="assistant-message"
            data-testid="assistant-reply"
          >
            <MessageResponse
              :content="item.turn.assistantMessage.content || ' '"
              class="assistant-markdown"
            />
          </div>
        </template>
        <div
          v-else
          class="assistant-message"
          :class="{ 'assistant-message--user': item.message.role === 'user' }"
          :data-testid="item.message.role === 'user' ? 'assistant-user-message' : 'assistant-reply'"
        >
          <template v-if="item.message.role === 'user'">{{ item.message.content }}</template>
          <MessageResponse
            v-else
            :content="item.message.content || ' '"
            class="assistant-markdown"
          />
        </div>
      </template>
      <p v-if="state.error" class="assistant-panel__error">{{ state.error }}</p>
    </div>

    <AssistantComposer />
    <ConfirmDialog
      :open="Boolean(threadToDelete)"
      :title="t('components.assistant.deleteThreadTitle')"
      :description="
        threadToDelete
          ? t('components.assistant.deleteThreadDescription', { title: threadToDelete.title })
          : ''
      "
      :confirm-label="t('components.assistant.deleteThread')"
      :busy="deletingThread"
      danger
      @update:open="!$event && !deletingThread && (threadToDelete = null)"
      @confirm="removeThread"
    >
      <p v-if="deleteError" class="assistant-panel__error" role="alert">{{ deleteError }}</p>
    </ConfirmDialog>
  </div>
</template>
