<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui';
import type {
  AssistantImageAttachment,
  AssistantMessageView,
  AssistantQueueMode,
  AssistantQueuedMessage,
  AssistantTimelineTurn,
} from '@drill-hub/contracts';
import { useAssistant } from '#learning-client/assistant/store';
import { useAssistantHistory } from '#learning-client/assistant/history';
import {
  buildPromptWithQuotes,
  parsePromptQuotes,
  type AssistantSelectionQuote,
} from '#learning-client/assistant/selection';
import { useConversationScroll } from '#learning-client/assistant/useConversationScroll';
import { errorMessage } from '#learning-client/utils';
import AppIcon from '#learning-client/components/AppIcon.vue';
import AppTextarea from '#learning-client/components/AppTextarea.vue';
import AppTooltip from '#learning-client/components/AppTooltip.vue';
import AppDialog from '#learning-client/components/AppDialog.vue';
import ConfirmDialog from '#learning-client/components/ConfirmDialog.vue';
import MessageResponse from '#learning-client/components/ai-elements/message/MessageResponse.vue';
import AssistantComposer from '#learning-client/components/assistant/AssistantComposer.vue';
import AssistantTurn from '#learning-client/components/assistant/AssistantTurn.vue';
import AssistantUserMessage from '#learning-client/components/assistant/AssistantUserMessage.vue';
import AssistantVirtualItem from '#learning-client/components/assistant/AssistantVirtualItem.vue';
import AssistantQueue from '#learning-client/components/assistant/AssistantQueue.vue';
import AssistantTimeline from '#learning-client/components/assistant/AssistantTimeline.vue';
import AssistantSelectionMenu from '#learning-client/components/assistant/AssistantSelectionMenu.vue';
import { flashSelection, selectionContentRoot } from '#learning-client/assistant/selectionAnchors';

const { t } = useI18n();
const assistant = useAssistant();
const state = assistant.state;
const { history } = useAssistantHistory(state);
const content = ref<HTMLElement | null>(null);
const scroll = useConversationScroll(content);
const draft = ref('');
const quotes = ref<AssistantSelectionQuote[]>([]);
const composer = ref<InstanceType<typeof AssistantComposer> | null>(null);
const sending = ref(false);
const threadToDelete = ref<{ id: string; title: string } | null>(null);
const deletingThread = ref(false);
const deleteError = ref('');
const previewImage = ref<AssistantImageAttachment | null>(null);
const quoteToEdit = ref<AssistantSelectionQuote | null>(null);
const quoteComment = ref('');
const copied = ref(false);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
let clearSelectionFlash: (() => void) | null = null;
const busy = computed(() => Boolean(state.activeTurnId));
const currentThread = computed(
  () => state.threads.find((thread) => thread.id === state.currentThreadId) ?? null,
);
const lastUserId = computed(() =>
  [...history.value].reverse().find((item) => item.kind === 'turn' && item.turn.userMessage)
    ?.kind === 'turn'
    ? (
        [...history.value]
          .reverse()
          .find((item) => item.kind === 'turn' && item.turn.userMessage) as Extract<
          (typeof history.value)[number],
          { kind: 'turn' }
        >
      ).turn.userMessage?.id
    : null,
);
function itemKey(item: (typeof history.value)[number], index: number): string {
  return item.kind === 'message' ? item.message.id : (item.turn.turnId ?? `turn-${index}`);
}
function notifyCopied() {
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1600);
}
function requestRemoveThread() {
  if (currentThread.value && !deletingThread.value) {
    threadToDelete.value = { id: currentThread.value.id, title: currentThread.value.title };
    deleteError.value = '';
  }
}
async function removeThread() {
  if (!threadToDelete.value || deletingThread.value) return;
  deletingThread.value = true;
  deleteError.value = '';
  try {
    await assistant.deleteThread(threadToDelete.value.id);
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
    scroll.scrollToBottom();
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
async function createThread() {
  try {
    await assistant.newThread();
    scroll.scrollToBottom();
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
async function submit(mode: AssistantQueueMode) {
  if (sending.value) return;
  const text = draft.value;
  const selectedQuotes = [...quotes.value];
  const images = [...(composer.value?.images ?? [])];
  sending.value = true;
  try {
    await assistant.send(buildPromptWithQuotes(text, selectedQuotes), { images, mode });
    composer.value?.clear();
    draft.value = '';
    quotes.value = [];
    scroll.scrollToBottom();
  } catch {
    draft.value = text;
    quotes.value = selectedQuotes;
  } finally {
    sending.value = false;
  }
}
async function editMessage(message: AssistantMessageView) {
  const turn = state.turns.find((item) => item.userMessageId === message.id);
  if (!turn || busy.value) return;
  try {
    await assistant.forkThread(turn.id, 'before');
    const parsed = parsePromptQuotes(message.content);
    draft.value = parsed.visibleContent;
    quotes.value = parsed.quotes;
    await nextTick();
    scroll.scrollToBottom();
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
async function forkTurn(turnId: string) {
  try {
    await assistant.forkThread(turnId, 'through');
    scroll.scrollToBottom();
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
async function retryTurn(item: Extract<(typeof history.value)[number], { kind: 'turn' }>['turn']) {
  if (!item.turnId || !item.userMessage) return;
  const message = item.userMessage;
  try {
    await assistant.forkThread(item.turnId, 'before');
    await assistant.send(message.content, { images: message.images });
    scroll.scrollToBottom();
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
async function navigateTimeline(turn: AssistantTimelineTurn) {
  try {
    const id = await assistant.revealTurn(turn.id);
    if (id) await scroll.scrollToMessage(id);
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
async function onHistoryScroll() {
  scroll.onScroll();
  const viewport = scroll.viewport.value;
  if (
    !viewport ||
    !scroll.userScrolled.value ||
    viewport.scrollTop > 500 ||
    !state.hasOlder ||
    state.historyLoading
  )
    return;
  const height = viewport.scrollHeight;
  const threadId = state.currentThreadId;
  scroll.stop();
  try {
    await assistant.loadOlder();
    await nextTick();
    if (viewport.isConnected && state.currentThreadId === threadId)
      viewport.scrollTop += viewport.scrollHeight - height;
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
function addQuote(quote: AssistantSelectionQuote) {
  if (
    !quotes.value.some(
      (item) =>
        item.text === quote.text &&
        item.anchor?.messageId === quote.anchor?.messageId &&
        item.anchor?.start === quote.anchor?.start &&
        item.anchor?.end === quote.anchor?.end,
    )
  )
    quotes.value.push(quote);
}
async function locateQuote(quote: AssistantSelectionQuote) {
  const anchor = quote.anchor;
  const viewport = scroll.viewport.value;
  if (!anchor || !viewport) return;
  clearSelectionFlash?.();
  clearSelectionFlash = null;
  scroll.stop();
  const threadId = state.currentThreadId;
  const revealMessage = async () => {
    const index = history.value.findIndex((item) =>
      item.kind === 'message'
        ? item.message.id === anchor.messageId
        : item.turn.userMessage?.id === anchor.messageId ||
          item.turn.assistantMessage?.id === anchor.messageId,
    );
    if (index < 0) return;
    const key = itemKey(history.value[index]!, index);
    viewport
      .querySelector(`[data-history-key="${CSS.escape(key)}"]`)
      ?.dispatchEvent(new CustomEvent('virtual-reveal'));
    await nextTick();
  };
  await revealMessage();
  let root = selectionContentRoot(viewport, anchor.messageId);
  while (!root && state.hasOlder) {
    const previousOldest = state.oldestMessageId;
    await assistant.loadOlder();
    if (state.currentThreadId !== threadId) return;
    await revealMessage();
    root = selectionContentRoot(viewport, anchor.messageId);
    if (!root && state.oldestMessageId === previousOldest) return;
  }
  if (!root) return;
  viewport.scrollTo({
    top:
      viewport.scrollTop +
      root.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      Math.max(24, (viewport.clientHeight - root.clientHeight) / 2),
    behavior: 'instant',
  });
  clearSelectionFlash = flashSelection(root, anchor);
}
function editQuote(quote: AssistantSelectionQuote) {
  quoteToEdit.value = quote;
  quoteComment.value = quote.comment ?? '';
}
function saveQuote() {
  if (quoteToEdit.value) quoteToEdit.value.comment = quoteComment.value.trim();
  quoteToEdit.value = null;
}
async function updateQueue(item: AssistantQueuedMessage, text: string, mode: AssistantQueueMode) {
  try {
    await assistant.updateQueued(item.id, text, mode);
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
async function removeQueue(item: AssistantQueuedMessage) {
  try {
    await assistant.removeQueued(item.id);
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
async function reorderQueue(ids: string[]) {
  try {
    await assistant.reorderQueued(ids);
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
async function sendQueueNow(item: AssistantQueuedMessage) {
  try {
    await assistant.sendQueuedNow(item.id);
  } catch (reason) {
    state.error = errorMessage(reason);
  }
}
watch(
  () => state.activeTurnId,
  (active) => {
    if (active && !clock)
      clock = setInterval(() => {
        now.value = Date.now();
      }, 1000);
    if (!active && clock) {
      clearInterval(clock);
      clock = null;
    }
  },
  { immediate: true },
);
watch(
  () => state.currentThreadId,
  () => {
    clearSelectionFlash?.();
    clearSelectionFlash = null;
    draft.value = '';
    quotes.value = [];
  },
);
onBeforeUnmount(() => {
  if (clock) clearInterval(clock);
  clearSelectionFlash?.();
});
</script>

<template>
  <div class="assistant-panel" data-testid="assistant-panel">
    <header class="assistant-panel__header">
      <div class="assistant-panel__title" :title="currentThread?.title ?? ''">
        <AppIcon name="assistant" :size="17" /><strong>{{
          currentThread?.title || t('components.assistant.title')
        }}</strong>
      </div>
      <div class="assistant-panel__actions">
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child
            ><button
              class="icon-button"
              type="button"
              data-testid="assistant-threads"
              :aria-label="t('components.assistant.threads')"
              :title="t('components.assistant.threads')"
            >
              <AppIcon name="message" :size="17" /></button
          ></DropdownMenuTrigger>
          <DropdownMenuPortal
            ><DropdownMenuContent
              class="dropdown-content assistant-thread-menu"
              align="end"
              :side-offset="6"
            >
              <DropdownMenuItem
                v-for="thread in state.threads"
                :key="thread.id"
                class="dropdown-item"
                @select="switchThread(thread.id)"
                ><AppIcon
                  :name="thread.id === state.currentThreadId ? 'check' : 'message'"
                  :size="16"
                /><span>{{ thread.title }}</span></DropdownMenuItem
              >
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
            </DropdownMenuContent></DropdownMenuPortal
          >
        </DropdownMenuRoot>
        <AppTooltip :label="t('components.assistant.layoutSplit')"
          ><button
            class="icon-button"
            type="button"
            :aria-label="t('components.assistant.layoutSplit')"
            @click="assistant.setLayout('split')"
          >
            <AppIcon name="panel" :size="17" /></button
        ></AppTooltip>
        <AppTooltip :label="t('components.assistant.close')"
          ><button
            class="icon-button"
            type="button"
            :aria-label="t('components.assistant.close')"
            data-testid="assistant-close"
            @click="assistant.closePanel()"
          >
            <AppIcon name="close" :size="17" /></button
        ></AppTooltip>
      </div>
    </header>
    <div class="assistant-conversation">
      <div
        :ref="scroll.viewport"
        class="assistant-panel__messages assistant-viewport"
        data-testid="assistant-messages"
        role="log"
        :aria-label="t('components.assistant.title')"
        tabindex="0"
        @scroll="onHistoryScroll"
      >
        <div ref="content" class="assistant-message-content">
          <p v-if="state.historyLoading" class="assistant-history-loading" role="status">
            {{ t('components.assistant.historyLoading') }}
          </p>
          <p v-if="!history.length" class="assistant-panel__empty">
            {{ t('components.assistant.welcome') }}
          </p>
          <template v-for="(item, index) in history" :key="itemKey(item, index)">
            <AssistantVirtualItem
              :pinned="index >= history.length - 4"
              :live="item.kind === 'turn' && item.turn.active"
              :data-history-key="itemKey(item, index)"
            >
              <AssistantTurn
                v-if="item.kind === 'turn'"
                :item="item.turn"
                :streaming-text="state.streamingText"
                :streaming-reasoning="state.streamingReasoning"
                :now="now"
                :can-edit="item.turn.userMessage?.id === lastUserId"
                :busy="busy"
                @edit="editMessage"
                @fork="forkTurn"
                @retry="retryTurn"
                @copy="notifyCopied"
                @preview="previewImage = $event"
              />
              <AssistantUserMessage
                v-else-if="item.message.role === 'user'"
                :message="item.message"
                :busy="busy"
                @copy="notifyCopied"
                @preview="previewImage = $event"
              />
              <div
                v-else
                class="assistant-message assistant-message--assistant"
                :data-message-id="item.message.id"
                data-selection-source="assistant"
                data-testid="assistant-reply"
              >
                <MessageResponse
                  :content="item.message.content || ' '"
                  class="assistant-markdown"
                  data-selection-content
                />
              </div>
            </AssistantVirtualItem>
          </template>
          <p v-if="state.error" class="assistant-panel__error" role="alert">{{ state.error }}</p>
        </div>
      </div>
      <AssistantTimeline :turns="state.timeline" @navigate="navigateTimeline" />
      <AppTooltip v-if="!scroll.atBottom.value" :label="t('components.assistant.backToBottom')"
        ><button
          class="assistant-scroll-bottom"
          type="button"
          :aria-label="t('components.assistant.backToBottom')"
          @click="scroll.scrollToBottom(true)"
        >
          <AppIcon name="arrowDown" :size="17" /></button
      ></AppTooltip>
      <AssistantSelectionMenu :root="scroll.viewport" @quote="addQuote" />
    </div>
    <AssistantQueue
      :items="state.queued"
      @update="updateQueue"
      @remove="removeQueue"
      @send="sendQueueNow"
      @reorder="reorderQueue"
    />
    <AssistantComposer
      ref="composer"
      v-model:text="draft"
      v-model:quotes="quotes"
      :busy="busy"
      :sending="sending"
      @submit="submit"
      @edit-quote="editQuote"
      @locate-quote="locateQuote"
    />
    <span v-if="copied" class="assistant-copied" role="status">{{
      t('components.assistant.copied')
    }}</span>
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
      ><p v-if="deleteError" class="assistant-panel__error" role="alert">
        {{ deleteError }}
      </p></ConfirmDialog
    >
    <AppDialog
      class="dialog-content"
      :open="Boolean(previewImage)"
      :title="previewImage?.name ?? ''"
      @update:open="!$event && (previewImage = null)"
      ><img
        v-if="previewImage"
        class="assistant-image-preview"
        :src="`data:${previewImage.mimeType};base64,${previewImage.data}`"
        :alt="previewImage.name"
    /></AppDialog>
    <AppDialog
      class="dialog-content"
      :open="Boolean(quoteToEdit)"
      :title="t('components.assistant.editQuote')"
      @update:open="!$event && (quoteToEdit = null)"
    >
      <AppTextarea
        v-model="quoteComment"
        class="assistant-quote-comment"
        rows="3"
        :placeholder="t('components.assistant.quoteComment')"
      /><template #actions
        ><button class="button button--primary" type="button" @click="saveQuote">
          {{ t('components.assistant.saveQuote') }}
        </button></template
      ></AppDialog
    >
  </div>
</template>
