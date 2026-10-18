import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../core/context.js';
import { registerAgentRoutes } from './agent.js';
import { registerAnswerLinkRoutes } from './answer-links.js';
import { registerLearnerRoutes } from './learner.js';

export function registerLearningRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerLearnerRoutes(app, ctx);
  registerAgentRoutes(app, ctx);
  registerAnswerLinkRoutes(app, ctx);
}

export {
  expireAttempts,
  refreshAttempt,
  settleAttempt,
  syncWrongQuestions,
  updateAttemptStatus,
} from './helpers.js';
export { toAttemptItemView, toAttemptReport, toAttemptView } from './projections.js';
