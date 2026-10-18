import type { Answer, AttemptItemView, AttemptView } from '@drill-hub/contracts';
import { isAnswerEmpty } from './types';

export const attemptPurposeOptions: { value: AttemptView['purpose']; label: string }[] = [
  { value: 'learning', label: '正式作答' },
  { value: 'test', label: '测试作答' },
];

export const answerStatusLabels: Record<AttemptItemView['answerStatus'], string> = {
  unanswered: '未作答',
  partial: '部分作答',
  answered: '已作答',
};

export const gradingStatusLabels: Record<AttemptItemView['gradingStatus'], string> = {
  not_started: '尚未评分',
  pending: '待评分',
  running: '正在评分',
  failed: '评分失败',
  completed: '已评分',
};

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
