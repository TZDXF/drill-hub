import { describe, expect, it } from 'vitest';
import { isNearBottom, pinToBottom } from '#learning-client/assistant/scroll';
import { buildPromptWithQuotes, parsePromptQuotes } from '#learning-client/assistant/selection';

describe('assistant conversation primitives', () => {
  it('pins growth synchronously only while following', () => {
    const viewport = { scrollTop: 900, scrollHeight: 1000, clientHeight: 100 };
    expect(pinToBottom(viewport, true)).toBe(false);
    viewport.scrollHeight = 1400;
    expect(pinToBottom(viewport, true)).toBe(true);
    expect(viewport.scrollTop).toBe(1300);
    viewport.scrollTop = 300;
    viewport.scrollHeight = 1600;
    expect(pinToBottom(viewport, false)).toBe(false);
    expect(viewport.scrollTop).toBe(300);
    expect(isNearBottom({ scrollTop: 1300, scrollHeight: 1400, clientHeight: 100 })).toBe(true);
  });
  it('round-trips quote chips without exposing editor metadata', () => {
    const prompt = buildPromptWithQuotes('解释一下', [
      {
        id: 'local',
        text: '贝叶斯定理',
        comment: '举例',
        anchor: { messageId: 'message-local', start: 2, end: 7 },
      },
    ]);
    expect(prompt).toContain('```userselect');
    expect(prompt).not.toContain('local');
    expect(prompt).not.toContain('message-local');
    expect(prompt).not.toContain('start');
    expect(parsePromptQuotes(prompt)).toEqual({
      visibleContent: '解释一下',
      quotes: [{ id: 'quote-0', text: '贝叶斯定理', comment: '举例' }],
    });
  });
});
