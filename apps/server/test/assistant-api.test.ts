import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '#server/core/context.js';
import {
  ASSISTANT_API_OPERATIONS,
  assistantApiHelp,
  isAssistantApiAllowed,
} from '#server/modules/assistant/api-reference.js';
import { registerLearningRoutes } from '#server/modules/learning/index.js';
import { registerGradingRoutes } from '#server/modules/grading/routes.js';

const app = Fastify();
const registered = new Set<string>();
const normalize = (path: string) => path.replace(/:[^/]+|\{[^}]+\}/g, '{}');

beforeAll(async () => {
  app.addHook('onRoute', (route) => {
    for (const method of Array.isArray(route.method) ? route.method : [route.method])
      registered.add(`${method} ${normalize(route.url)}`);
  });
  // 仅注册路由并检查目录，不执行数据库和鉴权处理。
  const context = {} as AppContext;
  registerLearningRoutes(app, context);
  await registerGradingRoutes(app, context);
  await app.ready();
});

afterAll(async () => app.close());

describe('assistant learning API coverage', () => {
  it('documents exact JSON types and a complete fill-blank question example', () => {
    const help = assistantApiHelp('questions');
    expect(help).toContain('options: [{id:string,text:string}]');
    expect(help).toContain('acceptedAnswers:{空位ID:string[]}');
    expect(help).toContain(
      '{type:"fill_blank",stem:"计算 1+2=__",gradingMode:"rule",slots:[{id:"s1"}],gradingKey:{acceptedAnswers:{s1:["3","3.0"]}}}',
    );
    expect(help).toContain('数字答案也必须写成字符串');
    expect(help).toContain('不要创建“探测题”测试格式');
  });

  it('documents exact JSON types and a complete assessment example', () => {
    const help = assistantApiHelp('assessments');
    expect(help).toContain('questionVersion、durationSeconds 是数字');
    expect(help).toContain('maxScore 是字符串，不能写成数字');
    expect(help).toContain(
      '{kind:"practice",title:"阶段练习",durationSeconds:1800,items:[{questionId:"替换为真实题目ID",questionVersion:1,maxScore:"10.00"}]}',
    );
  });

  it('documents existing endpoints and covers every learner route', () => {
    const documented = new Set(
      ASSISTANT_API_OPERATIONS.map((operation) => {
        const path = `/api/v1${operation.path}`;
        const key = `${operation.method} ${normalize(path)}`;
        expect(registered.has(key)).toBe(true);
        expect(
          isAssistantApiAllowed(operation.method, path.replace(/\{[^}]+\}/g, 'resource-id')),
        ).toBe(true);
        expect(assistantApiHelp(operation.resource)).toContain(`${operation.method} ${path}`);
        return key;
      }),
    );
    expect(documented.size).toBe(ASSISTANT_API_OPERATIONS.length);
    for (const key of registered) {
      if (
        key.startsWith('HEAD ') ||
        key.includes('/agent/') ||
        key.includes('/public/') ||
        key.includes('/admin/') ||
        key.includes('/me/')
      )
        continue;
      expect(documented.has(key)).toBe(true);
    }
  });

  it('exposes learning operations while refusing credentials, raw answers and external grading', () => {
    for (const [method, path] of [
      ['POST', '/api/v1/agent/topics'],
      ['GET', '/api/v1/agent/topics/topic-id/questions'],
      ['POST', '/api/v1/agent/assessments/assessment-id/answer-links'],
      ['GET', '/api/v1/agent/grading-jobs'],
      ['POST', '/api/v1/agent/grading-jobs/job-id/retry'],
      ['POST', '/api/v1/agent/attempt-items/item-id/regrade'],
    ])
      expect(isAssistantApiAllowed(method!, path!)).toBe(true);
    for (const [method, path] of [
      ['POST', '/api/v1/topics'],
      ['GET', '/api/v1/admin/users'],
      ['GET', '/api/v1/me/agent-tokens'],
      ['POST', '/api/v1/auth/web/login'],
      ['POST', '/api/v1/me/assistant/threads'],
      ['GET', '/api/v1/agent/attempts'],
      ['GET', '/api/v1/agent/attempts/attempt-id'],
      ['GET', '/api/v1/agent/learning-summary'],
      ['GET', '/api/v1/agent/grading-queue'],
      ['POST', '/api/v1/agent/attempt-items/item-id/grades'],
      ['DELETE', '/api/v1/agent/topics/topic-id'],
      ['GET', '/api/v1/agent/topics/topic-id/questions/extra'],
      ['GET', '/api/v1/agent/topics/topic%2fid/questions'],
    ])
      expect(isAssistantApiAllowed(method!, path!)).toBe(false);
  });
});
