import { afterEach, describe, expect, it } from 'vitest';
import type { Actor, AppContext } from '../src/core/context.js';
import type {
  Assessment,
  Attempt,
  AttemptItemSnapshot,
  QuestionDefinition,
} from '@drill-hub/contracts';
import { Database } from '../src/db/database.js';
import { baseRecord, id } from '../src/core/ids.js';
import { gradeRule } from '../src/modules/grading/engine.js';
import {
  saveAnswer,
  startAssessment,
  submitAttempt,
  submitPracticeItem,
} from '../src/modules/learning/attempts.js';
import { expireAttempts } from '../src/modules/learning/helpers.js';
import { toAttemptView } from '../src/modules/learning/projections.js';

const databases: Database[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

const actor: Actor = { id: 'u1', userId: 'u1', role: 'user', channel: 'web', scopes: [] };
const definition: QuestionDefinition = {
  type: 'true_false',
  stem: '事务具有原子性',
  gradingMode: 'rule',
  gradingKey: { value: true },
  referenceAnswer: '正确',
  explanation: '事务作为整体提交或回滚',
  rubric: undefined,
};

function context(db: Database, calls: string[]) {
  const ctx = {
    db,
    grading: {
      async gradeLockedItem(tx: Database, attempt: Attempt, item: AttemptItemSnapshot) {
        calls.push(`${attempt.id}:${item.id}`);
        item.grade = gradeRule(item.definition, item.answer, item.maxScore);
        item.gradingStatus = 'completed';
        item.generation += 1;
      },
    },
    audit: async (
      auditActor: Actor,
      action: string,
      resourceType: string,
      resourceId: string,
      summary: Record<string, unknown> = {},
      database: Database = db,
    ) => {
      await database.insert('auditLogs', {
        ...baseRecord(),
        ownerId: auditActor.userId,
        actorId: auditActor.id,
        action,
        resourceType,
        resourceId,
        summary,
      });
    },
  };
  return ctx as unknown as AppContext;
}

async function setup(kind: 'practice' | 'exam' = 'practice') {
  const db = await Database.open(':memory:');
  databases.push(db);
  const calls: string[] = [];
  const ctx = context(db, calls);
  const topic = {
    ...baseRecord(),
    ownerId: actor.userId,
    title: '数据库',
    goalText: '',
    archivedAt: null,
  };
  const question = {
    ...baseRecord(),
    ownerId: actor.userId,
    topicId: topic.id,
    version: 1,
    definition,
    archivedAt: null,
  };
  const version = {
    ...baseRecord(),
    ownerId: actor.userId,
    questionId: question.id,
    version: 1,
    definition,
  };
  const assessment: Assessment = {
    ...baseRecord(),
    ownerId: actor.userId,
    topicId: topic.id,
    kind,
    title: kind === 'exam' ? '考试' : '练习',
    durationSeconds: 3600,
    items: [{ questionId: question.id, questionVersion: 1, maxScore: '10.00' }],
    archivedAt: null,
  };
  await db.insert('topics', topic);
  await db.insert('questions', question);
  await db.insert('questionVersions', version);
  await db.insert('assessments', assessment);
  return { db, ctx, calls, topic, question, version, assessment };
}

describe('learning attempt services', () => {
  it('reuses an in-progress attempt and freezes the configured question version', async () => {
    const { db, ctx, assessment, question } = await setup();
    const first = await startAssessment(ctx, actor, assessment.id, {});
    const secondDefinition = { ...definition, stem: '新版本题干', gradingKey: { value: false } };
    await db.insert('questionVersions', {
      ...baseRecord(),
      ownerId: actor.userId,
      questionId: question.id,
      version: 2,
      definition: secondDefinition,
    });
    await db.update('questions', question.id, question.revision, {
      version: 2,
      definition: secondDefinition,
    });
    const second = await startAssessment(ctx, actor, assessment.id, {});
    expect(second.created).toBe(false);
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(second.attempt.items[0]).toMatchObject({
      questionVersion: 1,
      definition: { stem: definition.stem },
    });
  });

  it('uses answerRevision for concurrent-save conflict checks', async () => {
    const { ctx, assessment } = await setup();
    const { attempt } = await startAssessment(ctx, actor, assessment.id, {});
    const itemId = attempt.items[0].id;
    const saved = await saveAnswer(ctx, actor, attempt.id, itemId, {
      expectedRevision: 0,
      answer: { value: false },
    });
    expect(saved.items[0].answerRevision).toBe(1);
    await expect(
      saveAnswer(ctx, actor, attempt.id, itemId, { expectedRevision: 0, answer: { value: true } }),
    ).rejects.toMatchObject({ code: 'ANSWER_VERSION_CONFLICT' });
    await expect(
      saveAnswer(ctx, actor, attempt.id, itemId, { expectedRevision: 1, answer: { value: true } }),
    ).resolves.toMatchObject({ items: [{ answer: { value: true }, answerRevision: 2 }] });
  });

  it('does not grade an exam before overall submission and makes concurrent submits idempotent', async () => {
    const { ctx, calls, assessment } = await setup('exam');
    const { attempt } = await startAssessment(ctx, actor, assessment.id, {});
    const itemId = attempt.items[0].id;
    expect(toAttemptView(attempt).items[0]).not.toHaveProperty('gradingKey');
    await saveAnswer(ctx, actor, attempt.id, itemId, {
      expectedRevision: 0,
      answer: { value: true },
    });
    expect(calls).toHaveLength(0);
    const [left, right] = await Promise.all([
      submitAttempt(ctx, actor, attempt.id),
      submitAttempt(ctx, actor, attempt.id),
    ]);
    expect(left.id).toBe(right.id);
    expect(calls).toHaveLength(1);
    expect(left).toMatchObject({ status: 'completed', submissionReason: 'user_submitted' });
    const view = toAttemptView(left);
    expect(view.items[0]).toMatchObject({ grade: { score: '10.00' }, gradingKey: { value: true } });
  });

  it('locks and grades one practice item without releasing other items early', async () => {
    const { db, ctx, calls, assessment, question } = await setup();
    const secondQuestion = {
      ...baseRecord(),
      ownerId: actor.userId,
      topicId: assessment.topicId,
      version: 1,
      definition,
      archivedAt: null,
    };
    await db.insert('questions', secondQuestion);
    await db.insert('questionVersions', {
      ...baseRecord(),
      ownerId: actor.userId,
      questionId: secondQuestion.id,
      version: 1,
      definition,
    });
    await db.update('assessments', assessment.id, assessment.revision, {
      items: [
        ...assessment.items,
        { questionId: secondQuestion.id, questionVersion: 1, maxScore: '5.00' },
      ],
    });
    const { attempt } = await startAssessment(ctx, actor, assessment.id, {});
    const saved = await submitPracticeItem(ctx, actor, attempt.id, attempt.items[0].id);
    expect(calls).toHaveLength(1);
    expect(saved.status).toBe('in_progress');
    const view = toAttemptView(saved);
    expect(view.items[0]).toHaveProperty('gradingKey');
    expect(view.items[1]).not.toHaveProperty('gradingKey');
    expect(view.items[1].grade).toBeNull();
    expect(question.id).not.toBe(secondQuestion.id);
  });

  it('expires attempts once and grades blanks as zero without creating wrong questions', async () => {
    const { db, ctx, calls, assessment } = await setup('exam');
    const { attempt } = await startAssessment(ctx, actor, assessment.id, {});
    await db.update('attempts', attempt.id, attempt.revision, {
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    await expireAttempts(ctx);
    await expireAttempts(ctx);
    const saved = await db.get('attempts', attempt.id);
    expect(saved).toMatchObject({ status: 'completed', submissionReason: 'time_expired' });
    expect(saved?.items[0].grade?.score).toBe('0.00');
    expect(calls).toHaveLength(1);
    expect(
      await db.findOne('wrongQuestions', {
        ownerId: actor.userId,
        questionId: assessment.items[0].questionId,
      }),
    ).toBeUndefined();
  });

  it('completes only the explicitly linked plan task on submission', async () => {
    const { db, ctx, assessment } = await setup();
    const linked = {
      id: id(),
      title: '完成练习',
      kind: 'practice' as const,
      targetId: assessment.id,
      scheduledDate: null,
      estimatedMinutes: null,
      status: 'todo' as const,
      completedAt: null,
    };
    const unrelated = { ...linked, id: id(), title: '另一任务', status: 'in_progress' as const };
    const plan = {
      ...baseRecord(),
      ownerId: actor.userId,
      topicId: assessment.topicId,
      title: '计划',
      phases: [{ id: id(), title: '阶段', tasks: [linked, unrelated] }],
      archivedAt: null,
    };
    await db.insert('plans', plan);
    const { attempt } = await startAssessment(ctx, actor, assessment.id, { taskId: linked.id });
    await saveAnswer(ctx, actor, attempt.id, attempt.items[0].id, {
      expectedRevision: 0,
      answer: { value: true },
    });
    await submitAttempt(ctx, actor, attempt.id);
    const saved = await db.get('plans', plan.id);
    const tasks = saved?.phases[0].tasks;
    expect(tasks?.find((task) => task.id === linked.id)).toMatchObject({ status: 'completed' });
    expect(tasks?.find((task) => task.id === unrelated.id)).toMatchObject({
      status: 'in_progress',
    });
  });
  it('does not allow cross-user attempts or saves', async () => {
    const { ctx, assessment } = await setup();
    const other: Actor = { ...actor, id: 'u2', userId: 'u2' };
    await expect(startAssessment(ctx, other, assessment.id, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const { attempt } = await startAssessment(ctx, actor, assessment.id, {});
    await expect(
      saveAnswer(ctx, other, attempt.id, attempt.items[0].id, {
        expectedRevision: 0,
        answer: { value: true },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('links a reused attempt to one plan task and rejects a conflicting task', async () => {
    const { db, ctx, assessment } = await setup();
    const { attempt } = await startAssessment(ctx, actor, assessment.id, {});
    const linked = {
      id: id(),
      title: '从计划继续练习',
      kind: 'practice' as const,
      targetId: assessment.id,
      scheduledDate: null,
      estimatedMinutes: null,
      status: 'todo' as const,
      completedAt: null,
    };
    const conflicting = { ...linked, id: id(), title: '另一练习任务' };
    const plan = {
      ...baseRecord(),
      ownerId: actor.userId,
      topicId: assessment.topicId,
      title: '计划',
      phases: [{ id: id(), title: '阶段', tasks: [linked, conflicting] }],
      archivedAt: null,
    };
    await db.insert('plans', plan);

    const resumed = await startAssessment(ctx, actor, assessment.id, { taskId: linked.id });
    expect(resumed).toMatchObject({ created: false, attempt: { id: attempt.id } });
    let saved = await db.get('plans', plan.id);
    expect(saved?.phases[0].tasks.find((task) => task.id === linked.id)).toMatchObject({
      status: 'in_progress',
    });
    await expect(
      startAssessment(ctx, actor, assessment.id, { taskId: conflicting.id }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_TASK_CONFLICT' });

    await saveAnswer(ctx, actor, attempt.id, attempt.items[0].id, {
      expectedRevision: 0,
      answer: { value: true },
    });
    await submitAttempt(ctx, actor, attempt.id);
    saved = await db.get('plans', plan.id);
    expect(saved?.phases[0].tasks.find((task) => task.id === linked.id)).toMatchObject({
      status: 'completed',
    });
    expect(saved?.phases[0].tasks.find((task) => task.id === conflicting.id)).toMatchObject({
      status: 'todo',
      completedAt: null,
    });
  });
});
