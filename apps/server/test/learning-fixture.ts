import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AGENT_SCOPES } from '@drill-hub/contracts';
import { createApp } from '#server/app.js';
import { createUser } from '#server/modules/auth/index.js';
import { baseRecord, id } from '#server/core/ids.js';
import { hashSecret, randomSecret } from '#server/core/security.js';

const apps: FastifyInstance[] = [];

/** 各测试文件在 afterEach 中调用，关闭本文件内创建的全部应用。 */
export async function closeTrackedApps(): Promise<void> {
  await Promise.all(apps.splice(0).map((app) => app.close()));
}

export interface LearningFixture {
  app: FastifyInstance;
  userId: string;
  otherUserId: string;
  /** 拥有全部 scope 的 Agent 令牌请求头。 */
  agent: Record<string, string>;
  learner: Record<string, string>;
  otherLearner: Record<string, string>;
}

export async function setupLearningApp(): Promise<LearningFixture> {
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
  return {
    app,
    userId: user.id,
    otherUserId: other.id,
    agent: { authorization: `Bearer ${agentToken}` },
    learner: { authorization: `Bearer ${accessToken}` },
    otherLearner: { authorization: `Bearer ${otherAccessToken}` },
  };
}

export interface SeededTopic {
  topicId: string;
  contentId: string;
  planId: string;
  questionId: string;
  assessmentId: string;
}

/** 建一个含内容、计划、题目与试卷的完整主题。 */
export async function seedTopicBundle(
  fixture: LearningFixture,
  overrides: { topicTitle?: string; contentBody?: string; examTitle?: string } = {},
): Promise<SeededTopic> {
  const { app, agent } = fixture;
  const inject = async (method: 'POST', url: string, payload: unknown) => {
    const response = await app.inject({ method, url, headers: agent, payload });
    expect(response.statusCode).toBe(201);
    return response.json().data;
  };
  const topic = await inject('POST', '/api/v1/agent/topics', {
    title: overrides.topicTitle ?? '数据库原理',
    goalText: '理解事务与索引',
  });
  const content = await inject('POST', `/api/v1/agent/topics/${topic.id}/contents`, {
    title: '事务隔离级别',
    bodyText: overrides.contentBody ?? 'MVCC 通过版本链实现快照读，避免读写互相阻塞。',
  });
  const plan = await inject('POST', `/api/v1/agent/topics/${topic.id}/plans`, {
    title: '两周冲刺',
    phases: [
      {
        title: '基础',
        tasks: [{ title: '阅读 MVCC 章节', kind: 'reading', targetId: content.id, status: 'todo' }],
      },
    ],
  });
  const questionBatch = await inject('POST', `/api/v1/agent/topics/${topic.id}/questions/batch`, {
    items: [
      {
        clientRef: 'q1',
        type: 'true_false',
        stem: '事务具有原子性',
        gradingMode: 'rule',
        gradingKey: { value: true },
        referenceAnswer: '正确',
        explanation: '事务作为整体提交或回滚',
        tags: ['transaction'],
      },
    ],
  });
  const assessment = await inject('POST', `/api/v1/agent/topics/${topic.id}/assessments`, {
    kind: 'exam',
    title: overrides.examTitle ?? '数据库期末考试',
    durationSeconds: 3600,
    items: [
      {
        questionId: questionBatch[0].questionId,
        questionVersion: 1,
        maxScore: '10.00',
      },
    ],
  });
  return {
    topicId: topic.id,
    contentId: content.id,
    planId: plan.id,
    questionId: questionBatch[0].questionId,
    assessmentId: assessment.id,
  };
}
