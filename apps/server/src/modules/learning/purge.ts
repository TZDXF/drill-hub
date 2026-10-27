import { In } from 'typeorm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PurgeCounts, PurgePreview } from '@drill-hub/contracts';
import type { Actor, AppContext } from '#server/core/context.js';
import { AppError, assert } from '#server/core/errors.js';
import { body, revision } from '#server/core/validation.js';
import type { Database } from '#server/db/database.js';
import {
  API_PREFIX,
  checkRevision,
  owned,
  params,
  type JsonObject,
} from '#server/modules/learning/common.js';

interface PurgeScope {
  questionIds: string[];
  assessmentIds: string[];
  attemptIds: string[];
  counts: PurgeCounts;
}

async function collectPurgeScope(
  tx: Database,
  ownerId: string,
  topicId: string,
): Promise<PurgeScope> {
  const contents = await tx.list('contents', { ownerId, topicId });
  const plans = await tx.list('plans', { ownerId, topicId });
  const questions = await tx.list('questions', { ownerId, topicId });
  const questionIds = questions.map((question) => question.id);
  const assessments = await tx.list('assessments', { ownerId, topicId });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const attempts = await tx.list('attempts', { ownerId, topicId });
  const attemptIds = attempts.map((attempt) => attempt.id);
  const wrongQuestions = await tx.list('wrongQuestions', { ownerId, topicId });
  const questionVersions = questionIds.length ? await tx.list('questionVersions', { ownerId }) : [];
  const answerLinks = assessmentIds.length ? await tx.list('answerLinks', { ownerId }) : [];
  const gradingJobs = attemptIds.length ? await tx.list('gradingJobs', { ownerId }) : [];
  return {
    questionIds,
    assessmentIds,
    attemptIds,
    counts: {
      contents: contents.length,
      plans: plans.length,
      questions: questions.length,
      questionVersions: questionVersions.filter((version) =>
        questionIds.includes(version.questionId),
      ).length,
      assessments: assessments.length,
      attempts: attempts.length,
      wrongQuestions: wrongQuestions.length,
      answerLinks: answerLinks.filter((link) => assessmentIds.includes(link.assessmentId)).length,
      gradingJobs: gradingJobs.filter((job) => attemptIds.includes(job.attemptId)).length,
    },
  };
}

/**
 * 永久删除主题及其全部子资源。仅允许删除作答已终结（已提交或已作废）的主题；
 * 归档子资源一并删除；审计记录保留。
 */
export async function purgeTopic(
  ctx: AppContext,
  actor: Actor,
  topicId: string,
  expectedRevision: number,
): Promise<PurgeCounts> {
  const ownerId = actor.userId;
  return ctx.db.transaction(async (tx) => {
    const topic = await tx.get('topics', topicId);
    assert(topic && topic.ownerId === ownerId, 'NOT_FOUND', '资源不存在', 404);
    checkRevision(topic, expectedRevision);
    const scope = await collectPurgeScope(tx, ownerId, topicId);
    const attempts = await tx.list('attempts', { ownerId, topicId });
    const active = attempts.find(
      (attempt) => attempt.submittedAt === null && attempt.voidedAt === null,
    );
    if (active)
      throw new AppError(
        409,
        'TOPIC_ATTEMPTS_ACTIVE',
        '主题存在未终结的作答，请先提交或作废后再删除',
      );
    if (scope.attemptIds.length)
      await tx.deleteWhere('gradingJobs', {
        ownerId,
        attemptId: In(scope.attemptIds) as unknown,
      });
    await tx.deleteWhere('attempts', { ownerId, topicId });
    if (scope.assessmentIds.length)
      await tx.deleteWhere('answerLinks', {
        ownerId,
        assessmentId: In(scope.assessmentIds) as unknown,
      });
    await tx.deleteWhere('assessments', { ownerId, topicId });
    await tx.deleteWhere('wrongQuestions', { ownerId, topicId });
    if (scope.questionIds.length)
      await tx.deleteWhere('questionVersions', {
        ownerId,
        questionId: In(scope.questionIds) as unknown,
      });
    await tx.deleteWhere('questions', { ownerId, topicId });
    await tx.deleteWhere('contents', { ownerId, topicId });
    await tx.deleteWhere('plans', { ownerId, topicId });
    await tx.deleteWhere('topics', { ownerId, id: topicId });
    await ctx.audit(
      actor,
      'topic.purged',
      'topic',
      topicId,
      { title: topic.title, counts: scope.counts },
      tx,
    );
    return scope.counts;
  });
}

async function buildPreview(
  ctx: AppContext,
  ownerId: string,
  topicId: string,
): Promise<PurgePreview> {
  const topic = await owned(ctx.db, 'topics', topicId, ownerId);
  const { counts } = await collectPurgeScope(ctx.db, ownerId, topic.id);
  return {
    topic: {
      id: topic.id,
      title: topic.title,
      revision: topic.revision,
      archivedAt: topic.archivedAt,
    },
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
}

function parseExpectedRevision(request: FastifyRequest): number {
  const input = body(request, true) as JsonObject;
  return revision(input.expectedRevision);
}

export function registerPurgeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(`${API_PREFIX}/topics/:id/purge-preview`, async (request) => {
    const actor = await ctx.requireUser(request);
    return { data: await buildPreview(ctx, actor.userId, params(request).id) };
  });

  app.delete(`${API_PREFIX}/topics/:id`, async (request) => {
    const actor = await ctx.requireUser(request);
    const counts = await purgeTopic(ctx, actor, params(request).id, parseExpectedRevision(request));
    return { data: { purged: true, counts } };
  });

  app.get(`${API_PREFIX}/agent/topics/:id/purge-preview`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    return { data: await buildPreview(ctx, actor.userId, params(request).id) };
  });

  app.delete(`${API_PREFIX}/agent/topics/:id`, async (request) => {
    const actor = await ctx.requireAgent(request, 'topic:purge');
    const counts = await purgeTopic(ctx, actor, params(request).id, parseExpectedRevision(request));
    return { data: { purged: true, counts } };
  });
}
