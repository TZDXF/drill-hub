import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';
import type { LearningContext } from '#learning-client/context';
import { parseAssistantPanelPreferences } from '#learning-client/assistant/preferences';
import { clampFloatingRect } from '#learning-client/assistant/floating';

beforeEach(() => vi.resetModules());

describe('assistant panel preferences', () => {
  it.each([null, '', '{', 'null', '[]', 'true', '42'])(
    'uses defaults when stored preferences are missing or malformed: %s',
    (raw) => {
      expect(parseAssistantPanelPreferences(raw)).toEqual({
        position: 'left',
        chatWidth: 400,
        floatingRect: null,
      });
    },
  );

  it('validates fields independently and limits the dock width', () => {
    expect(
      parseAssistantPanelPreferences(
        '{"position":"right","chatWidth":999,"floatingRect":{"x":0,"y":0,"width":-1,"height":400}}',
      ),
    ).toEqual({ position: 'right', chatWidth: 560, floatingRect: null });
    expect(parseAssistantPanelPreferences('{"position":"invalid","chatWidth":1}')).toMatchObject({
      position: 'left',
      chatWidth: 320,
    });
    expect(
      parseAssistantPanelPreferences(
        '{"chatWidth":1e999,"floatingRect":{"x":1e999,"y":0,"width":400,"height":400}}',
      ),
    ).toMatchObject({ chatWidth: 400, floatingRect: null });
  });

  it('restores panel placement after a fresh store and keeps conversation data out of storage', async () => {
    let saved: string | null = null;
    const platform = {
      getAssistantPanelPreferences: () => saved,
      setAssistantPanelPreferences: (value: string) => {
        saved = value;
      },
    };
    const context = { platform } as unknown as LearningContext;
    let module = await import('#learning-client/assistant/store');
    module.initAssistantStore(context, {} as Router);
    const store = module.useAssistant();
    store.state.currentThreadId = 'private-thread';
    store.state.streamingText = 'private answer';
    store.setPosition('right');
    store.setChatWidth(470);
    const rect = { x: 500, y: 150, width: 440, height: 500 };
    store.setFloatingRect(rect);
    store.setPosition('floating');
    expect(JSON.parse(saved!)).toEqual({
      position: 'floating',
      chatWidth: 470,
      floatingRect: rect,
    });

    vi.resetModules();
    module = await import('#learning-client/assistant/store');
    module.initAssistantStore(context, {} as Router);
    expect(module.useAssistant().state).toMatchObject({
      position: 'floating',
      chatWidth: 470,
      floatingRect: rect,
      open: false,
      currentThreadId: null,
      streamingText: '',
    });
    expect(clampFloatingRect(module.useAssistant().state.floatingRect!, 800, 600)).toEqual({
      x: 352,
      y: 92,
      width: 440,
      height: 500,
    });
  });
});
