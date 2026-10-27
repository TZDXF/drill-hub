import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AGENT_SCOPES } from '@drill-hub/contracts';
import { createApp } from '#server/app.js';
import { createUser } from '#server/modules/auth/index.js';
import { baseRecord, id } from '#server/core/ids.js';
import { hashSecret, randomSecret } from '#server/core/security.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup() {
  const app = await createApp({
    databasePath: ':memory:',
    encryptionKey: 'ab'.repeat(32),
    startWorkers: false,
  });
  apps.push(app);
  const user = await createUser(app.ctx.db, {
    username: 'learner',
    password: 'LearningPass123!',
    mustChangePassword: false,
  });
  const other = await createUser(app.ctx.db, {
    username: 'other',
    password: 'LearningPass123!',
    mustChangePassword: false,
  });
  async function login(username: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/login',
      payload: { username, password: 'LearningPass123!' },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data.accessToken as string;
  }
  const accessToken = await login('learner');
  const otherAccessToken = await login('other');
  const agentToken = `dhk.${id()}.${randomSecret()}`;
  await app.ctx.db.insert('agentTokens', {
    ...baseRecord(),
    ownerId: user.id,
    name: 'test',
    prefix: agentToken.slice(0, 12),
    secretHash: hashSecret(agentToken),
    encryptedSecret: app.ctx.vault.encrypt(agentToken),
    scopes: AGENT_SCOPES,
    expiresAt: null,
    lastUsedAt: null,
  });
  const agent = { authorization: `Bearer ${agentToken}` };
  const learner = { authorization: `Bearer ${accessToken}` };
  const otherLearner = { authorization: `Bearer ${otherAccessToken}` };
  async function createTopic() {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/topics',
      headers: agent,
      payload: { title: '数据库', goalText: '理解事务' },
    });
    expect(response.statusCode).toBe(201);
    return response.json().data;
  }
  return { app, user, other, agent, learner, otherLearner, createTopic };
}

const ruleDefinition = {
  type: 'true_false',
  stem: '事务具有原子性',
  gradingMode: 'rule',
  gradingKey: { value: true },
  referenceAnswer: '正确',
  explanation: '事务作为整体提交或回滚',
  tags: ['transaction'],
};

async function createQuestion(
  app: FastifyInstance,
  agent: Record<string, string>,
  topicId: string,
  definition: unknown = ruleDefinition,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agent/topics/${topicId}/questions/batch`,
    headers: agent,
    payload: { items: [{ clientRef: 'q1', ...(definition as Record<string, unknown>) }] },
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().data[0]).toEqual({
    clientRef: 'q1',
    questionId: expect.any(String),
    questionRevisionId: expect.any(String),
    revision: expect.any(Number),
    webUrl: `/topics/${topicId}`,
  });
  return response.json().data[0];
}

async function createAssessment(
  app: FastifyInstance,
  agent: Record<string, string>,
  topicId: string,
  questionId: string,
  kind: 'practice' | 'exam' = 'exam',
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agent/topics/${topicId}/assessments`,
    headers: agent,
    payload: {
      kind,
      title: kind === 'exam' ? '期末考试' : '练习',
      durationSeconds: 3600,
      items: [{ questionId, questionVersion: 1, maxScore: '10.00' }],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data;
}

const forbiddenQuestionFacts = [
  'ownerId',
  'score',
  'maxScore',
  'correct',
  'submittedAt',
  'gradingStatus',
  'answerStatus',
  'startedAt',
  'answerLinkId',
  'voidedAt',
  'voidedBy',
  'voidReason',
];

describe('question definition trust boundary', () => {
  it('rejects every client fact in batch items and envelopes without partial writes', async () => {
    const { app, agent, createTopic } = await setup();
    const topic = await createTopic();
    const auditBefore = await app.ctx.db.list('auditLogs');
    for (const field of forbiddenQuestionFacts) {
      for (const value of ['forged', null, false, 0]) {
        for (const payload of [
          {
            items: [
              { ...ruleDefinition, clientRef: 'valid' },
              { ...ruleDefinition, clientRef: 'invalid', [field]: value },
            ],
          },
          { items: [ruleDefinition], [field]: value },
        ]) {
          const response = await app.inject({
            method: 'POST',
            url: `/api/v1/agent/topics/${topic.id}/questions/batch`,
            headers: agent,
            payload,
          });
          expect(response.statusCode).toBe(422);
          expect(response.json().error).toMatchObject({
            code: 'CLIENT_FACT_FORBIDDEN',
            fields: { [field]: '该字段由服务端确定' },
          });
          expect(await app.ctx.db.list('questions')).toEqual([]);
          expect(await app.ctx.db.list('questionVersions')).toEqual([]);
        }
      }
    }
    expect(await app.ctx.db.list('auditLogs')).toEqual(auditBefore);
  });

  it('rejects facts in flat, nested and outer PATCH payloads without changing frozen data', async () => {
    const { app, agent, learner, createTopic } = await setup();
    const topic = await createTopic();
    const question = await createQuestion(app, agent, topic.id);
    const assessment = await createAssessment(app, agent, topic.id, question.questionId);
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${assessment.id}/attempts`,
      headers: learner,
      payload: {},
    });
    expect(started.statusCode).toBe(201);
    const original = await app.ctx.db.get('questions', question.questionId);
    const versions = await app.ctx.db.list('questionVersions');
    const attempts = await app.ctx.db.list('attempts');
    const audits = await app.ctx.db.list('auditLogs');
    for (const field of forbiddenQuestionFacts) {
      for (const value of ['forged', null, false, 0]) {
        for (const payload of [
          { expectedRevision: 1, ...ruleDefinition, [field]: value },
          { expectedRevision: 1, definition: { ...ruleDefinition, [field]: value } },
          { expectedRevision: 1, definition: ruleDefinition, [field]: value },
        ]) {
          const response = await app.inject({
            method: 'PATCH',
            url: `/api/v1/agent/questions/${question.questionId}`,
            headers: agent,
            payload,
          });
          expect(response.statusCode).toBe(422);
          expect(response.json().error).toMatchObject({
            code: 'CLIENT_FACT_FORBIDDEN',
            fields: { [field]: '该字段由服务端确定' },
          });
          expect(await app.ctx.db.get('questions', question.questionId)).toEqual(original);
          expect(await app.ctx.db.list('questionVersions')).toEqual(versions);
          expect(await app.ctx.db.list('attempts')).toEqual(attempts);
        }
      }
    }
    expect(await app.ctx.db.list('auditLogs')).toEqual(audits);
  });

  it('creates new versions without changing historical definitions, grades or assessment pins', async () => {
    const { app, agent, learner, createTopic } = await setup();
    const topic = await createTopic();
    const question = await createQuestion(app, agent, topic.id);
    const assessment = await createAssessment(app, agent, topic.id, question.questionId);
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${assessment.id}/attempts`,
      headers: learner,
      payload: {},
    });
    expect(started.statusCode).toBe(201);
    const attempt = started.json().data;
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/attempts/${attempt.id}/answers/${attempt.items[0].id}`,
      headers: learner,
      payload: { expectedRevision: 0, answer: { value: true } },
    });
    expect(saved.statusCode).toBe(200);
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attempt.id}/submit`,
      headers: learner,
      payload: {},
    });
    expect(submitted.statusCode).toBe(200);
    const frozenAttempt = await app.ctx.db.get('attempts', attempt.id);
    expect(frozenAttempt?.items[0].grade?.score).toBe('10.00');
    const firstVersion = await app.ctx.db.get('questionVersions', question.questionRevisionId);
    const secondDefinition = { ...ruleDefinition, stem: '新题干', gradingKey: { value: false } };
    const second = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agent/questions/${question.questionId}`,
      headers: agent,
      payload: { expectedRevision: 1, definition: secondDefinition },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({
      version: 2,
      revision: 2,
      definition: secondDefinition,
    });
    const secondVersion = await app.ctx.db.findOne('questionVersions', {
      questionId: question.questionId,
      version: 2,
    });
    const thirdDefinition = { ...secondDefinition, stem: '第三版题干' };
    const third = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agent/questions/${question.questionId}`,
      headers: agent,
      payload: { expectedRevision: 2, ...thirdDefinition },
    });
    expect(third.statusCode).toBe(200);
    expect(third.json().data).toMatchObject({
      version: 3,
      revision: 3,
      definition: thirdDefinition,
    });
    expect(await app.ctx.db.get('questionVersions', question.questionRevisionId)).toEqual(
      firstVersion,
    );
    expect(await app.ctx.db.get('questionVersions', secondVersion!.id)).toEqual(secondVersion);
    expect(await app.ctx.db.list('questionVersions')).toHaveLength(3);
    expect(await app.ctx.db.get('attempts', attempt.id)).toEqual(frozenAttempt);
    expect(await app.ctx.db.get('assessments', assessment.id)).toEqual(assessment);
    const agentView = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/attempts/${attempt.id}`,
      headers: agent,
    });
    expect(agentView.statusCode).toBe(200);
    expect(agentView.json().data).toEqual(frozenAttempt);
    const next = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${assessment.id}/attempts`,
      headers: learner,
      payload: {},
    });
    expect(next.statusCode).toBe(201);
    const nextAttempt = await app.ctx.db.get('attempts', next.json().data.id);
    expect(nextAttempt?.items[0]).toMatchObject({
      questionVersion: 1,
      definition: ruleDefinition,
      maxScore: '10.00',
    });
  });
});

describe('learning HTTP closed loop', () => {
  it('rejects nested client facts and preserves historical retry scores', async () => {
    const { app, agent, learner, createTopic } = await setup();
    const topic = await createTopic();
    const question = await createQuestion(app, agent, topic.id);
    const assessment = await createAssessment(app, agent, topic.id, question.questionId);
    const start = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${assessment.id}/attempts`,
      headers: learner,
      payload: {},
    });
    const attempt = start.json().data;
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/attempts/${attempt.id}/answers/${attempt.items[0].id}`,
      headers: learner,
      payload: { expectedRevision: 0, answer: { value: false } },
    });
    expect(saved.statusCode).toBe(200);
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attempt.id}/submit`,
      headers: learner,
      payload: {},
    });
    expect(submitted.statusCode).toBe(200);
    const count = (await app.ctx.db.list('attempts')).length;
    for (const field of ['maxScore', 'score', 'correct', 'submittedAt', 'ownerId', 'grade']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/wrong-question-practices',
        headers: learner,
        payload: { items: [{ questionId: question.questionId, [field]: '1000000.00' }] },
      });
      expect(response.statusCode).toBe(422);
      expect((await app.ctx.db.list('attempts')).length).toBe(count);
    }
    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/wrong-question-practices',
      headers: learner,
      payload: { items: [{ questionId: question.questionId }] },
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().data.items[0].maxScore).toBe('10.00');
    const forgedAssessment = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/topics/${topic.id}/assessments`,
      headers: agent,
      payload: {
        kind: 'exam',
        title: '伪造',
        items: [
          {
            questionId: question.questionId,
            questionVersion: 1,
            maxScore: '10.00',
            score: '10.00',
          },
        ],
      },
    });
    expect(forgedAssessment.statusCode).toBe(422);
    const forgedQuestion = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/topics/${topic.id}/questions/batch`,
      headers: agent,
      payload: { items: [{ ...ruleDefinition, score: '10.00' }] },
    });
    expect(forgedQuestion.statusCode).toBe(422);
  });
  it('creates real resources and never leaks rule answers before exam submission', async () => {
    const { app, agent, learner, otherLearner, createTopic } = await setup();
    const topic = await createTopic();
    const question = await createQuestion(app, agent, topic.id);
    const assessment = await createAssessment(app, agent, topic.id, question.questionId);
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${assessment.id}/attempts`,
      headers: learner,
      payload: {},
    });
    expect(started.statusCode).toBe(201);
    const attempt = started.json().data;
    expect(attempt.items[0]).not.toHaveProperty('definition');
    expect(attempt.items[0]).not.toHaveProperty('rubric');
    expect(attempt.items[0]).not.toHaveProperty('gradingKey');
    expect(attempt.items[0]).not.toHaveProperty('referenceAnswer');
    expect(attempt.items[0]).not.toHaveProperty('explanation');
    const itemId = attempt.items[0].id;
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/attempts/${attempt.id}/answers/${itemId}`,
      headers: learner,
      payload: { expectedRevision: 0, answer: { value: true } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ answerRevision: 1, answer: { value: true } });
    expect(saved.json().data).not.toHaveProperty('gradingKey');
    expect(await app.ctx.db.list('gradingJobs', { attemptId: attempt.id })).toHaveLength(0);
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attempt.id}/submit`,
      headers: learner,
      payload: {},
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().data).toMatchObject({
      status: 'completed',
      submissionReason: 'user_submitted',
    });
    expect(submitted.json().data.items[0]).toMatchObject({
      grade: { score: '10.00' },
      gradingKey: { value: true },
      referenceAnswer: '正确',
    });
    const report = await app.inject({
      method: 'GET',
      url: `/api/v1/attempts/${attempt.id}/report`,
      headers: learner,
    });
    expect(report.json().data).toMatchObject({
      awardedScore: '10.00',
      pendingMaxScore: '0.00',
      isFinal: true,
    });
    const agentView = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/attempts/${attempt.id}`,
      headers: agent,
    });
    expect(agentView.json().data.items[0].definition.gradingKey).toEqual({ value: true });
    const crossUser = await app.inject({
      method: 'GET',
      url: `/api/v1/attempts/${attempt.id}`,
      headers: otherLearner,
    });
    expect(crossUser.statusCode).toBe(404);
    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attempt.id}/submit`,
      headers: learner,
      payload: {},
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.revision).toBe(submitted.json().data.revision);
  });

  it('queues model grading only after overall submission and keeps pending scores visible', async () => {
    const { app, agent, learner, createTopic } = await setup();
    const topic = await createTopic();
    const modelDefinition = {
      type: 'short_answer',
      stem: '解释原子性',
      gradingMode: 'model_rubric',
      referenceAnswer: '全部成功或全部回滚',
      rubric: {
        version: 1,
        criteria: [
          {
            id: 'atomicity',
            description: '说明整体成功或回滚',
            weight: 1,
            levels: [
              { id: 'not_met', creditBps: 0, description: '未说明' },
              { id: 'met', creditBps: 10000, description: '说明准确' },
            ],
          },
        ],
      },
    };
    const question = await createQuestion(app, agent, topic.id, modelDefinition);
    const assessment = await createAssessment(app, agent, topic.id, question.questionId);
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${assessment.id}/attempts`,
      headers: learner,
      payload: {},
    });
    const attempt = started.json().data;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/attempts/${attempt.id}/answers/${attempt.items[0].id}`,
      headers: learner,
      payload: { expectedRevision: 0, answer: { text: '事务中的操作一起成功或一起回滚。' } },
    });
    expect(await app.ctx.db.list('gradingJobs', { attemptId: attempt.id })).toHaveLength(0);
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attempt.id}/submit`,
      headers: learner,
      payload: {},
    });
    expect(submitted.json().data).toMatchObject({ status: 'pending_grading' });
    expect(submitted.json().data.items[0].grade).toBeNull();
    const jobs = await app.ctx.db.list('gradingJobs', { attemptId: attempt.id });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('blocked_config');
    const report = await app.inject({
      method: 'GET',
      url: `/api/v1/attempts/${attempt.id}/report`,
      headers: learner,
    });
    expect(report.json().data).toMatchObject({
      awardedScore: '0.00',
      pendingMaxScore: '10.00',
      isFinal: false,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attempt.id}/submit`,
      headers: learner,
      payload: {},
    });
    expect(await app.ctx.db.list('gradingJobs', { attemptId: attempt.id })).toHaveLength(1);
  });

  it('closes the external-rubric loop and rebuilds wrong questions after correction', async () => {
    const { app, agent, learner, createTopic } = await setup();
    const topic = await createTopic();
    const definition = {
      type: 'short_answer',
      stem: '解释原子性',
      gradingMode: 'external_rubric',
      referenceAnswer: '全部成功或全部回滚',
      rubric: {
        version: 1,
        criteria: [
          {
            id: 'atomicity',
            description: '说明整体成功或回滚',
            weight: 1,
            levels: [
              { id: 'not_met', creditBps: 0, description: '未说明' },
              { id: 'met', creditBps: 10000, description: '说明准确' },
            ],
          },
        ],
      },
    };
    const question = await createQuestion(app, agent, topic.id, definition);
    const assessment = await createAssessment(app, agent, topic.id, question.questionId);
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${assessment.id}/attempts`,
      headers: learner,
      payload: {},
    });
    const attempt = started.json().data;
    const answerText = '事务中的操作一起成功或一起回滚。';
    await app.inject({
      method: 'PUT',
      url: `/api/v1/attempts/${attempt.id}/answers/${attempt.items[0].id}`,
      headers: learner,
      payload: { expectedRevision: 0, answer: { text: answerText } },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attempt.id}/submit`,
      headers: learner,
      payload: {},
    });
    expect(await app.ctx.db.list('gradingJobs', { attemptId: attempt.id })).toHaveLength(0);
    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/grading-queue',
      headers: agent,
    });
    expect(queue.json().data).toHaveLength(1);
    const graded = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/attempt-items/${attempt.items[0].id}/grades`,
      headers: agent,
      payload: {
        expectedGradeVersion: 0,
        criterionResults: [
          { criterionId: 'atomicity', levelId: 'not_met', evidence: [], explanation: '未覆盖要点' },
        ],
      },
    });
    expect(graded.statusCode).toBe(200);
    expect(graded.json().data.grade).toMatchObject({ score: '0.00', version: 1 });
    expect(
      await app.ctx.db.findOne('wrongQuestions', {
        ownerId: (await app.ctx.db.get('attempts', attempt.id))?.ownerId ?? '',
        questionId: question.questionId,
      }),
    ).toBeDefined();
    const wrongList = await app.inject({
      method: 'GET',
      url: '/api/v1/wrong-questions',
      headers: learner,
    });
    expect(wrongList.statusCode).toBe(200);
    expect(wrongList.json().data).toHaveLength(1);
    expect(wrongList.json().data[0]).toMatchObject({
      stem: '解释原子性',
      topicTitle: '数据库',
      type: 'short_answer',
    });
    expect(wrongList.json().data[0]).not.toHaveProperty('definition');
    expect(wrongList.json().data[0]).not.toHaveProperty('gradingKey');
    expect(wrongList.json().data[0]).not.toHaveProperty('rubric');
    const corrected = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/attempt-items/${attempt.items[0].id}/grades`,
      headers: agent,
      payload: {
        expectedGradeVersion: 1,
        reason: '首次漏看了明确表述',
        criterionResults: [
          {
            criterionId: 'atomicity',
            levelId: 'met',
            evidence: [answerText],
            explanation: '完整覆盖',
          },
        ],
      },
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json().data.grade).toMatchObject({ score: '10.00', version: 2 });
    const raw = await app.ctx.db.get('attempts', attempt.id);
    expect(raw?.items[0].gradingHistory).toHaveLength(1);
    expect(
      await app.ctx.db.findOne('wrongQuestions', {
        ownerId: raw?.ownerId ?? '',
        questionId: question.questionId,
      }),
    ).toBeUndefined();
    const report = await app.inject({
      method: 'GET',
      url: `/api/v1/attempts/${attempt.id}/report`,
      headers: learner,
    });
    expect(report.json().data).toMatchObject({ awardedScore: '10.00', isFinal: true });
  });
  it.each([
    ['model_rubric', false, false],
    ['external_rubric', false, false],
    ['model_rubric', true, false],
    ['external_rubric', true, false],
    ['model_rubric', false, true],
    ['external_rubric', false, true],
  ] as const)(
    'defers practice short answers until settlement (%s, expired=%s, blank=%s)',
    async (gradingMode, viaExpiry, blank) => {
      const { app, agent, learner, createTopic } = await setup();
      const topic = await createTopic();
      const question = await createQuestion(app, agent, topic.id, {
        type: 'short_answer',
        stem: '解释原子性',
        gradingMode,
        referenceAnswer: '全部成功或全部回滚',
        rubric: {
          version: 1,
          criteria: [
            {
              id: 'atomicity',
              description: '说明整体成功或回滚',
              weight: 1,
              levels: [
                { id: 'none', creditBps: 0, description: '未说明' },
                { id: 'full', creditBps: 10000, description: '完整说明' },
              ],
            },
          ],
        },
      });
      const assessment = await createAssessment(
        app,
        agent,
        topic.id,
        question.questionId,
        'practice',
      );
      const started = await app.inject({
        method: 'POST',
        url: `/api/v1/assessments/${assessment.id}/attempts`,
        headers: learner,
        payload: {},
      });
      const attempt = started.json().data;
      const itemId = attempt.items[0].id;
      const answerUrl = `/api/v1/attempts/${attempt.id}/answers/${itemId}`;
      const saved = await app.inject({
        method: 'PUT',
        url: answerUrl,
        headers: learner,
        payload: { expectedRevision: 0, answer: { text: blank ? '' : '一起成功' } },
      });
      expect(saved.statusCode).toBe(200);
      const early = await app.inject({
        method: 'POST',
        url: `/api/v1/attempts/${attempt.id}/items/${itemId}/submit`,
        headers: learner,
        payload: {},
      });
      expect(early.statusCode).toBe(409);
      expect(early.json().error.code).toBe('SHORT_ANSWER_REQUIRES_SUBMISSION');
      const editable = await app.inject({
        method: 'PUT',
        url: answerUrl,
        headers: learner,
        payload: { expectedRevision: 1, answer: { text: blank ? '' : '一起成功或全部回滚' } },
      });
      expect(editable.statusCode).toBe(200);
      const before = await app.inject({ url: `/api/v1/attempts/${attempt.id}`, headers: learner });
      expect(before.json().data.items[0]).toMatchObject({ lockedAt: null, grade: null });
      expect(before.json().data.items[0]).not.toHaveProperty('referenceAnswer');
      expect(await app.ctx.db.list('gradingJobs', { attemptId: attempt.id })).toHaveLength(0);
      const earlyExternal = await app.inject({
        method: 'POST',
        url: `/api/v1/agent/attempt-items/${itemId}/grades`,
        headers: agent,
        payload: { expectedGradeVersion: 0, criterionResults: [] },
      });
      expect(earlyExternal.statusCode).toBe(409);
      if (viaExpiry) {
        const raw = (await app.ctx.db.get('attempts', attempt.id))!;
        await app.ctx.db.update('attempts', raw.id, raw.revision, {
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        });
      }
      const settled = await app.inject(
        viaExpiry
          ? { url: `/api/v1/attempts/${attempt.id}`, headers: learner }
          : {
              method: 'POST',
              url: `/api/v1/attempts/${attempt.id}/submit`,
              headers: learner,
              payload: {},
            },
      );
      expect(settled.statusCode).toBe(200);
      expect(settled.json().data.submissionReason).toBe(
        viaExpiry ? 'time_expired' : 'user_submitted',
      );
      expect(settled.json().data.items[0].lockedAt).not.toBeNull();
      expect(settled.json().data.items[0].answer).toEqual({
        text: blank ? '' : '一起成功或全部回滚',
      });
      expect(settled.json().data.status).toBe(blank ? 'completed' : 'pending_grading');
      expect(settled.json().data.items[0].grade?.score ?? null).toBe(blank ? '0.00' : null);
      const expectedJobs = gradingMode === 'model_rubric' && !blank ? 1 : 0;
      expect(await app.ctx.db.list('gradingJobs', { attemptId: attempt.id })).toHaveLength(
        expectedJobs,
      );
      await app.inject({
        method: 'POST',
        url: `/api/v1/attempts/${attempt.id}/submit`,
        headers: learner,
        payload: {},
      });
      expect(await app.ctx.db.list('gradingJobs', { attemptId: attempt.id })).toHaveLength(
        expectedJobs,
      );
    },
  );
  it('preserves Markdown content with plans and safe archive/restore responses', async () => {
    const { app, agent, learner, createTopic } = await setup();
    const topic = await createTopic();
    const bodyText = '## 事务笔记\n\n**原子性**与 `COMMIT`\n\n<b>原样保存</b>';
    const capabilities = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/capabilities',
      headers: agent,
    });
    expect(capabilities.json().data).toEqual({
      apiVersion: 1,
      scopes: expect.any(Array),
      questionTypes: expect.any(Array),
      gradingModes: expect.any(Array),
      limitations: expect.any(Array),
    });
    const summary = await app.inject({ url: '/api/v1/agent/learning-summary', headers: agent });
    expect(summary.json().data).toEqual({
      topics: expect.any(Array),
      plans: expect.any(Array),
      recentAttempts: expect.any(Array),
      wrongQuestions: expect.any(Array),
    });
    expect(capabilities.json().data.limitations).not.toContain('纯文本内容');
    const contentResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/topics/${topic.id}/contents`,
      headers: agent,
      payload: { title: '事务笔记', bodyText },
    });
    expect(contentResponse.statusCode).toBe(201);
    const content = contentResponse.json().data;
    const planResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/topics/${topic.id}/plans`,
      headers: agent,
      payload: {
        title: '第一周',
        phases: [
          { title: '阶段一', tasks: [{ title: '阅读', kind: 'reading', targetId: content.id }] },
        ],
      },
    });
    expect(planResponse.statusCode).toBe(201);
    const plan = planResponse.json().data;
    const task = plan.phases[0].tasks[0];
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/contents/${content.id}`,
      headers: learner,
    });
    expect(content.bodyText).toBe(bodyText);
    expect(read.json().data.bodyText).toBe(bodyText);
    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/complete`,
      headers: learner,
      payload: {},
    });
    expect(completed.json().data.status).toBe('completed');
    const archived = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/resources/content/${content.id}/archive`,
      headers: agent,
      payload: { expectedRevision: content.revision },
    });
    expect(archived.statusCode).toBe(200);
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/topics/${topic.id}/contents`,
      headers: learner,
    });
    expect(listed.json().data).toEqual([]);
    const restored = await app.inject({
      method: 'POST',
      url: `/api/v1/archive/content/${content.id}/restore`,
      headers: learner,
      payload: {},
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data).toEqual({
      resourceType: 'content',
      id: content.id,
      archivedAt: null,
    });
    expect(restored.json().data).not.toHaveProperty('bodyText');
  });
  it('does not let an Agent complete practice or exam tasks without submission', async () => {
    const { app, agent, createTopic } = await setup();
    const topic = await createTopic();
    const question = await createQuestion(app, agent, topic.id);
    const assessment = await createAssessment(
      app,
      agent,
      topic.id,
      question.questionId,
      'practice',
    );
    const planResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/topics/${topic.id}/plans`,
      headers: agent,
      payload: {
        title: '练习计划',
        phases: [
          {
            title: '阶段一',
            tasks: [{ title: '完成练习', kind: 'practice', targetId: assessment.id }],
          },
        ],
      },
    });
    expect(planResponse.statusCode).toBe(201);
    const plan = planResponse.json().data;
    const task = plan.phases[0].tasks[0];

    const completed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agent/tasks/${task.id}`,
      headers: agent,
      payload: { expectedRevision: plan.revision, status: 'completed' },
    });
    expect(completed.statusCode).toBe(409);
    expect(completed.json().error.code).toBe('TASK_KIND_NOT_COMPLETABLE');
    const saved = await app.ctx.db.get('plans', plan.id);
    expect(saved?.phases[0].tasks[0]).toMatchObject({ status: 'todo', completedAt: null });
  });
});
