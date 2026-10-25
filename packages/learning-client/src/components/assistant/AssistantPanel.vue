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
import type { AssistantEventView } from '@drill-hub/contracts';
import { useAssistant } from '../../assistant/store';
import { errorMessage } from '../../utils';
import AppIcon from '../AppIcon.vue';
import MessageResponse from '../ai-elements/message/MessageResponse.vue';

const { t } = useI18n();
const assistant = useAssistant();
const state = assistant.state;

const input = ref('');
const messageList = ref<HTMLElement | null>(null);

const currentThread = computed(
  () => state.threads.find((thread) => thread.id === state.currentThreadId) ?? null,
);

/** 本轮（活动或最近一次）事件，按序号展示为进度卡。 */
const turnEvents = computed<AssistantEventView[]>(() => {
  if (!state.events.length) return [];
  const lastErrorOrDone = [...state.events]
    .reverse()
    .find((event) => event.type === 'error' || event.payload?.phase === 'turn_completed');
  const cutoff = lastErrorOrDone ? state.events.indexOf(lastErrorOrDone) : -1;
  const remaining = cutoff >= 0 ? state.events.slice(cutoff + 1) : state.events;
  return state.activeTurnId ? remaining : [];
});

const busy = computed(() => Boolean(state.activeTurnId));

const lastAssistantStreaming = computed(() => {
  if (!state.streamingText) return null;
  return state.streamingText;
});

function visibleEvents(events: AssistantEventView[]) {
  return events.filter(
    (event) =>
      event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'ui_action',
  );
}

function eventLabel(event: AssistantEventView): string {
  const name = String(event.payload?.name ?? '');
  if (event.type === 'tool_call') return t('components.assistant.events.toolCall', { name });
  if (event.type === 'tool_result')
    return event.payload?.isError
      ? t('components.assistant.events.toolFailed', { name })
      : t('components.assistant.events.toolDone', { name });
  const action = event.payload?.action as { type?: string; route?: string } | undefined;
  if (event.type === 'ui_action')
    return action?.type === 'navigate'
      ? t('components.assistant.events.navigated', { route: String(action.route ?? '') })
      : t('components.assistant.events.layoutChanged');
  return '';
}

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

async function removeThread() {
  if (!state.currentThreadId) return;
  try {
    await assistant.deleteThread(state.currentThreadId);
  } catch (reason) {
    state.error = errorMessage(reason);
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
  () => [state.messages.length, state.streamingText, state.events.length],
  async () => {
    await nextTick();
    messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' });
  },
);
</script>

<template>
  <div class="assistant-panel" data-testid="assistant-panel">
    <header class="assistant-panel__header">
      <div class="assistant-panel__title">
        <AppIcon name="assistant" :size="17" />
        <strong>{{ t('components.assistant.title') }}</strong>
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
                @select="removeThread"
                ><AppIcon name="trash" :size="16" />{{
                  t('components.assistant.deleteThread')
                }}</DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
        <button
          class="icon-button"
          type="button"
          :aria-label="t('components.assistant.layoutSplit')"
          :title="t('components.assistant.layoutSplit')"
          @click="assistant.setLayout('split')"
        >
          <AppIcon name="panel" :size="17" />
        </button>
        <button
          class="icon-button"
          type="button"
          :aria-label="t('components.assistant.close')"
          :title="t('components.assistant.close')"
          data-testid="assistant-close"
          @click="assistant.closePanel()"
        >
          <AppIcon name="x" :size="17" />
        </button>
      </div>
    </header>

    <div ref="messageList" class="assistant-panel__messages" data-testid="assistant-messages">
      <p v-if="!state.messages.length" class="assistant-panel__empty">
        {{ t('components.assistant.welcome') }}
      </p>
      <div
        v-for="message in state.messages"
        :key="message.id"
        class="assistant-message"
        :class="{ 'assistant-message--user': message.role === 'user' }"
        :data-testid="message.role === 'user' ? 'assistant-user-message' : 'assistant-reply'"
      >
        <template v-if="message.role === 'user'">{{ message.content }}</template>
        <MessageResponse v-else :content="message.content || ' '" class="assistant-markdown" />
      </div>
      <template v-if="busy || lastAssistantStreaming">
        <div
          v-for="(event, index) in visibleEvents(turnEvents)"
          :key="event.seq"
          class="assistant-event"
          :class="{ 'assistant-event--error': event.payload?.isError }"
          :data-testid="index === 0 ? 'assistant-event-card' : undefined"
        >
          <AppIcon :name="event.type === 'ui_action' ? 'panel' : 'server'" :size="14" />{{
            eventLabel(event)
          }}
        </div>
        <div v-if="lastAssistantStreaming" class="assistant-message assistant-message--streaming">
          <MessageResponse :content="lastAssistantStreaming" class="assistant-markdown" />
        </div>
        <div v-else-if="busy" class="assistant-event" data-testid="assistant-waiting">
          <span class="assistant-dotting" aria-hidden="true"></span>
          {{ t('components.assistant.thinking') }}
        </div>
      </template>
      <p v-if="state.error" class="assistant-panel__error">{{ state.error }}</p>
    </div>

    <footer class="assistant-panel__input">
      <textarea
        v-model="input"
        rows="2"
        :placeholder="t('components.assistant.placeholder')"
        :disabled="busy"
        data-testid="assistant-input"
        @keydown="onInputKey"
      ></textarea>
      <button
        v-if="busy"
        class="icon-button"
        type="button"
        data-testid="assistant-cancel"
        :aria-label="t('components.assistant.stop')"
        @click="assistant.cancelTurn()"
      >
        <AppIcon name="square" :size="17" />
      </button>
      <button
        v-else
        class="icon-button assistant-panel__send"
        type="button"
        data-testid="assistant-send"
        :disabled="!input.trim()"
        :aria-label="t('components.assistant.send')"
        @click="submit"
      >
        <AppIcon name="send" :size="17" />
      </button>
    </footer>
  </div>
</template>
