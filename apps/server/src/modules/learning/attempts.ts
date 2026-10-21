import type { Actor, AppContext } from '../../core/context.js';
import type { Answer, Assessment, Attempt, AttemptItemSnapshot } from '@drill-hub/contracts';
import { AppError } from '../../core/errors.js';
import { baseRecord, id, now } from '../../core/ids.js';
import type { AnswerLinkRecord } from '../../db/records.js';
import { validateAnswer } from '../grading/engine.js';
import {
  assert,
  checkRevision,
  expectedRevision,
  clone,
  expired,
  isRecord,
  owned,
  ownedTopic,
  rejectClientFacts,
  requiredString,
  type JsonObject,
} from './common.js';
import { refreshAttempt, settleAttempt, syncLinkedTask, syncWrongQuestions } from './helpers.js';
import { attemptPurpose } from './attempt-policy.js';
import { findTaskLocation } from './plans.js';
import { validateScoringConfiguration } from './question-utils.js';

function snapshot(
  questionId: string,
  questionVersion: number,
  definition: AttemptItemSnapshot['definition'],
  maxScore: string,
): AttemptItemSnapshot {
  return {
    id: id(),
    questionId,
    questionVersion,
    definition: clone(definition),
    maxScore,
    answer: null,
    answerRevision: 0,
    lockedAt: null,
    gradingStatus: 'not_started',
    generation: 0,
    grade: null,
    gradingHistory: [],
  };
}

async function assessmentSnapshots(
  assessment: Assessment,
  ownerId: string,
  tx: AppContext['db'],
): Promise<AttemptItemSnapshot[]> {
  const items: AttemptItemSnapshot[] = [];
  for (const assessmentItem of assessment.items) {
    const version = await tx.findOne('questionVersions', {
      ownerId,
      questionId: assessmentItem.questionId,
      version: assessmentItem.questionVersion,
    });
    assert(version, 'ASSESSMENT_SNAPSHOT_INVALID', '试卷引用的题目版本不存在', 409);
    items.push(
      snapshot(
        assessmentItem.questionId,
        version.version,
        version.definition,
        assessmentItem.maxScore,
      ),
    );
  }
  return items;
}

function newAttempt(
  ownerId: string,
  topicId: string,
  assessmentId: string | null,
  answerLinkId: string | null,
  title: string,
  kind: Attempt['kind'],
  durationSeconds: number | null,
  items: AttemptItemSnapshot[],
  purpose: Attempt['purpose'],
  taskId: string | null,
): Attempt {
  const startedAt = now();
  return {
    ...baseRecord(),
    ownerId,
    topicId,
    assessmentId,
    answerLinkId,
    purpose,
    taskId,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    title,
    kind,
    status: 'in_progress',
    startedAt,
    expiresAt:
      durationSeconds === null
        ? null
        : new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString(),
    submittedAt: null,
    submissionReason: null,
    items,
  };
}

export async function startAssessment(
  ctx: AppContext,
  actor: Actor,
  assessmentId: string,
  input: JsonObject,
): Promise<{ attempt: Attempt; created: boolean }> {
  rejectClientFacts(input);
  const purpose = attemptPurpose(input);
  const taskId = input.taskId;
  assert(
    taskId === undefined || (typeof taskId === 'string' && taskId.length > 0),
    'INVALID_TASK',
    'taskId 无效',
  );
  return ctx.db.transaction(async (tx) => {
    const assessment = await owned(tx, 'assessments', assessmentId, actor.userId);
    const existing = (
      await tx.list('attempts', {
        ownerId: actor.userId,
        assessmentId,
        status: 'in_progress',
      })
    ).filter(
      (attempt) =>
        attempt.answerLinkId === null && attempt.voidedAt === null && attempt.purpose === purpose,
    );
    const reusable = existing.find((attempt) => attempt.answerLinkId === null && !expired(attempt));

    const resolvedTaskId =
      taskId === undefined && reusable?.taskId
        ? reusable.taskId
        : await resolveAssessmentTaskId(tx, actor.userId, assessment, purpose, taskId);

    const recordStart = async (attempt: Attempt) => {
      await syncLinkedTask(tx, attempt);
      await ctx.audit(
        actor,
        'attempt.start',
        'attempt',
        attempt.id,
        { assessmentId, taskId: attempt.taskId },
        tx,
      );
    };

    if (reusable) {
      let current = reusable;
      if (resolvedTaskId !== null) {
        assert(
          reusable.taskId === null || reusable.taskId === resolvedTaskId,
          'ATTEMPT_TASK_CONFLICT',
          '当前作答已关联其他计划任务',
          409,
        );
        if (reusable.taskId === null) {
          current = await tx.update('attempts', reusable.id, reusable.revision, {
            taskId: resolvedTaskId,
          });
          await recordStart(current);
        }
      }
      return { attempt: current, created: false };
    }

    await ownedTopic(tx, assessment.topicId, actor.userId, true);
    assert(
      assessment.archivedAt === null,
      'ASSESSMENT_ARCHIVED',
      '练习或考试已归档，不能开始新作答',
      409,
    );
    for (const stale of existing) await settleAttempt(tx, ctx, stale, 'time_expired');

    const attempt = newAttempt(
      actor.userId,
      assessment.topicId,
      assessment.id,
      null,
      assessment.title,
      assessment.kind,
      assessment.durationSeconds,
      await assessmentSnapshots(assessment, actor.userId, tx),
      purpose,
      resolvedTaskId,
    );
    await tx.insert('attempts', attempt);
    await recordStart(attempt);
    return { attempt, created: true };
  });
}

/**
 * Start or resume a link attempt attributed to the link owner.
 * The link is an answer capability, not an anonymous learning identity.
 */
export async function startAnswerLinkAttempt(
  ctx: AppContext,
  answerLinkId: string,
): Promise<Attempt> {
  return ctx.db.transaction(async (tx) => {
    const link = await tx.get('answerLinks', answerLinkId);
    assert(link, 'ANSWER_LINK_NOT_FOUND', '答题链接不存在', 404);
    assert(
      link.revokedAt === null && Date.parse(link.expiresAt) > Date.now(),
      'ANSWER_LINK_EXPIRED',
      '答题链接已过期，请向发布者获取新链接',
      410,
    );
    if (link.attemptId !== null) {
      const existing = await tx.get('attempts', link.attemptId);
      assert(
        existing && existing.answerLinkId === link.id && existing.ownerId === link.ownerId,
        'ANSWER_LINK_ATTEMPT_MISMATCH',
        '答题链接状态异常，请联系发布者',
        409,
      );
      if (existing.voidedAt === null && existing.submittedAt === null && expired(existing)) {
        return settleAttempt(tx, ctx, existing, 'time_expired');
      }
      return existing;
    }

    const assessment = await owned(tx, 'assessments', link.assessmentId, link.ownerId);
    assert(
      assessment.archivedAt === null,
      'ASSESSMENT_ARCHIVED',
      '练习或考试已归档，不能开始作答',
      409,
    );
    await ownedTopic(tx, assessment.topicId, link.ownerId, true);
    const taskId = await resolveAssessmentTaskId(
      tx,
      link.ownerId,
      assessment,
      link.purpose,
      link.taskId,
    );
    const attempt = newAttempt(
      link.ownerId,
      assessment.topicId,
      assessment.id,
      link.id,
      assessment.title,
      assessment.kind,
      assessment.durationSeconds,
      await assessmentSnapshots(assessment, link.ownerId, tx),
      link.purpose,
      taskId,
    );
    await tx.insert('attempts', attempt);
    await syncLinkedTask(tx, attempt);
    await tx.update('answerLinks', link.id, link.revision, { taskId, attemptId: attempt.id });
    await ctx.audit(
      {
        id: 'answer-link:' + link.id,
        userId: link.ownerId,
        role: 'user',
        channel: 'public',
        scopes: [],
      },
      'answer-link.attempt.start',
      'attempt',
      attempt.id,
      { answerLinkId: link.id, assessmentId: assessment.id, taskId: attempt.taskId },
      tx,
    );
    return attempt;
  });
}

/** Read the link's only attempt, settling an expired in-progress session first. */
export async function readAnswerLinkAttempt(
  ctx: AppContext,
  link: AnswerLinkRecord,
): Promise<Attempt> {
  if (link.attemptId === null) throw new AppError(404, 'ATTEMPT_NOT_STARTED', '答题尚未开始');
  const current = await ctx.db.get('attempts', link.attemptId);
  assert(
    current && current.answerLinkId === link.id && current.ownerId === link.ownerId,
    'ANSWER_LINK_ATTEMPT_MISMATCH',
    '答题链接状态异常，请联系发布者',
    409,
  );
  if (current.voidedAt !== null || current.submittedAt !== null || !expired(current))
    return current;
  return ctx.db.transaction(async (tx) => {
    const attempt = await tx.get('attempts', current.id);
    assert(
      attempt && attempt.answerLinkId === link.id && attempt.ownerId === link.ownerId,
      'ANSWER_LINK_ATTEMPT_MISMATCH',
      '答题链接状态异常，请联系发布者',
      409,
    );
    if (attempt.submittedAt !== null || !expired(attempt)) return attempt;
    return settleAttempt(tx, ctx, attempt, 'time_expired');
  });
}

function answerRevision(input: JsonObject): number {
  const value = input.expectedRevision;
  assert(
    Number.isInteger(value) && (value as number) >= 0,
    'INVALID_REVISION',
    'expectedRevision 必须是答案版本号',
    422,
    {
      expectedRevision: '从 AttemptItemView.answerRevision 获取，初始值为 0',
    },
  );
  return value as number;
}

function assertWritableAttempt(attempt: Attempt, actor: Actor): void {
  assert(attempt.voidedAt === null, 'ATTEMPT_VOIDED', '作答已作废，不能修改或提交', 409);
  assert(
    attempt.answerLinkId === null ||
      (actor.channel === 'public' && actor.id === 'answer-link:' + attempt.answerLinkId),
    'NOT_FOUND',
    '资源不存在',
    404,
  );
}

export async function saveAnswer(
  ctx: AppContext,
  actor: Actor,
  attemptId: string,
  itemId: string,
  input: JsonObject,
): Promise<Attempt> {
  const revision = answerRevision(input);
  rejectClientFacts(input);
  const result = await ctx.db.transaction(async (tx) => {
    const attempt = await owned(tx, 'attempts', attemptId, actor.userId);
    assertWritableAttempt(attempt, actor);
    if (attempt.submittedAt !== null)
      throw new AppError(409, 'ATTEMPT_SUBMITTED', '作答已提交，不能继续保存');
    const item = attempt.items.find((candidate) => candidate.id === itemId);
    assert(item, 'NOT_FOUND', '作答题目不存在', 404);
    if (expired(attempt)) {
      await settleAttempt(tx, ctx, attempt, 'time_expired');
      return { expired: true as const };
    }
    if (item.lockedAt !== null)
      throw new AppError(409, 'ATTEMPT_ITEM_LOCKED', '该题已锁定，不能修改答案');
    if (item.answerRevision !== revision) {
      throw new AppError(409, 'ANSWER_VERSION_CONFLICT', '答案已被其他请求更新，请刷新后重试');
    }
    validateAnswer(item.definition, input.answer as Answer);
    item.answer = clone(input.answer as Answer);
    item.answerRevision += 1;
    const saved = await tx.update('attempts', attempt.id, attempt.revision, {
      items: attempt.items,
    });
    return { expired: false as const, attempt: saved };
  });
  if (result.expired) throw new AppError(409, 'ATTEMPT_EXPIRED', '作答已到期并按服务端时间结算');
  return result.attempt;
}

export async function submitPracticeItem(
  ctx: AppContext,
  actor: Actor,
  attemptId: string,
  itemId: string,
): Promise<Attempt> {
  const result = await ctx.db.transaction(async (tx) => {
    const attempt = await owned(tx, 'attempts', attemptId, actor.userId);
    assertWritableAttempt(attempt, actor);
    assert(attempt.kind === 'practice', 'PRACTICE_REQUIRED', '考试必须整体交卷', 409);
    const item = attempt.items.find((candidate) => candidate.id === itemId);
    assert(item, 'NOT_FOUND', '作答题目不存在', 404);
    if (item.lockedAt !== null) return { attempt, expired: false };
    if (attempt.submittedAt !== null) throw new AppError(409, 'ATTEMPT_SUBMITTED', '作答已提交');
    if (expired(attempt)) {
      const settled = await settleAttempt(tx, ctx, attempt, 'time_expired');
      return { attempt: settled, expired: true };
    }
    assert(
      item.definition.type !== 'short_answer',
      'SHORT_ANSWER_REQUIRES_SUBMISSION',
      '简答题在最终交卷后统一评分，请先保存答案',
      409,
    );
    item.lockedAt = now();
    await ctx.grading.gradeLockedItem(tx, attempt, item);
    const saved = await refreshAttempt(tx, attempt);
    await ctx.audit(actor, 'attempt-item.submit', 'attempt', attempt.id, { itemId }, tx);
    return { attempt: saved, expired: false };
  });
  if (result.expired)
    throw new AppError(409, 'ATTEMPT_EXPIRED', '作答已到期并按服务端时间整体结算');
  return result.attempt;
}

export async function submitAttempt(
  ctx: AppContext,
  actor: Actor,
  attemptId: string,
): Promise<Attempt> {
  return ctx.db.transaction(async (tx) => {
    const attempt = await owned(tx, 'attempts', attemptId, actor.userId);
    assertWritableAttempt(attempt, actor);
    if (attempt.submittedAt !== null) return attempt;
    const reason = expired(attempt) ? 'time_expired' : 'user_submitted';
    const saved = await settleAttempt(tx, ctx, attempt, reason);
    await ctx.audit(actor, 'attempt.submit', 'attempt', attempt.id, { reason }, tx);
    return saved;
  });
}

interface WrongPracticeInputItem {
  questionId: string;
}

function wrongPracticeItems(input: JsonObject): WrongPracticeInputItem[] {
  const seen = new Set<string>();
  const add = (questionId: string) => {
    assert(!seen.has(questionId), 'DUPLICATE_QUESTION', '同一次重练不能重复题目');
    seen.add(questionId);
    return { questionId };
  };
  if (input.questionId !== undefined) {
    assert(input.items === undefined, 'INVALID_ITEMS', 'questionId 与 items 不能同时提供');
    return [add(requiredString(input, 'questionId', 128))];
  }
  assert(
    Array.isArray(input.items) && input.items.length > 0 && input.items.length <= 50,
    'INVALID_ITEMS',
    '请提供 questionId，或包含 1 至 50 项的 items',
  );
  return input.items.map((raw) => {
    assert(isRecord(raw), 'INVALID_ITEM', '重练题目格式无效');
    rejectClientFacts(raw);
    assert(
      Object.keys(raw).every((key) => key === 'questionId'),
      'INVALID_ITEM',
      '重练题目仅接受 questionId',
    );
    return add(requiredString(raw, 'questionId', 128));
  });
}

export async function startWrongQuestionPractice(
  ctx: AppContext,
  actor: Actor,
  input: JsonObject,
): Promise<Attempt> {
  rejectClientFacts(input);
  assert(
    Object.keys(input).every((key) => ['questionId', 'items', 'title', 'purpose'].includes(key)),
    'INVALID_FIELD',
    '重练包含不允许的字段',
  );
  const purpose = attemptPurpose(input);
  const requested = wrongPracticeItems(input);
  assert(
    input.title === undefined || typeof input.title === 'string',
    'INVALID_TITLE',
    'title 必须是字符串',
  );
  const title = typeof input.title === 'string' && input.title.trim() ? input.title : '错题重练';
  assert(title.length <= 500, 'INVALID_TITLE', 'title 过长');
  return ctx.db.transaction(async (tx) => {
    const history = await tx.list('attempts', { ownerId: actor.userId });
    const existing = history.filter(
      (attempt) =>
        attempt.assessmentId === null &&
        attempt.status === 'in_progress' &&
        attempt.answerLinkId === null &&
        attempt.purpose === purpose &&
        attempt.voidedAt === null,
    );
    const requestedIds = requested
      .map((item) => item.questionId)
      .sort()
      .join(',');
    const reusable = existing.find(
      (attempt) =>
        attempt.items
          .map((item) => item.questionId)
          .sort()
          .join(',') === requestedIds,
    );
    if (reusable) return reusable;

    const items: AttemptItemSnapshot[] = [];
    let topicId: string | undefined;
    for (const requestedItem of requested) {
      const wrong = await tx.findOne('wrongQuestions', {
        ownerId: actor.userId,
        questionId: requestedItem.questionId,
      });
      assert(wrong, 'NOT_FOUND', '错题不存在', 404);
      const question = await owned(tx, 'questions', requestedItem.questionId, actor.userId);
      assert(question.archivedAt === null, 'QUESTION_ARCHIVED', '题目已归档，恢复后才能重练', 409);
      await ownedTopic(tx, question.topicId, actor.userId, true);
      if (topicId === undefined) topicId = question.topicId;
      assert(
        topicId === question.topicId,
        'MIXED_TOPIC_PRACTICE',
        '一次错题重练暂仅支持同一主题',
        422,
      );
      const version = await tx.findOne('questionVersions', {
        ownerId: actor.userId,
        questionId: question.id,
        version: question.version,
      });
      assert(version, 'QUESTION_VERSION_MISSING', '题目当前版本不存在', 409);
      const historicalScore = history
        .flatMap((attempt) => attempt.items)
        .filter((item) => item.questionId === question.id && item.lockedAt !== null)
        .sort((left, right) =>
          (right.lockedAt ?? '').localeCompare(left.lockedAt ?? ''),
        )[0]?.maxScore;
      const maxScore = historicalScore;
      assert(maxScore, 'PRACTICE_SCORE_REQUIRED', '无法从历史作答确定重练分值', 422);
      validateScoringConfiguration(version.definition, maxScore);
      items.push(snapshot(question.id, question.version, version.definition, maxScore));
    }
    assert(topicId, 'INVALID_ITEMS', '重练题目不能为空');
    const attempt = newAttempt(
      actor.userId,
      topicId,
      null,
      null,
      title,
      'practice',
      null,
      items,
      purpose,
      null,
    );
    await tx.insert('attempts', attempt);
    await ctx.audit(
      actor,
      'wrong-question-practice.start',
      'attempt',
      attempt.id,
      {
        questionIds: requested.map((item) => item.questionId),
      },
      tx,
    );
    return attempt;
  });
}

/** Resolve one task, never guess between multiple matching learning-plan tasks. */
export async function resolveAssessmentTaskId(
  db: AppContext['db'],
  ownerId: string,
  assessment: Assessment,
  purpose: Attempt['purpose'],
  taskId: string | null | undefined,
): Promise<string | null> {
  if (taskId != null) {
    await validateAssessmentTask(db, ownerId, assessment, taskId);
    return taskId;
  }
  if (purpose !== 'learning') return null;
  const plans = await db.list('plans', { ownerId });
  const matches = plans
    .filter((plan) => plan.archivedAt === null && plan.topicId === assessment.topicId)
    .flatMap((plan) => plan.phases.flatMap((phase) => phase.tasks))
    .filter((task) => task.targetId === assessment.id && task.kind === assessment.kind);
  return matches.length === 1 ? matches[0].id : null;
}

/** Validate an explicit task association at both link creation and actual start. */
export async function validateAssessmentTask(
  db: AppContext['db'],
  ownerId: string,
  assessment: Assessment,
  taskId: string,
): Promise<Awaited<ReturnType<typeof findTaskLocation>>> {
  const location = await findTaskLocation(db, ownerId, taskId);
  const { plan, task } = location;
  assert(plan.archivedAt === null, 'PLAN_ARCHIVED', '计划已归档，不能开始新任务', 409);
  assert(
    plan.topicId === assessment.topicId &&
      task.targetId === assessment.id &&
      task.kind === assessment.kind,
    'TASK_TARGET_MISMATCH',
    '任务与练习或考试不匹配',
    422,
  );
  return location;
}

/** Invalidate evidence without deleting the answer, grade history, or audit trail. */
export async function voidAttempt(
  ctx: AppContext,
  actor: Actor,
  attemptId: string,
  input: JsonObject,
): Promise<Attempt> {
  const revision = expectedRevision(input);
  const reason = requiredString(input, 'reason', 4000);
  assert(
    Object.keys(input).every((key) => ['expectedRevision', 'reason'].includes(key)),
    'CLIENT_FIELD_FORBIDDEN',
    '作废请求只接受 expectedRevision 和 reason',
    400,
  );
  return ctx.db.transaction(async (tx) => {
    const attempt = await owned(tx, 'attempts', attemptId, actor.userId);
    checkRevision(attempt, revision);
    assert(attempt.voidedAt === null, 'ATTEMPT_VOIDED', '作答已作废', 409);
    const saved = await tx.update('attempts', attempt.id, attempt.revision, {
      voidedAt: now(),
      voidedBy: actor.id,
      voidReason: reason,
    });
    const jobs = await tx.list('gradingJobs', { attemptId: attempt.id });
    for (const job of jobs) {
      if (
        ['queued', 'running', 'retry_wait', 'blocked_config', 'blocked_budget'].includes(job.status)
      )
        await tx.update('gradingJobs', job.id, job.revision, {
          status: 'cancelled',
          leaseExpiresAt: null,
          lastErrorCode: 'ATTEMPT_VOIDED',
        });
    }
    await syncWrongQuestions(tx, saved);
    await syncLinkedTask(tx, saved);
    await ctx.audit(actor, 'attempt.void', 'attempt', saved.id, {}, tx);
    return saved;
  });
}
