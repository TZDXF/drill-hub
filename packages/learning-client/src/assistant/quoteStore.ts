import { computed, reactive, toValue, type MaybeRefOrGetter } from 'vue';
import {
  appendSelectionQuote,
  type AssistantSelectionAppendResult,
  type AssistantSelectionQuote,
} from '#learning-client/assistant/selection';

const quotesByThread = reactive(new Map<string, AssistantSelectionQuote[]>());

export function deleteAssistantQuotes(scope: string): void {
  quotesByThread.delete(scope);
}

/** Pending quotes belong to their conversation and survive thread switches and panel remounts. */
export function useAssistantQuotes(scope: MaybeRefOrGetter<string>) {
  const quotes = computed<AssistantSelectionQuote[]>({
    get: () => quotesByThread.get(toValue(scope)) ?? [],
    set: (items) => {
      const key = toValue(scope);
      if (items.length) quotesByThread.set(key, items);
      else quotesByThread.delete(key);
    },
  });
  function add(quote: AssistantSelectionQuote): AssistantSelectionAppendResult {
    const result = appendSelectionQuote(quotes.value, quote);
    if (result.ok && !result.duplicate) quotes.value = [...quotes.value, quote];
    return result;
  }
  function update(id: string, comment: string): void {
    const trimmed = comment.trim();
    quotes.value = quotes.value.map((item) =>
      item.id === id
        ? { ...item, ...(trimmed ? { comment: trimmed } : { comment: undefined }) }
        : item,
    );
  }
  function remove(id: string): void {
    quotes.value = quotes.value.filter((item) => item.id !== id);
  }
  function clear(forScope = toValue(scope)): void {
    quotesByThread.delete(forScope);
  }
  function removeSent(forScope: string, sent: AssistantSelectionQuote[]): void {
    const current = quotesByThread.get(forScope);
    if (!current) return;
    const remaining = current.filter((item) => !sent.some((quote) => quote === item));
    if (remaining.length) quotesByThread.set(forScope, remaining);
    else quotesByThread.delete(forScope);
  }
  return { quotes, add, update, remove, clear, removeSent };
}
