import type { Attempt, AttemptItemView, QuestionDefinition, Answer } from '@drill-hub/contracts';
import { isBlankAnswer } from '#server/modules/grading/engine.js';
import { assert, type JsonObject } from '#server/modules/learning/common.js';

/** The only eligibility rule for personal learning projections, regardless of entry point. */
export function isLearningAttempt(attempt: Attempt): boolean {
  return attempt.purpose === 'learning' && attempt.voidedAt === null;
}

export function attemptPurpose(input: JsonObject): Attempt['purpose'] {
  const purpose = input.purpose === undefined ? 'learning' : input.purpose;
  assert(purpose === 'learning' || purpose === 'test', 'INVALID_PURPOSE', '作答用途无效');
  return purpose;
}

export function answerStatus(
  definition: QuestionDefinition,
  answer: Answer | null,
): AttemptItemView['answerStatus'] {
  if (isBlankAnswer(definition, answer)) return 'unanswered';
  if (definition.type === 'fill_blank' && answer && 'slots' in answer) {
    if (definition.slots?.some((slot) => !answer.slots[slot.id]?.trim())) return 'partial';
  }
  return 'answered';
}

export function qualifiesForTaskCompletion(attempt: Attempt): boolean {
  return (
    isLearningAttempt(attempt) &&
    attempt.submittedAt !== null &&
    (attempt.kind === 'exam' ||
      attempt.items.some((item) => !isBlankAnswer(item.definition, item.answer)))
  );
}
