import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { isNearBottom, pinToBottom } from '#learning-client/assistant/scroll';
import {
  appendSelectionQuote,
  buildPromptWithQuotes,
  parsePromptQuotes,
  type AssistantSelectionQuote,
} from '#learning-client/assistant/selection';
import { useAssistantQuotes } from '#learning-client/assistant/quoteStore';

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
  it('enforces Pi-X selection limits and duplicate semantics', () => {
    const quote = (id: string, text: string, comment?: string): AssistantSelectionQuote => ({
      id,
      text,
      ...(comment ? { comment } : {}),
    });
    expect(appendSelectionQuote([], quote('long', 'x'.repeat(8001)))).toEqual({
      ok: false,
      reason: 'single',
    });
    const eight = Array.from({ length: 8 }, (_, index) => quote(`${index}`, `quote-${index}`));
    expect(appendSelectionQuote(eight, quote('ninth', 'ninth'))).toEqual({
      ok: false,
      reason: 'count',
    });
    expect(
      appendSelectionQuote(
        [quote('a', 'x'.repeat(8000)), quote('b', 'y'.repeat(8000))],
        quote('c', 'z'),
      ),
    ).toEqual({ ok: false, reason: 'total' });
    expect(
      appendSelectionQuote([quote('a', 'same', 'comment')], quote('b', 'same', 'comment')),
    ).toEqual({ ok: true, duplicate: true });
    expect(appendSelectionQuote([quote('a', 'same', 'one')], quote('b', 'same', 'two'))).toEqual({
      ok: true,
      duplicate: false,
    });
  });

  it('keeps pending quotes isolated by thread and restores them after switching', () => {
    const scope = ref('scope-test-a');
    const store = useAssistantQuotes(scope);
    store.clear('scope-test-a');
    store.clear('scope-test-b');
    expect(store.add({ id: 'a', text: 'A 的引用' })).toEqual({ ok: true, duplicate: false });
    store.update('a', 'A 的批注');
    scope.value = 'scope-test-b';
    expect(store.quotes.value).toEqual([]);
    store.add({ id: 'b', text: 'B 的引用' });
    scope.value = 'scope-test-a';
    expect(store.quotes.value).toEqual([{ id: 'a', text: 'A 的引用', comment: 'A 的批注' }]);
    store.remove('a');
    expect(store.quotes.value).toEqual([]);
    scope.value = 'scope-test-b';
    store.clear();
  });
});
