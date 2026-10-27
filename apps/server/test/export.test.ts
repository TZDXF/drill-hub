import { afterEach, describe, expect, it } from 'vitest';
import { closeTrackedApps, seedTopicBundle, setupLearningApp } from './learning-fixture.js';

afterEach(closeTrackedApps);

describe('GET /api/v1/me/export', () => {
  it('导出本人全部学习数据与完整题量版本', async () => {
    const fixture = await setupLearningApp();
    const seeded = await seedTopicBundle(fixture);
    // 开始一次作答，保证 attempts 出现在导出中。
    const attempt = await fixture.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${seeded.assessmentId}/attempts`,
      headers: fixture.learner,
      payload: {},
    });
    expect(attempt.statusCode).toBe(201);
    const response = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/me/export',
      headers: fixture.learner,
    });
    expect(response.statusCode).toBe(200);
    const bundle = response.json().data;
    expect(bundle.formatVersion).toBe(1);
    expect(bundle.account).toMatchObject({ userId: fixture.userId, username: 'learner' });
    expect(bundle.topics).toHaveLength(1);
    expect(bundle.contents).toHaveLength(1);
    expect(bundle.plans).toHaveLength(1);
    expect(bundle.questions).toHaveLength(1);
    expect(bundle.questionVersions).toHaveLength(1);
    expect(bundle.assessments).toHaveLength(1);
    expect(bundle.attempts).toHaveLength(1);
    expect(bundle.wrongQuestions).toHaveLength(0);
    expect(bundle.answerLinks).toEqual([]);
    expect(bundle.topics[0]).toMatchObject({ id: seeded.topicId, title: '数据库原理' });
  });

  it('不包含其他用户数据与敏感字段', async () => {
    const fixture = await setupLearningApp();
    await seedTopicBundle(fixture);
    const response = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/me/export',
      headers: fixture.otherLearner,
    });
    const bundle = response.json().data;
    expect(bundle.topics).toEqual([]);
    expect(bundle.contents).toEqual([]);
    expect(bundle.attempts).toEqual([]);
    const serialized = response.body;
    expect(serialized).not.toContain('secretHash');
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('encryptedSecret');
  });

  it('导出包含答题链接元数据但不含秘钥', async () => {
    const fixture = await setupLearningApp();
    const seeded = await seedTopicBundle(fixture);
    const link = await fixture.app.inject({
      method: 'POST',
      url: `/api/v1/agent/assessments/${seeded.assessmentId}/answer-links`,
      headers: fixture.agent,
      payload: { purpose: 'test', expiresInSeconds: 3600 },
    });
    expect(link.statusCode).toBe(201);
    const response = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/me/export',
      headers: fixture.learner,
    });
    const bundle = response.json().data;
    expect(bundle.answerLinks).toHaveLength(1);
    expect(bundle.answerLinks[0]).toMatchObject({
      assessmentId: seeded.assessmentId,
      purpose: 'test',
      revokedAt: null,
    });
    expect(response.body).not.toContain('answerUrl');
  });

  it('未登录返回 401', async () => {
    const fixture = await setupLearningApp();
    const response = await fixture.app.inject({ method: 'GET', url: '/api/v1/me/export' });
    expect(response.statusCode).toBe(401);
  });
});
