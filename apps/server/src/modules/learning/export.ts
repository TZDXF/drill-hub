import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ExportAnswerLink, ExportBundle } from '@drill-hub/contracts';
import type { AppContext } from '#server/core/context.js';
import { API_PREFIX } from '#server/modules/learning/common.js';

export function registerExportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(`${API_PREFIX}/me/export`, async (request: FastifyRequest) => {
    const actor = await ctx.requireUser(request);
    const ownerId = actor.userId;
    const db = ctx.db;
    const owner = await db.get('users', ownerId);
    const answerLinks: ExportAnswerLink[] = (await db.list('answerLinks', { ownerId })).map(
      (record) => ({
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        revision: record.revision,
        purpose: record.purpose,
        taskId: record.taskId,
        assessmentId: record.assessmentId,
        expiresAt: record.expiresAt,
        revokedAt: record.revokedAt,
        attemptId: record.attemptId,
      }),
    );
    const bundle: ExportBundle = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      account: {
        userId: ownerId,
        username: owner?.username ?? actor.userId,
        displayName: owner?.displayName ?? ownerId,
      },
      topics: await db.list('topics', { ownerId }),
      contents: await db.list('contents', { ownerId }),
      plans: await db.list('plans', { ownerId }),
      questions: await db.list('questions', { ownerId }),
      questionVersions: await db.list('questionVersions', { ownerId }),
      assessments: await db.list('assessments', { ownerId }),
      attempts: await db.list('attempts', { ownerId }),
      wrongQuestions: await db.list('wrongQuestions', { ownerId }),
      answerLinks,
    };
    return { data: bundle };
  });
}
