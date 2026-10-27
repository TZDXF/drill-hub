import type { FastifyInstance } from 'fastify';
import type { AppContext } from '#server/core/context.js';
import { registerAgentRoutes } from '#server/modules/learning/agent.js';
import { registerAnswerLinkRoutes } from '#server/modules/learning/answer-links.js';
import { registerLearnerRoutes } from '#server/modules/learning/learner.js';
import { registerExportRoutes } from '#server/modules/learning/export.js';
import { registerPurgeRoutes } from '#server/modules/learning/purge.js';
import { registerSearchRoutes } from '#server/modules/learning/search.js';

export function registerLearningRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerLearnerRoutes(app, ctx);
  registerAgentRoutes(app, ctx);
  registerAnswerLinkRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerExportRoutes(app, ctx);
  registerPurgeRoutes(app, ctx);
}

export {
  expireAttempts,
  refreshAttempt,
  settleAttempt,
  syncWrongQuestions,
  updateAttemptStatus,
} from '#server/modules/learning/helpers.js';
export {
  toAttemptItemView,
  toAttemptReport,
  toAttemptView,
} from '#server/modules/learning/projections.js';
