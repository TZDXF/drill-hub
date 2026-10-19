import type { Answer, AttemptItemView, AttemptView } from '@drill-hub/contracts';
import { isAnswerEmpty } from './types';
import { localizedRecord, translate } from './utils';

export interface AttemptPurposeOption {
  value: AttemptView['purpose'];
  label: string;
}

const attemptPurposeLabelKeys: Record<AttemptView['purpose'], string> = {
  learning: 'core.attempt.purpose.learning',
  test: 'core.attempt.purpose.test',
};

/** 用途选项的 label 每次读取都按当前语言解析，切换语言后即时生效。 */
export const attemptPurposeOptions: AttemptPurposeOption[] = [
  {
    value: 'learning',
    get label() {
      return translate(attemptPurposeLabelKeys.learning);
    },
  },
  {
    value: 'test',
    get label() {
      return translate(attemptPurposeLabelKeys.test);
    },
  },
];

export const answerStatusLabels: Record<AttemptItemView['answerStatus'], string> = localizedRecord<
  AttemptItemView['answerStatus']
>({
  unanswered: 'core.attempt.answerStatus.unanswered',
  partial: 'core.attempt.answerStatus.partial',
  answered: 'core.attempt.answerStatus.answered',
});

export const gradingStatusLabels: Record<AttemptItemView['gradingStatus'], string> =
  localizedRecord<AttemptItemView['gradingStatus']>({
    not_started: 'core.attempt.gradingStatus.not_started',
    pending: 'core.attempt.gradingStatus.pending',
    running: 'core.attempt.gradingStatus.running',
    failed: 'core.attempt.gradingStatus.failed',
    completed: 'core.attempt.gradingStatus.completed',
  });

export function draftAnswerStatus(
  item: AttemptItemView,
  answer: Answer | null | undefined,
): AttemptItemView['answerStatus'] {
  if (isAnswerEmpty(answer)) return 'unanswered';
  if (item.type === 'fill_blank' && answer && 'slots' in answer) {
    return item.slots?.every((slot) => answer.slots[slot.id]?.trim()) ? 'answered' : 'partial';
  }
  return 'answered';
}

export function canContinueAttempt(attempt: AttemptView): boolean {
  return !attempt.voidedAt && attempt.status === 'in_progress' && attempt.source === 'personal';
}
