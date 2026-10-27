import type { Actor, AppContext } from '#server/core/context.js';
import {
  assert,
  checkRevision,
  expectedRevision,
  type JsonObject,
} from '#server/modules/learning/common.js';

export async function updateWrongQuestionMastery(
  ctx: AppContext,
  actor: Actor,
  questionId: string,
  input: JsonObject,
) {
  const revision = expectedRevision(input);
  const masteryStatus = input.masteryStatus;
  assert(
    masteryStatus === 'pending' || masteryStatus === 'reviewing' || masteryStatus === 'mastered',
    'INVALID_MASTERY',
    '掌握状态无效',
  );
  return ctx.db.transaction(async (tx) => {
    const wrong = await tx.findOne('wrongQuestions', { ownerId: actor.userId, questionId });
    assert(wrong, 'NOT_FOUND', '错题不存在', 404);
    checkRevision(wrong, revision);
    const updated = await tx.update('wrongQuestions', wrong.id, wrong.revision, { masteryStatus });
    await ctx.audit(
      actor,
      'wrong-question.mastery',
      'wrongQuestion',
      wrong.id,
      { masteryStatus },
      tx,
    );
    return updated;
  });
}
