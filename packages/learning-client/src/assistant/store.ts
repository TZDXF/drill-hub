import { reactive } from 'vue';
import type { Router } from 'vue-router';
import type {
  AssistantEventView,
  AssistantLayoutMode,
  AssistantMessageView,
  AssistantRouteName,
  AssistantStatus,
  AssistantThread,
  AssistantTurnView,
  AssistantUiAction,
} from '@drill-hub/contracts';
import type { LearningContext } from '../context';
import { errorMessage } from '../utils';

/** 路由名与助手 navigate 工具白名单的映射（服务端以白名单名下发）。 */
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
  streamingText: string;
  connection: 'idle' | 'connecting' | 'streaming' | 'polling';
  error: string;
}

type StreamHandle = { abort: AbortController };

let learningRef: LearningContext | null = null;
let routerRef: Router | null = null;
let streamHandle: StreamHandle | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let visibilityBound = false;

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
  streamingText: '',
  connection: 'idle',
  error: '',
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
  return state.events.length ? state.events[state.events.length - 1]!.seq : 0;
}

function pushEvent(event: AssistantEventView): void {
  if (state.events.some((existing) => existing.seq === event.seq)) return;
  state.events.push(event);
  state.events.sort((left, right) => left.seq - right.seq);
}

async function refreshStatus(): Promise<void> {
  try {
    state.status = await learning().get<AssistantStatus>('/me/assistant/status');
  } catch {
    state.status = null;
  }
}

async function loadThreads(): Promise<void> {
  state.threads = await learning().get<AssistantThread[]>('/me/assistant/threads');
}

async function selectThread(threadId: string): Promise<void> {
  state.currentThreadId = threadId;
  state.streamingText = '';
  state.error = '';
  const detail = await learning().get<{
    thread: AssistantThread;
    turns: AssistantTurnView[];
    messages: AssistantMessageView[];
    events: AssistantEventView[];
    activeTurn: AssistantTurnView | null;
  }>(`/me/assistant/threads/${threadId}`);
  if (state.currentThreadId !== threadId) return;
  state.turns = detail.turns ?? [];
  state.messages = detail.messages;
  state.events = detail.events;
  state.activeTurnId = detail.activeTurn?.id ?? null;
  if (state.activeTurnId) connectStream();
}

async function newThread(): Promise<AssistantThread> {
  const thread = await learning().post<AssistantThread>('/me/assistant/threads', {});
  await loadThreads();
  await selectThread(thread.id);
  return thread;
}

async function deleteThread(threadId: string): Promise<void> {
  await learning().del(`/me/assistant/threads/${threadId}`);
  await loadThreads();
  if (state.currentThreadId === threadId) {
    state.currentThreadId = null;
    state.turns = [];
    state.messages = [];
    state.events = [];
    state.activeTurnId = null;
    state.streamingText = '';
  }
}

async function refreshCurrentThread(): Promise<void> {
  if (state.currentThreadId) await selectThread(state.currentThreadId);
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

async function send(content: string): Promise<void> {
  const text = content.trim();
  if (!text || state.activeTurnId) return;
  // 等待面板初始化（加载或创建首个线程）完成，避免与 openPanel 竞态创建重复线程。
  if (openingPromise) await openingPromise;
  if (!state.currentThreadId) await newThread();
  const threadId = state.currentThreadId!;
  state.error = '';
  state.messages.push({
    id: `local-${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    threadId,
    role: 'user',
    content: text,
    status: 'complete',
    errorCode: null,
  });
  try {
    const result = await learning().post<{
      turn: AssistantTurnView | null;
      userMessage: AssistantMessageView | null;
    }>(`/me/assistant/threads/${threadId}/messages`, {
      content: text,
      pageContext: currentPageContext(),
    });
    state.activeTurnId = result.turn?.id ?? null;
    state.streamingText = '';
    connectStream();
  } catch (reason) {
    state.error = errorMessage(reason);
  }
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
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (state.connection === 'streaming' || state.connection === 'connecting') {
    state.connection = 'idle';
  }
}

function handleStreamEvent(payload: { event?: string; data: string; id?: string }): void {
  const type = payload.event ?? 'message';
  if (type === 'text_delta') {
    try {
      const parsed = JSON.parse(payload.data) as { delta?: string };
      if (parsed.delta) state.streamingText += parsed.delta;
    } catch {
      /* 忽略无法解析的增量。 */
    }
    return;
  }
  try {
    const event = JSON.parse(payload.data) as AssistantEventView;
    if (event && event.type) {
      event.type = type as AssistantEventView['type'];
      pushEvent(event);
      if (event.type === 'error') {
        const message = String(event.payload?.message ?? '本轮对话未能完成');
        state.activeTurnId = null;
        state.streamingText = '';
        // 先刷新终稿消息再回填错误，避免刷新过程清空错误提示。
        void refreshCurrentThread().finally(() => {
          state.error = message;
        });
      }
      if (event.type === 'status' && event.payload?.phase === 'turn_completed') {
        state.activeTurnId = null;
        state.streamingText = '';
        void refreshCurrentThread();
      }
      if (event.type === 'ui_action') {
        const action = event.payload?.action as AssistantUiAction | undefined;
        if (action) executeUiAction(action);
      }
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
  if (action.type === 'navigate') {
    const target = ASSISTANT_TO_ROUTE[action.route];
    if (!target) return;
    const routeParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(action.params ?? {})) routeParams[key] = value;
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(action.query ?? {})) query[key] = value;
    void router().push({ name: target, params: routeParams, query });
    // 手机布局下导航自动收起对话面板，通过胶囊返回。
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 780px)').matches) {
      state.open = false;
    }
  }
}

function connectStream(): void {
  if (!state.currentThreadId || streamHandle) return;
  const threadId = state.currentThreadId;
  const abort = new AbortController();
  streamHandle = { abort };
  state.connection = 'connecting';
  void learning()
    .stream(`/me/assistant/threads/${threadId}/stream?after=${lastSeq()}`, abort.signal, (event) =>
      handleStreamEvent(event),
    )
    .then(() => {
      if (streamHandle?.abort.signal === abort.signal) {
        streamHandle = null;
        state.connection = state.activeTurnId ? 'polling' : 'idle';
        if (state.activeTurnId) startPolling();
      }
    })
    .catch(() => {
      if (streamHandle?.abort.signal !== abort.signal) return;
      streamHandle = null;
      if (abort.signal.aborted) {
        state.connection = 'idle';
        return;
      }
      state.connection = 'polling';
      if (state.activeTurnId) startPolling();
      else state.connection = 'idle';
    });
}

function startPolling(): void {
  if (pollTimer || !state.currentThreadId) return;
  pollTimer = setInterval(async () => {
    if (!state.currentThreadId || !state.activeTurnId) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      state.connection = 'idle';
      return;
    }
    try {
      const data = await learning().get<{
        events: AssistantEventView[];
        activeTurn: AssistantTurnView | null;
      }>(`/me/assistant/threads/${state.currentThreadId}/events?after=${lastSeq()}`);
      for (const event of data.events) {
        pushEvent(event);
        if (event.type === 'ui_action') {
          const action = event.payload?.action as AssistantUiAction | undefined;
          if (action) executeUiAction(action);
        }
        if (event.type === 'error') {
          state.activeTurnId = null;
          state.streamingText = '';
        }
        if (event.type === 'status' && event.payload?.phase === 'turn_completed') {
          state.activeTurnId = null;
          state.streamingText = '';
        }
      }
      if (!data.activeTurn && state.activeTurnId) {
        state.activeTurnId = null;
        state.streamingText = '';
        void refreshCurrentThread();
      }
    } catch {
      /* 轮询失败时下个周期重试。 */
    }
  }, 2000);
}

function bindVisibility(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopStream();
    } else if (state.activeTurnId && state.open) {
      connectStream();
    }
  });
}

let openingPromise: Promise<void> | null = null;

function openPanel(): void {
  state.open = true;
  bindVisibility();
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
  if (mode === 'content') state.open = false;
  else state.open = true;
}

function setChatWidth(width: number): void {
  state.chatWidth = Math.min(560, Math.max(320, Math.round(width)));
}

export interface AssistantStore {
  state: AssistantState;
  refreshStatus(): Promise<void>;
  loadThreads(): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  newThread(): Promise<AssistantThread>;
  deleteThread(threadId: string): Promise<void>;
  send(content: string): Promise<void>;
  cancelTurn(): Promise<void>;
  openPanel(): void;
  closePanel(): void;
  setLayout(mode: AssistantLayoutMode): void;
  setChatWidth(width: number): void;
}

export function initAssistantStore(instance: LearningContext, routerInstance: Router): void {
  learningRef = instance;
  routerRef = routerInstance;
}

export function useAssistant(): AssistantStore {
  return {
    state,
    refreshStatus,
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
  };
}
