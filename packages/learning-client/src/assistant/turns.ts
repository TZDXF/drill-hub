import type {
  AssistantEventView,
  AssistantMessageView,
  AssistantTurnView,
  AssistantUiAction,
} from '@drill-hub/contracts';
import {
  describeToolAction,
  describeUiAction,
  type AssistantActionDescriptor,
} from '#learning-client/assistant/actions';

/**
 * 把线程的 messages / turns / events 组装成按轮组织的渲染模型：
 * 用户消息 → 过程折叠行（关键操作）→ 助手回复。无关事件已在 actions 里过滤。
 */

export interface AssistantActionItem extends AssistantActionDescriptor {
  seq: number;
  running: boolean;
  failed: boolean;
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  createdAt?: string;
  durationMs?: number | null;
}

export interface AssistantTurnItem {
  turnId: string | null;
  userMessage: AssistantMessageView | null;
  assistantMessage: AssistantMessageView | null;
  actions: AssistantActionItem[];
  /** 完成轮的耗时；进行中为 null。 */
  durationMs: number | null;
  failed: boolean;
  reasoning: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  /** 该轮正在进行（含 turns 记录缺失的乐观轮）。 */
  active: boolean;
}

export type AssistantHistoryItem =
  | { kind: 'turn'; turn: AssistantTurnItem }
  | { kind: 'message'; message: AssistantMessageView };

export interface AssistantHistoryInput {
  messages: AssistantMessageView[];
  turns: AssistantTurnView[];
  events: AssistantEventView[];
  activeTurnId: string | null;
  streamingText: string;
}

function turnActions(turnId: string, events: AssistantEventView[]): AssistantActionItem[] {
  const turnEvents = events.filter((event) => event.turnId === turnId);
  const results = new Map<string, AssistantEventView>();
  const calls = new Map<string, AssistantEventView>();
  for (const event of turnEvents) {
    if (event.type === 'tool_call') calls.set(String(event.payload?.toolCallId ?? ''), event);
    if (event.type === 'tool_result') {
      const callId = String(event.payload?.toolCallId ?? '');
      if (callId) results.set(callId, event);
    }
  }
  const items: AssistantActionItem[] = [];
  for (const event of turnEvents) {
    let descriptor: AssistantActionDescriptor | null = null;
    let running = false;
    let failed = false;
    if (event.type === 'tool_call') {
      descriptor = describeToolAction(
        String(event.payload?.name ?? ''),
        event.payload?.args as Record<string, unknown> | undefined,
      );
      if (descriptor) {
        const result = results.get(String(event.payload?.toolCallId ?? ''));
        running = !result;
        failed = result?.payload?.isError === true;
        const call = calls.get(String(event.payload?.toolCallId ?? ''));
        const start = call ? Date.parse(call.createdAt) : NaN;
        const end = result ? Date.parse(result.createdAt) : NaN;
        const durationMs =
          Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
        if (descriptor)
          items.push({
            ...descriptor,
            seq: event.seq,
            running,
            failed,
            name: String(event.payload?.name ?? ''),
            args: event.payload?.args as Record<string, unknown> | undefined,
            result: typeof result?.payload?.summary === 'string' ? result.payload.summary : '',
            createdAt: event.createdAt,
            durationMs,
          });
        continue;
      }
    } else if (event.type === 'ui_action') {
      descriptor = describeUiAction(event.payload?.action as AssistantUiAction | undefined);
    }
    if (descriptor) items.push({ ...descriptor, seq: event.seq, running, failed });
  }
  return items;
}

function turnDuration(turn: AssistantTurnView): number | null {
  if (turn.status === 'queued' || turn.status === 'running') return null;
  const start = Date.parse(turn.createdAt);
  const end = Date.parse(turn.updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function buildTurnItem(turn: AssistantTurnView, input: AssistantHistoryInput): AssistantTurnItem {
  return {
    turnId: turn.id,
    userMessage: input.messages.find((message) => message.id === turn.userMessageId) ?? null,
    assistantMessage:
      input.messages.find((message) => message.id === turn.assistantMessageId) ?? null,
    actions: turnActions(turn.id, input.events),
    durationMs: turnDuration(turn),
    failed: turn.status === 'failed' || turn.status === 'cancelled',
    reasoning:
      input.messages.find((message) => message.id === turn.assistantMessageId)?.reasoning ?? null,
    errorMessage:
      (input.events.find((event) => event.turnId === turn.id && event.type === 'error')?.payload
        ?.message as string) ?? null,
    startedAt: turn.createdAt,
    active: turn.id === input.activeTurnId,
  };
}

/** 服务端 turn 记录尚未随线程详情刷新时，为活动轮构造乐观渲染项。 */
function optimisticActiveTurn(
  input: AssistantHistoryInput,
  userMessage: AssistantMessageView | null,
): AssistantTurnItem | null {
  if (!input.activeTurnId) return null;
  const actions = turnActions(input.activeTurnId, input.events);
  return {
    turnId: input.activeTurnId,
    userMessage,
    assistantMessage: null,
    actions,
    durationMs: null,
    failed: false,
    reasoning: null,
    errorMessage: null,
    startedAt: null,
    active: true,
  };
}

export function buildHistory(input: AssistantHistoryInput): AssistantHistoryItem[] {
  const turns = [...input.turns].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt),
  );
  const usedMessages = new Set<string>();
  const items: AssistantHistoryItem[] = [];
  for (const message of input.messages) {
    const turn = turns.find((entry) => entry.userMessageId === message.id);
    if (!turn) continue;
    usedMessages.add(message.id);
    if (turn.assistantMessageId) usedMessages.add(turn.assistantMessageId);
    items.push({ kind: 'turn', turn: buildTurnItem(turn, input) });
  }

  // 尚未挂到 turn 记录上的消息：最后一条未匹配的用户消息归入乐观活动轮，其余原样展示。
  const activeTurnKnown = turns.some((turn) => turn.id === input.activeTurnId);
  const unmatched = input.messages.filter((message) => !usedMessages.has(message.id));
  let pendingUserMessage: AssistantMessageView | null = null;
  if (!activeTurnKnown && input.activeTurnId) {
    for (let index = unmatched.length - 1; index >= 0; index -= 1) {
      const message = unmatched[index]!;
      if (message.role === 'user') {
        pendingUserMessage = message;
        break;
      }
    }
  }
  for (const message of unmatched) {
    if (message === pendingUserMessage) continue;
    items.push({ kind: 'message', message });
  }
  if (!activeTurnKnown && input.activeTurnId) {
    const turn = optimisticActiveTurn(input, pendingUserMessage);
    if (turn) items.push({ kind: 'turn', turn });
  }
  return items;
}
