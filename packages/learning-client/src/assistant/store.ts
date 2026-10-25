import { reactive } from 'vue';
import type { Router } from 'vue-router';
import type {
  AssistantEventView,
  AssistantImageAttachment,
  AssistantLayoutMode,
  AssistantMessageView,
  AssistantModelOption,
  AssistantQueuedMessage,
  AssistantQueueMode,
  AssistantRouteName,
  AssistantStatus,
  AssistantThread,
  AssistantThreadDetail,
  AssistantTimelineTurn,
  AssistantTurnView,
  AssistantUiAction,
} from '@drill-hub/contracts';
import type { LearningContext } from '#learning-client/context';
import { errorMessage } from '#learning-client/utils';

const ROUTE_TO_ASSISTANT: Record<string, { route: AssistantRouteName; params: string[] }> = {
  home: { route: 'home', params: [] },
  topics: { route: 'topics', params: [] },
  'topic-detail': { route: 'topic', params: ['topicId'] },
  plan: { route: 'plan', params: ['topicId', 'planId'] },
  content: { route: 'content', params: ['contentId'] },
  assessment: { route: 'assessment', params: ['assessmentId'] },
  attempt: { route: 'attempt', params: ['attemptId'] },
  report: { route: 'report', params: ['attemptId'] },
  'wrong-questions': { route: 'wrong-questions', params: [] },
  'wrong-question-detail': { route: 'wrong-question-detail', params: ['questionId'] },
  history: { route: 'history', params: [] },
  archive: { route: 'archive', params: [] },
};
const ASSISTANT_TO_ROUTE: Record<AssistantRouteName, string> = {
  home: 'home',
  topics: 'topics',
  topic: 'topic-detail',
  plan: 'plan',
  content: 'content',
  assessment: 'assessment',
  attempt: 'attempt',
  report: 'report',
  'wrong-questions': 'wrong-questions',
  'wrong-question-detail': 'wrong-question-detail',
  history: 'history',
  archive: 'archive',
};

export interface AssistantState {
  status: AssistantStatus | null;
  open: boolean;
  layoutMode: AssistantLayoutMode;
  chatWidth: number;
  threads: AssistantThread[];
  currentThreadId: string | null;
  turns: AssistantTurnView[];
  messages: AssistantMessageView[];
  events: AssistantEventView[];
  activeTurnId: string | null;
  activeStartedAt: string | null;
  streamingText: string;
  streamingReasoning: string;
  connection: 'idle' | 'connecting' | 'streaming';
  error: string;
  models: AssistantModelOption[];
  selectedModelId: string;
  queued: AssistantQueuedMessage[];
  timeline: AssistantTimelineTurn[];
  hasOlder: boolean;
  oldestMessageId: string | null;
  historyLoading: boolean;
}

type StreamHandle = { abort: AbortController };
let learningRef: LearningContext | null = null;
let routerRef: Router | null = null;
let streamHandle: StreamHandle | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityBound = false;
let openingPromise: Promise<void> | null = null;
let olderPromise: Promise<void> | null = null;

const state = reactive<AssistantState>({
  status: null,
  open: false,
  layoutMode: 'split',
  chatWidth: 400,
  threads: [],
  currentThreadId: null,
  turns: [],
  messages: [],
  events: [],
  activeTurnId: null,
  activeStartedAt: null,
  streamingText: '',
  streamingReasoning: '',
  connection: 'idle',
  error: '',
  models: [],
  selectedModelId: '',
  queued: [],
  timeline: [],
  hasOlder: false,
  oldestMessageId: null,
  historyLoading: false,
});

function learning(): LearningContext {
  if (!learningRef) throw new Error('assistant store is not initialized');
  return learningRef;
}
function router(): Router {
  if (!routerRef) throw new Error('assistant store is not initialized');
  return routerRef;
}
function lastSeq(): number {
  return state.events.reduce((max, event) => Math.max(max, event.seq), 0);
}
function pushEvent(event: AssistantEventView): boolean {
  if (state.events.some((existing) => existing.seq === event.seq)) return false;
  state.events.push(event);
  state.events.sort((left, right) => left.seq - right.seq);
  return true;
}
function clearThread() {
  state.turns = [];
  state.messages = [];
  state.events = [];
  state.queued = [];
  state.timeline = [];
  state.activeTurnId = null;
  state.activeStartedAt = null;
  state.streamingText = '';
  state.streamingReasoning = '';
  state.hasOlder = false;
  state.oldestMessageId = null;
}
function mergeUnique<T extends { id: string }>(current: T[], incoming: T[], prepend = false): T[] {
  const map = new Map(
    (prepend ? [...incoming, ...current] : [...current, ...incoming]).map((item) => [
      item.id,
      item,
    ]),
  );
  return [...map.values()];
}
function applyDetail(detail: AssistantThreadDetail, prepend = false, preserveStream = false) {
  const previousActiveTurnId = state.activeTurnId;
  state.turns = mergeUnique(state.turns, detail.turns, prepend).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  state.messages = mergeUnique(state.messages, detail.messages, prepend).sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.role === b.role
        ? a.id.localeCompare(b.id)
        : a.role === 'user'
          ? -1
          : 1
      : a.createdAt.localeCompare(b.createdAt),
  );
  state.events = mergeUnique(state.events, detail.events, prepend).sort((a, b) => a.seq - b.seq);
  state.queued = detail.queued ?? [];
  state.timeline = detail.timeline ?? [];
  state.hasOlder = detail.hasOlder ?? false;
  state.oldestMessageId = detail.oldestMessageId ?? null;
  state.activeTurnId = detail.activeTurn?.id ?? null;
  state.activeStartedAt = detail.activeTurn?.createdAt ?? null;
  if (!preserveStream) {
    const activeMessage = detail.activeTurn
      ? detail.messages.find((message) => message.id === detail.activeTurn!.assistantMessageId)
      : null;
    state.streamingText = activeMessage?.content ?? '';
    state.streamingReasoning = activeMessage?.reasoning ?? '';
  } else if (detail.activeTurn?.id !== previousActiveTurnId) {
    state.streamingText = '';
    state.streamingReasoning = '';
  }
}

async function refreshStatus(): Promise<void> {
  try {
    state.status = await learning().get<AssistantStatus>('/me/assistant/status');
  } catch {
    state.status = null;
  }
  await loadModels();
}
async function loadModels(): Promise<void> {
  try {
    state.models = await learning().get<AssistantModelOption[]>('/me/assistant/models');
  } catch {
    state.models = [];
  }
  if (state.selectedModelId && !state.models.some((model) => model.id === state.selectedModelId))
    state.selectedModelId = '';
}
function selectModel(modelId: string): void {
  state.selectedModelId = modelId;
}
async function loadThreads(): Promise<void> {
  state.threads = await learning().get<AssistantThread[]>('/me/assistant/threads');
  state.threads.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}
async function selectThread(threadId: string, preserveStream = false): Promise<void> {
  stopStream();
  const changed = state.currentThreadId !== threadId;
  state.currentThreadId = threadId;
  if (changed || !preserveStream) {
    state.turns = [];
    state.messages = [];
    state.events = [];
    state.queued = [];
    state.timeline = [];
    state.streamingText = '';
    state.streamingReasoning = '';
  }
  state.error = '';
  const detail = await learning().get<AssistantThreadDetail>(`/me/assistant/threads/${threadId}`);
  if (state.currentThreadId !== threadId) return;
  applyDetail(detail, false, preserveStream);
  if (state.activeTurnId) connectStream();
}
async function newThread(): Promise<AssistantThread> {
  const thread = await learning().post<AssistantThread>('/me/assistant/threads', {});
  await loadThreads();
  clearThread();
  await selectThread(thread.id);
  return thread;
}
async function deleteThread(threadId: string): Promise<void> {
  await learning().del(`/me/assistant/threads/${threadId}`);
  await loadThreads();
  if (state.currentThreadId === threadId) {
    stopStream();
    state.currentThreadId = null;
    clearThread();
  }
}
async function refreshCurrentThread(preserveStream = false): Promise<void> {
  if (state.currentThreadId) await selectThread(state.currentThreadId, preserveStream);
}
async function loadOlder(): Promise<void> {
  if (!state.currentThreadId || !state.hasOlder || !state.oldestMessageId || olderPromise)
    return olderPromise ?? undefined;
  const threadId = state.currentThreadId;
  const before = state.oldestMessageId;
  state.historyLoading = true;
  olderPromise = learning()
    .get<AssistantThreadDetail>(
      `/me/assistant/threads/${threadId}?before=${encodeURIComponent(before)}`,
    )
    .then((detail) => {
      if (state.currentThreadId === threadId) applyDetail(detail, true, true);
    })
    .finally(() => {
      state.historyLoading = false;
      olderPromise = null;
    });
  return olderPromise;
}
async function revealTurn(turnId: string): Promise<string | null> {
  const timeline = state.timeline.find((turn) => turn.id === turnId);
  if (!timeline) return null;
  const threadId = state.currentThreadId;
  while (
    !state.messages.some((message) => message.id === timeline.userMessageId) &&
    state.hasOlder
  ) {
    await loadOlder();
    if (state.currentThreadId !== threadId) return null;
  }
  return timeline.userMessageId;
}
async function forkThread(turnId: string, mode: 'before' | 'through'): Promise<AssistantThread> {
  if (!state.currentThreadId) throw new Error('没有当前对话');
  const thread = await learning().post<AssistantThread>(
    `/me/assistant/threads/${state.currentThreadId}/fork`,
    { turnId, mode },
  );
  await loadThreads();
  await selectThread(thread.id);
  return thread;
}

function currentPageContext(): Record<string, unknown> | null {
  const route = router().currentRoute.value;
  const mapping = ROUTE_TO_ASSISTANT[String(route.name)];
  if (!mapping) return null;
  const params: Record<string, string> = {};
  for (const key of mapping.params) {
    const value = route.params[key];
    if (typeof value === 'string' && value) params[key] = value;
  }
  return { route: mapping.route, params };
}

async function send(
  content: string,
  options: { images?: AssistantImageAttachment[]; mode?: AssistantQueueMode } = {},
): Promise<'started' | 'queued'> {
  const text = content.trim();
  const images = options.images ?? [];
  if (!text && !images.length) return 'queued';
  if (openingPromise) await openingPromise;
  if (!state.currentThreadId) await newThread();
  const threadId = state.currentThreadId!;
  const active = Boolean(state.activeTurnId || state.queued.length);
  state.error = '';
  if (!active) {
    state.messages.push({
      id: `local-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: 1,
      threadId,
      role: 'user',
      content: text,
      reasoning: null,
      images,
      status: 'complete',
      errorCode: null,
    });
  }
  try {
    const result = await learning().post<{
      turn: AssistantTurnView | null;
      userMessage: AssistantMessageView | null;
      queuedMessage?: AssistantQueuedMessage;
    }>(`/me/assistant/threads/${threadId}/messages`, {
      content: text,
      images,
      pageContext: currentPageContext(),
      mode: options.mode ?? 'followUp',
      ...(state.selectedModelId ? { providerModelId: state.selectedModelId } : {}),
    });
    if (state.currentThreadId !== threadId) return active ? 'queued' : 'started';
    if (result.queuedMessage) {
      if (!state.queued.some((item) => item.id === result.queuedMessage!.id))
        state.queued.push(result.queuedMessage);
      return 'queued';
    }
    state.activeTurnId = result.turn?.id ?? null;
    state.activeStartedAt = result.turn?.createdAt ?? new Date().toISOString();
    state.streamingText = '';
    state.streamingReasoning = '';
    if (result.turn && !state.turns.some((turn) => turn.id === result.turn!.id))
      state.turns.push(result.turn);
    if (result.userMessage) {
      const localIndex = state.messages.findIndex(
        (message) => message.id.startsWith('local-') && message.content === text,
      );
      if (localIndex >= 0) state.messages.splice(localIndex, 1);
      state.messages = mergeUnique(state.messages, [result.userMessage]);
    }
    connectStream();
    return 'started';
  } catch (reason) {
    state.error = errorMessage(reason);
    if (!active) {
      const index = state.messages.findIndex(
        (message) => message.id.startsWith('local-') && message.content === text,
      );
      if (index >= 0) state.messages.splice(index, 1);
    }
    throw reason;
  }
}
async function updateQueued(id: string, content: string, mode: AssistantQueueMode): Promise<void> {
  const queued = state.queued.find((item) => item.id === id);
  if (!queued) return;
  const updated = await learning().patch<AssistantQueuedMessage>(
    `/me/assistant/queued-messages/${id}`,
    {
      content,
      mode,
      expectedRevision: queued.revision,
    },
  );
  state.queued = state.queued.map((item) => (item.id === id ? updated : item));
}
async function removeQueued(id: string): Promise<void> {
  await learning().del(`/me/assistant/queued-messages/${id}`);
  state.queued = state.queued.filter((item) => item.id !== id);
}
async function reorderQueued(ids: string[]): Promise<void> {
  if (!state.currentThreadId) return;
  const ordered = await learning().put<AssistantQueuedMessage[]>(
    `/me/assistant/threads/${state.currentThreadId}/queued-messages/order`,
    { ids },
  );
  state.queued = ordered;
}
async function sendQueuedNow(id: string): Promise<void> {
  await learning().post(`/me/assistant/queued-messages/${id}/send`, {});
  state.queued = state.queued.filter((item) => item.id !== id);
}
async function cancelTurn(): Promise<void> {
  if (!state.activeTurnId) return;
  try {
    await learning().post(`/me/assistant/turns/${state.activeTurnId}/cancel`, {});
  } catch {
    /* 取消失败由事件流的错误状态兜底。 */
  }
}
function stopStream(): void {
  streamHandle?.abort.abort();
  streamHandle = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (state.connection !== 'idle') state.connection = 'idle';
}
async function completeTurn(turnId: string, message?: string): Promise<void> {
  if (state.activeTurnId !== turnId) return;
  const threadId = state.currentThreadId;
  stopStream();
  try {
    // Keep the live answer mounted until the persisted response has replaced it.
    await refreshCurrentThread(true);
    if (message && state.currentThreadId === threadId) state.error = message;
  } catch (reason) {
    if (state.currentThreadId === threadId) state.error = errorMessage(reason);
  }
}
function handleStreamEvent(payload: { event?: string; data: string; id?: string }): void {
  const type = payload.event ?? 'message';
  try {
    const parsed = JSON.parse(payload.data) as {
      delta?: string;
      content?: string;
      reasoning?: string;
      queued?: AssistantQueuedMessage[];
    } & AssistantEventView;
    if (type === 'text_delta') {
      if (parsed.delta) state.streamingText += parsed.delta;
      return;
    }
    if (type === 'reasoning_delta') {
      if (parsed.delta) state.streamingReasoning += parsed.delta;
      return;
    }
    if (type === 'snapshot') {
      state.streamingText = parsed.content ?? '';
      state.streamingReasoning = parsed.reasoning ?? '';
      return;
    }
    if (type === 'queue') {
      state.queued = parsed.queued ?? [];
      return;
    }
    const event = parsed as AssistantEventView;
    if (!event?.type || !pushEvent({ ...event, type: type as AssistantEventView['type'] })) return;
    if (event.type === 'error')
      void completeTurn(event.turnId, String(event.payload?.message ?? '本轮对话未能完成'));
    if (event.type === 'status' && event.payload?.phase === 'turn_completed')
      void completeTurn(event.turnId);
    if (event.type === 'ui_action') {
      const action = event.payload?.action as AssistantUiAction | undefined;
      if (action) executeUiAction(action);
    }
  } catch {
    /* 忽略无法解析的事件帧。 */
  }
}
function executeUiAction(action: AssistantUiAction): void {
  if (action.type === 'set_layout') {
    state.layoutMode = action.mode;
    if (action.chatWidth) state.chatWidth = Math.min(560, Math.max(320, action.chatWidth));
    if (action.mode !== 'content') state.open = true;
    return;
  }
  const target = ASSISTANT_TO_ROUTE[action.route];
  if (!target) return;
  const routeParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(action.params ?? {}))
    if (value) routeParams[key] = value;
  void router().push({ name: target, params: routeParams, query: action.query ?? {} });
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 780px)').matches)
    state.open = false;
}
function connectStream(): void {
  if (!state.currentThreadId || !state.activeTurnId || streamHandle) return;
  const threadId = state.currentThreadId;
  const abort = new AbortController();
  streamHandle = { abort };
  state.connection = 'connecting';
  void learning()
    .stream(
      `/me/assistant/threads/${threadId}/stream?after=${lastSeq()}`,
      abort.signal,
      (event) => {
        if (streamHandle?.abort !== abort || state.currentThreadId !== threadId) return;
        state.connection = 'streaming';
        state.error = '';
        handleStreamEvent(event);
      },
    )
    .then(() => {
      if (streamHandle?.abort.signal === abort.signal) {
        streamHandle = null;
        scheduleReconnect();
      }
    })
    .catch(() => {
      if (streamHandle?.abort.signal !== abort.signal) return;
      streamHandle = null;
      if (abort.signal.aborted) {
        state.connection = 'idle';
        return;
      }
      scheduleReconnect();
    });
}
function scheduleReconnect(): void {
  state.connection = 'idle';
  if (!state.currentThreadId || !state.activeTurnId || reconnectTimer) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  state.connection = 'connecting';
  state.error = '事件流连接中断，正在重新连接…';
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectStream();
  }, 2000);
}
function bindVisibility(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopStream();
    else if (state.activeTurnId && state.open) connectStream();
  });
}
function openPanel(): void {
  state.open = true;
  bindVisibility();
  if (state.activeTurnId && !reconnectTimer) connectStream();
  if (!state.currentThreadId && !openingPromise) {
    openingPromise = loadThreads()
      .then(async () => {
        if (!state.currentThreadId && state.threads.length)
          await selectThread(state.threads[0]!.id);
        else if (!state.threads.length) await newThread();
      })
      .finally(() => {
        openingPromise = null;
      });
  }
}
function closePanel(): void {
  state.open = false;
  stopStream();
}
function setLayout(mode: AssistantLayoutMode): void {
  state.layoutMode = mode;
  state.open = mode !== 'content';
}
function setChatWidth(width: number): void {
  state.chatWidth = Math.min(560, Math.max(320, Math.round(width)));
}

export interface AssistantStore {
  state: AssistantState;
  refreshStatus(): Promise<void>;
  loadModels(): Promise<void>;
  selectModel(modelId: string): void;
  loadThreads(): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  newThread(): Promise<AssistantThread>;
  deleteThread(threadId: string): Promise<void>;
  send(
    content: string,
    options?: { images?: AssistantImageAttachment[]; mode?: AssistantQueueMode },
  ): Promise<'started' | 'queued'>;
  cancelTurn(): Promise<void>;
  openPanel(): void;
  closePanel(): void;
  setLayout(mode: AssistantLayoutMode): void;
  setChatWidth(width: number): void;
  loadOlder(): Promise<void>;
  revealTurn(turnId: string): Promise<string | null>;
  forkThread(turnId: string, mode: 'before' | 'through'): Promise<AssistantThread>;
  updateQueued(id: string, content: string, mode: AssistantQueueMode): Promise<void>;
  removeQueued(id: string): Promise<void>;
  reorderQueued(ids: string[]): Promise<void>;
  sendQueuedNow(id: string): Promise<void>;
}
export function initAssistantStore(instance: LearningContext, routerInstance: Router): void {
  learningRef = instance;
  routerRef = routerInstance;
}
export function useAssistant(): AssistantStore {
  return {
    state,
    refreshStatus,
    loadModels,
    selectModel,
    loadThreads,
    selectThread,
    newThread,
    deleteThread,
    send,
    cancelTurn,
    openPanel,
    closePanel,
    setLayout,
    setChatWidth,
    loadOlder,
    revealTurn,
    forkThread,
    updateQueued,
    removeQueued,
    reorderQueued,
    sendQueuedNow,
  };
}
