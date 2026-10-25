<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useId } from 'vue';
import type { Answer, AttemptItemView } from '@drill-hub/contracts';
import {
  answerStatusLabels,
  draftAnswerStatus,
  gradingStatusLabels,
} from '#learning-client/attemptPresentation';

const { t } = useI18n();

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
  if (item.answerStatus === 'unanswered') return t('learning.attempt.statUnanswered');
  const result = reviewResult(item);
  if (result === 'correct') return t('components.questionNav.reviewCorrect');
  if (result === 'wrong') return t('components.questionNav.reviewWrong');
  return gradingStatusLabels[item.gradingStatus];
}
</script>

<template>
  <nav
    class="paper-panel question-nav"
    :aria-label="t('components.questionNav.navLabel')"
    :aria-describedby="descriptionId"
  >
    <h2 class="question-nav-title">{{ t('components.questionNav.title') }}</h2>
    <p :id="descriptionId" class="question-nav-description">
      {{
        mode === 'review'
          ? t('components.questionNav.descriptionReview')
          : marksEnabled
            ? t('components.questionNav.descriptionMarked')
            : t('components.questionNav.descriptionPlain')
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
      {{ t('components.questionNav.overview') }}
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
            ? t('components.questionNav.ariaAnswer', {
                index: index + 1,
                status: reviewLabel(item),
              })
            : t(
                item.lockedAt
                  ? marksEnabled && markedIds.includes(item.id)
                    ? 'components.questionNav.ariaAnswerLockedMarked'
                    : 'components.questionNav.ariaAnswerLocked'
                  : marksEnabled && markedIds.includes(item.id)
                    ? 'components.questionNav.ariaAnswerMarked'
                    : 'components.questionNav.ariaAnswer',
                {
                  index: index + 1,
                  status: answerStatusLabels[draftAnswerStatus(item, answers[item.id])],
                },
              )
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
