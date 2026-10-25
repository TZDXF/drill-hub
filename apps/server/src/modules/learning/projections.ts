import type {
  Attempt,
  AttemptItemSnapshot,
  AttemptItemView,
  AttemptReport,
  AttemptView,
} from '@drill-hub/contracts';
import { answerStatus } from '#server/modules/learning/attempt-policy.js';
import { assert } from '#server/core/errors.js';
import { scoreToMinor, minorToScore } from '#server/modules/learning/scores.js';

function itemIsReleased(attempt: Attempt, item: AttemptItemSnapshot): boolean {
  return attempt.kind === 'exam' ? attempt.submittedAt !== null : item.lockedAt !== null;
}

export function toAttemptItemView(attempt: Attempt, item: AttemptItemSnapshot): AttemptItemView {
  const released = itemIsReleased(attempt, item);
  const view: AttemptItemView = {
    id: item.id,
    questionId: item.questionId,
    type: item.definition.type,
    stem: item.definition.stem,
    maxScore: item.maxScore,
    answer: item.answer,
    answerRevision: item.answerRevision,
    lockedAt: item.lockedAt,
    answerStatus: answerStatus(item.definition, item.answer),
    gradingStatus: item.gradingStatus,
    grade:
      released && item.grade
        ? {
            ...item.grade,
            criterionResults: item.grade.criterionResults.map((result) => {
              const criterion = item.definition.rubric?.criteria.find(
                (entry) => entry.id === result.criterionId,
              );
              const level = criterion?.levels.find((entry) => entry.id === result.levelId);
              assert(
                criterion && level,
                'INVALID_GRADE_REFERENCE',
                '评分结果与题目评分标准不一致',
                500,
              );
              return {
                ...result,
                criterionDescription: criterion.description,
                levelDescription: level.description,
              };
            }),
          }
        : null,
  };
  if (item.definition.options) view.options = item.definition.options;
  if (item.definition.slots) view.slots = item.definition.slots;
  if (released) {
    if (item.definition.explanation !== undefined) view.explanation = item.definition.explanation;
    if (item.definition.gradingKey !== undefined) view.gradingKey = item.definition.gradingKey;
    if (item.definition.referenceAnswer !== undefined)
      view.referenceAnswer = item.definition.referenceAnswer;
  }
  return view;
}

/** Never expose AttemptItemSnapshot directly to a learner. */
export function toAttemptView(attempt: Attempt): AttemptView {
  return {
    id: attempt.id,
    topicId: attempt.topicId,
    assessmentId: attempt.assessmentId,
    source: attempt.answerLinkId === null ? 'personal' : 'answer_link',
    purpose: attempt.purpose,
    taskId: attempt.taskId,
    voidedAt: attempt.voidedAt,
    voidedBy: attempt.voidedBy,
    voidReason: attempt.voidReason,
    title: attempt.title,
    kind: attempt.kind,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    submissionReason: attempt.submissionReason,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
    revision: attempt.revision,
    items: attempt.items.map((item) => toAttemptItemView(attempt, item)),
  };
}

export function toAttemptReport(attempt: Attempt): AttemptReport {
  let awarded = 0;
  let maximum = 0;
  let pending = 0;
  let failedCount = 0;
  let hasActiveRegrading = false;
  for (const item of attempt.items) {
    const itemMaximum = scoreToMinor(item.maxScore, 'maxScore');
    maximum += itemMaximum;
    if (item.grade) awarded += scoreToMinor(item.grade.score, 'score');
    else pending += itemMaximum;
    if (item.gradingStatus === 'failed') failedCount += 1;
    if (item.grade && (item.gradingStatus === 'pending' || item.gradingStatus === 'running')) {
      hasActiveRegrading = true;
    }
  }
  return {
    attempt: toAttemptView(attempt),
    awardedScore: minorToScore(awarded),
    maxScore: minorToScore(maximum),
    pendingMaxScore: minorToScore(pending),
    isFinal: attempt.items.every((item) => item.grade !== null),
    failedCount,
    hasActiveRegrading,
    unansweredCount: attempt.items.filter(
      (item) => answerStatus(item.definition, item.answer) === 'unanswered',
    ).length,
  };
}
