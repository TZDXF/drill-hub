import type { FastifyInstance } from 'fastify';
import type { Attempt, Dashboard, WrongQuestionListItem } from '@drill-hub/contracts';
import type { AppContext } from '../../core/context.js';
import { now } from '../../core/ids.js';
import { changeArchiveState, listArchive } from './archive.js';
import {
  API_PREFIX,
  archiveState,
  assert,
  body,
  checkRevision,
  expectedRevision,
  expired,
  matchesArchive,
  owned,
  ownedTopic,
  params,
  query,
} from './common.js';
import {
  saveAnswer,
  startAssessment,
  startWrongQuestionPractice,
  submitAttempt,
  submitPracticeItem,
  voidAttempt,
} from './attempts.js';
import { isLearningAttempt } from './attempt-policy.js';
import { settleAttempt } from './helpers.js';
import { findTaskLocation, replaceTask } from './plans.js';
import { toAttemptItemView, toAttemptReport, toAttemptView } from './projections.js';

async function readAttempt(ctx: AppContext, ownerId: string, attemptId: string): Promise<Attempt> {
  const current = await owned(ctx.db, 'attempts', attemptId, ownerId);
  if (current.voidedAt !== null || current.submittedAt !== null || !expired(current))
    return current;
  return ctx.db.transaction(async (tx) => {
    const attempt = await owned(tx, 'attempts', attemptId, ownerId);
    if (attempt.submittedAt !== null || !expired(attempt)) return attempt;
    return settleAttempt(tx, ctx, attempt, 'time_expired');
  });
}

export function registerLearnerRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(`${API_PREFIX}/dashboard`, async (request) => {
    const actor = await ctx.requireUser(request);
    const topics = await ctx.db.list('topics', { ownerId: actor.userId });
    const plans = await ctx.db.list('plans', { ownerId: actor.userId });
    const attempts = (await ctx.db.list('attempts', { ownerId: actor.userId })).filter(
      isLearningAttempt,
    );
    const wrong = await ctx.db.list('wrongQuestions', { ownerId: actor.userId });
    const activeTopicIds = new Set(
      topics.filter((topic) => topic.archivedAt === null).map((topic) => topic.id),
    );
    const pendingTasks = plans
      .filter((plan) => plan.archivedAt === null && activeTopicIds.has(plan.topicId))
      .reduce(
        (sum, plan) =>
          sum +
          plan.phases.flatMap((phase) => phase.tasks).filter((task) => task.status !== 'completed')
            .length,
        0,
      );
    const dashboard: Dashboard = {
      topics: activeTopicIds.size,
      pendingTasks,
      completedAttempts: attempts.filter((attempt) => attempt.status === 'completed').length,
      pendingGrading: attempts.filter((attempt) => attempt.status === 'pending_grading').length,
      wrongQuestions: wrong.filter((record) => record.masteryStatus !== 'mastered').length,
      recentAttempts: [...attempts]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 5)
        .map(toAttemptView),
    };
    return { data: dashboard };
  });

  app.get(`${API_PREFIX}/topics`, async (request) => {
    const actor = await ctx.requireUser(request);
    const state = archiveState(query(request).archiveState);
    const records = await ctx.db.list('topics', { ownerId: actor.userId });
    return { data: records.filter((record) => matchesArchive(record, state)) };
  });

  app.get(`${API_PREFIX}/topics/:id`, async (request) => {
    const actor = await ctx.requireUser(request);
    return { data: await owned(ctx.db, 'topics', params(request).id, actor.userId) };
  });

  app.get(`${API_PREFIX}/topics/:id/plans`, async (request) => {
    const actor = await ctx.requireUser(request);
    const topic = await ownedTopic(ctx.db, params(request).id, actor.userId);
    const state = archiveState(query(request).archiveState);
    const records = await ctx.db.list('plans', { ownerId: actor.userId, topicId: topic.id });
    return { data: records.filter((record) => matchesArchive(record, state)) };
  });

  app.get(`${API_PREFIX}/topics/:id/contents`, async (request) => {
    const actor = await ctx.requireUser(request);
    const topic = await ownedTopic(ctx.db, params(request).id, actor.userId);
    const state = archiveState(query(request).archiveState);
    const records = await ctx.db.list('contents', { ownerId: actor.userId, topicId: topic.id });
    return { data: records.filter((record) => matchesArchive(record, state)) };
  });

  app.get(`${API_PREFIX}/contents/:id`, async (request) => {
    const actor = await ctx.requireUser(request);
    return { data: await owned(ctx.db, 'contents', params(request).id, actor.userId) };
  });

  app.get(`${API_PREFIX}/topics/:id/assessments`, async (request) => {
    const actor = await ctx.requireUser(request);
    const topic = await ownedTopic(ctx.db, params(request).id, actor.userId);
    const state = archiveState(query(request).archiveState);
    const records = await ctx.db.list('assessments', { ownerId: actor.userId, topicId: topic.id });
    return { data: records.filter((record) => matchesArchive(record, state)) };
  });

  app.get(`${API_PREFIX}/assessments/:id`, async (request) => {
    const actor = await ctx.requireUser(request);
    // Assessment contains only question IDs/versions and max scores, never definitions.
    return { data: await owned(ctx.db, 'assessments', params(request).id, actor.userId) };
  });

  app.post(`${API_PREFIX}/tasks/:id/complete`, async (request) => {
    const actor = await ctx.requireUser(request);
    const input = body(request);
    const revision = input.expectedRevision === undefined ? undefined : expectedRevision(input);
    const task = await ctx.db.transaction(async (tx) => {
      const location = await findTaskLocation(tx, actor.userId, params(request).id);
      if (revision !== undefined) checkRevision(location.plan, revision);
      assert(
        location.task.kind === 'reading' || location.task.kind === 'manual',
        'TASK_KIND_NOT_COMPLETABLE',
        '练习和考试任务由提交自动完成',
        409,
      );
      assert(location.plan.archivedAt === null, 'PLAN_ARCHIVED', '计划已归档', 409);
      if (location.task.status === 'completed') return location.task;
      const replacement = { ...location.task, status: 'completed' as const, completedAt: now() };
      await tx.update('plans', location.plan.id, location.plan.revision, {
        phases: replaceTask(location.plan, location.task.id, replacement),
      });
      await ctx.audit(
        actor,
        'task.complete',
        'plan',
        location.plan.id,
        { taskId: location.task.id },
        tx,
      );
      return replacement;
    });
    return { data: task };
  });

  app.post(`${API_PREFIX}/assessments/:id/attempts`, async (request, reply) => {
    const actor = await ctx.requireUser(request);
    const result = await startAssessment(ctx, actor, params(request).id, body(request, true));
    reply.code(result.created ? 201 : 200);
    return { data: toAttemptView(result.attempt) };
  });

  app.get(`${API_PREFIX}/attempts/:id`, async (request) => {
    const actor = await ctx.requireUser(request);
    return { data: toAttemptView(await readAttempt(ctx, actor.userId, params(request).id)) };
  });

  app.put(`${API_PREFIX}/attempts/:id/answers/:itemId`, async (request) => {
    const actor = await ctx.requireUser(request);
    const saved = await saveAnswer(
      ctx,
      actor,
      params(request).id,
      params(request).itemId,
      body(request),
    );
    const item = saved.items.find((candidate) => candidate.id === params(request).itemId);
    assert(item, 'NOT_FOUND', '作答题目不存在', 404);
    return { data: toAttemptItemView(saved, item) };
  });

  app.post(`${API_PREFIX}/attempts/:id/items/:itemId/submit`, async (request) => {
    const actor = await ctx.requireUser(request);
    const saved = await submitPracticeItem(ctx, actor, params(request).id, params(request).itemId);
    return { data: toAttemptView(saved) };
  });

  app.post(`${API_PREFIX}/attempts/:id/void`, async (request) => {
    const actor = await ctx.requireUser(request);
    return {
      data: toAttemptView(await voidAttempt(ctx, actor, params(request).id, body(request))),
    };
  });

  app.post(`${API_PREFIX}/attempts/:id/submit`, async (request) => {
    const actor = await ctx.requireUser(request);
    const saved = await submitAttempt(ctx, actor, params(request).id);
    return { data: toAttemptView(saved) };
  });

  app.get(`${API_PREFIX}/attempts/:id/report`, async (request) => {
    const actor = await ctx.requireUser(request);
    return { data: toAttemptReport(await readAttempt(ctx, actor.userId, params(request).id)) };
  });

  app.get(`${API_PREFIX}/attempts`, async (request) => {
    const actor = await ctx.requireUser(request);
    const filters = query(request);
    const records = await ctx.db.list('attempts', { ownerId: actor.userId });
    const filtered = records.filter(
      (record) =>
        (filters.status === undefined || record.status === filters.status) &&
        (filters.kind === undefined || record.kind === filters.kind) &&
        (filters.topicId === undefined || record.topicId === filters.topicId) &&
        (filters.assessmentId === undefined || record.assessmentId === filters.assessmentId),
    );
    return { data: filtered.map(toAttemptView) };
  });

  app.get(`${API_PREFIX}/wrong-questions`, async (request) => {
    const actor = await ctx.requireUser(request);
    const filters = query(request);
    const records = await ctx.db.list('wrongQuestions', { ownerId: actor.userId });
    const filtered = records.filter(
      (record) =>
        (filters.topicId === undefined || record.topicId === filters.topicId) &&
        (filters.masteryStatus === undefined || record.masteryStatus === filters.masteryStatus),
    );
    const questions = new Map(
      (await ctx.db.list('questions', { ownerId: actor.userId })).map((item) => [item.id, item]),
    );
    const topics = new Map(
      (await ctx.db.list('topics', { ownerId: actor.userId })).map((item) => [item.id, item]),
    );
    const data: WrongQuestionListItem[] = filtered.map((record) => {
      const question = questions.get(record.questionId);
      return {
        ...record,
        stem: question?.definition.stem ?? '题目暂不可用',
        type: question?.definition.type ?? null,
        topicTitle: topics.get(record.topicId)?.title ?? '主题暂不可用',
      };
    });
    return { data };
  });

  app.get(`${API_PREFIX}/wrong-questions/:questionId`, async (request) => {
    const actor = await ctx.requireUser(request);
    const questionId = params(request).questionId;
    const wrong = await ctx.db.findOne('wrongQuestions', { ownerId: actor.userId, questionId });
    assert(wrong, 'NOT_FOUND', '错题不存在', 404);
    const attempts = (await ctx.db.list('attempts', { ownerId: actor.userId })).filter(
      isLearningAttempt,
    );
    const history = attempts
      .filter((attempt) =>
        attempt.items.some((item) => item.questionId === questionId && item.lockedAt !== null),
      )
      .map((attempt) => {
        const view = toAttemptView(attempt);
        return { ...view, items: view.items.filter((item) => item.questionId === questionId) };
      });
    return { data: { ...wrong, attempts: history } };
  });

  app.patch(`${API_PREFIX}/wrong-questions/:questionId/mastery`, async (request) => {
    const actor = await ctx.requireUser(request);
    const input = body(request);
    const revision = expectedRevision(input);
    assert(
      input.masteryStatus === 'pending' ||
        input.masteryStatus === 'reviewing' ||
        input.masteryStatus === 'mastered',
      'INVALID_MASTERY',
      '掌握状态无效',
    );
    const saved = await ctx.db.transaction(async (tx) => {
      const wrong = await tx.findOne('wrongQuestions', {
        ownerId: actor.userId,
        questionId: params(request).questionId,
      });
      assert(wrong, 'NOT_FOUND', '错题不存在', 404);
      checkRevision(wrong, revision);
      const updated = await tx.update('wrongQuestions', wrong.id, wrong.revision, {
        masteryStatus: input.masteryStatus as 'pending' | 'reviewing' | 'mastered',
      });
      await ctx.audit(
        actor,
        'wrong-question.mastery',
        'wrongQuestion',
        wrong.id,
        { masteryStatus: input.masteryStatus as 'pending' | 'reviewing' | 'mastered' },
        tx,
      );
      return updated;
    });
    return { data: saved };
  });

  app.post(`${API_PREFIX}/wrong-question-practices`, async (request, reply) => {
    const actor = await ctx.requireUser(request);
    const attempt = await startWrongQuestionPractice(ctx, actor, body(request));
    reply.code(201);
    return { data: toAttemptView(attempt) };
  });

  app.get(`${API_PREFIX}/archive`, async (request) => {
    const actor = await ctx.requireUser(request);
    return { data: await listArchive(ctx.db, actor.userId, query(request).resourceType) };
  });

  app.post(`${API_PREFIX}/archive/:resourceType/:id/restore`, async (request) => {
    const actor = await ctx.requireUser(request);
    const saved = await changeArchiveState(
      ctx,
      actor,
      params(request).resourceType,
      params(request).id,
      false,
      body(request),
    );
    // In particular, never serialize a restored Question definition to a learner.
    return {
      data: {
        resourceType: params(request).resourceType,
        id: saved.id,
        archivedAt: saved.archivedAt,
      },
    };
  });
}
