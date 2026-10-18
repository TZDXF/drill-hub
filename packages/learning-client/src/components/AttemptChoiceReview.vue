<script setup lang="ts">
import { computed } from 'vue';
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui';
import type { AttemptItemView } from '@drill-hub/contracts';
import { formatOptionLabel } from '../utils';
import AppCheckbox from './AppCheckbox.vue';

const props = defineProps<{ item: AttemptItemView }>();

const trueFalseOptions = [
  { id: 'true', text: '正确' },
  { id: 'false', text: '错误' },
];
const singleChoiceOptions = computed(() => {
  if (props.item.type === 'single_choice') return props.item.options ?? [];
  if (props.item.type === 'true_false') return trueFalseOptions;
  return [];
});
const selectedOptionIds = computed(() => {
  const answer = props.item.answer;
  if (answer && 'optionId' in answer) return new Set([answer.optionId]);
  if (answer && 'optionIds' in answer) return new Set(answer.optionIds);
  if (answer && 'value' in answer) return new Set([String(answer.value)]);
  return new Set<string>();
});
const singleValue = computed(() => {
  const answer = props.item.answer;
  if (answer && 'optionId' in answer) return answer.optionId;
  if (answer && 'value' in answer) return String(answer.value);
  return '';
});
const correctOptionIds = computed(() => {
  const gradingKey = props.item.gradingKey;
  if (gradingKey?.optionId) return new Set([gradingKey.optionId]);
  if (gradingKey?.optionIds) return new Set(gradingKey.optionIds);
  if (typeof gradingKey?.value === 'boolean') return new Set([String(gradingKey.value)]);
  return new Set<string>();
});

function isSelected(optionId: string) {
  return selectedOptionIds.value.has(optionId);
}
function optionClasses(optionId: string) {
  const correct = correctOptionIds.value.has(optionId);
  return {
    selected: isSelected(optionId),
    correct,
    wrong: isSelected(optionId) && !correct && correctOptionIds.value.size > 0,
    missed: props.item.type === 'multiple_choice' && correct && !isSelected(optionId),
  };
}
</script>

<template>
  <RadioGroupRoot
    v-if="
      (item.type === 'single_choice' || item.type === 'true_false') && singleChoiceOptions.length
    "
    class="answer-options review-choices"
    :model-value="singleValue"
    disabled
    :aria-label="item.type === 'true_false' ? '判断题选项' : '单选题选项'"
  >
    <label
      v-for="(option, index) in singleChoiceOptions"
      :key="option.id"
      :for="`review-choice-${item.id}-${option.id}`"
      class="answer-option"
      :class="optionClasses(option.id)"
    >
      <RadioGroupItem
        :id="`review-choice-${item.id}-${option.id}`"
        :value="option.id"
        class="choice-box choice-box--radio"
      >
        <RadioGroupIndicator><span class="choice-radio-dot" /></RadioGroupIndicator>
      </RadioGroupItem>
      <span class="answer-option__text">{{
        item.type === 'single_choice' ? formatOptionLabel(index, option.text) : option.text
      }}</span>
    </label>
  </RadioGroupRoot>
  <div
    v-else-if="item.type === 'multiple_choice' && item.options?.length"
    class="answer-options review-choices"
    role="group"
    aria-label="多选题选项"
  >
    <AppCheckbox
      v-for="(option, index) in item.options"
      :id="`review-choice-${item.id}-${option.id}`"
      :key="option.id"
      class="answer-option"
      :class="optionClasses(option.id)"
      :model-value="isSelected(option.id)"
      disabled
    >
      <span class="answer-option__text">{{ formatOptionLabel(index, option.text) }}</span>
      <span
        v-if="isSelected(option.id) && !correctOptionIds.has(option.id) && correctOptionIds.size"
        class="answer-option__status"
        >错选</span
      >
      <span
        v-else-if="correctOptionIds.has(option.id) && !isSelected(option.id)"
        class="answer-option__status"
        >漏选</span
      >
    </AppCheckbox>
  </div>
</template>
