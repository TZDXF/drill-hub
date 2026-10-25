import { computed } from 'vue';
import type { AssistantHistoryItem } from '#learning-client/assistant/turns';
import type { AssistantState } from '#learning-client/assistant/store';
import { buildHistory } from '#learning-client/assistant/turns';

/** Cache settled turns independently of deltas; only the live tail is rebuilt per chunk. */
export function useAssistantHistory(state: AssistantState) {
  const settled = computed(() => {
    const active = state.turns.find((turn) => turn.id === state.activeTurnId);
    const excluded = new Set(active ? [active.userMessageId, active.assistantMessageId] : []);
    return buildHistory({
      messages: state.messages.filter(
        (message) =>
          !excluded.has(message.id) &&
          (state.activeTurnId ? !message.id.startsWith('local-') : true),
      ),
      turns: state.turns.filter((turn) => turn.id !== state.activeTurnId),
      events: state.events,
      activeTurnId: null,
      streamingText: '',
    });
  });
  const history = computed<AssistantHistoryItem[]>(() => {
    if (!state.activeTurnId) return settled.value;
    const active = state.turns.find((turn) => turn.id === state.activeTurnId);
    const activeIds = new Set(active ? [active.userMessageId, active.assistantMessageId] : []);
    const activeItems = buildHistory({
      messages: state.messages.filter(
        (message) => activeIds.has(message.id) || message.id.startsWith('local-'),
      ),
      turns: active ? [active] : [],
      events: state.events,
      activeTurnId: state.activeTurnId,
      streamingText: state.streamingText,
    });
    return [...settled.value, ...activeItems];
  });
  return { history };
}
