import { describe, expect, it } from 'vitest';
import type {
  AssistantEventView,
  AssistantMessageView,
  AssistantTurnView,
} from '@drill-hub/contracts';
import { describeToolAction, describeUiAction } from '#learning-client/assistant/actions';
import { buildHistory } from '#learning-client/assistant/turns';

function message(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt = '2026-10-25T10:00:00.000Z',
): AssistantMessageView {
  return {
    id,
    threadId: 'thread-1',
    role,
    content,
    status: 'complete',
    errorCode: null,
    createdAt,
    updatedAt: createdAt,
    revision: 1,
  };
}

function turn(
  id: string,
  userMessageId: string,
  assistantMessageId: string,
  overrides: Partial<AssistantTurnView> = {},
): AssistantTurnView {
  return {
    id,
    threadId: 'thread-1',
    userMessageId,
    assistantMessageId,
    status: 'succeeded',
    errorCode: null,
    providerModelId: null,
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:12.500Z',
    revision: 1,
    ...overrides,
  };
}

function event(
  seq: number,
  type: AssistantEventView['type'],
  payload: Record<string, unknown>,
  turnId = 'turn-1',
): AssistantEventView {
  return {
    id: `event-${seq}`,
    threadId: 'thread-1',
    turnId,
    seq,
    type,
    payload,
    createdAt: '2026-10-25T10:00:01.000Z',
  };
}

describe('assistant actions', () => {
  it('hides GET lookups and layout tweaks, keeps writes and search', () => {
    expect(
      describeToolAction('drill_hub_api', { method: 'GET', path: '/api/v1/topics' }),
    ).toBeNull();
    expect(describeUiAction({ type: 'set_layout', mode: 'split' })).toBeNull();
    const create = describeToolAction('drill_hub_api', {
      method: 'POST',
      path: '/api/v1/agent/topics',
      body: { title: '高等数学' },
    });
    expect(create).toMatchObject({
      icon: 'book',
      key: 'createTopic',
      values: { title: '“高等数学”' },
    });
    expect(describeToolAction('web_search', { query: '极限的定义' })).toMatchObject({
      icon: 'search',
      key: 'search',
      values: { query: '极限的定义' },
    });
    expect(describeUiAction({ type: 'navigate', route: 'topics' })).toMatchObject({
      icon: 'arrow',
      key: 'navigate',
    });
  });

  it('describes attempt lifecycle writes', () => {
    expect(
      describeToolAction('drill_hub_api', {
        method: 'POST',
        path: '/api/v1/assessments/a1/attempts',
      }),
    ).toMatchObject({ key: 'startAttempt' });
    expect(
      describeToolAction('drill_hub_api', {
        method: 'POST',
        path: '/api/v1/attempts/at1/submit',
      }),
    ).toMatchObject({ key: 'submitAttempt' });
    expect(
      describeToolAction('drill_hub_api', {
        method: 'PUT',
        path: '/api/v1/attempts/at1/answers/q1',
      }),
    ).toMatchObject({ key: 'saveAnswer' });
  });
});

describe('assistant buildHistory', () => {
  const messages = [
    message('u1', 'user', '帮我创建一个主题'),
    message('a1', 'assistant', '已创建。'),
    message('u2', 'user', '谢谢'),
  ];
  const turns = [turn('turn-1', 'u1', 'a1')];
  const events = [
    event(1, 'tool_call', {
      toolCallId: 't1',
      name: 'drill_hub_api',
      args: { method: 'POST', path: '/api/v1/agent/topics', body: { title: '高等数学' } },
    }),
    event(2, 'tool_call', {
      toolCallId: 't2',
      name: 'drill_hub_api',
      args: { method: 'GET', path: '/api/v1/dashboard' },
    }),
    event(3, 'tool_result', { toolCallId: 't1', name: 'drill_hub_api', isError: false }),
    event(4, 'ui_action', { action: { type: 'set_layout', mode: 'split' } }),
  ];

  it('groups a turn with only visible key actions and duration', () => {
    const history = buildHistory({
      messages,
      turns,
      events,
      activeTurnId: null,
      streamingText: '',
    });
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ kind: 'turn' });
    const first = history[0] as Extract<(typeof history)[number], { kind: 'turn' }>;
    expect(first.turn.userMessage?.id).toBe('u1');
    expect(first.turn.assistantMessage?.id).toBe('a1');
    expect(first.turn.actions).toHaveLength(1);
    expect(first.turn.actions[0]).toMatchObject({
      key: 'createTopic',
      running: false,
      failed: false,
    });
    expect(first.turn.durationMs).toBe(12500);
    expect(history[1]).toMatchObject({ kind: 'message', message: { id: 'u2' } });
  });

  it('marks failed results and failed turns', () => {
    const history = buildHistory({
      messages,
      turns: [turn('turn-1', 'u1', 'a1', { status: 'failed' })],
      events: [
        event(1, 'tool_call', {
          toolCallId: 't1',
          name: 'drill_hub_api',
          args: { method: 'POST', path: '/api/v1/agent/topics' },
        }),
        event(2, 'tool_result', { toolCallId: 't1', name: 'drill_hub_api', isError: true }),
      ],
      activeTurnId: null,
      streamingText: '',
    });
    const first = history[0] as Extract<(typeof history)[number], { kind: 'turn' }>;
    expect(first.turn.failed).toBe(true);
    expect(first.turn.actions[0]).toMatchObject({ key: 'createTopic', failed: true });
  });

  it('attaches the last unmatched user message to an optimistic active turn', () => {
    const history = buildHistory({
      messages: [message('u9', 'user', '打开主题列表', '2026-10-25T10:05:00.000Z')],
      turns: [],
      events: [event(1, 'ui_action', { action: { type: 'navigate', route: 'topics' } }, 'turn-9')],
      activeTurnId: 'turn-9',
      streamingText: '好的，',
    });
    expect(history).toHaveLength(1);
    const first = history[0] as Extract<(typeof history)[number], { kind: 'turn' }>;
    expect(first.turn.turnId).toBe('turn-9');
    expect(first.turn.active).toBe(true);
    expect(first.turn.userMessage?.id).toBe('u9');
    expect(first.turn.actions).toHaveLength(1);
    expect(first.turn.actions[0]).toMatchObject({ key: 'navigate' });
  });
});
