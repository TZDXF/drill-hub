import { resolvePublicUrl } from '../../core/public-url.js';
import { attemptPurpose } from './attempt-policy.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  AnswerLinkCreated,
  PublicAnswerContext,
  PublicAssessmentSummary,
} from '@drill-hub/contracts';
import type { Actor, AppContext } from '../../core/context.js';
import { baseRecord } from '../../core/ids.js';
import { hashSecret, randomSecret } from '../../core/security.js';
import type { Database } from '../../db/database.js';
import type { AnswerLinkRecord } from '../../db/records.js';
import {
  API_PREFIX,
  assert,
  body,
  owned,
  ownedTopic,
  params,
  positiveInteger,
  rejectClientFacts,
  type JsonObject,
} from './common.js';
import {
  readAnswerLinkAttempt,
  saveAnswer,
  startAnswerLinkAttempt,
  submitAttempt,
  submitPracticeItem,
  validateAssessmentTask,
} from './attempts.js';
import { toAttemptItemView, toAttemptReport, toAttemptView } from './projections.js';

const ANSWER_LINK_TOKEN_HEADER = 'x-answer-link-token';
const DEFAULT_LINK_SECONDS = 86_400;
const MIN_LINK_SECONDS = 60;
const MAX_LINK_SECONDS = 30 * 24 * 60 * 60;

function linkTtl(input: JsonObject, durationSeconds: number | null): number {
  if (input.expiresInSeconds === undefined) {
    return Math.min(
      MAX_LINK_SECONDS,
      Math.max(DEFAULT_LINK_SECONDS, (durationSeconds ?? 0) + 3600),
    );
  }
  const seconds = positiveInteger(input.expiresInSeconds, 'expiresInSeconds', MAX_LINK_SECONDS);
  assert(
    seconds >= MIN_LINK_SECONDS,
    'INVALID_LINK_TTL',
    `expiresInSeconds 不能小于 ${MIN_LINK_SECONDS} 秒`,
    422,
  );
  return seconds;
}

async function resolveAnswerLink(request: FastifyRequest, db: Database): Promise<AnswerLinkRecord> {
  const raw = request.headers[ANSWER_LINK_TOKEN_HEADER];
  assert(
    typeof raw === 'string' && raw.length > 0,
    'ANSWER_LINK_REQUIRED',
    '答题链接缺少临时秘钥',
    401,
  );
  const link = await db.findOne('answerLinks', { secretHash: hashSecret(raw) });
  assert(link, 'ANSWER_LINK_NOT_FOUND', '答题链接无效', 404);
  assert(
    link.revokedAt === null && Date.parse(link.expiresAt) > Date.now(),
    'ANSWER_LINK_EXPIRED',
    '答题链接已过期，请向发布者获取新链接',
    410,
  );
  const owner = await db.get('users', link.ownerId);
  assert(
    owner?.status === 'active',
    'ANSWER_LINK_UNAVAILABLE',
    '答题链接当前不可用，请联系发布者',
    403,
  );
  request.auditActor = publicActor(link, link.ownerId);
  return link;
}

function publicActor(link: AnswerLinkRecord, ownerId: string): Actor {
  return {
    id: 'answer-link:' + link.id,
    userId: ownerId,
    role: 'user',
    channel: 'public',
    scopes: [],
  };
}

async function assessmentSummary(
  db: Database,
  link: AnswerLinkRecord,
): Promise<PublicAssessmentSummary> {
  const assessment = await owned(db, 'assessments', link.assessmentId, link.ownerId);
  return {
    id: assessment.id,
    title: assessment.title,
    kind: assessment.kind,
    durationSeconds: assessment.durationSeconds,
    itemCount: assessment.items.length,
  };
}

export function registerAnswerLinkRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(`${API_PREFIX}/agent/assessments/:id/answer-links`, async (request, reply) => {
    const actor = await ctx.requireAgent(request, 'assessment:write');
    const assessment = await owned(ctx.db, 'assessments', params(request).id, actor.userId);
    assert(
      assessment.archivedAt === null,
      'ASSESSMENT_ARCHIVED',
      '已归档练习或考试不能生成答题链接',
      409,
    );
    await ownedTopic(ctx.db, assessment.topicId, actor.userId, true);
    const input = body(request, true);
    rejectClientFacts(input);
    const purpose = attemptPurpose(input);
    const taskId = input.taskId === undefined ? null : input.taskId;
    assert(
      taskId === null || (typeof taskId === 'string' && taskId.length > 0),
      'INVALID_TASK',
      'taskId 无效',
    );
    if (taskId !== null) await validateAssessmentTask(ctx.db, actor.userId, assessment, taskId);
    const ttl = linkTtl(input, assessment.durationSeconds);
    const token = randomSecret();
    const link: AnswerLinkRecord = {
      ...baseRecord(),
      ownerId: actor.userId,
      purpose,
      taskId,
      assessmentId: assessment.id,
      secretHash: hashSecret(token),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      revokedAt: null,
      attemptId: null,
    };
    await ctx.db.transaction(async (tx) => {
      if (taskId !== null) await validateAssessmentTask(tx, actor.userId, assessment, taskId);
      await tx.insert('answerLinks', link);
      await ctx.audit(
        actor,
        'answer-link.create',
        'assessment',
        assessment.id,
        { answerLinkId: link.id, expiresAt: link.expiresAt },
        tx,
      );
    });
    const base = resolvePublicUrl(request, ctx.config.publicUrl).publicBaseUrl;
    const created: AnswerLinkCreated = {
      id: link.id,
      purpose: link.purpose,
      taskId: link.taskId,
      assessmentId: assessment.id,
      expiresAt: link.expiresAt,
      answerUrl: `${base}/answer#${token}`,
    };
    reply.code(201);
    return { data: created };
  });

  app.get(`${API_PREFIX}/public/answer`, async (request) => {
    const link = await resolveAnswerLink(request, ctx.db);
    const attempt = link.attemptId ? await readAnswerLinkAttempt(ctx, link) : null;
    const data: PublicAnswerContext = {
      purpose: link.purpose,
      assessment: await assessmentSummary(ctx.db, link),
      expiresAt: link.expiresAt,
      attempt: attempt ? toAttemptView(attempt) : null,
    };
    return { data };
  });

  app.post(`${API_PREFIX}/public/answer/attempt`, async (request) => {
    const link = await resolveAnswerLink(request, ctx.db);
    const attempt = await startAnswerLinkAttempt(ctx, link.id);
    return { data: toAttemptView(attempt) };
  });

  app.put(`${API_PREFIX}/public/answer/attempt/items/:itemId`, async (request) => {
    const link = await resolveAnswerLink(request, ctx.db);
    const attempt = await readAnswerLinkAttempt(ctx, link);
    const saved = await saveAnswer(
      ctx,
      publicActor(link, attempt.ownerId),
      attempt.id,
      params(request).itemId,
      body(request),
    );
    const item = saved.items.find((candidate) => candidate.id === params(request).itemId);
    assert(item, 'NOT_FOUND', '作答题目不存在', 404);
    return { data: toAttemptItemView(saved, item) };
  });

  app.post(`${API_PREFIX}/public/answer/attempt/items/:itemId/submit`, async (request) => {
    const link = await resolveAnswerLink(request, ctx.db);
    const attempt = await readAnswerLinkAttempt(ctx, link);
    const saved = await submitPracticeItem(
      ctx,
      publicActor(link, attempt.ownerId),
      attempt.id,
      params(request).itemId,
    );
    return { data: toAttemptView(saved) };
  });

  app.post(`${API_PREFIX}/public/answer/attempt/submit`, async (request) => {
    const link = await resolveAnswerLink(request, ctx.db);
    const attempt = await readAnswerLinkAttempt(ctx, link);
    const saved = await submitAttempt(ctx, publicActor(link, attempt.ownerId), attempt.id);
    return { data: toAttemptView(saved) };
  });

  app.get(`${API_PREFIX}/public/answer/report`, async (request) => {
    const link = await resolveAnswerLink(request, ctx.db);
    const attempt = await readAnswerLinkAttempt(ctx, link);
    return { data: toAttemptReport(attempt) };
  });
}
