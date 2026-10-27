import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { deleteAssistantQuotes, useAssistantQuotes } from '#learning-client/assistant/quoteStore';

describe('assistant quote scopes', () => {
  it('removes only submitted unchanged quotes from their original thread', () => {
    const scope = ref('quote-test-a');
    const store = useAssistantQuotes(scope);
    store.add({ id: 'one', text: 'one' });
    store.add({ id: 'two', text: 'two' });
    const submitted = [...store.quotes.value];
    store.update('two', 'edited during send');
    scope.value = 'quote-test-b';
    store.add({ id: 'other', text: 'other' });
    store.removeSent('quote-test-a', submitted);
    expect(store.quotes.value.map((item) => item.id)).toEqual(['other']);
    scope.value = 'quote-test-a';
    expect(store.quotes.value).toEqual([{ id: 'two', text: 'two', comment: 'edited during send' }]);
    deleteAssistantQuotes('quote-test-a');
    expect(store.quotes.value).toEqual([]);
    deleteAssistantQuotes('quote-test-b');
  });
});
