import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';
import type { LearningContext } from '#learning-client/context';

beforeEach(() => vi.resetModules());
afterEach(async () => {
  const { useAssistant } = await import('#learning-client/assistant/store');
  useAssistant().closePanel();
});

describe('assistant thread races', () => {
  it('does not navigate to a fork after the user switches threads', async () => {
    const { initAssistantStore, useAssistant } = await import('#learning-client/assistant/store');
    let finish!: (value: unknown) => void;
    const post = vi.fn<() => Promise<unknown>>(
      () =>
        new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
    );
    const get = vi.fn<(path: string) => Promise<unknown>>(async (path: string) =>
      path === '/me/assistant/threads'
        ? []
        : { turns: [], messages: [], events: [], activeTurn: null },
    );
    initAssistantStore(
      {
        get,
        post,
        platform: {
          getAssistantPanelPreferences: () => null,
          setAssistantPanelPreferences: (_value: string) => undefined,
        },
      } as unknown as LearningContext,
      {} as Router,
    );
    const store = useAssistant();
    await store.selectThread('a');
    const fork = store.forkThread('turn', 'through');
    await store.selectThread('b');
    finish({ id: 'fork' });
    await fork;
    expect(store.state.currentThreadId).toBe('b');
    expect(get).not.toHaveBeenCalledWith('/me/assistant/threads/fork');
  });
});
