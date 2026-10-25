import type { Attempt, LearningTask, WrongQuestion } from '@drill-hub/contracts';
import { baseRecord, now } from '#server/core/ids.js';
import type { AppContext } from '#server/core/context.js';
import type { Database } from '#server/db/database.js';
import { scoreToMinor } from '#server/modules/learning/scores.js';
import {
  answerStatus,
  isLearningAttempt,
  qualifiesForTaskCompletion,
} from '#server/modules/learning/attempt-policy.js';

/**
 * Derive only the aggregate attempt status. This function has no I/O and does not
 * mutate the supplied object. A valid previous grade keeps an attempt completed
 * while a regrade is pending or running.
 */
export function updateAttemptStatus(attempt: Attempt): Attempt {
  let status: Attempt['status'];
  if (attempt.submittedAt === null) {
    status = 'in_progress';
  } else {
    status = attempt.items.every((item) => item.grade !== null) ? 'completed' : 'pending_grading';
  }
  return { ...attempt, status };
}

interface PracticeFact {
  attempt: Attempt;
  item: Attempt['items'][number];
}

function byNewestLockedAt(left: PracticeFact, right: PracticeFact): number {
  return (right.item.lockedAt ?? '').localeCompare(left.item.lockedAt ?? '');
}

/**
 * Rebuild the wrong-question projections touched by an attempt.
 *
 * The supplied attempt replaces its persisted version in the calculation, so it
 * may contain unsaved item grades. Regrades therefore cannot increment counts
 * repeatedly, correct re-practice does not erase earlier mistakes, and correcting
 * the only mistaken attempt removes the projection while preserving the attempt.
 */
export async function syncWrongQuestions(db: Database, attempt: Attempt): Promise<void> {
  const persisted = await db.list('attempts', { ownerId: attempt.ownerId });
  const attempts = [
    ...persisted.filter((candidate) => candidate.id !== attempt.id && isLearningAttempt(candidate)),
    ...(isLearningAttempt(attempt) ? [attempt] : []),
  ];
  const questionIds = [...new Set(attempt.items.map((item) => item.questionId))];

  for (const questionId of questionIds) {
    const facts: PracticeFact[] = [];
    for (const candidate of attempts) {
      for (const item of candidate.items) {
        if (
          item.questionId === questionId &&
          item.lockedAt !== null &&
          item.grade !== null &&
          answerStatus(item.definition, item.answer) !== 'unanswered'
        ) {
          facts.push({ attempt: candidate, item });
        }
      }
    }
    facts.sort(byNewestLockedAt);
    const existing = await db.findOne('wrongQuestions', { ownerId: attempt.ownerId, questionId });
    const wrongFacts = facts.filter(({ item }) => {
      const grade = item.grade;
      return grade !== null && scoreToMinor(grade.score) < scoreToMinor(grade.maxScore);
    });

    if (wrongFacts.length === 0) {
      if (existing) await db.delete('wrongQuestions', existing.id);
      continue;
    }

    const latestWrong = wrongFacts[0];
    const latestPractice = facts[0];
    const lastWrongAt = latestWrong.item.lockedAt as string;
    const lastPracticedAt = latestPractice.item.lockedAt as string;
    const values = {
      ownerId: attempt.ownerId,
      topicId: latestWrong.attempt.topicId,
      questionId,
      lastWrongAt,
      lastPracticedAt,
      wrongCount: wrongFacts.length,
    } satisfies Omit<
      WrongQuestion,
      keyof import('@drill-hub/contracts').BaseRecord | 'masteryStatus'
    >;

    if (!existing) {
      await db.insert('wrongQuestions', {
        ...baseRecord(),
        ...values,
        masteryStatus: 'pending',
      });
      continue;
    }

    const hasNewWrongFact =
      lastWrongAt > existing.lastWrongAt || values.wrongCount > existing.wrongCount;
    const masteryStatus = hasNewWrongFact ? 'pending' : existing.masteryStatus;
    if (
      existing.topicId !== values.topicId ||
      existing.lastWrongAt !== values.lastWrongAt ||
      existing.lastPracticedAt !== values.lastPracticedAt ||
      existing.wrongCount !== values.wrongCount ||
      existing.masteryStatus !== masteryStatus
    ) {
      await db.update('wrongQuestions', existing.id, existing.revision, {
        ...values,
        masteryStatus,
      });
    }
  }
}

/**
 * Persist mutated item/answer/grade state and refresh all derived learning state.
 * Grading workers should call this with their transaction-scoped Database.
 */
export async function refreshAttempt(tx: Database, attempt: Attempt): Promise<Attempt> {
  const current = await tx.get('attempts', attempt.id);
  if (current && current.voidedAt !== null) return current;
  const next = updateAttemptStatus(attempt);
  await syncWrongQuestions(tx, next);
  return tx.update('attempts', next.id, next.revision, {
    items: next.items,
    status: next.status,
    submittedAt: next.submittedAt,
    submissionReason: next.submissionReason,
  });
}

/** Rebuild only the persisted task association, using valid learning attempts as evidence. */
export async function syncLinkedTask(db: Database, attempt: Attempt): Promise<void> {
  if (attempt.purpose === 'test' || !attempt.taskId || !attempt.assessmentId) return;
  const attempts = (await db.list('attempts', { ownerId: attempt.ownerId })).filter(
    (candidate) => candidate.id !== attempt.id,
  );
  attempts.push(attempt);
  const linked = attempts.filter(
    (candidate) =>
      candidate.taskId === attempt.taskId &&
      candidate.assessmentId === attempt.assessmentId &&
      candidate.kind === attempt.kind &&
      isLearningAttempt(candidate),
  );
  const completed = linked
    .filter(qualifiesForTaskCompletion)
    .sort((a, b) => (a.submittedAt as string).localeCompare(b.submittedAt as string));
  const status: LearningTask['status'] =
    completed.length > 0 ? 'completed' : linked.length > 0 ? 'in_progress' : 'todo';
  const completedAt = completed[0]?.submittedAt ?? null;
  const plans = await db.list('plans', { ownerId: attempt.ownerId });
  for (const plan of plans) {
    let changed = false;
    const phases = plan.phases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map((task) => {
        if (
          task.id !== attempt.taskId ||
          task.targetId !== attempt.assessmentId ||
          task.kind !== attempt.kind
        )
          return task;
        if (task.status === status && task.completedAt === completedAt) return task;
        changed = true;
        return { ...task, status, completedAt };
      }),
    }));
    if (changed) await db.update('plans', plan.id, plan.revision, { phases });
  }
}

/**
 * Freeze and grade an attempt exactly once. Used by both explicit submission and
 * the expiry sweeper; callers must pass the transaction-scoped attempt and db.
 */
export async function settleAttempt(
  tx: Database,
  ctx: AppContext,
  attempt: Attempt,
  reason: 'user_submitted' | 'time_expired',
  timestamp = now(),
): Promise<Attempt> {
  if (attempt.voidedAt !== null || attempt.submittedAt !== null) return attempt;
  attempt.submittedAt = timestamp;
  attempt.submissionReason = reason;
  for (const item of attempt.items) {
    if (item.lockedAt !== null) continue;
    item.lockedAt = timestamp;
    await ctx.grading.gradeLockedItem(tx, attempt, item);
  }
  await syncLinkedTask(tx, attempt);
  return refreshAttempt(tx, attempt);
}

/** Settle all expired in-progress attempts, including after a service restart. */
export async function expireAttempts(ctx: AppContext): Promise<void> {
  const candidates = await ctx.db.list('attempts', { status: 'in_progress' });
  const currentTime = Date.now();
  for (const candidate of candidates) {
    if (
      candidate.voidedAt !== null ||
      candidate.expiresAt === null ||
      Date.parse(candidate.expiresAt) > currentTime
    )
      continue;
    await ctx.db.transaction(async (tx) => {
      const current = await tx.get('attempts', candidate.id);
      if (
        !current ||
        current.voidedAt !== null ||
        current.status !== 'in_progress' ||
        current.submittedAt !== null ||
        current.expiresAt === null ||
        Date.parse(current.expiresAt) > Date.now()
      )
        return;
      await settleAttempt(tx, ctx, current, 'time_expired');
    });
  }
}
