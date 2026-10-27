<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type WatchStopHandle,
} from 'vue';
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
  AssistantThread,
  AssistantTimelineTurn,
} from '@drill-hub/contracts';
import { useAssistant } from '#learning-client/assistant/store';
import { useAssistantHistory } from '#learning-client/assistant/history';
import { useAssistantQuotes } from '#learning-client/assistant/quoteStore';
import { useLearning } from '#learning-client/injection';
import {
  ASSISTANT_SELECTION_MAX_COUNT,
  buildPromptWithQuotes,
  parsePromptQuotes,
  type AssistantSelectionAppendResult,
  type AssistantSelectionQuote,
} from '#learning-client/assistant/selection';
import { useConversationScroll } from '#learning-client/assistant/useConversationScroll';
import { errorMessage } from '#learning-client/utils';
import AppIcon from '#learning-client/components/AppIcon.vue';
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
import AssistantSelectionPopup, {
  type AssistantSelectionPopupState,
} from '#learning-client/components/assistant/AssistantSelectionPopup.vue';
import AssistantSelectionBadges, {
  type AssistantSelectionBadge,
} from '#learning-client/components/assistant/AssistantSelectionBadges.vue';
import {
  boundaryRect,
  flashSelection,
  restoreSelection,
  selectionContentRoot,
  selectionEndRect,
} from '#learning-client/assistant/selectionAnchors';

const { t } = useI18n();
const learning = useLearning();
const assistant = useAssistant();
const state = assistant.state;
const { history } = useAssistantHistory(state);
const content = ref<HTMLElement | null>(null);
const scroll = useConversationScroll(content);
const draft = ref('');
const selectionScope = computed(() => state.currentThreadId ?? 'new-thread');
const {
  quotes,
  add: addStoredQuote,
  update: updateStoredQuote,
  remove: removeStoredQuote,
  removeSent: removeSentQuotes,
} = useAssistantQuotes(selectionScope);
const composer = ref<InstanceType<typeof AssistantComposer> | null>(null);
const sending = ref(false);
const threadToDelete = ref<{ id: string; title: string } | null>(null);
const deletingThread = ref(false);
const deleteError = ref('');
const threadToRename = ref<AssistantThread | null>(null);
const renamingThread = ref(false);
const renameError = ref('');
const renameTitle = ref('');
const previewImage = ref<AssistantImageAttachment | null>(null);
const selectionPopup = ref<AssistantSelectionPopupState | null>(null);
const anchorOverlays = ref<Map<string, AssistantSelectionBadge[]>>(new Map());
const copied = ref(false);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
let clearSelectionFlash: (() => void) | null = null;
let selectionRequest = 0;
let anchorsWatcher: WatchStopHandle | undefined;
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
function requestRenameThread() {
  if (!currentThread.value || renamingThread.value) return;
  threadToRename.value = { ...currentThread.value };
  renameTitle.value = currentThread.value.title;
  renameError.value = '';
}
async function renameThread() {
  const thread = threadToRename.value;
  const title = renameTitle.value.trim();
  if (!thread || !title || renamingThread.value) return;
  renamingThread.value = true;
  renameError.value = '';
  try {
    await assistant.renameThread(thread.id, title);
    threadToRename.value = null;
  } catch (reason) {
    renameError.value = errorMessage(reason);
  } finally {
    renamingThread.value = false;
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
  const selectedScope = selectionScope.value;
  const images = [...(composer.value?.images ?? [])];
  sending.value = true;
  try {
    await assistant.send(buildPromptWithQuotes(text, selectedQuotes), { images, mode });
    removeSentQuotes(selectedScope, selectedQuotes);
    if (selectionScope.value === selectedScope) {
      composer.value?.clear();
      if (draft.value === text) draft.value = '';
      scroll.scrollToBottom();
    }
  } catch {
    // Keep the existing draft and quotes, including edits made while sending.
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
function notifySelectionResult(result: AssistantSelectionAppendResult): void {
  if (!result.ok) {
    const key =
      result.reason === 'count'
        ? 'components.assistant.selectionLimitCount'
        : result.reason === 'total'
          ? 'components.assistant.selectionLimitTotal'
          : 'components.assistant.selectionLimitSingle';
    learning.notify.warning(t(key, { count: ASSISTANT_SELECTION_MAX_COUNT }));
  } else if (result.duplicate) {
    learning.notify.info(t('components.assistant.selectionDuplicate'));
  }
}
function recomputeAnchors(): void {
  const viewport = scroll.viewport.value;
  const map = new Map<string, AssistantSelectionBadge[]>();
  if (viewport) {
    quotes.value.forEach((quote, index) => {
      const anchor = quote.anchor;
      if (!anchor) return;
      const root = selectionContentRoot(viewport, anchor.messageId);
      const wrapper = root?.closest<HTMLElement>('[data-selection-source]');
      if (!root || !wrapper) return;
      const rect = boundaryRect(root, anchor.end);
      if (!rect) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const badges = map.get(anchor.messageId) ?? [];
      badges.push({
        id: quote.id,
        index: index + 1,
        left: rect.right - wrapperRect.left + 2,
        top: rect.top - wrapperRect.top - 16,
      });
      map.set(anchor.messageId, badges);
    });
  }
  if (JSON.stringify([...anchorOverlays.value]) !== JSON.stringify([...map]))
    anchorOverlays.value = map;
}
function syncSelectionAnchors(): void {
  const popup = selectionPopup.value;
  if (popup && !quotes.value.some((item) => item.id === popup.id)) selectionPopup.value = null;
  void nextTick(recomputeAnchors);
}
function addQuote(quote: AssistantSelectionQuote): void {
  const selection = window.getSelection();
  const rect = selection?.rangeCount ? selectionEndRect(selection.getRangeAt(0)) : null;
  const result = addStoredQuote(quote);
  notifySelectionResult(result);
  selection?.removeAllRanges();
  if (!result.ok || result.duplicate) return;
  if (rect) {
    selectionPopup.value = {
      id: quote.id,
      comment: '',
      anchor: { left: rect.right, top: rect.top, bottom: rect.bottom },
    };
  } else {
    void editQuote(quote.id);
  }
}
async function locateQuote(id: string): Promise<void> {
  const quote = quotes.value.find((item) => item.id === id);
  const anchor = quote?.anchor;
  const viewport = scroll.viewport.value;
  if (!quote || !anchor || !viewport) return;
  const request = ++selectionRequest;
  clearSelectionFlash?.();
  clearSelectionFlash = null;
  scroll.stop();
  const threadId = state.currentThreadId;
  const flash = () => {
    const root = selectionContentRoot(viewport, anchor.messageId);
    if (root) clearSelectionFlash = flashSelection(root, anchor);
  };
  const badge = () =>
    viewport?.querySelector<HTMLElement>(`[data-selection-anchor="${CSS.escape(id)}"]`);
  const existingBadge = badge();
  if (existingBadge) {
    existingBadge.scrollIntoView({ block: 'center', behavior: 'instant' });
    flash();
    return;
  }
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
    if (request !== selectionRequest || state.currentThreadId !== threadId) return;
    await revealMessage();
    root = selectionContentRoot(viewport, anchor.messageId);
    if (!root && state.oldestMessageId === previousOldest) return;
  }
  if (!root || request !== selectionRequest || state.currentThreadId !== threadId) return;
  recomputeAnchors();
  await nextTick();
  const locatedBadge = badge();
  if (locatedBadge) locatedBadge.scrollIntoView({ block: 'center', behavior: 'instant' });
  else
    viewport.scrollTo({
      top:
        viewport.scrollTop +
        root.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top -
        Math.max(24, (viewport.clientHeight - root.clientHeight) / 2),
      behavior: 'instant',
    });
  flash();
}
async function editQuote(id: string): Promise<void> {
  const quote = quotes.value.find((item) => item.id === id);
  if (!quote) return;
  await locateQuote(id);
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (!quotes.value.some((item) => item.id === id)) return;
  const viewport = scroll.viewport.value;
  const root =
    quote.anchor && viewport ? selectionContentRoot(viewport, quote.anchor.messageId) : null;
  const badge = viewport?.querySelector<HTMLElement>(`[data-selection-anchor="${CSS.escape(id)}"]`);
  let anchor: AssistantSelectionPopupState['anchor'] | null = null;
  if (root && quote.anchor && restoreSelection(root, quote.anchor)) {
    const selection = window.getSelection();
    const rect = selection?.rangeCount ? selectionEndRect(selection.getRangeAt(0)) : null;
    if (rect) anchor = { left: rect.right, top: rect.top, bottom: rect.bottom };
  }
  if (!anchor && badge) {
    const rect = badge.getBoundingClientRect();
    anchor = { left: rect.right, top: rect.top, bottom: rect.bottom };
  }
  if (!anchor) return;
  selectionPopup.value = { id, comment: quote.comment ?? '', anchor };
}
function saveQuote(comment: string): void {
  if (selectionPopup.value) updateStoredQuote(selectionPopup.value.id, comment);
  closeSelectionPopup();
}
function removeQuote(): void {
  if (selectionPopup.value) removeStoredQuote(selectionPopup.value.id);
  closeSelectionPopup();
}
function closeSelectionPopup(): void {
  selectionPopup.value = null;
  window.getSelection()?.removeAllRanges();
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
    selectionRequest++;
    selectionPopup.value = null;
    draft.value = '';
  },
);
watch(
  () => quotes.value.length,
  (count) => {
    if (count > 0 && !anchorsWatcher) {
      anchorsWatcher = watch(quotes, syncSelectionAnchors, {
        deep: true,
        immediate: true,
      });
    } else if (count === 0 && anchorsWatcher) {
      anchorsWatcher();
      anchorsWatcher = undefined;
      selectionPopup.value = null;
      anchorOverlays.value = new Map();
    }
  },
  { immediate: true },
);
watch(
  [scroll.viewport, () => quotes.value.length],
  ([viewport, count], _, onCleanup) => {
    if (!viewport || !count) return;
    let frame: number | undefined;
    const observer = new MutationObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        recomputeAnchors();
      });
    });
    const closePopup = () => {
      selectionPopup.value = null;
    };
    viewport.addEventListener('scroll', closePopup, { passive: true });
    observer.observe(viewport, { childList: true, subtree: true, characterData: true });
    void nextTick(recomputeAnchors);
    onCleanup(() => {
      observer.disconnect();
      viewport.removeEventListener('scroll', closePopup);
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  },
  { flush: 'post', immediate: true },
);
function handleResize() {
  selectionPopup.value = null;
  recomputeAnchors();
}
onMounted(() => {
  window.addEventListener('resize', handleResize);
  window.visualViewport?.addEventListener('resize', handleResize);
  window.visualViewport?.addEventListener('scroll', handleResize);
});
onBeforeUnmount(() => {
  anchorsWatcher?.();
  window.removeEventListener('resize', handleResize);
  window.visualViewport?.removeEventListener('resize', handleResize);
  window.visualViewport?.removeEventListener('scroll', handleResize);
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
                class="dropdown-item"
                data-testid="assistant-rename-thread"
                @select="requestRenameThread"
                ><AppIcon name="edit" :size="16" />{{
                  t('components.assistant.renameThread')
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
        <AppTooltip
          :label="
            t(
              state.layoutMode === 'split'
                ? 'components.assistant.layoutChat'
                : 'components.assistant.layoutSplit',
            )
          "
          ><button
            class="icon-button"
            type="button"
            :aria-label="
              t(
                state.layoutMode === 'split'
                  ? 'components.assistant.layoutChat'
                  : 'components.assistant.layoutSplit',
              )
            "
            data-testid="assistant-layout-toggle"
            @click="assistant.setLayout(state.layoutMode === 'split' ? 'chat' : 'split')"
          >
            <AppIcon
              :name="state.layoutMode === 'split' ? 'message' : 'panel'"
              :size="17"
            /></button
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
                :selection-badges="anchorOverlays"
                @edit-selection="editQuote"
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
                :selection-badges="anchorOverlays.get(item.message.id) ?? []"
                @edit-selection="editQuote"
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
                <AssistantSelectionBadges
                  :badges="anchorOverlays.get(item.message.id) ?? []"
                  @edit="editQuote"
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
      <AssistantSelectionPopup
        :state="selectionPopup"
        @save="saveQuote"
        @remove="removeQuote"
        @cancel="closeSelectionPopup"
      />
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
      :open="Boolean(threadToRename)"
      :title="t('components.assistant.renameThreadTitle')"
      :busy="renamingThread"
      @update:open="!$event && !renamingThread && (threadToRename = null)"
    >
      <form class="form-field" @submit.prevent="renameThread">
        <label for="assistant-thread-title">{{ t('components.assistant.threadTitle') }}</label>
        <input
          id="assistant-thread-title"
          v-model="renameTitle"
          class="input"
          data-testid="assistant-thread-title-input"
          maxlength="200"
          autofocus
          :disabled="renamingThread"
        />
        <p v-if="renameError" class="assistant-panel__error" role="alert">{{ renameError }}</p>
      </form>
      <template #actions>
        <button
          class="button"
          type="button"
          :disabled="renamingThread"
          @click="threadToRename = null"
        >
          {{ t('components.assistant.cancelRename') }}
        </button>
        <button
          class="button button--primary"
          type="button"
          data-testid="assistant-save-thread-title"
          :disabled="renamingThread || !renameTitle.trim()"
          @click="renameThread"
        >
          <span v-if="renamingThread" class="spinner" />{{
            t('components.assistant.saveThreadTitle')
          }}
        </button>
      </template>
    </AppDialog>
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
  </div>
</template>
