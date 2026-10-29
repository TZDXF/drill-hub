import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';
import type { AssistantThread } from '@drill-hub/contracts';
import type { LearningContext } from '#learning-client/context';

beforeEach(() => vi.resetModules());
afterEach(async () => {
  const { useAssistant } = await import('#learning-client/assistant/store');
  useAssistant().closePanel();
});

async function setup() {
  const { initAssistantStore, useAssistant } = await import('#learning-client/assistant/store');
  const threads: AssistantThread[] = ['a', 'b'].map((id) => ({
    id,
    ownerId: 'owner',
    title: id,
    revision: 1,
    archivedAt: null,
    lastMessageAt: '2026-10-29T00:00:00Z',
    createdAt: '2026-10-29T00:00:00Z',
    updatedAt: '2026-10-29T00:00:00Z',
  }));
  const get = vi.fn<(path: string) => Promise<unknown>>(async (path: string) =>
    path === '/me/assistant/threads'
      ? threads
      : {
          thread: threads.find((thread) => path.endsWith(thread.id)),
          turns: [],
          messages: [],
          events: [],
          queued: [],
          timeline: [],
          activeTurn: null,
        },
  );
  const post = vi.fn<(path: string, body: unknown) => Promise<unknown>>().mockResolvedValue({});
  initAssistantStore({ get, post } as unknown as LearningContext, {} as Router);
  const store = useAssistant();
  await store.loadThreads();
  await store.selectThread('a');
  return { store, get, post, threads };
}

describe('assistant conversation archives', () => {
  it('archives the current conversation and selects the next, clearing an empty list', async () => {
    const { store, post } = await setup();
    await store.archiveThread('a');
    expect(post).toHaveBeenCalledWith('/me/assistant/threads/a/archive', { expectedRevision: 1 });
    expect(store.state.currentThreadId).toBe('b');
    expect(store.state.threads.map((thread) => thread.id)).toEqual(['b']);
    await store.archiveThread('b');
    expect(store.state.currentThreadId).toBeNull();
    expect(store.state.threads).toEqual([]);
    expect(store.state.messages).toEqual([]);
  });

  it('keeps conversations visible on failure and preserves a user switch during archiving', async () => {
    const { store, post } = await setup();
    post.mockRejectedValueOnce(new Error('conflict'));
    await expect(store.archiveThread('a')).rejects.toThrow('conflict');
    expect(store.state.currentThreadId).toBe('a');
    expect(store.state.threads).toHaveLength(2);
    let finish!: (value: unknown) => void;
    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const archiving = store.archiveThread('a');
    await store.selectThread('b');
    finish({});
    await archiving;
    expect(store.state.currentThreadId).toBe('b');
    expect(store.state.threads.map((thread) => thread.id)).toEqual(['b']);
  });

  it('restores an archived conversation without changing the current conversation', async () => {
    const { store, post, threads } = await setup();
    const archived = { ...threads[1]!, archivedAt: '2026-10-29T00:00:00Z', revision: 2 };
    post.mockResolvedValueOnce({ ...archived, archivedAt: null, revision: 3 });
    await store.restoreThread(archived);
    expect(post).toHaveBeenCalledWith('/me/assistant/threads/b/restore', { expectedRevision: 2 });
    expect(store.state.threads.filter((thread) => thread.id === 'b')).toEqual([
      { ...archived, archivedAt: null, revision: 3 },
    ]);
    expect(store.state.currentThreadId).toBe('a');
  });
});
