import { voidAttempt } from './attempts.js';
import { isLearningAttempt } from './attempt-policy.js';
import type { FastifyInstance } from 'fastify';
import type { AssessmentItem, LearningTask, PlanPhase } from '@drill-hub/contracts';
import { API_VERSION } from '@drill-hub/contracts';
import type { AppContext } from '../../core/context.js';
import { baseRecord, now } from '../../core/ids.js';
import type { Database } from '../../db/database.js';
import { changeArchiveState, listArchive } from './archive.js';
import {
  API_PREFIX,
  archiveState,
  assert,
  body,
  checkRevision,
  expectedRevision,
  isRecord,
  matchesArchive,
  optionalScheduledDate,
  optionalString,
  owned,
  ownedTopic,
  params,
  positiveInteger,
  query,
  requiredString,
  type JsonObject,
} from './common.js';
import { findTaskLocation, normalizePhases, replaceTask } from './plans.js';
import { questionDefinition, validateScoringConfiguration } from './question-utils.js';

function kind(value: unknown): 'practice' | 'exam' {
  assert(
    value === 'practice' || value === 'exam',
    'INVALID_ASSESSMENT_KIND',
    '评估类型必须是 practice 或 exam',
  );
  return value;
}

function duration(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  return positiveInteger(value, 'durationSeconds', 31_536_000);
}

async function normalizeAssessmentItems(
  db: Database,
  ownerId: string,
  topicId: string,
  input: unknown,
): Promise<AssessmentItem[]> {
  assert(
    Array.isArray(input) && input.length > 0 && input.length <= 200,
    'INVALID_ITEMS',
    'items 必须包含 1 至 200 项',
  );
  const seen = new Set<string>();
  const result: AssessmentItem[] = [];
  for (const raw of input) {
    assert(isRecord(raw), 'INVALID_ITEM', '试卷题目格式无效');
    const questionId = requiredString(raw, 'questionId', 128);
    assert(!seen.has(questionId), 'DUPLICATE_QUESTION', '同一试卷不能重复题目');
    seen.add(questionId);
    const questionVersion = positiveInteger(raw.questionVersion, 'questionVersion', 1_000_000);
    const question = await owned(db, 'questions', questionId, ownerId);
    assert(question.topicId === topicId, 'QUESTION_TOPIC_MISMATCH', '题目不属于当前主题', 422);
    assert(question.archivedAt === null, 'QUESTION_ARCHIVED', '已归档题目不能加入新试卷', 409);
    const version = await db.findOne('questionVersions', {
      ownerId,
      questionId,
      version: questionVersion,
    });
    assert(version, 'QUESTION_VERSION_NOT_FOUND', '指定的题目版本不存在', 422);
    const maxScore = validateScoringConfiguration(version.definition, raw.maxScore);
    result.push({ questionId, questionVersion, maxScore });
  }
  return result;
}

function hasAny(input: JsonObject, keys: string[]): boolean {
  return keys.some((key) => input[key] !== undefined);
}

export function registerAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(`${API_PREFIX}/agent/capabilities`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    return {
      data: {
        apiVersion: API_VERSION,
        scopes: actor.scopes,
        questionTypes: [
          'single_choice',
          'multiple_choice',
          'true_false',
          'fill_blank',
          'short_answer',
        ],
        gradingModes: ['rule', 'model_rubric', 'external_rubric'],
        limitations: [
          '主题和题干仅支持纯文本',
          '无永久删除',
          '无自由写分',
          '无客户端分页游标',
          '无通用创建幂等键',
          '免登录链接正式作答计入链接所属用户学习记录',
          '测试及作废作答不计学习统计',
        ],
      },
    };
  });

  app.get(`${API_PREFIX}/agent/topics`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    const state = archiveState(query(request).archiveState);
    const records = await ctx.db.list('topics', { ownerId: actor.userId });
    return { data: records.filter((record) => matchesArchive(record, state)) };
  });

  app.post(`${API_PREFIX}/agent/topics`, async (request, reply) => {
    const actor = await ctx.requireAgent(request, 'content:write');
    const input = body(request);
    const topic = {
      ...baseRecord(),
      ownerId: actor.userId,
      title: requiredString(input, 'title', 500),
      goalText: optionalString(input, 'goalText', '', 100000, true),
      archivedAt: null,
    };
    await ctx.db.transaction(async (tx) => {
      await tx.insert('topics', topic);
      await ctx.audit(actor, 'topic.create', 'topic', topic.id, {}, tx);
    });
    reply.code(201);
    return { data: topic };
  });

  app.patch(`${API_PREFIX}/agent/topics/:id`, async (request) => {
    const actor = await ctx.requireAgent(request, 'content:write');
    const input = body(request);
    const revision = expectedRevision(input);
    assert(hasAny(input, ['title', 'goalText']), 'EMPTY_UPDATE', '没有可更新字段', 400);
    const saved = await ctx.db.transaction(async (tx) => {
      const topic = await owned(tx, 'topics', params(request).id, actor.userId);
      checkRevision(topic, revision);
      assert(topic.archivedAt === null, 'TOPIC_ARCHIVED', '主题已归档', 409);
      const updated = await tx.update('topics', topic.id, topic.revision, {
        title: optionalString(input, 'title', topic.title, 500),
        goalText: optionalString(input, 'goalText', topic.goalText, 100000, true),
      });
      await ctx.audit(actor, 'topic.update', 'topic', topic.id, {}, tx);
      return updated;
    });
    return { data: saved };
  });

  app.get(`${API_PREFIX}/agent/topics/:id/plans`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    const topic = await ownedTopic(ctx.db, params(request).id, actor.userId);
    const state = archiveState(query(request).archiveState);
    const records = await ctx.db.list('plans', { ownerId: actor.userId, topicId: topic.id });
    return { data: records.filter((record) => matchesArchive(record, state)) };
  });

  app.post(`${API_PREFIX}/agent/topics/:id/plans`, async (request, reply) => {
    const actor = await ctx.requireAgent(request, 'content:write');
    const input = body(request);
    const plan = await ctx.db.transaction(async (tx) => {
      const topic = await ownedTopic(tx, params(request).id, actor.userId, true);
      const record = {
        ...baseRecord(),
        ownerId: actor.userId,
        topicId: topic.id,
        title: requiredString(input, 'title', 500),
        phases: await normalizePhases(tx, actor.userId, topic.id, input.phases ?? []),
        archivedAt: null,
      };
      await tx.insert('plans', record);
      await ctx.audit(actor, 'plan.create', 'plan', record.id, {}, tx);
      return record;
    });
    reply.code(201);
    return { data: plan };
  });

  app.patch(`${API_PREFIX}/agent/plans/:id`, async (request) => {
    const actor = await ctx.requireAgent(request, 'content:write');
    const input = body(request);
    const revision = expectedRevision(input);
    assert(hasAny(input, ['title', 'phases']), 'EMPTY_UPDATE', '没有可更新字段', 400);
    const saved = await ctx.db.transaction(async (tx) => {
      const plan = await owned(tx, 'plans', params(request).id, actor.userId);
      checkRevision(plan, revision);
      assert(plan.archivedAt === null, 'PLAN_ARCHIVED', '计划已归档', 409);
      await ownedTopic(tx, plan.topicId, actor.userId, true);
      const phases =
        input.phases === undefined
          ? plan.phases
          : await normalizePhases(tx, actor.userId, plan.topicId, input.phases, plan);
      const updated = await tx.update('plans', plan.id, plan.revision, {
        title: optionalString(input, 'title', plan.title, 500),
        phases,
      });
      await ctx.audit(actor, 'plan.update', 'plan', plan.id, {}, tx);
      return updated;
    });
    return { data: saved };
  });

  app.patch(`${API_PREFIX}/agent/tasks/:id`, async (request) => {
    const actor = await ctx.requireAgent(request, 'content:write');
    const input = body(request);
    const revision = expectedRevision(input);
    const allowedStatus =
      input.status === undefined ||
      input.status === 'todo' ||
      input.status === 'in_progress' ||
      input.status === 'completed';
    assert(allowedStatus, 'INVALID_TASK_STATUS', '任务状态无效');
    const updatedTask = await ctx.db.transaction(async (tx) => {
      const location = await findTaskLocation(tx, actor.userId, params(request).id);
      checkRevision(location.plan, revision);
      assert(location.plan.archivedAt === null, 'PLAN_ARCHIVED', '计划已归档', 409);
      const status = (input.status ?? location.task.status) as LearningTask['status'];
      const startsAssessmentCompletion =
        status === 'completed' &&
        location.task.status !== 'completed' &&
        (location.task.kind === 'practice' || location.task.kind === 'exam');
      assert(
        !startsAssessmentCompletion,
        'TASK_KIND_NOT_COMPLETABLE',
        '练习和考试任务由提交自动完成',
        409,
      );
      const replacement: LearningTask = {
        ...location.task,
        title: optionalString(input, 'title', location.task.title, 500),
        scheduledDate:
          input.scheduledDate === undefined
            ? location.task.scheduledDate
            : optionalScheduledDate(input.scheduledDate),
        estimatedMinutes:
          input.estimatedMinutes === undefined
            ? location.task.estimatedMinutes
            : input.estimatedMinutes === null
              ? null
              : positiveInteger(input.estimatedMinutes, 'estimatedMinutes', 100000),
        status,
        completedAt: status === 'completed' ? (location.task.completedAt ?? now()) : null,
      };
      let phases: PlanPhase[];
      if (input.phaseId !== undefined || input.position !== undefined) {
        assert(typeof input.phaseId === 'string', 'INVALID_PHASE', '移动任务时必须提供 phaseId');
        assert(
          location.plan.phases.some((phase) => phase.id === input.phaseId),
          'INVALID_PHASE',
          '目标阶段不存在',
          422,
        );
        const without = location.plan.phases.map((phase) => ({
          ...phase,
          tasks: phase.tasks.filter((task) => task.id !== replacement.id),
        }));
        const target = without.find((phase) => phase.id === input.phaseId);
        assert(target, 'INVALID_PHASE', '目标阶段不存在', 422);
        const position = input.position === undefined ? target.tasks.length : input.position;
        assert(
          Number.isInteger(position) &&
            (position as number) >= 0 &&
            (position as number) <= target.tasks.length,
          'INVALID_POSITION',
          '任务位置无效',
        );
        target.tasks.splice(position as number, 0, replacement);
        phases = without;
      } else {
        phases = replaceTask(location.plan, location.task.id, replacement);
      }
      await tx.update('plans', location.plan.id, location.plan.revision, { phases });
      await ctx.audit(
        actor,
        'task.update',
        'plan',
        location.plan.id,
        { taskId: replacement.id },
        tx,
      );
      return replacement;
    });
    return { data: updatedTask };
  });

  app.get(`${API_PREFIX}/agent/topics/:id/contents`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    const topic = await ownedTopic(ctx.db, params(request).id, actor.userId);
    const state = archiveState(query(request).archiveState);
    const records = await ctx.db.list('contents', { ownerId: actor.userId, topicId: topic.id });
    return { data: records.filter((record) => matchesArchive(record, state)) };
  });

  app.post(`${API_PREFIX}/agent/topics/:id/contents`, async (request, reply) => {
    const actor = await ctx.requireAgent(request, 'content:write');
    const input = body(request);
    const content = await ctx.db.transaction(async (tx) => {
      const topic = await ownedTopic(tx, params(request).id, actor.userId, true);
      const record = {
        ...baseRecord(),
        ownerId: actor.userId,
        topicId: topic.id,
        title: requiredString(input, 'title', 500),
        bodyText: requiredString(input, 'bodyText', 1_000_000),
        archivedAt: null,
      };
      await tx.insert('contents', record);
      await ctx.audit(actor, 'content.create', 'content', record.id, {}, tx);
      return record;
    });
    reply.code(201);
    return { data: content };
  });

  app.patch(`${API_PREFIX}/agent/contents/:id`, async (request) => {
    const actor = await ctx.requireAgent(request, 'content:write');
    const input = body(request);
    const revision = expectedRevision(input);
    assert(hasAny(input, ['title', 'bodyText']), 'EMPTY_UPDATE', '没有可更新字段', 400);
    const saved = await ctx.db.transaction(async (tx) => {
      const content = await owned(tx, 'contents', params(request).id, actor.userId);
      checkRevision(content, revision);
      assert(content.archivedAt === null, 'CONTENT_ARCHIVED', '内容已归档', 409);
      await ownedTopic(tx, content.topicId, actor.userId, true);
      const updated = await tx.update('contents', content.id, content.revision, {
        title: optionalString(input, 'title', content.title, 500),
        bodyText: optionalString(input, 'bodyText', content.bodyText, 1_000_000),
      });
      await ctx.audit(actor, 'content.update', 'content', content.id, {}, tx);
      return updated;
    });
    return { data: saved };
  });

  app.get(`${API_PREFIX}/agent/topics/:id/questions`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    const topic = await ownedTopic(ctx.db, params(request).id, actor.userId);
    const state = archiveState(query(request).archiveState);
    const questions = await ctx.db.list('questions', { ownerId: actor.userId, topicId: topic.id });
    const result = [];
    for (const question of questions) {
      if (!matchesArchive(question, state)) continue;
      const versions = await ctx.db.list('questionVersions', {
        ownerId: actor.userId,
        questionId: question.id,
      });
      result.push({
        ...question,
        versions: versions.sort((left, right) => right.version - left.version),
      });
    }
    return { data: result };
  });

  app.post(`${API_PREFIX}/agent/topics/:id/questions/batch`, async (request, reply) => {
    const actor = await ctx.requireAgent(request, 'content:write');
    const input = body(request);
    const rawItems = input.items;
    assert(
      Array.isArray(rawItems) && rawItems.length > 0 && rawItems.length <= 100,
      'INVALID_ITEMS',
      '批量题目必须为 1 至 100 项',
    );
    const result = await ctx.db.transaction(async (tx) => {
      const topic = await ownedTopic(tx, params(request).id, actor.userId, true);
      const created = [];
      const clientRefs = new Set<string>();
      for (const raw of rawItems) {
        assert(isRecord(raw), 'INVALID_QUESTION', '题目格式无效');
        const clientRef =
          raw.clientRef === undefined ? undefined : requiredString(raw, 'clientRef', 128);
        if (clientRef !== undefined) {
          assert(!clientRefs.has(clientRef), 'DUPLICATE_CLIENT_REF', 'clientRef 不能重复');
          clientRefs.add(clientRef);
        }
        const { clientRef: _clientRef, ...definitionInput } = raw;
        const definition = questionDefinition(definitionInput);
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
          definition: questionDefinition(definition),
        };
        await tx.insert('questions', question);
        await tx.insert('questionVersions', version);
        created.push({
          clientRef: clientRef ?? null,
          questionId: question.id,
          questionRevisionId: version.id,
          revision: question.revision,
          webUrl: `/topics/${topic.id}`,
        });
      }
      await ctx.audit(
        actor,
        'question.batch-create',
        'topic',
        topic.id,
        { count: created.length },
        tx,
      );
      return created;
    });
    reply.code(201);
    return { data: result };
  });

  app.patch(`${API_PREFIX}/agent/questions/:id`, async (request) => {
    const actor = await ctx.requireAgent(request, 'content:write');
    const input = body(request);
    const revision = expectedRevision(input);
    const saved = await ctx.db.transaction(async (tx) => {
      const question = await owned(tx, 'questions', params(request).id, actor.userId);
      checkRevision(question, revision);
      assert(question.archivedAt === null, 'QUESTION_ARCHIVED', '题目已归档', 409);
      await ownedTopic(tx, question.topicId, actor.userId, true);
      const {
        expectedRevision: _expectedRevision,
        definition: nestedDefinition,
        ...flatDefinition
      } = input;
      const definition = questionDefinition(nestedDefinition ?? flatDefinition);
      const version = {
        ...baseRecord(),
        ownerId: actor.userId,
        questionId: question.id,
        version: question.version + 1,
        definition,
      };
      await tx.insert('questionVersions', version);
      const updated = await tx.update('questions', question.id, question.revision, {
        version: version.version,
        definition,
      });
      await ctx.audit(
        actor,
        'question.new-version',
        'question',
        question.id,
        { version: version.version },
        tx,
      );
      return updated;
    });
    return { data: saved };
  });

  app.get(`${API_PREFIX}/agent/topics/:id/assessments`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    const topic = await ownedTopic(ctx.db, params(request).id, actor.userId);
    const state = archiveState(query(request).archiveState);
    const records = await ctx.db.list('assessments', { ownerId: actor.userId, topicId: topic.id });
    return { data: records.filter((record) => matchesArchive(record, state)) };
  });

  app.post(`${API_PREFIX}/agent/topics/:id/assessments`, async (request, reply) => {
    const actor = await ctx.requireAgent(request, 'assessment:write');
    const input = body(request);
    const assessment = await ctx.db.transaction(async (tx) => {
      const topic = await ownedTopic(tx, params(request).id, actor.userId, true);
      const record = {
        ...baseRecord(),
        ownerId: actor.userId,
        topicId: topic.id,
        kind: kind(input.kind),
        title: requiredString(input, 'title', 500),
        durationSeconds: duration(input.durationSeconds, null),
        items: await normalizeAssessmentItems(tx, actor.userId, topic.id, input.items),
        archivedAt: null,
      };
      await tx.insert('assessments', record);
      await ctx.audit(actor, 'assessment.create', 'assessment', record.id, {}, tx);
      return record;
    });
    reply.code(201);
    return { data: assessment };
  });

  app.patch(`${API_PREFIX}/agent/assessments/:id`, async (request) => {
    const actor = await ctx.requireAgent(request, 'assessment:write');
    const input = body(request);
    const revision = expectedRevision(input);
    assert(
      hasAny(input, ['kind', 'title', 'durationSeconds', 'items']),
      'EMPTY_UPDATE',
      '没有可更新字段',
      400,
    );
    const saved = await ctx.db.transaction(async (tx) => {
      const assessment = await owned(tx, 'assessments', params(request).id, actor.userId);
      checkRevision(assessment, revision);
      assert(assessment.archivedAt === null, 'ASSESSMENT_ARCHIVED', '练习或考试已归档', 409);
      await ownedTopic(tx, assessment.topicId, actor.userId, true);
      const updated = await tx.update('assessments', assessment.id, assessment.revision, {
        kind: input.kind === undefined ? assessment.kind : kind(input.kind),
        title: optionalString(input, 'title', assessment.title, 500),
        durationSeconds: duration(input.durationSeconds, assessment.durationSeconds),
        items:
          input.items === undefined
            ? assessment.items
            : await normalizeAssessmentItems(tx, actor.userId, assessment.topicId, input.items),
      });
      await ctx.audit(actor, 'assessment.update', 'assessment', assessment.id, {}, tx);
      return updated;
    });
    return { data: saved };
  });

  app.get(`${API_PREFIX}/agent/learning-summary`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    const since = query(request).since;
    assert(
      since === undefined || (typeof since === 'string' && !Number.isNaN(Date.parse(since))),
      'INVALID_SINCE',
      'since 必须是 ISO 时间',
      400,
    );
    const after = typeof since === 'string' ? since : null;
    const topics = await ctx.db.list('topics', { ownerId: actor.userId });
    const plans = await ctx.db.list('plans', { ownerId: actor.userId });
    const attempts = (await ctx.db.list('attempts', { ownerId: actor.userId })).filter(
      isLearningAttempt,
    );
    const wrongQuestions = await ctx.db.list('wrongQuestions', { ownerId: actor.userId });
    const recent = <T extends { updatedAt: string }>(records: T[]) =>
      records.filter((record) => !after || record.updatedAt >= after);
    return {
      data: {
        topics: recent(topics),
        plans: recent(plans),
        recentAttempts: recent(attempts),
        wrongQuestions: recent(wrongQuestions),
      },
    };
  });

  app.get(`${API_PREFIX}/agent/attempts`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    const filters = query(request);
    const records = await ctx.db.list('attempts', { ownerId: actor.userId });
    return {
      data: records.filter(
        (record) =>
          (filters.status === undefined || record.status === filters.status) &&
          (filters.topicId === undefined || record.topicId === filters.topicId) &&
          (filters.assessmentId === undefined || record.assessmentId === filters.assessmentId),
      ),
    };
  });

  app.post(`${API_PREFIX}/agent/attempts/:id/void`, async (request) => {
    const actor = await ctx.requireAgent(request, 'attempt:write');
    return { data: await voidAttempt(ctx, actor, params(request).id, body(request)) };
  });

  app.get(`${API_PREFIX}/agent/attempts/:id`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    // Agent scope explicitly permits frozen answers, rubrics and grading history.
    return { data: await owned(ctx.db, 'attempts', params(request).id, actor.userId) };
  });

  app.get(`${API_PREFIX}/agent/wrong-questions`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    const filters = query(request);
    const records = await ctx.db.list('wrongQuestions', { ownerId: actor.userId });
    return {
      data: records.filter(
        (record) =>
          (filters.topicId === undefined || record.topicId === filters.topicId) &&
          (filters.masteryStatus === undefined || record.masteryStatus === filters.masteryStatus),
      ),
    };
  });

  app.patch(`${API_PREFIX}/agent/wrong-questions/:questionId/mastery`, async (request) => {
    const actor = await ctx.requireAgent(request, 'content:write');
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

  app.get(`${API_PREFIX}/agent/archive`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    return { data: await listArchive(ctx.db, actor.userId, query(request).resourceType) };
  });

  app.post(`${API_PREFIX}/agent/resources/:type/:id/archive`, async (request) => {
    const actor = await ctx.requireAgent(request, 'archive:write');
    const saved = await changeArchiveState(
      ctx,
      actor,
      params(request).type,
      params(request).id,
      true,
      body(request),
    );
    return { data: saved };
  });

  app.post(`${API_PREFIX}/agent/resources/:type/:id/restore`, async (request) => {
    const actor = await ctx.requireAgent(request, 'archive:write');
    const saved = await changeArchiveState(
      ctx,
      actor,
      params(request).type,
      params(request).id,
      false,
      body(request),
    );
    return { data: saved };
  });
}
