import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AGENT_SCOPES, type Assessment, type QuestionDefinition } from '@drill-hub/contracts';
import { createApp } from '../src/app.js';
import { createUser } from '../src/modules/auth/index.js';
import { baseRecord, id } from '../src/core/ids.js';
import { hashSecret, randomSecret } from '../src/core/security.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const definition: QuestionDefinition = {
  type: 'true_false',
  stem: '事务具有原子性',
  gradingMode: 'rule',
  gradingKey: { value: true },
  referenceAnswer: '正确',
  explanation: '事务作为整体提交或回滚',
};

async function setup() {
  const app = await createApp({
    databasePath: ':memory:',
    encryptionKey: 'cd'.repeat(32),
    publicUrl: 'https://study.example.test',
    startWorkers: false,
  });
  apps.push(app);
  const user = await createUser(app.ctx.db, {
    username: 'publisher',
    password: 'LearningPass123!',
    mustChangePassword: false,
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/mobile/login',
    payload: { username: user.username, password: 'LearningPass123!' },
  });
  expect(login.statusCode).toBe(200);
  const learner = { authorization: `Bearer ${login.json().data.accessToken as string}` };
  const agentToken = `dhk.${id()}.${randomSecret()}`;
  await app.ctx.db.insert('agentTokens', {
    ...baseRecord(),
    ownerId: user.id,
    name: 'answer-link-test',
    prefix: agentToken.slice(0, 12),
    secretHash: hashSecret(agentToken),
    encryptedSecret: app.ctx.vault.encrypt(agentToken),
    scopes: AGENT_SCOPES,
    expiresAt: null,
    lastUsedAt: null,
  });
  const agent = { authorization: `Bearer ${agentToken}` };
  const topic = {
    ...baseRecord(),
    ownerId: user.id,
    title: '数据库',
    goalText: '',
    archivedAt: null,
  };
  const question = {
    ...baseRecord(),
    ownerId: user.id,
    topicId: topic.id,
    version: 1,
    definition,
    archivedAt: null,
  };
  const version = {
    ...baseRecord(),
    ownerId: user.id,
    questionId: question.id,
    version: 1,
    definition,
  };
  const assessment: Assessment = {
    ...baseRecord(),
    ownerId: user.id,
    topicId: topic.id,
    kind: 'exam',
    title: '临时考试',
    durationSeconds: 3600,
    items: [{ questionId: question.id, questionVersion: 1, maxScore: '10.00' }],
    archivedAt: null,
  };
  await app.ctx.db.insert('topics', topic);
  await app.ctx.db.insert('questions', question);
  await app.ctx.db.insert('questionVersions', version);
  await app.ctx.db.insert('assessments', assessment);

  async function createLink(expiresInSeconds = 3600) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/assessments/${assessment.id}/answer-links`,
      headers: agent,
      payload: { expiresInSeconds },
    });
    expect(response.statusCode).toBe(201);
    return response.json().data as {
      id: string;
      assessmentId: string;
      expiresAt: string;
      answerUrl: string;
    };
  }

  return { app, user, learner, agent, assessment, createLink };
}

describe('temporary public answer links', () => {
  it('attributes link submissions to owner history and personal learning projections', async () => {
    const { app, user, learner, agent, assessment, createLink } = await setup();
    const created = await createLink();
    const url = new URL(created.answerUrl);
    expect(url.origin + url.pathname).toBe('https://study.example.test/answer');
    const token = url.hash.slice(1);
    expect(token.length).toBeGreaterThanOrEqual(32);
    const stored = await app.ctx.db.get('answerLinks', created.id);
    expect(stored?.secretHash).toBe(hashSecret(token));
    expect(stored?.secretHash).not.toContain(token);

    const publicHeaders = { 'x-answer-link-token': token };
    const context = await app.inject({ url: '/api/v1/public/answer', headers: publicHeaders });
    expect(context.statusCode).toBe(200);
    expect(context.json().data).toMatchObject({
      assessment: { id: assessment.id, title: '临时考试', itemCount: 1 },
      attempt: null,
    });

    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/public/answer/attempt',
      headers: publicHeaders,
      payload: {},
    });
    expect(started.statusCode).toBe(200);
    const attempt = started.json().data;
    expect(attempt).toMatchObject({ status: 'in_progress', kind: 'exam' });
    expect(attempt).not.toHaveProperty('ownerId');
    expect(attempt).not.toHaveProperty('answerLinkId');
    const itemId = attempt.items[0].id as string;
    const storedAttempt = await app.ctx.db.get('attempts', attempt.id);
    expect(storedAttempt).toMatchObject({ ownerId: user.id, answerLinkId: created.id });

    const repeated = await app.inject({
      method: 'POST',
      url: '/api/v1/public/answer/attempt',
      headers: publicHeaders,
      payload: {},
    });
    expect(repeated.json().data.id).toBe(attempt.id);

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/public/answer/attempt/items/${itemId}`,
      headers: publicHeaders,
      payload: { expectedRevision: 0, answer: { value: true } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ answerRevision: 1, answer: { value: true } });

    const submitted = await app.inject({
      method: 'POST',
      url: '/api/v1/public/answer/attempt/submit',
      headers: publicHeaders,
      payload: {},
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().data).toMatchObject({
      status: 'completed',
      submissionReason: 'user_submitted',
      items: [{ grade: { score: '10.00' } }],
    });

    const report = await app.inject({
      url: '/api/v1/public/answer/report',
      headers: publicHeaders,
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().data).toMatchObject({ awardedScore: '10.00', isFinal: true });

    const history = await app.inject({ url: '/api/v1/attempts', headers: learner });
    expect(history.statusCode).toBe(200);
    expect(history.json().data).toMatchObject([
      { id: attempt.id, source: 'answer_link', status: 'completed' },
    ]);
    expect(history.json().data[0]).not.toHaveProperty('answerLinkId');
    expect(history.json().data[0]).not.toHaveProperty('ownerId');
    const matching = await app.inject({
      url: '/api/v1/attempts?kind=exam&status=completed&assessmentId=' + assessment.id,
      headers: learner,
    });
    expect(matching.json().data).toHaveLength(1);
    const nonMatching = await app.inject({
      url: '/api/v1/attempts?status=in_progress',
      headers: learner,
    });
    expect(nonMatching.json().data).toEqual([]);

    // Authenticated history and reports remain available after the temporary secret expires.
    const link = (await app.ctx.db.get('answerLinks', created.id))!;
    await app.ctx.db.update('answerLinks', link.id, link.revision, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const expiredReport = await app.inject({
      url: '/api/v1/public/answer/report',
      headers: publicHeaders,
    });
    expect(expiredReport.statusCode).toBe(410);
    const ownerReport = await app.inject({
      url: '/api/v1/attempts/' + attempt.id + '/report',
      headers: learner,
    });
    expect(ownerReport.statusCode).toBe(200);
    expect(ownerReport.json().data).toMatchObject({
      awardedScore: '10.00',
      isFinal: true,
      attempt: { source: 'answer_link' },
    });
    const dashboard = await app.inject({ url: '/api/v1/dashboard', headers: learner });
    expect(dashboard.json().data).toMatchObject({
      completedAttempts: 1,
      recentAttempts: [{ id: attempt.id }],
    });
    const summary = await app.inject({ url: '/api/v1/agent/learning-summary', headers: agent });
    expect(summary.json().data.recentAttempts).toMatchObject([{ id: attempt.id }]);
    expect(await app.ctx.db.list('wrongQuestions', { ownerId: user.id })).toEqual([]);
  });

  it('lets the owner read an ongoing link attempt but not answer or submit on behalf of the respondent', async () => {
    const { app, user, learner, createLink } = await setup();
    const created = await createLink();
    const headers = { 'x-answer-link-token': new URL(created.answerUrl).hash.slice(1) };
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/public/answer/attempt',
      headers,
      payload: {},
    });
    const attempt = started.json().data;
    const history = await app.inject({
      url: '/api/v1/attempts?status=in_progress',
      headers: learner,
    });
    expect(history.json().data).toMatchObject([{ id: attempt.id, source: 'answer_link' }]);
    const detail = await app.inject({ url: '/api/v1/attempts/' + attempt.id, headers: learner });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.items[0]).not.toHaveProperty('gradingKey');
    const report = await app.inject({
      url: '/api/v1/attempts/' + attempt.id + '/report',
      headers: learner,
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().data.attempt.items[0]).not.toHaveProperty('referenceAnswer');

    for (const request of [
      {
        method: 'PUT' as const,
        url: '/api/v1/attempts/' + attempt.id + '/answers/' + attempt.items[0].id,
        payload: { expectedRevision: 0, answer: { value: false } },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/attempts/' + attempt.id + '/items/' + attempt.items[0].id + '/submit',
        payload: {},
      },
      { method: 'POST' as const, url: '/api/v1/attempts/' + attempt.id + '/submit', payload: {} },
    ]) {
      const response = await app.inject({ ...request, headers: learner });
      expect(response.statusCode).toBe(404);
    }
    const stored = await app.ctx.db.get('attempts', attempt.id);
    expect(stored).toMatchObject({
      submittedAt: null,
      items: [{ answer: null, answerRevision: 0 }],
    });

    const anotherUser = await createUser(app.ctx.db, {
      username: 'another-user',
      password: 'AnotherPass123!',
      mustChangePassword: false,
      role: 'admin',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/login',
      payload: { username: anotherUser.username, password: 'AnotherPass123!' },
    });
    expect(login.statusCode).toBe(200);
    const otherHeaders = { authorization: 'Bearer ' + login.json().data.accessToken };
    const otherHistory = await app.inject({ url: '/api/v1/attempts', headers: otherHeaders });
    expect(otherHistory.json().data).toEqual([]);
    for (const suffix of ['', '/report']) {
      const otherReport = await app.inject({
        url: '/api/v1/attempts/' + attempt.id + suffix,
        headers: otherHeaders,
      });
      expect(otherReport.statusCode).toBe(404);
    }

    // Link access remains scoped, while wrong answers contribute to the owner learning record.
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/public/answer/attempt/items/' + attempt.items[0].id,
      headers,
      payload: { expectedRevision: 0, answer: { value: false } },
    });
    expect(saved.statusCode).toBe(200);
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/v1/public/answer/attempt/submit',
      headers,
      payload: {},
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().data.items[0].grade.score).toBe('0.00');
    expect(await app.ctx.db.list('wrongQuestions', { ownerId: user.id })).toMatchObject([
      { wrongCount: 1 },
    ]);
  });

  it('rejects missing, invalid, and expired link secrets', async () => {
    const { app, createLink } = await setup();
    const missing = await app.inject({ url: '/api/v1/public/answer' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe('ANSWER_LINK_REQUIRED');

    const invalid = await app.inject({
      url: '/api/v1/public/answer',
      headers: { 'x-answer-link-token': randomSecret() },
    });
    expect(invalid.statusCode).toBe(404);
    expect(invalid.json().error.code).toBe('ANSWER_LINK_NOT_FOUND');

    const created = await createLink();
    const token = new URL(created.answerUrl).hash.slice(1);
    const stored = await app.ctx.db.get('answerLinks', created.id);
    expect(stored).toBeTruthy();
    await app.ctx.db.update('answerLinks', stored!.id, stored!.revision, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const expired = await app.inject({
      url: '/api/v1/public/answer',
      headers: { 'x-answer-link-token': token },
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe('ANSWER_LINK_EXPIRED');
  });
});
