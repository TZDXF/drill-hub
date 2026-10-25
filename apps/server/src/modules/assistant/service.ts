import type { FastifyInstance } from 'fastify';
import type {
  AssistantEventView,
  AssistantQueueMode,
  AssistantQueuedMessage,
  ModelTokenUsage,
} from '@drill-hub/contracts';
import type {
  AgentEvent,
  EntryRecord,
  SnapshotEvent,
  SubmissionRecord,
} from '@earendil-works/pi-durable';
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import { AppError } from '#server/core/errors.js';
import { baseRecord } from '#server/core/ids.js';
import { signInternalToken } from '#server/core/internal-auth.js';
import type { Actor, AppContext, AssistantService } from '#server/core/context.js';
import type {
  AssistantEventRecord,
  AssistantQueuedMessageRecord,
  AssistantThreadRecord,
  AssistantTurnRecord,
} from '#server/db/records.js';
import { DurableAssistantRuntime } from '#server/modules/assistant/durable-runtime.js';

const TEXT_FLUSH_INTERVAL_MS = 1000;
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
  enqueue(turnId: string): void;
  queueMessage(input: QueueMessageInput): Promise<AssistantQueuedMessage>;
  sendQueuedMessage(queued: AssistantQueuedMessageRecord): Promise<AssistantQueuedMessage>;
  notifyQueue(threadId: string): Promise<void>;
  subscribe(threadId: string, listener: StreamListener): () => void;
  replay(threadId: string, afterSeq: number, listener: StreamListener): Promise<void>;
  forkThread(
    source: AssistantThreadRecord,
    branch: AssistantThreadRecord,
    turnId: string,
    mode: 'before' | 'through',
  ): Promise<void>;
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

function messageText(message: AssistantMessage | undefined): { text: string; reasoning: string } {
  let text = '';
  let reasoning = '';
  for (const block of message?.content ?? []) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'thinking') reasoning += block.thinking;
  }
  return { text, reasoning };
}
function entryMessage(entry: EntryRecord | undefined): AssistantMessage | undefined {
  const message = entry?.model?.[0];
  return message?.role === 'assistant' ? message : undefined;
}
function addUsage(total: ModelTokenUsage | null, usage: Usage): ModelTokenUsage {
  return {
    promptTokens: (total?.promptTokens ?? 0) + usage.input,
    completionTokens: (total?.completionTokens ?? 0) + usage.output,
    totalTokens: (total?.totalTokens ?? 0) + usage.totalTokens,
  };
}

export function createAssistantService(
  ctx: AppContext,
  app: FastifyInstance,
): AssistantServiceImpl {
  const seqCounters = new Map<string, number>();
  const listeners = new Map<string, Set<StreamListener>>();
  const activeTurns = new Map<string, string>();
  const cancelled = new Set<string>();
  const accumulated = new Map<string, { text: string; reasoning: string }>();
  const turnModels = new Map<string, { connectionId: string; modelKey: string }>();
  const transcripts = new Map<string, Map<EntryRecord['id'], EntryRecord>>();
  const flushTimers = new Map<string, ReturnType<typeof setInterval>>();
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
      ...baseRecord(),
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
    for (const listener of listeners.get(threadId) ?? []) {
      try {
        listener(frame);
      } catch {
        // 单个 SSE 订阅者失败不能中断 Durable 事件投影。
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
    for (const record of events
      .sort((left, right) => left.seq - right.seq)
      .filter((event) => event.seq > afterSeq)) {
      listener({ kind: 'event', event: toView(record) });
    }
  }
  function queuedView(row: AssistantQueuedMessageRecord): AssistantQueuedMessage {
    const { ownerId: _ownerId, promptContext: _promptContext, ...view } = row;
    return view;
  }
  async function notifyQueue(threadId: string): Promise<void> {
    broadcast(threadId, {
      kind: 'queue',
      queued: (await queuedMessages(threadId)).map(queuedView),
    });
  }
  async function queuedMessages(threadId: string): Promise<AssistantQueuedMessageRecord[]> {
    return (await ctx.db.list('assistantQueuedMessages', { threadId })).sort(
      (left, right) =>
        left.position - right.position ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  }
  function ensureFlush(turn: AssistantTurnRecord): void {
    if (flushTimers.has(turn.id)) return;
    accumulated.set(turn.id, { text: '', reasoning: '' });
    flushTimers.set(
      turn.id,
      setInterval(() => {
        const value = accumulated.get(turn.id);
        if (!value) return;
        void ctx.db
          .get('assistantMessages', turn.assistantMessageId)
          .then((message) =>
            message && message.status === 'streaming'
              ? ctx.db.update('assistantMessages', message.id, message.revision, {
                  content: value.text,
                  reasoning: value.reasoning || null,
                })
              : undefined,
          )
          .catch(() => {});
      }, TEXT_FLUSH_INTERVAL_MS),
    );
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
  async function failTurn(turnId: string, code: string, message: string) {
    const turn = await ctx.db.get('assistantTurns', turnId);
    if (!turn || !['queued', 'running'].includes(turn.status)) return;
    const value = accumulated.get(turnId) ?? { text: '', reasoning: '' };
    await finishMessage(turn.assistantMessageId, value.text, 'failed', code, value.reasoning);
    await finishTurn(turnId, cancelled.has(turnId) ? 'cancelled' : 'failed', code);
    await recordUsage(turn, false, null);
    await emit(turn.ownerId, turn.threadId, turnId, 'error', { code, message });
    cleanupTurn(turn.threadId, turnId);
  }
  async function finishMessage(
    messageId: string,
    content: string,
    status: 'complete' | 'failed' | 'interrupted',
    code: string | null,
    reasoning: string | null = null,
  ) {
    const message = await ctx.db.get('assistantMessages', messageId);
    if (message)
      await ctx.db.update('assistantMessages', message.id, message.revision, {
        content,
        status,
        errorCode: code,
        reasoning,
      });
  }
  async function recordUsage(
    turn: AssistantTurnRecord,
    succeeded: boolean,
    usage: ModelTokenUsage | null,
  ) {
    if ((await ctx.db.list('modelUsage', { jobId: turn.id, purpose: 'assistant' })).length) return;
    const model = turnModels.get(turn.id);
    if (!model) return;
    await ctx.db.insert('modelUsage', {
      ...baseRecord(),
      ownerId: turn.ownerId,
      connectionId: model.connectionId,
      modelKey: model.modelKey,
      purpose: 'assistant',
      jobId: turn.id,
      status: succeeded ? 'succeeded' : 'failed',
      usage,
    });
  }
  function cleanupTurn(threadId: string, turnId: string): void {
    const timer = flushTimers.get(turnId);
    if (timer) clearInterval(timer);
    flushTimers.delete(turnId);
    accumulated.delete(turnId);
    turnModels.delete(turnId);
    cancelled.delete(turnId);
    if (activeTurns.get(threadId) === turnId) activeTurns.delete(threadId);
    void drainThread(threadId).catch(() => {});
  }

  async function onBatch(
    thread: AssistantThreadRecord,
    events: readonly AgentEvent[],
    snapshot: SnapshotEvent,
    submissions: readonly SubmissionRecord[],
  ): Promise<void> {
    const byRequest = new Map(submissions.map((submission) => [submission.id, submission]));
    let transcript = transcripts.get(thread.id);
    if (!transcript) {
      transcript = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
      transcripts.set(thread.id, transcript);
    }
    for (const submission of submissions) {
      if (!submission.requestId) continue;
      const turn = await ctx.db.get('assistantTurns', submission.requestId);
      if (!turn || !['queued', 'running'].includes(turn.status)) continue;
      if (submission.status === 'placed') {
        activeTurns.set(thread.id, turn.id);
        ensureFlush(turn);
        if (turn.status === 'queued') await finishTurn(turn.id, 'running', null);
      }
    }
    for (const event of events) {
      if (event.type === 'message_end' || event.type === 'entry_appended')
        transcript.set(event.entry.id, event.entry);
      if (event.type === 'run_start') {
        const submission = byRequest.get(event.inputs[0]);
        const turnId = submission?.requestId;
        const turn = turnId ? await ctx.db.get('assistantTurns', turnId) : null;
        if (turn) {
          activeTurns.set(thread.id, turn.id);
          ensureFlush(turn);
          if (turn.status === 'queued') await finishTurn(turn.id, 'running', null);
          await emit(turn.ownerId, thread.id, turn.id, 'status', { phase: 'model_call' });
        }
        continue;
      }
      const turnId = activeTurns.get(thread.id);
      const turn = turnId ? await ctx.db.get('assistantTurns', turnId) : null;
      if (!turn) continue;
      if (event.type === 'message_update') {
        const value = accumulated.get(turn.id)!;
        for (const change of event.changes) {
          if (change.type === 'text_delta') {
            value.text += change.delta;
            broadcast(thread.id, { kind: 'text_delta', delta: change.delta });
          }
          if (change.type === 'thinking_delta') {
            value.reasoning += change.delta;
            broadcast(thread.id, { kind: 'reasoning_delta', delta: change.delta });
          }
          if (change.type === 'message') {
            const current = messageText(change.message);
            value.text = current.text;
            value.reasoning = current.reasoning;
          }
        }
      }
      if (event.type === 'tool_execution_start') {
        await emit(turn.ownerId, thread.id, turn.id, 'tool_call', {
          toolCallId: event.toolCallId,
          name: event.toolName,
          args: event.args,
        });
      }
      if (event.type === 'tool_execution_end') {
        const result = event.entry?.model?.[0];
        const content = result?.role === 'toolResult' ? result.content : [];
        await emit(turn.ownerId, thread.id, turn.id, 'tool_result', {
          toolCallId: event.toolCallId,
          name: event.toolName,
          isError: result?.role === 'toolResult' ? result.isError : false,
          summary: content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
            .slice(0, 500),
        });
      }
    }
    // 快照用于进程重启后对账；已结算 turn 不会重复写用量或完成事件。
    const reconcile = events.some((event) => event.type === 'run_end' || event.type === 'snapshot');
    for (const submission of reconcile ? submissions : []) {
      if (submission.status === 'done' || submission.status === 'unanswered')
        await settleSubmission(thread, submission, snapshot.agent.model);
    }
  }

  async function settleSubmission(
    thread: AssistantThreadRecord,
    submission: SubmissionRecord,
    agentModel: SnapshotEvent['agent']['model'],
  ): Promise<void> {
    if (!submission.requestId) return;
    const turn = await ctx.db.get('assistantTurns', submission.requestId);
    if (!turn || !['queued', 'running'].includes(turn.status)) return;
    const entries = transcripts.get(thread.id) ?? new Map();
    if (submission.type === 'input' && submission.status === 'done') {
      const final = messageText(entryMessage(entries.get(submission.answer)));
      const partial = accumulated.get(turn.id) ?? { text: '', reasoning: '' };
      let usage: ModelTokenUsage | null = null;
      let inTurn = false;
      for (const entry of entries.values()) {
        if (entry.id === submission.entry) inTurn = true;
        if (inTurn && entry.kind === 'pi.assistant') {
          const message = entryMessage(entry);
          if (message) usage = addUsage(usage, message.usage);
        }
        if (entry.id === submission.answer) break;
      }
      if (!turnModels.has(turn.id) && agentModel)
        turnModels.set(turn.id, {
          connectionId: agentModel.provider,
          modelKey: agentModel.modelId,
        });
      await finishMessage(
        turn.assistantMessageId,
        final.text || partial.text,
        'complete',
        null,
        final.reasoning || partial.reasoning || null,
      );
      await finishTurn(turn.id, 'succeeded', null);
      await recordUsage(turn, true, usage);
      await emit(turn.ownerId, thread.id, turn.id, 'status', { phase: 'turn_completed' });
      cleanupTurn(thread.id, turn.id);
    }
    if (submission.status === 'unanswered') {
      await failTurn(
        turn.id,
        cancelled.has(turn.id) ? 'ASSISTANT_TURN_CANCELLED' : 'ASSISTANT_TURN_FAILED',
        cancelled.has(turn.id) ? '本轮对话已取消' : '本轮对话未能完成',
      );
    }
  }

  const runtime = new DurableAssistantRuntime(
    ctx,
    {
      onBatch,
      onModel: (turnId, model) =>
        turnModels.set(turnId, { connectionId: model.connectionId, modelKey: model.modelKey }),
      resolveTool: async (api) => {
        const thread = (await ctx.db.list('assistantThreads', {})).find(
          (entry) => entry.durableConversationId === api.conversationId,
        );
        const turn = thread
          ? (await ctx.db.list('assistantTurns', { threadId: thread.id })).find((entry) =>
              ['queued', 'running'].includes(entry.status),
            )
          : null;
        const owner = turn ? await ctx.db.get('users', turn.ownerId) : null;
        if (!thread || !turn || !owner || owner.status !== 'active')
          throw new AppError(403, 'ASSISTANT_USER_UNAVAILABLE', '助手用户或会话不可用');
        const actor: Actor = {
          id: `assistant:${turn.id}`,
          userId: turn.ownerId,
          role: owner.role,
          channel: 'mobile',
          scopes: [],
        };
        return {
          actor,
          turn,
          internalToken: signInternalToken({
            secret: ctx.config.encryptionKey,
            userId: actor.userId,
            turnId: turn.id,
            role: actor.role,
            expiresAt: Date.now() + INTERNAL_TOKEN_TTL_MS,
          }),
          emitEvent: (type, payload) => emit(turn.ownerId, thread.id, turn.id, type, payload),
        };
      },
    },
    app,
  );

  async function runTurnNow(turnId: string): Promise<void> {
    const turn = await ctx.db.get('assistantTurns', turnId);
    if (!turn || turn.status !== 'queued') return;
    const thread = await ctx.db.get('assistantThreads', turn.threadId);
    const owner = await ctx.db.get('users', turn.ownerId);
    const user = await ctx.db.get('assistantMessages', turn.userMessageId);
    if (!thread || !owner || owner.status !== 'active' || !user) {
      await failTurn(turnId, 'ASSISTANT_USER_UNAVAILABLE', '助手用户或会话不可用');
      return;
    }
    ensureFlush(turn);
    try {
      await runtime.submit(thread, {
        id: turn.id,
        content: user.content,
        promptContext: turn.promptContext,
        providerModelId: turn.providerModelId,
        images: user.images,
      });
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'ASSISTANT_TURN_FAILED';
      const message = error instanceof AppError ? error.message : '本轮对话未能完成';
      await failTurn(turnId, code, message);
    }
  }
  function enqueueTurn(turnId: string): void {
    void runTurnNow(turnId).catch(() => {});
  }
  async function drainThread(threadId: string): Promise<void> {
    if (draining.has(threadId)) return;
    draining.add(threadId);
    try {
      const running = (await ctx.db.list('assistantTurns', { threadId })).some((turn) =>
        ['queued', 'running'].includes(turn.status),
      );
      if (running) return;
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
      enqueueTurn(handle.turnId);
    } finally {
      draining.delete(threadId);
      await notifyQueue(threadId);
    }
  }

  return {
    enqueue: enqueueTurn,
    queueMessage: async (input) => {
      const pending = await queuedMessages(input.threadId);
      const row: AssistantQueuedMessageRecord = {
        ...baseRecord(),
        ...input,
        position: Math.max(0, ...pending.map((item) => item.position)) + 1,
      };
      await ctx.db.insert('assistantQueuedMessages', row);
      await notifyQueue(input.threadId);
      if (input.mode === 'steer') {
        const current = (await ctx.db.list('assistantTurns', { threadId: input.threadId })).find(
          (turn) => ['queued', 'running'].includes(turn.status),
        );
        if (current) {
          cancelled.add(current.id);
          const thread = await ctx.db.get('assistantThreads', input.threadId);
          if (thread) await runtime.cancel(thread);
        }
      }
      void drainThread(input.threadId).catch(() => {});
      return queuedView(row);
    },
    sendQueuedMessage: async (queued) => {
      const pending = await queuedMessages(queued.threadId);
      const updated = await ctx.db.update('assistantQueuedMessages', queued.id, queued.revision, {
        mode: 'steer',
        position: (pending[0]?.position ?? 1) - 1,
      });
      await notifyQueue(queued.threadId);
      const current = (await ctx.db.list('assistantTurns', { threadId: queued.threadId })).find(
        (turn) => ['queued', 'running'].includes(turn.status),
      );
      if (current) {
        cancelled.add(current.id);
        const thread = await ctx.db.get('assistantThreads', queued.threadId);
        if (thread) await runtime.cancel(thread);
      }
      void drainThread(queued.threadId).catch(() => {});
      return queuedView(updated);
    },
    notifyQueue,
    runTurnNow,
    cancelTurn: async (ownerId, turnId) => {
      const turn = await ctx.db.get('assistantTurns', turnId);
      if (!turn || turn.ownerId !== ownerId || !['queued', 'running'].includes(turn.status))
        return false;
      cancelled.add(turn.id);
      const thread = await ctx.db.get('assistantThreads', turn.threadId);
      return thread ? runtime.cancel(thread) : false;
    },
    invalidateRuntime: () => runtime.invalidate(),
    start: async () => {
      const threads = await ctx.db.list('assistantThreads', {});
      await runtime.start(threads, await ctx.db.list('assistantTurns', {}));
      for (const queued of await ctx.db.list('assistantQueuedMessages', {}))
        void drainThread(queued.threadId).catch(() => {});
    },
    stop: () => runtime.close(),
    subscribe,
    replay,
    forkThread: (source, branch, turnId, mode) => runtime.fork(source, branch, turnId, mode),
  };
}

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
    promptContext,
    providerModelId,
    apiCalls: 0,
    writeCalls: 0,
  };
  await ctx.db.insert('assistantTurns', turn);
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
