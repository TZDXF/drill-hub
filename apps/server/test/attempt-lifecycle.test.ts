import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  AGENT_SCOPES,
  type Answer,
  type AnswerLinkCreated,
  type ApiResponse,
  type Assessment,
  type AttemptItemView,
  type AttemptReport,
  type AttemptView,
  type Dashboard,
  type GradingJob,
  type LearningPlan,
  type QuestionDefinition,
  type Scope,
  type WrongQuestion,
} from '@drill-hub/contracts';
import { createApp } from '../src/app.js';
import { baseRecord, id, now } from '../src/core/ids.js';
import { hashSecret, randomSecret } from '../src/core/security.js';
import { createUser } from '../src/modules/auth/index.js';

const apps: FastifyInstance[] = [];
const networkCalls: ReturnType<typeof vi.fn<typeof fetch>>[] = [];

afterEach(async () => {
  try {
    for (const fetchMock of networkCalls.splice(0)) {
      if (fetchMock.mock.calls.length > 0)
        throw new Error('Unexpected provider call in lifecycle test');
    }
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  }
});

const ruleDefinition: QuestionDefinition = {
  type: 'true_false',
  stem: '事务具有原子性',
  gradingMode: 'rule',
  gradingKey: { value: true },
  referenceAnswer: '正确',
  explanation: '全部操作成功或一起回滚',
};

const externalDefinition: QuestionDefinition = {
  type: 'short_answer',
  stem: '说明事务的原子性',
  gradingMode: 'external_rubric',
  referenceAnswer: '全部操作成功或一起回滚',
  rubric: {
    version: 1,
    criteria: [
      {
        id: 'atomicity',
        description: '说明全部成功或一起回滚',
        weight: 1,
        levels: [
          { id: 'not_met', creditBps: 0, description: '未达到' },
          { id: 'partial', creditBps: 5000, description: '部分达到' },
          { id: 'met', creditBps: 10000, description: '达到' },
        ],
      },
    ],
  },
};

const modelDefinition: QuestionDefinition = {
  ...externalDefinition,
  gradingMode: 'model_rubric',
};

type Headers = Record<string, string>;
type Input = Record<string, unknown>;
type Entry = 'personal' | 'answer_link';

async function setup(
  kind: Assessment['kind'] = 'exam',
  definitions: QuestionDefinition[] = [ruleDefinition],
) {
  // Fresh migrations and a separate in-memory database for every test; no .env/dev database.
  const app = await createApp({
    databasePath: ':memory:',
    encryptionKey: 'ef'.repeat(32),
    publicUrl: 'https://lifecycle.example.test',
    startWorkers: false,
  });
  apps.push(app);
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected provider call'));
  vi.stubGlobal('fetch', fetchMock);
  networkCalls.push(fetchMock);

  const password = 'Lifecycle-test-password-42!';
  const user = await createUser(app.ctx.db, {
    username: 'lifecycle-owner',
    password,
    mustChangePassword: false,
  });
  const other = await createUser(app.ctx.db, {
    username: 'lifecycle-other',
    password,
    role: 'admin',
    mustChangePassword: false,
  });

  async function api<T>(
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    headers: Headers,
    payload?: Input,
    statusCode = 200,
  ): Promise<T> {
    const response = await app.inject({ method, url: '/api/v1' + url, headers, payload });
    expect({ status: response.statusCode, error: response.json().error }).toEqual({
      status: statusCode,
      error: undefined,
    });
    return response.json<ApiResponse<T>>().data;
  }

  async function login(username: string): Promise<Headers> {
    const result = await api<{ accessToken: string }>(
      'POST',
      '/auth/mobile/login',
      {},
      {
        username,
        password,
      },
    );
    return { authorization: `Bearer ${result.accessToken}` };
  }

  async function issueAgent(ownerId: string, scopes: Scope[] = AGENT_SCOPES): Promise<Headers> {
    const tokenRecord = baseRecord();
    const token = `dhk.${tokenRecord.id}.${randomSecret()}`;
    await app.ctx.db.insert('agentTokens', {
      ...tokenRecord,
      ownerId,
      name: 'attempt-lifecycle-test',
      prefix: token.slice(0, 12),
      secretHash: hashSecret(token),
      encryptedSecret: app.ctx.vault.encrypt(token),
      scopes,
      expiresAt: null,
      lastUsedAt: null,
    });
    return { authorization: `Bearer ${token}` };
  }

  const learner = await login(user.username);
  const learnerSession = (await app.ctx.db.findOne('sessions', {
    secretHash: hashSecret(learner.authorization.slice(7)),
  }))!;
  const otherLearner = await login(other.username);
  const agent = await issueAgent(user.id);
  const topic = {
    ...baseRecord(),
    ownerId: user.id,
    title: '生命周期测试',
    goalText: '验证学习证据的生命周期',
    archivedAt: null,
  };
  await app.ctx.db.insert('topics', topic);
  const questions = [];
  for (const definition of definitions) {
    const question = {
      ...baseRecord(),
      ownerId: user.id,
      topicId: topic.id,
      version: 1,
      definition: structuredClone(definition),
      archivedAt: null,
    };
    await app.ctx.db.insert('questions', question);
    await app.ctx.db.insert('questionVersions', {
      ...baseRecord(),
      ownerId: user.id,
      questionId: question.id,
      version: 1,
      definition: structuredClone(definition),
    });
    questions.push(question);
  }
  const assessment: Assessment = {
    ...baseRecord(),
    ownerId: user.id,
    topicId: topic.id,
    kind,
    title: '生命周期试卷',
    durationSeconds: 3600,
    items: questions.map((question) => ({
      questionId: question.id,
      questionVersion: 1,
      maxScore: '10.00',
    })),
    archivedAt: null,
  };
  await app.ctx.db.insert('assessments', assessment);
  const tasks: LearningPlan['phases'][number]['tasks'] = [0, 1].map((index) => ({
    id: id(),
    title: `关联同一试卷的任务 ${index + 1}`,
    kind,
    targetId: assessment.id,
    scheduledDate: null,
    estimatedMinutes: null,
    status: 'todo',
    completedAt: null,
  }));
  const plan: LearningPlan = {
    ...baseRecord(),
    ownerId: user.id,
    topicId: topic.id,
    title: '显式关联计划',
    phases: [{ id: id(), title: '第一阶段', tasks }],
    archivedAt: null,
  };
  await app.ctx.db.insert('plans', plan);

  async function taskStates() {
    const plans = await api<LearningPlan[]>('GET', `/topics/${topic.id}/plans`, learner);
    return plans.find((candidate) => candidate.id === plan.id)!.phases[0].tasks;
  }

  async function start(input: Input = {}, entry: Entry = 'personal') {
    if (entry === 'personal') {
      const attempt = await api<AttemptView>(
        'POST',
        `/assessments/${assessment.id}/attempts`,
        learner,
        input,
        201,
      );
      return { attempt, headers: learner, entry };
    }
    const link = await api<AnswerLinkCreated>(
      'POST',
      `/agent/assessments/${assessment.id}/answer-links`,
      agent,
      { expiresInSeconds: 3600, ...input },
      201,
    );
    const headers = { 'x-answer-link-token': new URL(link.answerUrl).hash.slice(1) };
    const attempt = await api<AttemptView>('POST', '/public/answer/attempt', headers, {});
    expect(await app.ctx.db.get('answerLinks', link.id)).toMatchObject({
      ownerId: user.id,
      purpose: input.purpose ?? 'learning',
      taskId: input.taskId ?? null,
      attemptId: attempt.id,
    });
    return { attempt, headers, entry };
  }

  type Session = Awaited<ReturnType<typeof start>>;
  async function save(session: Session, answer: Answer, index = 0) {
    const item = session.attempt.items[index];
    const url =
      session.entry === 'personal'
        ? `/attempts/${session.attempt.id}/answers/${item.id}`
        : `/public/answer/attempt/items/${item.id}`;
    return api<AttemptItemView>('PUT', url, session.headers, {
      expectedRevision: item.answerRevision,
      answer,
    });
  }

  async function submit(session: Session) {
    const url =
      session.entry === 'personal'
        ? `/attempts/${session.attempt.id}/submit`
        : '/public/answer/attempt/submit';
    return api<AttemptView>('POST', url, session.headers, {});
  }

  async function report(attemptId: string) {
    return api<AttemptReport>('GET', `/attempts/${attemptId}/report`, learner);
  }

  async function dashboard(headers = learner) {
    return api<Dashboard>('GET', '/dashboard', headers);
  }

  async function summary() {
    return api<{ recentAttempts: AttemptView[]; wrongQuestions: WrongQuestion[] }>(
      'GET',
      '/agent/learning-summary',
      agent,
    );
  }

  async function voidAttempt(attemptId: string, headers = learner, reason = '撤销无效学习证据') {
    const current = (await app.ctx.db.get('attempts', attemptId))!;
    const prefix = headers === learner ? '' : '/agent';
    return api<AttemptView>('POST', `${prefix}/attempts/${attemptId}/void`, headers, {
      expectedRevision: current.revision,
      reason,
    });
  }

  async function grade(itemId: string, expectedGradeVersion: number, levelId: string) {
    return api('POST', `/agent/attempt-items/${itemId}/grades`, agent, {
      expectedGradeVersion,
      criterionResults: [
        {
          criterionId: 'atomicity',
          levelId,
          explanation: '按冻结标准判断',
          evidence: ['全部操作成功'],
        },
      ],
      ...(expectedGradeVersion > 0 ? { reason: '复核遗漏的评分证据' } : {}),
    });
  }

  return {
    app,
    user,
    other,
    learner,
    otherLearner,
    learnerActorId: learnerSession.id,
    agent,
    issueAgent,
    api,
    topic,
    questions,
    assessment,
    plan,
    tasks,
    taskStates,
    start,
    save,
    submit,
    report,
    dashboard,
    summary,
    voidAttempt,
    grade,
  };
}

describe('attempt HTTP lifecycle', () => {
  it.each<Entry>(['personal', 'answer_link'])(
    'fully grades test attempts from %s without changing personal learning evidence',
    async (entry) => {
      const f = await setup('exam', [ruleDefinition, externalDefinition]);
      const learning = await f.start();
      const test = await f.start({ purpose: 'test', taskId: f.tasks[0].id }, entry);
      expect(test.attempt.id).not.toBe(learning.attempt.id);
      expect(test.attempt).toMatchObject({
        purpose: 'test',
        taskId: f.tasks[0].id,
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
      });
      expect((await f.taskStates()).map((task) => task.status)).toEqual(['todo', 'todo']);
      await f.save(test, { value: false });
      await f.save(test, { text: '全部操作成功' }, 1);
      expect((await f.submit(test)).status).toBe('pending_grading');
      await f.grade(test.attempt.items[1].id, 0, 'partial');
      const report = await f.report(test.attempt.id);
      expect(report).toMatchObject({
        isFinal: true,
        awardedScore: '5.00',
        pendingMaxScore: '0.00',
        attempt: { purpose: 'test', status: 'completed', source: entry },
      });
      expect(report.attempt.items.map((item) => item.answerStatus)).toEqual([
        'answered',
        'answered',
      ]);
      expect(report.attempt.items.map((item) => item.grade?.source)).toEqual([
        'rule',
        'external_agent',
      ]);
      expect((await f.taskStates()).map((task) => task.status)).toEqual(['todo', 'todo']);
      expect(await f.dashboard()).toMatchObject({
        completedAttempts: 0,
        pendingGrading: 0,
        wrongQuestions: 0,
        pendingTasks: 2,
        recentAttempts: [{ id: learning.attempt.id, purpose: 'learning' }],
      });
      const summary = await f.summary();
      expect(summary.recentAttempts.map((attempt) => attempt.id)).toEqual([learning.attempt.id]);
      expect(summary.wrongQuestions).toEqual([]);
      expect(await f.api('GET', '/wrong-questions', f.learner)).toEqual([]);
      expect(await f.app.ctx.db.list('wrongQuestions', { ownerId: f.user.id })).toEqual([]);
    },
  );

  it.each([
    { entry: 'personal', status: 'in_progress' },
    { entry: 'personal', status: 'completed' },
    { entry: 'answer_link', status: 'in_progress' },
    { entry: 'answer_link', status: 'completed' },
  ] as const)(
    'never changes an existing $status task when a $entry test attempt starts, submits or is voided',
    async ({ entry, status }) => {
      const f = await setup();
      const learning = await f.start({ taskId: f.tasks[0].id });
      if (status === 'completed') {
        await f.save(learning, { value: true });
        await f.submit(learning);
      }
      const before = await f.app.ctx.db.get('plans', f.plan.id);
      expect(before!.phases[0].tasks[0].status).toBe(status);
      const test = await f.start({ purpose: 'test', taskId: f.tasks[0].id }, entry);
      expect(test.attempt.id).not.toBe(learning.attempt.id);
      expect(await f.app.ctx.db.get('plans', f.plan.id)).toEqual(before);
      await f.save(test, { value: false });
      expect(await f.app.ctx.db.get('plans', f.plan.id)).toEqual(before);
      await f.submit(test);
      expect(await f.app.ctx.db.get('plans', f.plan.id)).toEqual(before);
      expect(await f.report(test.attempt.id)).toMatchObject({
        isFinal: true,
        awardedScore: '0.00',
        attempt: { purpose: 'test' },
      });
      await f.voidAttempt(test.attempt.id);
      expect(await f.app.ctx.db.get('plans', f.plan.id)).toEqual(before);
      expect((await f.taskStates())[0]).toEqual(before!.phases[0].tasks[0]);
      expect(await f.dashboard()).toMatchObject({
        completedAttempts: status === 'completed' ? 1 : 0,
        wrongQuestions: 0,
        recentAttempts: [{ id: learning.attempt.id, purpose: 'learning' }],
      });
      expect((await f.summary()).recentAttempts.map((attempt) => attempt.id)).toEqual([
        learning.attempt.id,
      ]);
    },
  );

  it.each<Entry>(['personal', 'answer_link'])(
    'rejects foreign or mismatched tasks and invalid purposes before creating %s resources',
    async (entry) => {
      const f = await setup();
      const foreignTopic = {
        ...f.topic,
        ...baseRecord(),
        ownerId: f.other.id,
      };
      await f.app.ctx.db.insert('topics', foreignTopic);
      const foreignTask = {
        ...f.tasks[0],
        id: id(),
        kind: 'manual' as const,
        targetId: null,
      };
      const foreignPlan: LearningPlan = {
        ...f.plan,
        ...baseRecord(),
        ownerId: f.other.id,
        topicId: foreignTopic.id,
        phases: [{ id: id(), title: '其他用户的计划', tasks: [foreignTask] }],
      };
      await f.app.ctx.db.insert('plans', foreignPlan);
      const otherAssessment = { ...f.assessment, ...baseRecord() };
      await f.app.ctx.db.insert('assessments', otherAssessment);
      const wrongTarget = { ...f.tasks[0], id: id(), targetId: otherAssessment.id };
      const wrongKind = { ...f.tasks[0], id: id(), kind: 'practice' as const };
      const mismatchPlan: LearningPlan = {
        ...f.plan,
        ...baseRecord(),
        phases: [{ id: id(), title: '不匹配的目标', tasks: [wrongTarget, wrongKind] }],
      };
      await f.app.ctx.db.insert('plans', mismatchPlan);
      const plansBefore = await f.app.ctx.db.list('plans');
      const auditBefore = await f.app.ctx.db.list('auditLogs');
      const cases: [Input, number, string][] = [
        [{ taskId: foreignTask.id }, 404, 'NOT_FOUND'],
        [{ taskId: wrongTarget.id }, 422, 'TASK_TARGET_MISMATCH'],
        [{ taskId: wrongKind.id }, 422, 'TASK_TARGET_MISMATCH'],
        [{ purpose: null }, 422, 'INVALID_PURPOSE'],
        [{ purpose: '' }, 422, 'INVALID_PURPOSE'],
        [{ purpose: 'preview' }, 422, 'INVALID_PURPOSE'],
        [{ purpose: 0 }, 422, 'INVALID_PURPOSE'],
      ];
      const url =
        entry === 'personal'
          ? `/assessments/${f.assessment.id}/attempts`
          : `/agent/assessments/${f.assessment.id}/answer-links`;
      for (const [payload, status, code] of cases) {
        const response = await f.app.inject({
          method: 'POST',
          url: '/api/v1' + url,
          headers: entry === 'personal' ? f.learner : f.agent,
          payload,
        });
        expect(response.statusCode).toBe(status);
        expect(response.json().error.code).toBe(code);
      }
      expect(await f.app.ctx.db.list('attempts')).toEqual([]);
      expect(await f.app.ctx.db.list('answerLinks')).toEqual([]);
      expect(await f.app.ctx.db.list('plans')).toEqual(plansBefore);
      expect(await f.app.ctx.db.list('auditLogs')).toEqual(auditBefore);
    },
  );

  it('attributes anonymous learning, mistakes and only the explicit task to the link owner', async () => {
    const f = await setup();
    const session = await f.start({ taskId: f.tasks[0].id }, 'answer_link');
    expect(session.attempt).toMatchObject({ purpose: 'learning', source: 'answer_link' });
    expect(session.attempt).not.toHaveProperty('ownerId');
    expect(session.attempt).not.toHaveProperty('answerLinkId');
    expect(await f.app.ctx.db.get('attempts', session.attempt.id)).toMatchObject({
      ownerId: f.user.id,
      purpose: 'learning',
      taskId: f.tasks[0].id,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    });
    expect((await f.taskStates()).map((task) => task.status)).toEqual(['in_progress', 'todo']);
    await f.save(session, { value: false });
    await f.submit(session);
    const tasks = await f.taskStates();
    expect(tasks[0]).toMatchObject({ status: 'completed', completedAt: expect.any(String) });
    expect(tasks[1]).toMatchObject({ status: 'todo', completedAt: null });
    expect(await f.dashboard()).toMatchObject({
      completedAttempts: 1,
      wrongQuestions: 1,
      pendingTasks: 1,
      recentAttempts: [{ id: session.attempt.id, source: 'answer_link' }],
    });
    expect(await f.api<WrongQuestion[]>('GET', '/wrong-questions', f.learner)).toMatchObject([
      { ownerId: f.user.id, questionId: f.questions[0].id, wrongCount: 1 },
    ]);
    expect(await f.summary()).toMatchObject({
      recentAttempts: [{ id: session.attempt.id, ownerId: f.user.id }],
      wrongQuestions: [{ ownerId: f.user.id, wrongCount: 1 }],
    });
    expect(await f.dashboard(f.otherLearner)).toMatchObject({
      completedAttempts: 0,
      wrongQuestions: 0,
      recentAttempts: [],
    });
    const forbidden = await f.app.inject({
      url: `/api/v1/attempts/${session.attempt.id}/report`,
      headers: f.otherLearner,
    });
    expect(forbidden.statusCode).toBe(404);
  });

  it.each<Entry>(['personal', 'answer_link'])(
    'does not infer task association for unlinked learning from %s',
    async (entry) => {
      const f = await setup();
      const session = await f.start({}, entry);
      expect(session.attempt).toMatchObject({ purpose: 'learning', taskId: null });
      await f.save(session, { value: true });
      await f.submit(session);
      expect((await f.taskStates()).map((task) => task.status)).toEqual(['todo', 'todo']);
      expect(await f.dashboard()).toMatchObject({ completedAttempts: 1, pendingTasks: 2 });
    },
  );

  it.each<Entry>(['personal', 'answer_link'])(
    'voids %s evidence, removes mistakes and retracts its task without deleting grading history',
    async (entry) => {
      const f = await setup('exam', [externalDefinition]);
      const session = await f.start({ taskId: f.tasks[0].id }, entry);
      await f.save(session, { text: '全部操作成功' });
      await f.submit(session);
      const itemId = session.attempt.items[0].id;
      await f.grade(itemId, 0, 'not_met');
      await f.grade(itemId, 1, 'partial');
      const before = (await f.app.ctx.db.get('attempts', session.attempt.id))!;
      const auditBefore = await f.app.ctx.db.list('auditLogs');
      expect(before.items[0]).toMatchObject({
        grade: { version: 2, score: '5.00' },
        gradingHistory: [{ version: 1, score: '0.00' }],
      });
      expect(await f.dashboard()).toMatchObject({ completedAttempts: 1, wrongQuestions: 1 });
      expect((await f.taskStates())[0].status).toBe('completed');
      const result = await f.voidAttempt(session.attempt.id);
      expect(result).toMatchObject({
        voidedAt: expect.any(String),
        voidedBy: f.learnerActorId,
        voidReason: '撤销无效学习证据',
        revision: before.revision + 1,
      });
      const after = (await f.app.ctx.db.get('attempts', session.attempt.id))!;
      expect(after.items).toEqual(before.items);
      expect(after.submittedAt).toBe(before.submittedAt);
      expect(after.status).toBe(before.status);
      const auditAfter = await f.app.ctx.db.list('auditLogs');
      expect(auditAfter).toEqual(expect.arrayContaining(auditBefore));
      expect(auditAfter.filter((row) => row.action === 'attempt.void')).toMatchObject([
        { resourceId: before.id, actorId: f.learnerActorId, ownerId: f.user.id },
      ]);
      expect(await f.app.ctx.db.list('wrongQuestions', { ownerId: f.user.id })).toEqual([]);
      expect(
        (await f.taskStates()).map((task) => ({
          status: task.status,
          completedAt: task.completedAt,
        })),
      ).toEqual([
        { status: 'todo', completedAt: null },
        { status: 'todo', completedAt: null },
      ]);
      expect(await f.dashboard()).toMatchObject({
        completedAttempts: 0,
        wrongQuestions: 0,
        pendingTasks: 2,
        recentAttempts: [],
      });
      expect(await f.summary()).toMatchObject({ recentAttempts: [], wrongQuestions: [] });
      expect(await f.report(before.id)).toMatchObject({
        isFinal: true,
        awardedScore: '5.00',
        attempt: { voidedAt: after.voidedAt },
      });
      expect(await f.api<AttemptView[]>('GET', '/attempts', f.learner)).toMatchObject([
        { id: before.id, voidedAt: after.voidedAt },
      ]);
      const rejectedGrade = await f.app.inject({
        method: 'POST',
        url: `/api/v1/agent/attempt-items/${itemId}/grades`,
        headers: f.agent,
        payload: { expectedGradeVersion: 2, reason: '不能恢复作废证据', criterionResults: [] },
      });
      expect(rejectedGrade.statusCode).toBe(409);
      expect(rejectedGrade.json().error.code).toBe('ATTEMPT_VOIDED');
      expect(await f.app.ctx.db.get('attempts', before.id)).toEqual(after);
    },
  );

  it('keeps a task completed when another valid learning attempt still supports it', async () => {
    const f = await setup();
    const first = await f.start({ taskId: f.tasks[0].id });
    await f.save(first, { value: false });
    await f.submit(first);
    const second = await f.start({ taskId: f.tasks[0].id }, 'answer_link');
    await f.save(second, { value: true });
    const completed = await f.submit(second);
    await f.voidAttempt(first.attempt.id);
    expect((await f.taskStates())[0]).toMatchObject({
      status: 'completed',
      completedAt: completed.submittedAt,
    });
    expect((await f.taskStates())[1]).toMatchObject({ status: 'todo', completedAt: null });
    expect(await f.dashboard()).toMatchObject({
      completedAttempts: 1,
      wrongQuestions: 0,
      pendingTasks: 1,
      recentAttempts: [{ id: second.attempt.id }],
    });
    expect((await f.summary()).recentAttempts.map((attempt) => attempt.id)).toEqual([
      second.attempt.id,
    ]);
    expect(await f.app.ctx.db.list('wrongQuestions', { ownerId: f.user.id })).toEqual([]);
    await f.voidAttempt(second.attempt.id);
    expect((await f.taskStates())[0]).toMatchObject({ status: 'todo', completedAt: null });
  });

  it('commits only one concurrent void for the same expectedRevision', async () => {
    const f = await setup();
    const session = await f.start({ taskId: f.tasks[0].id });
    await f.save(session, { value: false });
    await f.submit(session);
    const before = (await f.app.ctx.db.get('attempts', session.attempt.id))!;
    const responses = await Promise.all(
      ['第一次作废', '并发作废'].map((reason) =>
        f.app.inject({
          method: 'POST',
          url: `/api/v1/attempts/${before.id}/void`,
          headers: f.learner,
          payload: { expectedRevision: before.revision, reason },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winner = responses.find((response) => response.statusCode === 200)!.json().data;
    expect(responses.find((response) => response.statusCode === 409)!.json().error.code).toBe(
      'VERSION_CONFLICT',
    );
    expect(await f.app.ctx.db.get('attempts', before.id)).toMatchObject({
      revision: before.revision + 1,
      voidReason: winner.voidReason,
      items: before.items,
    });
    expect(
      await f.app.ctx.db.list('auditLogs', { action: 'attempt.void', resourceId: before.id }),
    ).toHaveLength(1);
    expect((await f.taskStates())[0]).toMatchObject({ status: 'todo', completedAt: null });
    const repeated = await f.app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${before.id}/void`,
      headers: f.learner,
      payload: { expectedRevision: winner.revision, reason: '重复作废' },
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json().error.code).toBe('ATTEMPT_VOIDED');
  });

  it('requires attempt:write and enforces ownership even for another administrator', async () => {
    const f = await setup();
    const session = await f.start();
    const before = (await f.app.ctx.db.get('attempts', session.attempt.id))!;
    const missingScope = await f.issueAgent(
      f.user.id,
      AGENT_SCOPES.filter((scope) => scope !== 'attempt:write'),
    );
    const otherAgent = await f.issueAgent(f.other.id);
    for (const [prefix, headers, expectedStatus] of [
      ['', f.otherLearner, 404],
      ['/agent', otherAgent, 404],
      ['/agent', missingScope, 403],
    ] as const) {
      const response = await f.app.inject({
        method: 'POST',
        url: `/api/v1${prefix}/attempts/${before.id}/void`,
        headers,
        payload: { expectedRevision: before.revision, reason: '无权作废' },
      });
      expect(response.statusCode).toBe(expectedStatus);
    }
    expect(await f.app.ctx.db.get('attempts', before.id)).toEqual(before);
    expect(await f.app.ctx.db.list('auditLogs', { action: 'attempt.void' })).toEqual([]);
    // The new scope alone suffices; content/grading write scopes are not substitutes.
    const writer = await f.issueAgent(f.user.id, ['attempt:write']);
    const result = await f.voidAttempt(before.id, writer, '仅作答管理权限');
    const token = writer.authorization.split('.')[1];
    expect(result).toMatchObject({ voidedBy: token, voidReason: '仅作答管理权限' });
    expect(await f.app.ctx.db.list('auditLogs', { action: 'attempt.void' })).toMatchObject([
      { actorId: token, ownerId: f.user.id, resourceId: before.id },
    ]);
  });

  it.each(['', '/agent'])(
    'validates revision, reason length and forbidden facts on %s/attempts/:id/void',
    async (prefix) => {
      const f = await setup();
      const session = await f.start();
      const before = (await f.app.ctx.db.get('attempts', session.attempt.id))!;
      const headers = prefix ? f.agent : f.learner;
      const valid = { expectedRevision: before.revision, reason: '合法原因' };
      const cases: [Input, number, string][] = [
        [{ reason: '缺少版本' }, 422, 'INVALID_REVISION'],
        [{ ...valid, expectedRevision: 0 }, 422, 'INVALID_REVISION'],
        [{ ...valid, expectedRevision: '1' }, 422, 'INVALID_REVISION'],
        [{ ...valid, expectedRevision: before.revision + 1 }, 409, 'VERSION_CONFLICT'],
        [{ expectedRevision: before.revision }, 422, 'INVALID_FIELD'],
        [{ ...valid, reason: '   ' }, 422, 'INVALID_FIELD'],
        [{ ...valid, reason: '作'.repeat(4001) }, 422, 'INVALID_FIELD'],
        [{ ...valid, score: '10.00' }, 400, 'CLIENT_FIELD_FORBIDDEN'],
      ];
      for (const [payload, status, code] of cases) {
        const response = await f.app.inject({
          method: 'POST',
          url: `/api/v1${prefix}/attempts/${before.id}/void`,
          headers,
          payload,
        });
        expect(response.statusCode).toBe(status);
        expect(response.json().error.code).toBe(code);
        expect(await f.app.ctx.db.get('attempts', before.id)).toEqual(before);
      }
      expect(await f.app.ctx.db.list('auditLogs', { action: 'attempt.void' })).toEqual([]);
      await f.api('POST', `${prefix}/attempts/${before.id}/void`, headers, {
        ...valid,
        reason: '作'.repeat(4000),
      });
    },
  );

  it('rolls back void metadata, mistakes, tasks, jobs and inserted audit on audit failure', async () => {
    const f = await setup('exam', [ruleDefinition, modelDefinition]);
    const session = await f.start({ taskId: f.tasks[0].id });
    await f.save(session, { value: false });
    await f.save(session, { text: '全部操作成功' }, 1);
    await f.submit(session);
    const before = {
      attempt: await f.app.ctx.db.get('attempts', session.attempt.id),
      plan: await f.app.ctx.db.get('plans', f.plan.id),
      wrong: await f.app.ctx.db.list('wrongQuestions'),
      jobs: await f.app.ctx.db.list('gradingJobs'),
      audit: await f.app.ctx.db.list('auditLogs'),
      dashboard: await f.dashboard(),
    };
    expect(before.wrong).toHaveLength(1);
    expect(before.jobs).toMatchObject([{ status: 'blocked_config' }]);
    expect(before.plan!.phases[0].tasks[0].status).toBe('completed');
    const audit = f.app.ctx.audit.bind(f.app.ctx);
    const auditSpy = vi.spyOn(f.app.ctx, 'audit').mockImplementation(async (...args) => {
      await audit(...args);
      if (args[1] === 'attempt.void') throw new Error('Injected audit failure');
    });
    const response = await f.app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${session.attempt.id}/void`,
      headers: f.learner,
      payload: { expectedRevision: before.attempt!.revision, reason: '验证事务回滚' },
    });
    expect(response.statusCode).toBe(500);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.anything(),
      'attempt.void',
      'attempt',
      session.attempt.id,
      {},
      expect.anything(),
    );
    expect(await f.app.ctx.db.get('attempts', session.attempt.id)).toEqual(before.attempt);
    expect(await f.app.ctx.db.get('plans', f.plan.id)).toEqual(before.plan);
    expect(await f.app.ctx.db.list('wrongQuestions')).toEqual(before.wrong);
    expect(await f.app.ctx.db.list('gradingJobs')).toEqual(before.jobs);
    expect(await f.app.ctx.db.list('auditLogs')).toEqual(before.audit);
    expect(await f.dashboard()).toEqual(before.dashboard);
    auditSpy.mockRestore();
    await f.voidAttempt(session.attempt.id);
    expect(await f.app.ctx.db.list('gradingJobs')).toMatchObject([{ status: 'cancelled' }]);
    expect(await f.app.ctx.db.list('wrongQuestions')).toEqual([]);
    expect((await f.taskStates())[0].status).toBe('todo');
  });

  it.each<Entry>(['personal', 'answer_link'])(
    'rejects saving, item submission and overall submission after voiding an ongoing %s attempt',
    async (entry) => {
      const f = await setup('practice');
      const session = await f.start({ taskId: f.tasks[0].id }, entry);
      await f.save(session, { value: false });
      await f.voidAttempt(session.attempt.id);
      const before = await f.app.ctx.db.get('attempts', session.attempt.id);
      const itemId = session.attempt.items[0].id;
      const requests =
        entry === 'personal'
          ? [
              {
                method: 'PUT' as const,
                url: `/attempts/${session.attempt.id}/answers/${itemId}`,
                payload: { expectedRevision: 1, answer: { value: true } },
              },
              {
                method: 'POST' as const,
                url: `/attempts/${session.attempt.id}/items/${itemId}/submit`,
                payload: {},
              },
              {
                method: 'POST' as const,
                url: `/attempts/${session.attempt.id}/submit`,
                payload: {},
              },
            ]
          : [
              {
                method: 'PUT' as const,
                url: `/public/answer/attempt/items/${itemId}`,
                payload: { expectedRevision: 1, answer: { value: true } },
              },
              {
                method: 'POST' as const,
                url: `/public/answer/attempt/items/${itemId}/submit`,
                payload: {},
              },
              { method: 'POST' as const, url: '/public/answer/attempt/submit', payload: {} },
            ];
      for (const request of requests) {
        const response = await f.app.inject({
          ...request,
          url: '/api/v1' + request.url,
          headers: session.headers,
        });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe('ATTEMPT_VOIDED');
      }
      expect(await f.app.ctx.db.get('attempts', session.attempt.id)).toEqual(before);
      expect(await f.app.ctx.db.list('gradingJobs')).toEqual([]);
      expect(await f.app.ctx.db.list('wrongQuestions')).toEqual([]);
      expect((await f.taskStates())[0]).toMatchObject({ status: 'todo', completedAt: null });
    },
  );

  it('cancels every active job state and blocks subsequent retry or regrade without losing answers', async () => {
    const f = await setup('exam', [modelDefinition]);
    const session = await f.start({ taskId: f.tasks[0].id });
    await f.save(session, { text: '全部操作成功' });
    await f.submit(session);
    const before = (await f.app.ctx.db.get('attempts', session.attempt.id))!;
    const [job] = await f.app.ctx.db.list('gradingJobs', { attemptId: before.id });
    expect(job.status).toBe('blocked_config');
    // Additional job generations model queued/running/retry/budget and terminal history.
    const statuses: GradingJob['status'][] = [
      'queued',
      'running',
      'retry_wait',
      'blocked_budget',
      'succeeded',
      'failed',
      'cancelled',
    ];
    for (const [index, status] of statuses.entries()) {
      await f.app.ctx.db.insert('gradingJobs', {
        ...job,
        ...baseRecord(),
        generation: index + 2,
        status,
        leaseExpiresAt: status === 'running' ? new Date(Date.now() + 60000).toISOString() : null,
        nextRunAt: now(),
      });
    }
    const jobsBefore = await f.app.ctx.db.list('gradingJobs', { attemptId: before.id });
    await f.voidAttempt(before.id);
    const after = (await f.app.ctx.db.get('attempts', before.id))!;
    expect(after.items).toEqual(before.items);
    const terminal = new Set<GradingJob['status']>(['succeeded', 'failed', 'cancelled']);
    const updatedAt = expect.any(String);
    for (const original of jobsBefore) {
      const saved = await f.app.ctx.db.get('gradingJobs', original.id);
      const expected = terminal.has(original.status)
        ? original
        : {
            ...original,
            status: 'cancelled',
            leaseExpiresAt: null,
            lastErrorCode: 'ATTEMPT_VOIDED',
            revision: original.revision + 1,
            updatedAt,
          };
      expect(saved).toEqual(expected);
    }
    const jobsAfter = await f.app.ctx.db.list('gradingJobs', { attemptId: before.id });
    for (const request of [
      { url: `/agent/grading-jobs/${job.id}/retry`, payload: {} },
      {
        url: `/agent/attempt-items/${before.items[0].id}/regrade`,
        payload: { expectedGradeVersion: 1, reason: '不能重评作废作答' },
      },
    ]) {
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/v1' + request.url,
        headers: f.agent,
        payload: request.payload,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('ATTEMPT_VOIDED');
    }
    await f.app.ctx.grading.runOnce();
    expect(await f.app.ctx.db.get('attempts', before.id)).toEqual(after);
    expect(await f.app.ctx.db.list('gradingJobs', { attemptId: before.id })).toEqual(jobsAfter);
    expect(await f.dashboard()).toMatchObject({ pendingGrading: 0, recentAttempts: [] });
  });

  it.each<Assessment['kind']>(['practice', 'exam'])(
    'settles fully blank %s with system grades and no mistakes, completing only exam tasks',
    async (kind) => {
      const f = await setup(kind, [ruleDefinition, externalDefinition, modelDefinition]);
      const session = await f.start({ taskId: f.tasks[0].id });
      expect(session.attempt.items.map((item) => item.answerStatus)).toEqual([
        'unanswered',
        'unanswered',
        'unanswered',
      ]);
      // Cover both missing answers and explicitly saved whitespace-only answers.
      await f.save(session, { text: ' \n\t ' }, 1);
      await f.save(session, { text: '   ' }, 2);
      const submitted = await f.submit(session);
      expect(submitted.status).toBe('completed');
      const report = await f.report(session.attempt.id);
      expect(report).toMatchObject({
        isFinal: true,
        awardedScore: '0.00',
        pendingMaxScore: '0.00',
        unansweredCount: 3,
      });
      for (const item of report.attempt.items) {
        expect(item).toMatchObject({
          answerStatus: 'unanswered',
          gradingStatus: 'completed',
          grade: { source: 'system', score: '0.00', maxScore: '10.00' },
        });
      }
      const tasks = await f.taskStates();
      expect(tasks[0]).toMatchObject({
        status: kind === 'exam' ? 'completed' : 'in_progress',
        completedAt: kind === 'exam' ? submitted.submittedAt : null,
      });
      expect(tasks[1]).toMatchObject({ status: 'todo', completedAt: null });
      expect(await f.app.ctx.db.list('wrongQuestions')).toEqual([]);
      expect(await f.api('GET', '/wrong-questions', f.learner)).toEqual([]);
      expect((await f.summary()).wrongQuestions).toEqual([]);
      expect(await f.app.ctx.db.list('gradingJobs')).toEqual([]);
      expect(await f.dashboard()).toMatchObject({
        completedAttempts: 1,
        wrongQuestions: 0,
        pendingGrading: 0,
        pendingTasks: kind === 'exam' ? 1 : 2,
      });
    },
  );
});
