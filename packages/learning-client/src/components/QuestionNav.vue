<script setup lang="ts">
import { useId } from 'vue';
import type { Answer, AttemptItemView } from '@drill-hub/contracts';
import { answerStatusLabels, draftAnswerStatus, gradingStatusLabels } from '../attemptPresentation';

const props = withDefaults(
  defineProps<{
    items: AttemptItemView[];
    answers: Record<string, Answer | null>;
    currentIndex: number;
    markedIds?: string[];
    marksEnabled?: boolean;
    disabled?: boolean;
    mode?: 'answer' | 'review';
  }>(),
  { markedIds: () => [], marksEnabled: false, disabled: false, mode: 'answer' },
);
const descriptionId = useId();
const emit = defineEmits<{ select: [index: number] }>();

function reviewResult(item: AttemptItemView): 'correct' | 'wrong' | '' {
  if (item.answerStatus === 'unanswered') return '';
  if (item.gradingStatus === 'completed' && item.grade) {
    return Number(item.grade.score) >= Number(item.grade.maxScore) ? 'correct' : 'wrong';
  }
  return '';
}
function reviewLabel(item: AttemptItemView): string {
  if (item.answerStatus === 'unanswered') return '未作答';
  const result = reviewResult(item);
  if (result === 'correct') return '回答正确';
  if (result === 'wrong') return '回答错误';
  return gradingStatusLabels[item.gradingStatus];
}
</script>

<template>
  <nav class="paper-panel question-nav" aria-label="题号导航" :aria-describedby="descriptionId">
    <h2 class="question-nav-title">题号</h2>
    <p :id="descriptionId" class="question-nav-description">
      {{
        mode === 'review'
          ? '绿色表示回答正确，红色表示回答错误，未作答及尚未出分的题目保持中性色。'
          : marksEnabled
            ? '绿色表示已作答，浅黄色表示部分作答，琥珀色边框表示当前题，✓ 表示已锁定，右上角三角表示已标记。'
            : '绿色表示已作答，浅黄色表示部分作答，琥珀色边框表示当前题，✓ 表示已锁定。'
      }}
    </p>
    <button
      v-if="mode === 'review'"
      class="button question-nav-overview"
      type="button"
      :aria-current="currentIndex < 0 ? 'step' : undefined"
      :disabled="disabled"
      @click="emit('select', -1)"
    >
      评分总览
    </button>
    <div class="question-nav-grid">
      <button
        v-for="(item, index) in items"
        :key="item.id"
        class="question-nav-button"
        :class="
          mode === 'review'
            ? [reviewResult(item), { current: index === currentIndex }]
            : {
                answered: draftAnswerStatus(item, answers[item.id]) === 'answered',
                partial: draftAnswerStatus(item, answers[item.id]) === 'partial',
                current: index === currentIndex,
                locked: item.lockedAt,
                marked: marksEnabled && markedIds.includes(item.id),
              }
        "
        type="button"
        :disabled="disabled"
        :aria-current="index === currentIndex ? 'step' : undefined"
        :aria-label="
          mode === 'review'
            ? `第 ${index + 1} 题，${reviewLabel(item)}`
            : `第 ${index + 1} 题，${answerStatusLabels[draftAnswerStatus(item, answers[item.id])]}${item.lockedAt ? '，已锁定' : ''}${marksEnabled && markedIds.includes(item.id) ? '，已标记' : ''}`
        "
        @click="emit('select', index)"
      >
        {{ index + 1 }}
        <span
          v-if="mode !== 'review' && marksEnabled && markedIds.includes(item.id)"
          class="question-nav-mark"
          aria-hidden="true"
        />
      </button>
    </div>
  </nav>
</template>
