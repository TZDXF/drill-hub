import { afterEach, describe, expect, it } from 'vitest';
import { closeTrackedApps, seedTopicBundle, setupLearningApp } from './learning-fixture.js';

afterEach(closeTrackedApps);

describe('GET /api/v1/search', () => {
  it('跨资源类型搜索并返回计数、摘要与定位', async () => {
    const fixture = await setupLearningApp();
    const seeded = await seedTopicBundle(fixture);
    const response = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=MVCC',
      headers: fixture.learner,
    });
    expect(response.statusCode).toBe(200);
    const outcome = response.json().data;
    expect(outcome.query).toBe('MVCC');
    expect(outcome.counts).toEqual({ topic: 0, content: 1, plan: 1, question: 0, assessment: 0 });
    const types = outcome.results.map((result: { resourceType: string }) => result.resourceType);
    expect(types).toContain('content');
    expect(types).toContain('plan');
    const contentResult = outcome.results.find(
      (result: { resourceType: string }) => result.resourceType === 'content',
    );
    expect(contentResult).toMatchObject({
      id: seeded.contentId,
      topicId: seeded.topicId,
      title: '事务隔离级别',
      archived: false,
    });
    expect(contentResult.snippet).toContain('MVCC');
    expect(
      outcome.results.find((result: { resourceType: string }) => result.resourceType === 'plan').id,
    ).toBe(seeded.planId);
  });

  it('仅返回本人资源，其他用户数据不可见', async () => {
    const fixture = await setupLearningApp();
    await seedTopicBundle(fixture);
    const own = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=事务',
      headers: fixture.learner,
    });
    expect(own.json().data.results.length).toBeGreaterThan(0);
    const foreign = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=事务',
      headers: fixture.otherLearner,
    });
    expect(foreign.json().data.results).toEqual([]);
  });

  it('默认过滤归档资源，archiveState=all 时包含', async () => {
    const fixture = await setupLearningApp();
    const seeded = await seedTopicBundle(fixture);
    const archive = await fixture.app.inject({
      method: 'POST',
      url: `/api/v1/agent/resources/content/${seeded.contentId}/archive`,
      headers: fixture.agent,
      payload: {},
    });
    expect(archive.statusCode).toBe(200);
    const active = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=隔离级别',
      headers: fixture.learner,
    });
    expect(active.json().data.results).toEqual([]);
    const all = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=隔离级别&archiveState=all',
      headers: fixture.learner,
    });
    const results = all.json().data.results;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ archived: true, snippet: expect.stringContaining('隔离') });
  });

  it('types 参数过滤资源类型', async () => {
    const fixture = await setupLearningApp();
    await seedTopicBundle(fixture);
    const response = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=事务&types=topic,question',
      headers: fixture.learner,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.counts).toEqual({
      topic: 1,
      content: 0,
      plan: 0,
      question: 1,
      assessment: 0,
    });
  });

  it('空搜索词与非法类型返回 422', async () => {
    const fixture = await setupLearningApp();
    const empty = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=%20%20',
      headers: fixture.learner,
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error.code).toBe('INVALID_SEARCH_QUERY');
    const badType = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=事务&types=secret',
      headers: fixture.learner,
    });
    expect(badType.statusCode).toBe(422);
    expect(badType.json().error.code).toBe('INVALID_SEARCH_TYPE');
  });

  it('未登录返回 401', async () => {
    const fixture = await setupLearningApp();
    const response = await fixture.app.inject({ method: 'GET', url: '/api/v1/search?q=事务' });
    expect(response.statusCode).toBe(401);
  });
});
