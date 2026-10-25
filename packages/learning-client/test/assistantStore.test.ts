import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@drill-hub/api-client';
import type { Router } from 'vue-router';
import type { LearningContext } from '#learning-client/context';
import { buildHistory } from '#learning-client/assistant/turns';

async function setup() {
  const { initAssistantStore, useAssistant } = await import('#learning-client/assistant/store');
  const streams: {
    signal: AbortSignal;
    emit: (event: StreamEvent) => void;
    resolve: () => void;
    reject: (reason: Error) => void;
  }[] = [];
  const get = vi.fn<(path: string) => Promise<unknown>>().mockResolvedValue({
    turns: [],
    messages: [],
    events: [],
    activeTurn: { id: 'turn-1' },
  });
  const stream = vi.fn<
    (path: string, signal: AbortSignal, emit: (event: StreamEvent) => void) => Promise<void>
  >(
    (_path: string, signal: AbortSignal, emit: (event: StreamEvent) => void) =>
      new Promise<void>((resolve, reject) => {
        streams.push({ signal, emit, resolve, reject });
      }),
  );
  const push = vi.fn<(target: unknown) => void>();
  initAssistantStore({ get, stream } as unknown as LearningContext, { push } as unknown as Router);
  const store = useAssistant();
  await store.selectThread('thread-1');
  const emit = (seq: number, type: string, payload: Record<string, unknown>) => {
    streams.at(-1)!.emit({
      event: type,
      data: JSON.stringify({
        id: `event-${seq}`,
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq,
        type,
        payload,
        createdAt: '2026-10-25T10:00:00.000Z',
      }),
    });
  };
  return { store, get, stream, streams, push, emit };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(async () => {
  const { useAssistant } = await import('#learning-client/assistant/store');
  useAssistant().closePanel();
  vi.useRealTimers();
});

describe('assistant SSE transport', () => {
  it('reconnects SSE after EOF and failure with the last cursor, without polling or repeating actions', async () => {
    const { store, get, stream, streams, push, emit } = await setup();
    emit(1, 'ui_action', { action: { type: 'navigate', route: 'topics' } });
    streams[0]!.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    expect(stream).toHaveBeenNthCalledWith(
      2,
      '/me/assistant/threads/thread-1/stream?after=1',
      expect.any(AbortSignal),
      expect.any(Function),
    );
    emit(1, 'ui_action', { action: { type: 'navigate', route: 'topics' } });
    expect(push).toHaveBeenCalledTimes(1);
    streams[1]!.reject(new Error('offline'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(stream).toHaveBeenCalledTimes(3);
    expect(stream.mock.calls[2]![0]).toBe('/me/assistant/threads/thread-1/stream?after=1');
    expect(get.mock.calls).toEqual([['/me/assistant/threads/thread-1']]);
    expect(store.state.activeTurnId).toBe('turn-1');
  });

  it('refreshes the persisted final reply and duration on completion, and stops the stream', async () => {
    const { store, get, stream, streams, emit } = await setup();
    get.mockResolvedValue({
      turns: [
        {
          id: 'turn-1',
          userMessageId: 'u1',
          assistantMessageId: 'a1',
          status: 'succeeded',
          createdAt: '2026-10-25T10:00:00.000Z',
          updatedAt: '2026-10-25T10:00:12.500Z',
        },
      ],
      messages: [
        { id: 'u1', role: 'user', content: '问题' },
        { id: 'a1', role: 'assistant', content: '最终回复' },
      ],
      events: [],
      activeTurn: null,
    });
    streams[0]!.emit({ event: 'text_delta', data: '{"delta":"部分回复"}' });
    emit(2, 'status', { phase: 'turn_completed' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(store.state).toMatchObject({
      activeTurnId: null,
      streamingText: '',
      connection: 'idle',
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(streams[0]!.signal.aborted).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(buildHistory(store.state)[0]).toMatchObject({
      kind: 'turn',
      turn: { assistantMessage: { content: '最终回复' }, durationMs: 12500, active: false },
    });
  });

  it('refreshes failed turns and keeps the server error visible', async () => {
    const { store, get, streams, emit } = await setup();
    get.mockResolvedValue({ turns: [], messages: [], events: [], activeTurn: null });
    emit(2, 'error', { message: '请联系管理员配置模型' });
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(2);
    expect(store.state).toMatchObject({
      activeTurnId: null,
      error: '请联系管理员配置模型',
      connection: 'idle',
    });
    expect(streams[0]!.signal.aborted).toBe(true);
  });

  it('cancels pending reconnect on close and resumes SSE on reopening', async () => {
    const { store, stream, streams } = await setup();
    streams[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    store.closePanel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(stream).toHaveBeenCalledTimes(1);
    store.openPanel();
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('ignores events and failures from the previous thread after switching', async () => {
    const { store, get, streams } = await setup();
    get.mockResolvedValue({ turns: [], messages: [], events: [], activeTurn: null });
    await store.selectThread('thread-2');
    streams[0]!.emit({ event: 'text_delta', data: '{"delta":"旧回复"}' });
    streams[0]!.reject(new Error('old stream'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.state).toMatchObject({
      currentThreadId: 'thread-2',
      streamingText: '',
      connection: 'idle',
      error: '',
    });
  });
});
