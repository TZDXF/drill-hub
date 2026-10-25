import type {
  AssistantMessageView,
  AssistantQueuedMessage,
  AssistantThread,
  AssistantThreadDetail,
  AssistantTurnView,
} from '@drill-hub/contracts';
import { baseRecord } from '#server/core/ids.js';
import type { AppContext } from '#server/core/context.js';
import type { Actor } from '#server/core/context.js';
import type {
  AssistantMessageRecord,
  AssistantQueuedMessageRecord,
  AssistantTurnRecord,
} from '#server/db/records.js';
import { assistantEventViews } from '#server/modules/assistant/service.js';

export function assistantMessageView(record: AssistantMessageRecord): AssistantMessageView {
  const { ownerId: _ownerId, ...view } = record;
  return view;
}

export function assistantQueuedMessageView(
  record: AssistantQueuedMessageRecord,
): AssistantQueuedMessage {
  const { ownerId: _ownerId, promptContext: _promptContext, ...view } = record;
  return view;
}

export function assistantTurnView(record: AssistantTurnRecord): AssistantTurnView {
  const { ownerId: _ownerId, promptContext: _promptContext, ...view } = record;
  return view;
}

function byMessageDate(left: AssistantMessageRecord, right: AssistantMessageRecord): number {
  return left.createdAt === right.createdAt
    ? left.role === right.role
      ? left.id.localeCompare(right.id)
      : left.role === 'user'
        ? -1
        : 1
    : left.createdAt.localeCompare(right.createdAt);
}

function byDate<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return left.createdAt === right.createdAt
    ? left.id.localeCompare(right.id)
    : left.createdAt.localeCompare(right.createdAt);
}

export async function readAssistantThread(
  ctx: AppContext,
  thread: AssistantThread,
  before?: string,
  limit = 40,
): Promise<AssistantThreadDetail> {
  const [allMessages, allTurns, allEvents, activeRows, queued] = await Promise.all([
    ctx.db.list('assistantMessages', { threadId: thread.id }),
    ctx.db.list('assistantTurns', { threadId: thread.id }),
    ctx.db.list('assistantEvents', { threadId: thread.id }),
    ctx.db.list('assistantTurns', { threadId: thread.id }),
    ctx.db.list('assistantQueuedMessages', { threadId: thread.id }),
  ]);
  const ordered = [...allMessages].sort(byMessageDate);
  const beforeIndex = before ? ordered.findIndex((message) => message.id === before) : -1;
  const end = beforeIndex >= 0 ? beforeIndex : ordered.length;
  const messages = ordered.slice(Math.max(0, end - limit), end);
  const visibleMessageIds = new Set(messages.map((message) => message.id));
  const activeTurn =
    activeRows.find((turn) => turn.status === 'queued' || turn.status === 'running') ?? null;
  if (activeTurn) {
    visibleMessageIds.add(activeTurn.userMessageId);
    visibleMessageIds.add(activeTurn.assistantMessageId);
  }
  const turns = allTurns.filter(
    (turn) => visibleMessageIds.has(turn.userMessageId) || turn.id === activeTurn?.id,
  );
  const turnIds = new Set(turns.map((turn) => turn.id));
  const messageById = new Map(allMessages.map((message) => [message.id, message]));
  return {
    thread,
    messages: messages.map(assistantMessageView),
    turns: turns.map(assistantTurnView),
    events: assistantEventViews(
      allEvents.filter((event) => turnIds.has(event.turnId)).sort((a, b) => a.seq - b.seq),
    ),
    activeTurn: activeTurn ? assistantTurnView(activeTurn) : null,
    queued: queued.sort(byDate).map(assistantQueuedMessageView),
    timeline: [...allTurns].sort(byDate).map((turn) => ({
      id: turn.id,
      userMessageId: turn.userMessageId,
      question: messageById.get(turn.userMessageId)?.content.slice(0, 500) ?? '',
      answer: messageById.get(turn.assistantMessageId)?.content.slice(0, 500) ?? '',
      createdAt: turn.createdAt,
    })),
    hasOlder: end > messages.length,
    oldestMessageId: messages[0]?.id ?? null,
  };
}

/** Create an independent branch before or through a settled turn; source history is immutable. */
export async function forkAssistantThread(
  ctx: AppContext,
  actor: Actor,
  source: AssistantThread,
  turnId: string,
  mode: 'before' | 'through',
): Promise<AssistantThread> {
  const [messages, turns, events] = await Promise.all([
    ctx.db.list('assistantMessages', { threadId: source.id }),
    ctx.db.list('assistantTurns', { threadId: source.id }),
    ctx.db.list('assistantEvents', { threadId: source.id }),
  ]);
  const orderedTurns = [...turns].sort(byDate);
  const targetIndex = orderedTurns.findIndex((turn) => turn.id === turnId);
  if (targetIndex < 0) throw new Error('FORK_TURN_NOT_FOUND');
  const target = orderedTurns[targetIndex]!;
  if (mode === 'through' && (target.status === 'queued' || target.status === 'running'))
    throw new Error('FORK_ACTIVE_TURN');
  const keptTurns = orderedTurns.slice(0, mode === 'before' ? targetIndex : targetIndex + 1);
  const keptMessages = new Set(
    keptTurns.flatMap((turn) => [turn.userMessageId, turn.assistantMessageId]),
  );
  const branch = {
    ...baseRecord(),
    ownerId: actor.userId,
    title: `${source.title.slice(0, 180)} · 分支`,
    lastMessageAt: keptTurns.at(-1)?.updatedAt ?? source.createdAt,
  };
  await ctx.db.transaction(async (tx) => {
    await tx.insert('assistantThreads', branch);
    const messageIds = new Map<string, string>();
    for (const message of messages
      .filter((entry) => keptMessages.has(entry.id))
      .sort(byMessageDate)) {
      const copy = {
        ...message,
        ...baseRecord(),
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        ownerId: actor.userId,
        threadId: branch.id,
      };
      messageIds.set(message.id, copy.id);
      await tx.insert('assistantMessages', copy);
    }
    const turnIds = new Map<string, string>();
    for (const turn of keptTurns) {
      const copy = {
        ...turn,
        ...baseRecord(),
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
        ownerId: actor.userId,
        threadId: branch.id,
        userMessageId: messageIds.get(turn.userMessageId)!,
        assistantMessageId: messageIds.get(turn.assistantMessageId)!,
      };
      turnIds.set(turn.id, copy.id);
      await tx.insert('assistantTurns', copy);
    }
    for (const event of events.filter((entry) => turnIds.has(entry.turnId))) {
      await tx.insert('assistantEvents', {
        ...event,
        ...baseRecord(),
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        ownerId: actor.userId,
        threadId: branch.id,
        turnId: turnIds.get(event.turnId)!,
      });
    }
    await ctx.audit(
      actor,
      'assistant.thread.fork',
      'assistantThread',
      branch.id,
      { sourceThreadId: source.id, sourceTurnId: turnId, mode },
      tx,
    );
  });
  return branch;
}
