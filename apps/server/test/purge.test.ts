import { afterEach, describe, expect, it } from 'vitest';
import { baseRecord, id } from '#server/core/ids.js';
import { hashSecret, randomSecret } from '#server/core/security.js';
import {
  closeTrackedApps,
  seedTopicBundle,
  setupLearningApp,
  type LearningFixture,
} from '#server-root/test/learning-fixture.js';

afterEach(closeTrackedApps);

async function startAttempt(fixture: LearningFixture, assessmentId: string) {
  const start = await fixture.app.inject({
    method: 'POST',
    url: `/api/v1/assessments/${assessmentId}/attempts`,
    headers: fixture.learner,
    payload: {},
  });
  expect([200, 201]).toContain(start.statusCode);
  return start.json().data as {
    id: string;
    items: { id: string; answerRevision: number }[];
  };
}

async function answerAndSubmit(
  fixture: LearningFixture,
  attempt: { id: string; items: { id: string; answerRevision: number }[] },
  answer: unknown = { value: true },
) {
  const item = attempt.items[0];
  const saved = await fixture.app.inject({
    method: 'PUT',
    url: `/api/v1/attempts/${attempt.id}/answers/${item.id}`,
    headers: fixture.learner,
    payload: { expectedRevision: item.answerRevision, answer },
  });
  expect(saved.statusCode).toBe(200);
  const submit = await fixture.app.inject({
    method: 'POST',
    url: `/api/v1/attempts/${attempt.id}/submit`,
    headers: fixture.learner,
    payload: {},
  });
  expect(submit.statusCode).toBe(200);
}

async function preview(fixture: LearningFixture, topicId: string, headers = fixture.learner) {
  const response = await fixture.app.inject({
    method: 'GET',
    url: `/api/v1/topics/${topicId}/purge-preview`,
    headers,
  });
  return response;
}

describe('永久删除主题', () => {
  it('影响预览统计全部子资源', async () => {
    const fixture = await setupLearningApp();
    const seeded = await seedTopicBundle(fixture);
    const link = await fixture.app.inject({
      method: 'POST',
      url: `/api/v1/agent/assessments/${seeded.assessmentId}/answer-links`,
      headers: fixture.agent,
      payload: { expiresInSeconds: 3600 },
    });
    expect(link.statusCode).toBe(201);
    const response = await preview(fixture, seeded.topicId);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.topic).toMatchObject({
      id: seeded.topicId,
      title: '数据库原理',
      revision: expect.any(Number),
      archivedAt: null,
    });
    expect(data.counts).toEqual({
      contents: 1,
      plans: 1,
      questions: 1,
      questionVersions: 1,
      assessments: 1,
      attempts: 0,
      wrongQuestions: 0,
      answerLinks: 1,
      gradingJobs: 0,
    });
    expect(data.total).toBe(6);
  });

  it('expectedRevision 不匹配返回 409', async () => {
    const fixture = await setupLearningApp();
    const seeded = await seedTopicBundle(fixture);
    const response = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/v1/topics/${seeded.topicId}`,
      headers: fixture.learner,
      payload: { expectedRevision: 999 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('VERSION_CONFLICT');
    const stillThere = await fixture.app.ctx.db.get('topics', seeded.topicId);
    expect(stillThere).toBeTruthy();
  });

  it('存在未终结作答时返回 409 TOPIC_ATTEMPTS_ACTIVE', async () => {
    const fixture = await setupLearningApp();
    const seeded = await seedTopicBundle(fixture);
    await startAttempt(fixture, seeded.assessmentId);
    const { topic } = await (async () => {
      const row = await fixture.app.ctx.db.get('topics', seeded.topicId);
      return { topic: row! };
    })();
    const response = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/v1/topics/${seeded.topicId}`,
      headers: fixture.learner,
      payload: { expectedRevision: topic.revision },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('TOPIC_ATTEMPTS_ACTIVE');
  });

  it('作答提交后删除成功，级联清理并写入审计', async () => {
    const fixture = await setupLearningApp();
    const seeded = await seedTopicBundle(fixture);
    const attempt = await startAttempt(fixture, seeded.assessmentId);
    await answerAndSubmit(fixture, attempt);
    const before = await preview(fixture, seeded.topicId);
    expect(before.json().data.counts.attempts).toBe(1);
    const revision = before.json().data.topic.revision;
    const response = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/v1/topics/${seeded.topicId}`,
      headers: fixture.learner,
      payload: { expectedRevision: revision },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.purged).toBe(true);
    const db = fixture.app.ctx.db;
    expect(await db.get('topics', seeded.topicId)).toBeUndefined();
    expect(await db.list('contents', { ownerId: fixture.userId })).toEqual([]);
    expect(await db.list('plans', { ownerId: fixture.userId })).toEqual([]);
    expect(await db.list('questions', { ownerId: fixture.userId })).toEqual([]);
    expect(await db.list('questionVersions', { ownerId: fixture.userId })).toEqual([]);
    expect(await db.list('assessments', { ownerId: fixture.userId })).toEqual([]);
    expect(await db.list('attempts', { ownerId: fixture.userId })).toEqual([]);
    expect(await db.list('answerLinks', { ownerId: fixture.userId })).toEqual([]);
    const audits = await db.list('auditLogs', { ownerId: fixture.userId });
    const purged = audits.find((entry) => entry.action === 'topic.purged');
    expect(purged).toBeTruthy();
    expect(purged!.summary).toMatchObject({
      title: '数据库原理',
      counts: { attempts: 1, contents: 1 },
    });
  });

  it('其他用户主题不可见也不可删', async () => {
    const fixture = await setupLearningApp();
    const seeded = await seedTopicBundle(fixture);
    const foreignPreview = await fixture.app.inject({
      method: 'GET',
      url: `/api/v1/topics/${seeded.topicId}/purge-preview`,
      headers: fixture.otherLearner,
    });
    expect(foreignPreview.statusCode).toBe(404);
    const foreignDelete = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/v1/topics/${seeded.topicId}`,
      headers: fixture.otherLearner,
      payload: { expectedRevision: 1 },
    });
    expect(foreignDelete.statusCode).toBe(404);
  });

  it('Agent 需要 topic:purge scope 才能删除，预览仅需 read', async () => {
    const fixture = await setupLearningApp();
    const seeded = await seedTopicBundle(fixture);
    const previewResponse = await fixture.app.inject({
      method: 'GET',
      url: `/api/v1/agent/topics/${seeded.topicId}/purge-preview`,
      headers: fixture.agent,
    });
    expect(previewResponse.statusCode).toBe(200);
    // 无 topic:purge 的令牌被拒绝；全权限令牌可以删除。
    const readOnlyToken = `dhk.${id()}.${randomSecret()}`;
    await fixture.app.ctx.db.insert('agentTokens', {
      ...baseRecord(),
      ownerId: fixture.userId,
      name: 'readonly',
      prefix: readOnlyToken.slice(0, 12),
      secretHash: hashSecret(readOnlyToken),
      encryptedSecret: fixture.app.ctx.vault.encrypt(readOnlyToken),
      scopes: ['read'],
      expiresAt: null,
      lastUsedAt: null,
    });
    const denied = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/v1/agent/topics/${seeded.topicId}`,
      headers: { authorization: `Bearer ${readOnlyToken}` },
      payload: { expectedRevision: 1 },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('SCOPE_REQUIRED');
    const { topic } = await (async () => {
      const row = await fixture.app.ctx.db.get('topics', seeded.topicId);
      return { topic: row! };
    })();
    const allowed = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/v1/agent/topics/${seeded.topicId}`,
      headers: fixture.agent,
      payload: { expectedRevision: topic.revision },
    });
    expect(allowed.statusCode).toBe(200);
    expect(await fixture.app.ctx.db.get('topics', seeded.topicId)).toBeUndefined();
  });
});
