import type { Ref } from 'vue';
import type { Answer, AttemptItemView } from '@drill-hub/contracts';

export function useAttemptAnswerValues(answers: Ref<Record<string, Answer | null>>) {
  function optionSelected(item: AttemptItemView, optionId: string) {
    const answer = answers.value[item.id];
    return Boolean(answer && 'optionId' in answer && answer.optionId === optionId);
  }
  function multiSelected(item: AttemptItemView, optionId: string) {
    const answer = answers.value[item.id];
    return Boolean(answer && 'optionIds' in answer && answer.optionIds.includes(optionId));
  }
  function boolSelected(item: AttemptItemView, value: boolean) {
    const answer = answers.value[item.id];
    return Boolean(answer && 'value' in answer && answer.value === value);
  }
  function radioOptionValue(item: AttemptItemView) {
    const answer = answers.value[item.id];
    return answer && 'optionId' in answer ? answer.optionId : '';
  }
  function radioBooleanValue(item: AttemptItemView) {
    const answer = answers.value[item.id];
    return answer && 'value' in answer ? String(answer.value) : '';
  }
  function slotValue(item: AttemptItemView, slotId: string) {
    const answer = answers.value[item.id];
    return answer && 'slots' in answer ? (answer.slots[slotId] ?? '') : '';
  }
  function textValue(item: AttemptItemView) {
    const answer = answers.value[item.id];
    return answer && 'text' in answer ? answer.text : '';
  }
  return {
    optionSelected,
    multiSelected,
    boolSelected,
    radioOptionValue,
    radioBooleanValue,
    slotValue,
    textValue,
  };
}
