import type { FastifyInstance } from 'fastify';
import type {
  AssistantEventView,
  AssistantQueueMode,
  AssistantQueuedMessage,
  ModelTokenUsage,
} from '@drill-hub/contracts';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { AppError } from '#server/core/errors.js';
import { baseRecord, id, now } from '#server/core/ids.js';
import { signInternalToken } from '#server/core/internal-auth.js';
import type { Actor, AppContext, AssistantService } from '#server/core/context.js';
import type {
  AssistantEventRecord,
  AssistantQueuedMessageRecord,
  AssistantTurnRecord,
} from '#server/db/records.js';
import { createAssistantTools } from '#server/modules/assistant/tools.js';
import { PiSessionFactory } from '#server/modules/assistant/pi-session.js';

const HISTORY_MESSAGE_LIMIT = 20;
const TEXT_FLUSH_INTERVAL_MS = 1000;
/** internal token 覆盖整轮执行（不再受单轮超时限制），给足余量即可。 */
const INTERNAL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface AssistantStreamFrame {
  kind: 'event' | 'text_delta' | 'reasoning_delta' | 'snapshot' | 'queue' | 'heartbeat';
  event?: AssistantEventView;
  delta?: string;
  content?: string;
  reasoning?: string;
  queued?: AssistantQueuedMessage[];
}

export type StreamListener = (frame: AssistantStreamFrame) => void;

export interface AssistantServiceImpl extends AssistantService {
  /** 将已创建的一轮对话加入执行队列（各线程互不阻塞，不限制同时执行的轮数）。 */
  enqueue(turnId: string): void;
  queueMessage(input: QueueMessageInput): Promise<AssistantQueuedMessage>;
  sendQueuedMessage(queued: AssistantQueuedMessageRecord): Promise<AssistantQueuedMessage>;
  notifyQueue(threadId: string): Promise<void>;
  subscribe(threadId: string, listener: StreamListener): () => void;
  /** SSE 订阅时回放断线期间落库的事件，跳过监听器已收到的序号。 */
  replay(threadId: string, afterSeq: number, listener: StreamListener): Promise<void>;
}

export interface QueueMessageInput {
  ownerId: string;
  threadId: string;
  content: string;
  mode: AssistantQueueMode;
  promptContext: string | null;
  providerModelId: string | null;
  images: import('@drill-hub/contracts').AssistantImageAttachment[];
}

export interface TurnHandle {
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
}

export function createAssistantService(
  ctx: AppContext,
  app: FastifyInstance,
): AssistantServiceImpl {
  const factory = new PiSessionFactory(ctx);
  const seqCounters = new Map<string, number>();
  const listeners = new Map<string, Set<StreamListener>>();
  const active = new Map<string, { abort: AbortController; session: AgentSession | null }>();
  const draining = new Set<string>();

  async function nextSeq(threadId: string): Promise<number> {
    let last = seqCounters.get(threadId);
    if (last === undefined) {
      const events = await ctx.db.list('assistantEvents', { threadId });
      last = events.reduce((max, event) => Math.max(max, event.seq), 0);
    }
    last += 1;
    seqCounters.set(threadId, last);
    return last;
  }

  function toView(record: AssistantEventRecord): AssistantEventView {
    const { ownerId: _ownerId, ...view } = record;
    return view;
  }

  async function emit(
    ownerId: string,
    threadId: string,
    turnId: string,
    type: AssistantEventView['type'],
    payload: Record<string, unknown>,
  ): Promise<void> {
    const record: AssistantEventRecord = {
      id: id(),
      createdAt: now(),
      updatedAt: now(),
      revision: 1,
      ownerId,
      threadId,
      turnId,
      seq: await nextSeq(threadId),
      type,
      payload,
    };
    await ctx.db.insert('assistantEvents', record);
    broadcast(threadId, { kind: 'event', event: toView(record) });
  }

  function broadcast(threadId: string, frame: AssistantStreamFrame): void {
    const set = listeners.get(threadId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(frame);
      } catch {
        // 单个订阅者异常不影响其他订阅者。
      }
    }
  }

  function subscribe(threadId: string, listener: StreamListener): () => void {
    let set = listeners.get(threadId);
    if (!set) {
      set = new Set();
      listeners.set(threadId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) listeners.delete(threadId);
    };
  }

  async function replay(threadId: string, afterSeq: number, listener: StreamListener) {
    const events = await ctx.db.list('assistantEvents', { threadId });
    for (const record of [...events]
      .sort((left, right) => left.seq - right.seq)
      .filter((event) => event.seq > afterSeq)) {
      listener({ kind: 'event', event: toView(record) });
    }
  }

  function enqueueTurn(turnId: string): void {
    // 每轮独立执行：同线程由活动 turn 与持久化队列保证顺序，跨线程不设并发上限。
    void runTurnNow(turnId).catch(() => {});
  }

  function queuedView(record: AssistantQueuedMessageRecord): AssistantQueuedMessage {
    const { ownerId: _ownerId, promptContext: _promptContext, ...view } = record;
    return view;
  }

  async function queuedMessages(threadId: string): Promise<AssistantQueuedMessageRecord[]> {
    const rows = await ctx.db.list('assistantQueuedMessages', { threadId });
    return rows.sort(
      (left, right) =>
        left.position - right.position ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  }

  async function notifyQueue(threadId: string): Promise<void> {
    broadcast(threadId, {
      kind: 'queue',
      queued: (await queuedMessages(threadId)).map(queuedView),
    });
  }

  async function queueMessage(input: QueueMessageInput): Promise<AssistantQueuedMessage> {
    const pending = await ctx.db.list('assistantQueuedMessages', { threadId: input.threadId });
    const position = Math.max(0, ...pending.map((item) => item.position)) + 1;
    const row: AssistantQueuedMessageRecord = { ...baseRecord(), ...input, position };
    await ctx.db.insert('assistantQueuedMessages', row);
    await notifyQueue(input.threadId);
    if (input.mode === 'steer') {
      const current = (await ctx.db.list('assistantTurns', { threadId: input.threadId })).find(
        (turn) => turn.status === 'queued' || turn.status === 'running',
      );
      const entry = current ? active.get(current.id) : null;
      if (entry) {
        entry.abort.abort();
        try {
          await entry.session?.abort();
        } catch {
          /* cancellation is finalized by runTurnNow */
        }
      }
    }
    void drainThread(input.threadId).catch(() => {});
    return queuedView(row);
  }

  async function sendQueuedMessage(
    queued: AssistantQueuedMessageRecord,
  ): Promise<AssistantQueuedMessage> {
    const pending = await queuedMessages(queued.threadId);
    const updated = await ctx.db.update('assistantQueuedMessages', queued.id, queued.revision, {
      mode: 'steer',
      position: (pending[0]?.position ?? 1) - 1,
    });
    await notifyQueue(queued.threadId);
    const current = (await ctx.db.list('assistantTurns', { threadId: queued.threadId })).find(
      (turn) => turn.status === 'queued' || turn.status === 'running',
    );
    const entry = current ? active.get(current.id) : null;
    if (entry) {
      entry.abort.abort();
      try {
        await entry.session?.abort();
      } catch {
        /* cancellation is finalized by runTurnNow */
      }
    }
    void drainThread(queued.threadId).catch(() => {});
    return queuedView(updated);
  }

  async function drainThread(threadId: string): Promise<void> {
    if (draining.has(threadId)) return;
    draining.add(threadId);
    try {
      const running = (await ctx.db.list('assistantTurns', { threadId })).some(
        (turn) => turn.status === 'queued' || turn.status === 'running',
      );
      if (running) return;
      while (true) {
        const next = (await queuedMessages(threadId))[0];
        if (!next) return;
        const handle = await createTurn(
          ctx,
          next.ownerId,
          threadId,
          next.content,
          next.promptContext,
          next.providerModelId,
          next.images,
        );
        await ctx.db.delete('assistantQueuedMessages', next.id);
        await notifyQueue(threadId);
        await runTurnNow(handle.turnId);
      }
    } finally {
      draining.delete(threadId);
      await notifyQueue(threadId);
    }
  }

  async function finishTurn(
    turnId: string,
    status: AssistantTurnRecord['status'],
    code: string | null,
  ) {
    const turn = await ctx.db.get('assistantTurns', turnId);
    if (turn)
      await ctx.db.update('assistantTurns', turnId, turn.revision, { status, errorCode: code });
  }

  async function finishMessage(
    messageId: string,
    content: string,
    status: string,
    code: string | null,
    reasoning: string | null = null,
  ) {
    const message = await ctx.db.get('assistantMessages', messageId);
    if (!message) return;
    await ctx.db.update('assistantMessages', messageId, message.revision, {
      content,
      status: status as 'complete' | 'failed' | 'interrupted',
      errorCode: code,
      reasoning,
    });
  }

  async function failTurn(
    turnId: string,
    code: string,
    assistantMessageId: string,
    content = '',
    message = '本轮对话未能完成',
  ) {
    await finishTurn(turnId, 'failed', code);
    await finishMessage(assistantMessageId, content, 'failed', code);
    const turn = await ctx.db.get('assistantTurns', turnId);
    if (turn) await emit(turn.ownerId, turn.threadId, turnId, 'error', { code, message });
  }

  async function recordUsage(
    ownerId: string,
    turnId: string,
    succeeded: boolean,
    usage: ModelTokenUsage | null,
    model: { connectionId: string; modelKey: string },
  ): Promise<void> {
    await ctx.db.insert('modelUsage', {
      ...baseRecord(),
      ownerId,
      connectionId: model.connectionId,
      modelKey: model.modelKey,
      purpose: 'assistant',
      jobId: turnId,
      status: succeeded ? 'succeeded' : 'failed',
      usage,
    });
  }

  async function runTurnNow(turnId: string): Promise<void> {
    const turn = await ctx.db.get('assistantTurns', turnId);
    if (!turn || turn.status !== 'queued') return;
    await ctx.db.update('assistantTurns', turnId, turn.revision, { status: 'running' });
    const thread = await ctx.db.get('assistantThreads', turn.threadId);
    const owner = await ctx.db.get('users', turn.ownerId);
    if (!thread || !owner || owner.status !== 'active') {
      await failTurn(turnId, 'ASSISTANT_USER_UNAVAILABLE', turn.assistantMessageId);
      return;
    }
    const actor: Actor = {
      id: `assistant:${turnId}`,
      userId: turn.ownerId,
      role: owner.role,
      channel: 'mobile',
      scopes: [],
    };
    const internalToken = signInternalToken({
      secret: ctx.config.encryptionKey,
      userId: actor.userId,
      turnId,
      role: actor.role,
      expiresAt: Date.now() + INTERNAL_TOKEN_TTL_MS,
    });

    let session: AgentSession | null = null;
    let usedModel: { connectionId: string; modelKey: string; providerModelId: string } | null =
      null;
    let accumulated = '';
    let accumulatedReasoning = '';
    let usageTotal: ModelTokenUsage | null = null;
    const controller = new AbortController();
    active.set(turnId, { abort: controller, session: null });
    let flushTimer: ReturnType<typeof setInterval> | undefined;
    try {
      const tools = createAssistantTools({
        app,
        ctx,
        actor,
        internalToken,
        emitEvent: (type, payload) => emit(turn.ownerId, turn.threadId, turnId, type, payload),
      });
      const built = await factory.buildSession({
        app,
        customTools: tools,
        providerModelId: turn.providerModelId,
      });
      session = built.session;
      usedModel = built.resolved;
      active.get(turnId)!.session = session;
      await emit(turn.ownerId, turn.threadId, turnId, 'status', { phase: 'model_call' });

      session.subscribe((event: Record<string, unknown>) => {
        const type = event.type as string;
        if (type === 'message_update') {
          const inner = event.assistantMessageEvent as
            | { type?: string; delta?: string }
            | undefined;
          if (inner?.type === 'text_delta' && inner.delta) {
            accumulated += inner.delta;
            broadcast(turn.threadId, { kind: 'text_delta', delta: inner.delta });
          }
          if (inner?.type === 'thinking_delta' && inner.delta) {
            accumulatedReasoning += inner.delta;
            broadcast(turn.threadId, { kind: 'reasoning_delta', delta: inner.delta });
          }
          return;
        }
        if (type === 'tool_execution_start') {
          void emit(turn.ownerId, turn.threadId, turnId, 'tool_call', {
            toolCallId: String(event.toolCallId ?? ''),
            name: String(event.toolName ?? ''),
            args: (event.args as Record<string, unknown>) ?? {},
          });
          return;
        }
        if (type === 'tool_execution_end') {
          const result = event.result as
            | { content?: { type?: string; text?: string }[] }
            | undefined;
          const summary = Array.isArray(result?.content)
            ? result.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text ?? '')
                .join('\n')
                .slice(0, 500)
            : '';
          void emit(turn.ownerId, turn.threadId, turnId, 'tool_result', {
            toolCallId: String(event.toolCallId ?? ''),
            name: String(event.toolName ?? ''),
            isError: event.isError === true,
            summary,
          });
          return;
        }
        if (type === 'turn_end') {
          const message = event.message as
            | { usage?: { input?: number; output?: number } }
            | undefined;
          const input = message?.usage?.input;
          const output = message?.usage?.output;
          if (typeof input === 'number' && typeof output === 'number') {
            usageTotal = usageTotal
              ? {
                  promptTokens: usageTotal.promptTokens + input,
                  completionTokens: usageTotal.completionTokens + output,
                  totalTokens: usageTotal.totalTokens + input + output,
                }
              : { promptTokens: input, completionTokens: output, totalTokens: input + output };
          }
        }
      });

      flushTimer = setInterval(() => {
        if (accumulated)
          void ctx.db
            .get('assistantMessages', turn.assistantMessageId)
            .then((message) =>
              message && message.status === 'streaming'
                ? ctx.db.update('assistantMessages', message.id, message.revision, {
                    content: accumulated,
                    reasoning: accumulatedReasoning || null,
                  })
                : undefined,
            )
            .catch(() => {});
      }, TEXT_FLUSH_INTERVAL_MS);

      const history = await loadHistory(turn.threadId, turn.userMessageId);
      const currentUser = await ctx.db.get('assistantMessages', turn.userMessageId);
      const contextPrefix = turn.promptContext ? `${turn.promptContext}\n\n` : '';
      // 不再设置单轮超时；用户可随时通过 cancelTurn 主动取消。
      if (controller.signal.aborted)
        throw new AppError(409, 'ASSISTANT_TURN_CANCELLED', '本轮对话已取消');
      const images = (currentUser?.images ?? []).map((image) => ({
        type: 'image' as const,
        data: image.data,
        mimeType: image.mimeType,
      }));
      await session.prompt(contextPrefix + formatPrompt(history, currentUser?.content ?? ''), {
        images,
      });

      const finalText = session.getLastAssistantText() ?? accumulated;
      await finishMessage(
        turn.assistantMessageId,
        finalText || accumulated,
        'complete',
        null,
        accumulatedReasoning || null,
      );
      await finishTurn(turnId, 'succeeded', null);
      await recordUsage(turn.ownerId, turnId, true, usageTotal, usedModel!);
      await emit(turn.ownerId, turn.threadId, turnId, 'status', { phase: 'turn_completed' });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const code = error instanceof AppError ? error.code : 'ASSISTANT_TURN_FAILED';
      const message = cancelled
        ? '本轮对话已取消'
        : error instanceof AppError
          ? error.message
          : '本轮对话未能完成';
      await finishMessage(
        turn.assistantMessageId,
        accumulated,
        cancelled ? 'interrupted' : 'failed',
        code,
        accumulatedReasoning || null,
      );
      await finishTurn(turnId, cancelled ? 'cancelled' : 'failed', code);
      if (usedModel) await recordUsage(turn.ownerId, turnId, false, usageTotal, usedModel);
      await emit(turn.ownerId, turn.threadId, turnId, 'error', { code, message });
    } finally {
      if (flushTimer) clearInterval(flushTimer);
      active.delete(turnId);
      try {
        session?.dispose();
      } catch {
        // 会话清理失败不影响结果落库。
      }
      const threadRecord = await ctx.db.get('assistantThreads', turn.threadId);
      if (threadRecord)
        await ctx.db.update('assistantThreads', threadRecord.id, threadRecord.revision, {
          lastMessageAt: now(),
        });
      void drainThread(turn.threadId).catch(() => {});
    }
  }

  async function loadHistory(threadId: string, beforeMessageId: string) {
    const messages = await ctx.db.list('assistantMessages', { threadId });
    const ordered = [...messages].sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.role === right.role
          ? left.id.localeCompare(right.id)
          : left.role === 'user'
            ? -1
            : 1
        : left.createdAt.localeCompare(right.createdAt),
    );
    const cutoff = ordered.findIndex((message) => message.id === beforeMessageId);
    const history = cutoff >= 0 ? ordered.slice(0, cutoff) : ordered;
    return history.filter((message) => message.status === 'complete').slice(-HISTORY_MESSAGE_LIMIT);
  }

  function formatPrompt(history: { role: string; content: string }[], current: string): string {
    const transcript = history.length
      ? '以下是此前对话记录（供上下文参考）：\n' +
        history
          .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
          .join('\n') +
        '\n\n'
      : '';
    return `${transcript}用户：${current}`;
  }

  return {
    enqueue: enqueueTurn,
    queueMessage,
    sendQueuedMessage,
    notifyQueue,
    async runTurnNow(turnId) {
      await runTurnNow(turnId);
    },
    async cancelTurn(ownerId, turnId) {
      const turn = await ctx.db.get('assistantTurns', turnId);
      if (!turn || turn.ownerId !== ownerId) return false;
      const entry = active.get(turnId);
      if (!entry) return false;
      entry.abort.abort();
      try {
        await entry.session?.abort();
      } catch {
        // 会话中止失败时以 AbortController 为准。
      }
      return true;
    },
    invalidateRuntime() {
      factory.invalidateRuntime();
    },
    async start() {
      // 进程重启后未完成的一轮对话不恢复模型中间态，直接标记失败并通知前端。
      const turns = await ctx.db.list('assistantTurns', {});
      for (const turn of turns.filter(
        (entry) => entry.status === 'queued' || entry.status === 'running',
      )) {
        await failTurn(turn.id, 'ASSISTANT_RESTARTED', turn.assistantMessageId);
      }
      const queued = await ctx.db.list('assistantQueuedMessages', {});
      for (const threadId of new Set(queued.map((entry) => entry.threadId)))
        void drainThread(threadId).catch(() => {});
    },
    stop() {
      for (const [, entry] of active) {
        try {
          entry.abort.abort();
          void entry.session?.abort();
        } catch {
          // 忽略停止时的会话错误。
        }
      }
      active.clear();
    },
    subscribe,
    replay,
  };
}

/** 创建一轮对话的持久化记录；返回句柄后由调用方入队执行。 */
export async function createTurn(
  ctx: AppContext,
  ownerId: string,
  threadId: string,
  content: string,
  promptContext: string | null = null,
  providerModelId: string | null = null,
  images: import('@drill-hub/contracts').AssistantImageAttachment[] = [],
): Promise<TurnHandle> {
  const userMessage = {
    ...baseRecord(),
    ownerId,
    threadId,
    role: 'user' as const,
    content,
    reasoning: null,
    images,
    status: 'complete' as const,
    errorCode: null,
  };
  await ctx.db.insert('assistantMessages', userMessage);
  const assistantMessage = {
    ...baseRecord(),
    ownerId,
    threadId,
    role: 'assistant' as const,
    content: '',
    reasoning: null,
    images: [],
    status: 'streaming' as const,
    errorCode: null,
  };
  await ctx.db.insert('assistantMessages', assistantMessage);
  const turn = {
    ...baseRecord(),
    ownerId,
    threadId,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    status: 'queued' as const,
    errorCode: null,
    promptContext: null,
    providerModelId,
  };
  await ctx.db.insert('assistantTurns', turn);
  if (promptContext) {
    await ctx.db.update('assistantTurns', turn.id, turn.revision, { promptContext });
  }
  return {
    turnId: turn.id,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
  };
}

export function assistantEventViews(records: AssistantEventRecord[]): AssistantEventView[] {
  return records.map((record) => {
    const { ownerId: _ownerId, ...view } = record;
    return view;
  });
}
