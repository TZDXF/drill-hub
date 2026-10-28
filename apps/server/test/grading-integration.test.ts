import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Answer, Attempt, QuestionDefinition } from '@drill-hub/contracts';
import { createApp } from '#server/app.js';
import { baseRecord, id, now } from '#server/core/ids.js';
import type { Database } from '#server/db/database.js';
import { refreshAttempt } from '#server/modules/learning/helpers.js';
import { gradeRubric, zeroCriterionEvaluations } from '#server/modules/grading/engine.js';

const PASSWORD = 'Test-only-password-42!';
const apps: FastifyInstance[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setupApp() {
  const app = await createApp({
    databasePath: ':memory:',
    encryptionKey: 'a'.repeat(64),
    startWorkers: false,
    bootstrapAdmin: { username: 'admin', password: PASSWORD },
  });
  apps.push(app);
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/web/login',
    payload: { username: 'admin', password: PASSWORD },
  });
  const value = login.json().data;
  const cookie = login.cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
  return {
    app,
    admin: { cookie, 'x-csrf-token': value.csrfToken },
    ownerId: value.user.id as string,
  };
}

function criterion(idValue: string, weight = 1, slotId?: string) {
  return {
    id: idValue,
    description: `${idValue} 的明确标准`,
    weight,
    ...(slotId ? { slotId } : {}),
    levels: [
      { id: 'not_met', creditBps: 0, description: '未达成' },
      { id: 'partial', creditBps: 5000, description: '部分达成' },
      { id: 'met', creditBps: 10000, description: '达成' },
    ],
  };
}

function modelDefinition(): QuestionDefinition {
  return {
    type: 'short_answer',
    stem: '说明原子性并举例',
    gradingMode: 'model_rubric',
    referenceAnswer: '全部成功或回滚并举例',
    rubric: { version: 1, criteria: [criterion('atomicity', 6), criterion('example', 4)] },
  };
}

function fillDefinition(): QuestionDefinition {
  return {
    type: 'fill_blank',
    stem: '填写 A 和 I',
    gradingMode: 'model_rubric',
    slots: [{ id: 'a' }, { id: 'i' }],
    rubric: {
      version: 1,
      criteria: [criterion('a-criterion', 1, 'a'), criterion('i-criterion', 1, 'i')],
    },
  };
}

function responseWithCriteria(
  criteria: unknown[],
  summary = '模型逐项判断',
  status = 200,
): Response {
  return new Response(
    JSON.stringify({
      model: 'actual-provider-model',
      choices: [
        {
          finish_reason: 'stop',
          message: { refusal: null, content: JSON.stringify({ criteria, summary }) },
        },
      ],
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

type ProviderResponder = (
  request: Record<string, any>,
  payload: any,
) => Response | Promise<Response>;

function installProvider(
  responder: ProviderResponder,
  options: { models?: unknown[]; catalog?: unknown } = {},
) {
  const chatRequests: Record<string, any>[] = [];
  const fake = vi.fn<typeof fetch>(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === 'https://models.dev/api.json')
      return new Response(JSON.stringify(options.catalog ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    if (String(url).endsWith('/models'))
      return new Response(JSON.stringify({ data: options.models ?? [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const request = JSON.parse(String(init?.body));
    chatRequests.push(request);
    const payload = JSON.parse(request.messages[1].content);
    return responder(request, payload);
  });
  vi.stubGlobal('fetch', fake);
  return { fake, chatRequests };
}

async function configureModel(
  app: FastifyInstance,
  admin: Record<string, string>,
  options: { maxRetries?: number; secret?: string } = {},
) {
  const secret = options.secret ?? 'test-only-provider-secret';
  const connectionResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/model-connections',
    headers: admin,
    payload: {
      displayName: '动态测试供应商',
      protocol: 'chat_completions',
      baseUrl: 'http://provider.test/v1/',
      apiKey: secret,
    },
  });
  expect(connectionResponse.statusCode).toBe(201);
  const connection = connectionResponse.json().data;
  expect(connectionResponse.body).not.toContain(secret);
  expect(connectionResponse.body).not.toContain('encryptedApiKey');
  const connectionTest = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/model-connections/${connection.id}/test`,
    headers: admin,
    payload: {},
  });
  expect(connectionTest.statusCode).toBe(200);
  const modelResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/model-connections/${connection.id}/models`,
    headers: admin,
    payload: { modelKey: 'configured-model', displayName: '动态测试模型' },
  });
  expect(modelResponse.statusCode).toBe(201);
  const model = modelResponse.json().data;
  const configured = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/provider-models/${model.id}`,
    headers: admin,
    payload: {
      expectedRevision: model.revision,
      contextWindow: 262144,
      maxTokens: 32768,
      reasoning: true,
      input: ['text', 'image'],
      costPerMillion: { input: 1.5, output: 6, cacheRead: 0.15, cacheWrite: 0 },
    },
  });
  expect(configured.statusCode).toBe(200);
  expect(configured.json().data).toMatchObject({
    contextWindow: 262144,
    maxTokens: 32768,
    reasoning: true,
    input: ['text', 'image'],
    costPerMillion: { input: 1.5, output: 6, cacheRead: 0.15, cacheWrite: 0 },
  });
  const invalidCost = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/provider-models/${model.id}`,
    headers: admin,
    payload: {
      expectedRevision: configured.json().data.revision,
      costPerMillion: { input: -1, output: 6, cacheRead: 0, cacheWrite: 0 },
    },
  });
  expect(invalidCost.statusCode).toBe(422);
  const profileResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/grading-profiles',
    headers: admin,
    payload: {
      providerModelId: model.id,
      isDefault: true,
      maxRetries: options.maxRetries ?? 2,
      timeoutMs: 1_000,
    },
  });
  expect(profileResponse.statusCode).toBe(201);
  return {
    connection,
    model: configured.json().data,
    profile: profileResponse.json().data,
    secret,
  };
}

async function agentHeaders(
  app: FastifyInstance,
  admin: Record<string, string>,
): Promise<Record<string, string>> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/me/agent-tokens',
    headers: admin,
    payload: { name: 'grading integration', scopes: ['read', 'grade:write', 'grading:request'] },
  });
  expect(response.statusCode).toBe(200);
  return { authorization: `Bearer ${response.json().data.token}` };
}

async function lockedAttempt(
  app: FastifyInstance,
  ownerId: string,
  definition: QuestionDefinition,
  answer: Answer | null,
  purpose: Attempt['purpose'] = 'learning',
): Promise<Attempt> {
  const item = {
    id: id(),
    questionId: `question-${id()}`,
    questionVersion: 1,
    definition: structuredClone(definition),
    maxScore: '10',
    answer,
    answerRevision: answer === null ? 0 : 1,
    lockedAt: null,
    gradingStatus: 'not_started' as const,
    generation: 0,
    grade: null,
    gradingHistory: [],
  };
  const attempt: Attempt = {
    ...baseRecord(),
    ownerId,
    topicId: 'topic-test',
    assessmentId: null,
    answerLinkId: null,
    purpose,
    taskId: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    title: '评分集成测试',
    kind: 'practice',
    status: 'in_progress',
    startedAt: now(),
    expiresAt: null,
    submittedAt: now(),
    submissionReason: 'user_submitted',
    items: [item],
  };
  await app.ctx.db.insert('attempts', attempt);
  return app.ctx.db.transaction(async (tx) => {
    const current = (await tx.get('attempts', attempt.id))!;
    current.items[0].lockedAt = now();
    await app.ctx.grading.gradeLockedItem(tx, current, current.items[0]);
    return refreshAttempt(tx, current);
  });
}

async function currentAttempt(app: FastifyInstance, attemptId: string): Promise<Attempt> {
  return (await app.ctx.db.get('attempts', attemptId))!;
}

describe('grading administration and persistent model workflow', () => {
  it('edits the grading model as a new profile while retaining bound jobs', async () => {
    const { app, admin, ownerId } = await setupApp();
    const calls: string[] = [];
    installProvider((request) => {
      calls.push(request.model);
      return responseWithCriteria(zeroCriterionEvaluations(modelDefinition()));
    });
    const configured = await configureModel(app, admin);
    expect(configured.profile.concurrency).toBe(2);
    expect(configured.profile).not.toHaveProperty('promptVersion');
    const originalAttempt = await lockedAttempt(app, ownerId, modelDefinition(), {
      text: '旧任务',
    });
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/model-connections/${configured.connection.id}/models`,
      headers: admin,
      payload: { modelKey: 'replacement-model', displayName: '替换模型' },
    });
    const model = added.json().data;
    const change = {
      expectedRevision: configured.profile.revision,
      providerModelId: model.id,
      concurrency: 3,
      timeoutMs: 2000,
      maxRetries: 1,
    };
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/grading-profiles/${configured.profile.id}`,
      headers: admin,
      payload: change,
    });
    expect(edited.statusCode).toBe(200);
    const replacement = edited.json().data;
    expect(replacement.id).not.toBe(configured.profile.id);
    expect(replacement).toMatchObject({
      providerModelId: model.id,
      modelIdSnapshot: 'replacement-model',
      concurrency: 3,
      timeoutMs: 2000,
      maxRetries: 1,
      isDefault: true,
    });
    expect(await app.ctx.db.get('gradingProfiles', configured.profile.id)).toMatchObject({
      providerModelId: configured.model.id,
      concurrency: 2,
      timeoutMs: 1000,
      maxRetries: 2,
      isDefault: false,
    });
    expect((await app.ctx.db.get('settings', 'global'))?.defaultGradingProfileId).toBe(
      replacement.id,
    );
    const repeated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/grading-profiles/${configured.profile.id}`,
      headers: admin,
      payload: change,
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json().error.code).toBe('VERSION_CONFLICT');
    const newerAttempt = await lockedAttempt(app, ownerId, modelDefinition(), { text: '新任务' });
    expect(
      (await app.ctx.db.list('gradingJobs', { attemptId: originalAttempt.id }))[0].profileId,
    ).toBe(configured.profile.id);
    expect(
      (await app.ctx.db.list('gradingJobs', { attemptId: newerAttempt.id }))[0].profileId,
    ).toBe(replacement.id);
    await app.ctx.grading.runOnce();
    expect(calls.sort()).toEqual(['configured-model', 'replacement-model']);
    for (const attempt of [originalAttempt, newerAttempt])
      expect((await currentAttempt(app, attempt.id)).items[0].gradingStatus).toBe('completed');
    const listed = await app.inject({ url: '/api/v1/admin/grading-profiles', headers: admin });
    expect(listed.json().data.every((profile: object) => !('promptVersion' in profile))).toBe(true);
    const adapters = await app.inject({ url: '/api/v1/admin/model-adapters', headers: admin });
    expect(adapters.json().data[0]).not.toHaveProperty('promptVersions');
    const audits = await app.ctx.db.list('auditLogs', { action: 'grading_profile.updated' });
    expect(audits[0].summary).toMatchObject({
      previousProfileId: configured.profile.id,
      concurrency: 3,
    });
  });

  it('rejects invalid concurrency, removed prompt versions and edits without revisions', async () => {
    const { app, admin } = await setupApp();
    installProvider(() => {
      throw new Error('unexpected grading call');
    });
    const configured = await configureModel(app, admin);
    for (const concurrency of [0, 21, 1.5, '2', null]) {
      for (const method of ['POST', 'PATCH'] as const) {
        const response = await app.inject({
          method,
          url: `/api/v1/admin/grading-profiles${method === 'PATCH' ? `/${configured.profile.id}` : ''}`,
          headers: admin,
          payload: {
            providerModelId: configured.model.id,
            concurrency,
            expectedRevision: method === 'PATCH' ? configured.profile.revision : undefined,
          },
        });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe('INVALID_FIELD');
      }
    }
    const removed = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/grading-profiles',
      headers: admin,
      payload: { providerModelId: configured.model.id, promptVersion: 'rubric-v1' },
    });
    expect(removed.statusCode).toBe(400);
    expect(removed.json().error.code).toBe('CLIENT_FIELD_FORBIDDEN');
    const missingRevision = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/grading-profiles/${configured.profile.id}`,
      headers: admin,
      payload: { concurrency: 3 },
    });
    expect(missingRevision.statusCode).toBe(422);
    expect(missingRevision.json().error.code).toBe('INVALID_REVISION');
  });

  it.each([1, 2, 3])(
    'runs at most %i model calls concurrently and refills available slots',
    async (limit) => {
      const { app, admin, ownerId } = await setupApp();
      let active = 0;
      let peak = 0;
      let completed = 0;
      const releases: (() => void)[] = [];
      installProvider(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        active -= 1;
        completed += 1;
        return responseWithCriteria(zeroCriterionEvaluations(modelDefinition()));
      });
      const configured = await configureModel(app, admin);
      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/grading-profiles/${configured.profile.id}`,
        headers: admin,
        payload: { expectedRevision: configured.profile.revision, concurrency: limit },
      });
      expect(updated.statusCode).toBe(200);
      for (let index = 0; index < 5; index += 1)
        await lockedAttempt(app, ownerId, modelDefinition(), { text: `答案 ${index}` });
      const running = app.ctx.grading.runOnce();
      expect(app.ctx.grading.runOnce()).toBe(running);
      try {
        await vi.waitFor(() => expect(releases).toHaveLength(limit));
        expect(await app.ctx.db.list('gradingJobs', { status: 'running' })).toHaveLength(limit);
        releases.shift()!();
        // One completion must free a slot without waiting for the rest of the batch.
        await vi.waitFor(() => expect(releases).toHaveLength(limit));
        while (completed < 5) {
          releases.splice(0).forEach((release) => release());
          await vi.waitFor(() => expect(completed === 5 || releases.length > 0).toBe(true));
        }
        await running;
        expect(peak).toBe(limit);
        expect(
          (await app.ctx.db.list('gradingJobs')).every((job) => job.status === 'succeeded'),
        ).toBe(true);
      } finally {
        // Release any blocked calls even when an assertion fails.
        releases.splice(0).forEach((release) => release());
      }
    },
  );

  it('does not let a saturated historical profile block jobs on another configuration', async () => {
    const { app, admin, ownerId } = await setupApp();
    const releases: (() => void)[] = [];
    let releaseAll = false;
    installProvider(async () => {
      if (!releaseAll)
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      return responseWithCriteria(zeroCriterionEvaluations(modelDefinition()));
    });
    const configured = await configureModel(app, admin);
    const single = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/grading-profiles/${configured.profile.id}`,
      headers: admin,
      payload: { expectedRevision: configured.profile.revision, concurrency: 1 },
    });
    expect(single.statusCode).toBe(200);
    for (let index = 0; index < 2; index += 1)
      await lockedAttempt(app, ownerId, modelDefinition(), { text: `旧配置答案 ${index}` });
    const parallel = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/grading-profiles/${single.json().data.id}`,
      headers: admin,
      payload: { expectedRevision: single.json().data.revision, concurrency: 2 },
    });
    expect(parallel.statusCode).toBe(200);
    for (let index = 0; index < 2; index += 1)
      await lockedAttempt(app, ownerId, modelDefinition(), { text: `新配置答案 ${index}` });
    const running = app.ctx.grading.runOnce();
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(3));
      const active = await app.ctx.db.list('gradingJobs', { status: 'running' });
      expect(active.filter((job) => job.profileId === single.json().data.id)).toHaveLength(1);
      expect(active.filter((job) => job.profileId === parallel.json().data.id)).toHaveLength(2);
    } finally {
      releaseAll = true;
      releases.splice(0).forEach((release) => release());
      await running;
    }
    expect((await app.ctx.db.list('gradingJobs')).every((job) => job.status === 'succeeded')).toBe(
      true,
    );
  });

  it('tests connection form values without creating a connection', async () => {
    const { app, admin } = await setupApp();
    const provider = installProvider(() => {
      throw new Error('unexpected grading call');
    });
    const tested = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/model-connections/test',
      headers: admin,
      payload: {
        baseUrl: 'http://provider.test/v1/',
        apiKey: 'draft-test-only-provider-secret',
      },
    });
    expect(tested.statusCode).toBe(200);
    expect(tested.body).not.toContain('draft-test-only-provider-secret');
    expect(tested.json().data).toEqual({ tested: true, connectionId: null });
    expect(provider.fake).toHaveBeenCalledWith(
      expect.stringContaining('/models'),
      expect.objectContaining({ method: 'GET' }),
    );
    const list = await app.inject({ url: '/api/v1/admin/model-connections', headers: admin });
    expect(list.json().data).toEqual([]);
  });

  it('discovers and imports provider models without duplicating existing entries', async () => {
    const { app, admin } = await setupApp();
    installProvider(
      () => {
        throw new Error('unexpected grading call');
      },
      {
        models: [
          { id: 'model-a', name: 'Model A' },
          { id: 'model-b' },
          { id: 'existing-model', name: 'Existing Model' },
        ],
        catalog: {
          test: {
            models: {
              'model-a': {
                reasoning: true,
                modalities: { input: ['text', 'image'] },
                limit: { context: 128000, output: 8192 },
                cost: { input: 1, output: 2, cache_read: 0.1 },
              },
            },
          },
        },
      },
    );
    const connectionResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/model-connections',
      headers: admin,
      payload: {
        displayName: '模型发现测试供应商',
        protocol: 'chat_completions',
        baseUrl: 'http://provider.test/v1',
        apiKey: 'discovery-test-only-secret',
      },
    });
    expect(connectionResponse.statusCode).toBe(201);
    const connection = connectionResponse.json().data;
    const existing = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/model-connections/${connection.id}/models`,
      headers: admin,
      payload: { modelKey: 'existing-model', displayName: 'Existing Model' },
    });
    expect(existing.statusCode).toBe(201);

    const discovered = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/model-connections/${connection.id}/models/discover`,
      headers: admin,
      payload: {},
    });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.json().data.models).toEqual([
      { modelKey: 'model-a', displayName: 'Model A' },
      { modelKey: 'model-b' },
      { modelKey: 'existing-model', displayName: 'Existing Model' },
    ]);
    expect(discovered.body).not.toContain('discovery-test-only-secret');

    const imported = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/model-connections/${connection.id}/models/import`,
      headers: admin,
      payload: {
        models: [
          { modelKey: 'model-a', displayName: 'Model A' },
          { modelKey: 'model-b' },
          { modelKey: 'existing-model' },
          { modelKey: 'model-a' },
        ],
      },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data.created.map((model: any) => model.modelKey)).toEqual([
      'model-a',
      'model-b',
    ]);
    expect(imported.json().data.skipped).toEqual(['existing-model', 'model-a']);
    expect(imported.json().data.created[0]).toMatchObject({
      modelKey: 'model-a',
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: true,
      input: ['text', 'image'],
      costPerMillion: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    });
    expect(imported.json().data.created[1]).toMatchObject({
      modelKey: 'model-b',
      contextWindow: null,
      maxTokens: null,
    });

    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/model-connections/${connection.id}/models/import`,
      headers: admin,
      payload: { models: [{ modelKey: 'model-a' }] },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data).toEqual({ created: [], skipped: ['model-a'] });

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/model-connections/${connection.id}/models`,
      headers: admin,
    });
    expect(
      listed
        .json()
        .data.map((model: any) => model.modelKey)
        .sort(),
    ).toEqual(['existing-model', 'model-a', 'model-b']);
  });

  it('manages dynamic providers/models without echoing vault secrets and rebinds profiles after rotation', async () => {
    const { app, admin } = await setupApp();
    installProvider(() => {
      throw new Error('unexpected grading call');
    });
    const configured = await configureModel(app, admin);
    expect(configured.model).not.toHaveProperty('verifiedConfigVersion');
    expect(configured.model).not.toHaveProperty('testError');
    const removedTest = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/provider-models/${configured.model.id}/test`,
      headers: admin,
      payload: {},
    });
    expect(removedTest.statusCode).toBe(404);
    expect(await app.ctx.db.list('modelUsage')).toHaveLength(0);
    expect((await app.ctx.db.get('settings', 'global'))?.defaultGradingProfileId).toBe(
      configured.profile.id,
    );
    const referencedDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/provider-models/${configured.model.id}`,
      headers: admin,
      payload: { expectedRevision: configured.model.revision },
    });
    expect(referencedDelete.statusCode).toBe(409);
    expect(referencedDelete.json().error.code).toBe('MODEL_IN_USE');
    expect(await app.ctx.db.get('providerModels', configured.model.id)).not.toBeNull();

    const spareResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/model-connections/${configured.connection.id}/models`,
      headers: admin,
      payload: { modelKey: 'spare-model' },
    });
    const spare = spareResponse.json().data;
    const staleDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/provider-models/${spare.id}`,
      headers: admin,
      payload: { expectedRevision: spare.revision + 1 },
    });
    expect(staleDelete.statusCode).toBe(409);
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/provider-models/${spare.id}`,
      headers: admin,
      payload: { expectedRevision: spare.revision },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toEqual({ deleted: true, id: spare.id });
    expect(await app.ctx.db.get('providerModels', spare.id)).toBeUndefined();
    const list = await app.inject({ url: '/api/v1/admin/model-connections', headers: admin });
    expect(list.body).not.toContain(configured.secret);
    expect(list.body).not.toContain('encryptedApiKey');
    expect(list.json().data[0].apiKeyConfigured).toBe(true);

    const rotatedSecret = 'rotated-test-only-secret';
    const rotated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/model-connections/${configured.connection.id}`,
      headers: admin,
      payload: { expectedRevision: configured.connection.revision, apiKey: rotatedSecret },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().data.configVersion).toBe(2);
    expect(rotated.body).not.toContain(rotatedSecret);
    const rebind = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/grading-profiles',
      headers: admin,
      payload: { providerModelId: configured.model.id, isDefault: true },
    });
    expect(rebind.statusCode).toBe(201);
    expect(rebind.json().data.connectionVersionId).not.toBe(configured.profile.connectionVersionId);
    expect((await app.ctx.db.get('gradingProfiles', configured.profile.id))?.isDefault).toBe(false);
    expect((await app.ctx.db.get('settings', 'global'))?.defaultGradingProfileId).toBe(
      rebind.json().data.id,
    );
  });

  it.each(['learning', 'test'] as const)(
    'computes model grades and regrades with history (%s)',
    async (purpose) => {
      const { app, admin, ownerId } = await setupApp();
      let actualCalls = 0;
      const provider = installProvider(() => {
        actualCalls += 1;
        if (actualCalls === 1) {
          return responseWithCriteria(
            [
              {
                criterionId: 'atomicity',
                levelId: 'partial',
                evidence: ['事务全部成功或全部回滚'],
                explanation: '部分',
              },
              { criterionId: 'example', levelId: 'not_met', evidence: [], explanation: '首次漏判' },
            ],
            '首次结果',
          );
        }
        return responseWithCriteria(
          [
            {
              criterionId: 'atomicity',
              levelId: 'met',
              evidence: ['事务全部成功或全部回滚'],
              explanation: '达成',
            },
            {
              criterionId: 'example',
              levelId: 'met',
              evidence: ['转账一起完成'],
              explanation: '例子有效',
            },
          ],
          '重评结果',
        );
      });
      await configureModel(app, admin);
      const answer = { text: '事务全部成功或全部回滚；转账一起完成。' };
      const attempt = await lockedAttempt(app, ownerId, modelDefinition(), answer, purpose);
      await app.ctx.grading.runOnce();
      let current = await currentAttempt(app, attempt.id);
      expect(current.items[0].grade).toMatchObject({
        version: 1,
        score: '3.00',
        modelId: 'actual-provider-model',
      });
      expect(current.status).toBe('completed');
      const wrongQuestion = await app.ctx.db.findOne('wrongQuestions', {
        ownerId,
        questionId: current.items[0].questionId,
      });
      expect(Boolean(wrongQuestion)).toBe(purpose === 'learning');

      const agent = await agentHeaders(app, admin);
      const reason = '首次结果遗漏已有例子，请按原得分项重评';
      const regrade = await app.inject({
        method: 'POST',
        url: `/api/v1/agent/attempt-items/${current.items[0].id}/regrade`,
        headers: agent,
        payload: { expectedGradeVersion: 1, reason },
      });
      expect(regrade.statusCode).toBe(202);
      current = await currentAttempt(app, attempt.id);
      expect(current.items[0]).toMatchObject({
        generation: 2,
        gradingStatus: 'pending',
        grade: { score: '3.00' },
      });
      expect(current.status).toBe('completed');
      await app.ctx.grading.runOnce();
      current = await currentAttempt(app, attempt.id);
      expect(current.items[0].grade).toMatchObject({
        version: 2,
        score: '10.00',
        feedback: '重评结果',
      });
      expect(current.items[0].gradingHistory).toHaveLength(1);
      expect(current.items[0].gradingHistory[0].score).toBe('3.00');
      expect(
        await app.ctx.db.findOne('wrongQuestions', {
          ownerId,
          questionId: current.items[0].questionId,
        }),
      ).toBeUndefined();
      expect(provider.chatRequests).toHaveLength(2);
      expect(JSON.stringify(provider.chatRequests[1])).not.toContain(reason);
      expect(JSON.stringify(provider.chatRequests[1])).not.toContain(ownerId);
    },
  );

  it.each(['learning', 'test'] as const)(
    'fails visibly and supports owned job retry (%s)',
    async (purpose) => {
      const { app, admin, ownerId } = await setupApp();
      let actualCalls = 0;
      installProvider(() => {
        actualCalls += 1;
        if (actualCalls === 1)
          return new Response('{"providerSecret":"do-not-store"}', { status: 500 });
        return responseWithCriteria([
          {
            criterionId: 'atomicity',
            levelId: 'met',
            evidence: ['事务全部成功或全部回滚'],
            explanation: '达成',
          },
          {
            criterionId: 'example',
            levelId: 'met',
            evidence: ['转账一起完成'],
            explanation: '达成',
          },
        ]);
      });
      await configureModel(app, admin, { maxRetries: 0 });
      const attempt = await lockedAttempt(
        app,
        ownerId,
        modelDefinition(),
        {
          text: '事务全部成功或全部回滚；转账一起完成。',
        },
        purpose,
      );
      await app.ctx.grading.runOnce();
      let current = await currentAttempt(app, attempt.id);
      let job = (await app.ctx.db.list('gradingJobs', { attemptId: attempt.id }))[0];
      expect(job).toMatchObject({ status: 'failed', lastErrorCode: 'MODEL_PROVIDER_UNAVAILABLE' });
      expect(current.items[0]).toMatchObject({ gradingStatus: 'failed', grade: null });
      expect(current.status).toBe('pending_grading');
      const agent = await agentHeaders(app, admin);
      const jobs = await app.inject({ url: '/api/v1/agent/grading-jobs', headers: agent });
      expect(jobs.statusCode).toBe(200);
      expect(jobs.body).not.toContain('providerSecret');
      expect(jobs.body).not.toContain('事务全部成功');
      const retry = await app.inject({
        method: 'POST',
        url: `/api/v1/agent/grading-jobs/${job.id}/retry`,
        headers: agent,
        payload: { expectedRevision: job.revision },
      });
      expect(retry.statusCode).toBe(202);
      await app.ctx.grading.runOnce();
      current = await currentAttempt(app, attempt.id);
      job = (await app.ctx.db.get('gradingJobs', job.id))!;
      expect(job.status).toBe('succeeded');
      expect(current.items[0].grade?.score).toBe('10.00');
      expect(current.status).toBe('completed');
    },
  );

  it('automatically recovers an unbound configuration-blocked job when a default appears', async () => {
    const { app, admin, ownerId } = await setupApp();
    const provider = installProvider(() =>
      responseWithCriteria([
        {
          criterionId: 'atomicity',
          levelId: 'met',
          evidence: ['事务全部成功或全部回滚'],
          explanation: '正确',
        },
        { criterionId: 'example', levelId: 'met', evidence: ['转账一起完成'], explanation: '正确' },
      ]),
    );
    const attempt = await lockedAttempt(app, ownerId, modelDefinition(), {
      text: '事务全部成功或全部回滚；转账一起完成。',
    });
    const before = (await app.ctx.db.list('gradingJobs', { attemptId: attempt.id }))[0];
    expect(before).toMatchObject({
      status: 'blocked_config',
      profileId: null,
      lastErrorCode: 'DEFAULT_PROFILE_NOT_CONFIGURED',
    });
    await app.ctx.grading.runOnce();
    expect((await app.ctx.db.get('gradingJobs', before.id))?.revision).toBe(before.revision);
    const configured = await configureModel(app, admin);
    const calls = provider.chatRequests.length;
    await app.ctx.grading.runOnce();
    expect(await app.ctx.db.get('gradingJobs', before.id)).toMatchObject({
      status: 'succeeded',
      profileId: configured.profile.id,
      attemptCount: 1,
    });
    expect(provider.chatRequests).toHaveLength(calls + 1);
    expect((await currentAttempt(app, attempt.id)).items[0].grade?.score).toBe('10.00');
  });

  it('recovers a bound disabled-model job only after its original model is enabled', async () => {
    const { app, admin, ownerId } = await setupApp();
    installProvider(() =>
      responseWithCriteria([
        {
          criterionId: 'atomicity',
          levelId: 'met',
          evidence: ['事务全部成功或全部回滚'],
          explanation: '正确',
        },
        { criterionId: 'example', levelId: 'met', evidence: ['转账一起完成'], explanation: '正确' },
      ]),
    );
    const configured = await configureModel(app, admin);
    const model = (await app.ctx.db.get('providerModels', configured.model.id))!;
    await app.ctx.db.update('providerModels', model.id, model.revision, { enabled: false });
    const attempt = await lockedAttempt(app, ownerId, modelDefinition(), {
      text: '事务全部成功或全部回滚；转账一起完成。',
    });
    await app.ctx.grading.runOnce();
    let job = (await app.ctx.db.list('gradingJobs', { attemptId: attempt.id }))[0];
    expect(job).toMatchObject({
      status: 'blocked_config',
      profileId: configured.profile.id,
      lastErrorCode: 'MODEL_DISABLED',
      attemptCount: 1,
    });
    await app.ctx.grading.runOnce();
    expect((await app.ctx.db.get('gradingJobs', job.id))?.revision).toBe(job.revision);
    const disabled = (await app.ctx.db.get('providerModels', model.id))!;
    await app.ctx.db.update('providerModels', disabled.id, disabled.revision, { enabled: true });
    await app.ctx.grading.runOnce();
    job = (await app.ctx.db.get('gradingJobs', job.id))!;
    expect(job).toMatchObject({
      status: 'succeeded',
      profileId: configured.profile.id,
      attemptCount: 2,
    });
  });

  it('keeps a successful grade when usage persistence fails', async () => {
    const { app, admin, ownerId } = await setupApp();
    const provider = installProvider(() =>
      responseWithCriteria([
        {
          criterionId: 'atomicity',
          levelId: 'met',
          evidence: ['事务全部成功或全部回滚'],
          explanation: '正确',
        },
        { criterionId: 'example', levelId: 'met', evidence: ['转账一起完成'], explanation: '正确' },
      ]),
    );
    await configureModel(app, admin);
    const attempt = await lockedAttempt(app, ownerId, modelDefinition(), {
      text: '事务全部成功或全部回滚；转账一起完成。',
    });
    const original = app.ctx.db.insert.bind(app.ctx.db);
    const spy = vi.spyOn(app.ctx.db, 'insert').mockImplementation(((
      table: string,
      record: never,
    ) => {
      if (table === 'modelUsage') throw new Error('usage unavailable');
      return original(table as never, record);
    }) as typeof app.ctx.db.insert);
    const before = provider.chatRequests.length;
    try {
      await app.ctx.grading.runOnce();
      expect((await app.ctx.db.list('gradingJobs', { attemptId: attempt.id }))[0].status).toBe(
        'succeeded',
      );
      expect((await currentAttempt(app, attempt.id)).items[0].grade?.score).toBe('10.00');
      expect(provider.chatRequests.length).toBe(before + 1);
    } finally {
      spy.mockRestore();
    }
  });

  it('records each billed retry and successful grading without storing answers or keys', async () => {
    const { app, admin, ownerId } = await setupApp();
    let count = 0;
    installProvider(() => {
      count += 1;
      return new Response(
        JSON.stringify({
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
          choices: [
            {
              finish_reason: count === 1 ? 'length' : 'stop',
              message: {
                content: JSON.stringify({
                  criteria: [
                    {
                      criterionId: 'atomicity',
                      levelId: 'met',
                      evidence: ['事务全部成功或全部回滚'],
                      explanation: '正确',
                    },
                    {
                      criterionId: 'example',
                      levelId: 'met',
                      evidence: ['转账一起完成'],
                      explanation: '正确',
                    },
                  ],
                  summary: '完成',
                }),
              },
            },
          ],
        }),
      );
    });
    await configureModel(app, admin);
    const attempt = await lockedAttempt(app, ownerId, modelDefinition(), {
      text: '事务全部成功或全部回滚；转账一起完成。',
    });
    await app.ctx.grading.runOnce();
    const job = (await app.ctx.db.list('gradingJobs', { attemptId: attempt.id }))[0]!;
    expect(job.status).toBe('retry_wait');
    await app.ctx.db.update('gradingJobs', job.id, job.revision, { nextRunAt: now() });
    await app.ctx.grading.runOnce();
    expect((await currentAttempt(app, attempt.id)).items[0].gradingStatus).toBe('completed');
    const records = await app.ctx.db.list('modelUsage');
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.purpose === 'grading')).toBe(true);
    expect(
      records
        .filter((record) => record.jobId === job.id)
        .map((record) => record.status)
        .sort(),
    ).toEqual(['failed', 'succeeded']);
    expect(
      records
        .filter((record) => record.jobId === job.id)
        .every((record) => record.usage?.totalTokens === 120),
    ).toBe(true);
    expect(records.every((record) => record.ownerId === ownerId)).toBe(true);
    expect(JSON.stringify(records)).not.toContain('test-only-provider-secret');
    expect(JSON.stringify(records)).not.toContain('事务全部成功');
    const result = await app.inject({ url: '/api/v1/me/token-usage', headers: admin });
    expect(result.json().data.totals).toMatchObject({
      calls: 2,
      failedCalls: 1,
      unknownUsageCalls: 0,
      totalTokens: 240,
    });
  });

  it('does not call or bill for blank answers and fixes blank fill slots to zero during partial grading', async () => {
    const { app, admin, ownerId } = await setupApp();
    const provider = installProvider((_request, payload) => {
      expect(payload.instructions.pendingCriterionIds).toEqual(['a-criterion']);
      return responseWithCriteria([
        { criterionId: 'a-criterion', levelId: 'met', evidence: ['原子性'], explanation: '正确' },
      ]);
    });
    await configureModel(app, admin);
    const callsAfterConfig = provider.chatRequests.length;
    const blank = await lockedAttempt(app, ownerId, modelDefinition(), { text: '  ' });
    expect(blank.items[0].grade).toMatchObject({
      score: '0.00',
      source: 'system',
      feedback: '未作答',
    });
    expect(await app.ctx.db.list('gradingJobs', { attemptId: blank.id })).toHaveLength(0);
    expect(await app.ctx.db.list('modelUsage')).toHaveLength(callsAfterConfig);
    const partial = await lockedAttempt(app, ownerId, fillDefinition(), {
      slots: { a: '原子性', i: ' ' },
    });
    await app.ctx.grading.runOnce();
    const current = await currentAttempt(app, partial.id);
    expect(current.items[0].grade?.score).toBe('5.00');
    expect(
      current.items[0].grade?.criterionResults.find(
        (result) => result.criterionId === 'i-criterion',
      ),
    ).toMatchObject({ score: '0.00', evidence: [] });
    expect(provider.chatRequests).toHaveLength(callsAfterConfig + 1);
  });

  it('recovers an expired persisted lease instead of losing the queue item', async () => {
    const { app, admin, ownerId } = await setupApp();
    installProvider(() =>
      responseWithCriteria([
        {
          criterionId: 'atomicity',
          levelId: 'met',
          evidence: ['事务全部成功或全部回滚'],
          explanation: '达成',
        },
        { criterionId: 'example', levelId: 'met', evidence: ['转账一起完成'], explanation: '达成' },
      ]),
    );
    await configureModel(app, admin);
    const attempt = await lockedAttempt(app, ownerId, modelDefinition(), {
      text: '事务全部成功或全部回滚；转账一起完成。',
    });
    const job = (await app.ctx.db.list('gradingJobs', { attemptId: attempt.id }))[0];
    await app.ctx.db.update('gradingJobs', job.id, job.revision, {
      status: 'running',
      leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    await app.ctx.grading.runOnce();
    const current = await currentAttempt(app, attempt.id);
    expect((await app.ctx.db.get('gradingJobs', job.id))?.status).toBe('succeeded');
    expect(current.items[0].grade?.score).toBe('10.00');
  });

  it('drops an old generation response instead of overwriting a newer grade', async () => {
    const { app, admin, ownerId } = await setupApp();
    let releaseOld!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let defer = false;
    installProvider(async () => {
      if (defer) {
        markStarted();
        await gate;
        return responseWithCriteria(
          [
            { criterionId: 'atomicity', levelId: 'not_met', evidence: [], explanation: '旧结果' },
            { criterionId: 'example', levelId: 'not_met', evidence: [], explanation: '旧结果' },
          ],
          'old generation',
        );
      }
      return responseWithCriteria([
        {
          criterionId: 'atomicity',
          levelId: 'met',
          evidence: ['事务全部成功或全部回滚'],
          explanation: '达成',
        },
        { criterionId: 'example', levelId: 'met', evidence: ['转账一起完成'], explanation: '达成' },
      ]);
    });
    await configureModel(app, admin);
    const definition = modelDefinition();
    const answer = { text: '事务全部成功或全部回滚；转账一起完成。' };
    const attempt = await lockedAttempt(app, ownerId, definition, answer);
    await app.ctx.grading.runOnce();
    const agent = await agentHeaders(app, admin);
    const regrade = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/attempt-items/${attempt.items[0].id}/regrade`,
      headers: agent,
      payload: { expectedGradeVersion: 1, reason: '测试旧响应 CAS' },
    });
    expect(regrade.statusCode).toBe(202);
    defer = true;
    const running = app.ctx.grading.runOnce();
    await started;
    await app.ctx.db.transaction(async (tx) => {
      const current = (await tx.get('attempts', attempt.id))!;
      const item = current.items[0];
      const newer = gradeRubric(
        definition,
        answer,
        '10',
        [
          {
            criterionId: 'atomicity',
            levelId: 'met',
            evidence: ['事务全部成功或全部回滚'],
            explanation: '新结果',
          },
          {
            criterionId: 'example',
            levelId: 'met',
            evidence: ['转账一起完成'],
            explanation: '新结果',
          },
        ],
        { source: 'model', version: 2, feedback: 'newer generation', modelId: 'new-model' },
      );
      item.gradingHistory = [...item.gradingHistory, item.grade!];
      item.grade = newer;
      item.generation += 1;
      item.gradingStatus = 'completed';
      await refreshAttempt(tx, current);
    });
    releaseOld();
    await running;
    const current = await currentAttempt(app, attempt.id);
    expect(current.items[0].generation).toBe(3);
    expect(current.items[0].grade).toMatchObject({
      score: '10.00',
      feedback: 'newer generation',
      modelId: 'new-model',
    });
    expect(await app.ctx.db.get('gradingJobs', regrade.json().data.id)).toMatchObject({
      status: 'failed',
      lastErrorCode: 'STALE_GRADING_RESULT',
    });
  });
});

describe('external rubric routes', () => {
  it.each(['learning', 'test'] as const)(
    'grades external criteria and corrects with reasons (%s)',
    async (purpose) => {
      const { app, admin, ownerId } = await setupApp();
      const definition = modelDefinition();
      definition.gradingMode = 'external_rubric';
      const attempt = await lockedAttempt(
        app,
        ownerId,
        definition,
        {
          text: '事务全部成功或全部回滚；转账一起完成。',
        },
        purpose,
      );
      expect(attempt.items[0].gradingStatus).toBe('pending');
      expect(await app.ctx.db.list('gradingJobs')).toHaveLength(0);
      const agent = await agentHeaders(app, admin);
      const queue = await app.inject({ url: '/api/v1/agent/grading-queue', headers: agent });
      expect(queue.statusCode).toBe(200);
      expect(queue.json().data).toHaveLength(1);
      const itemId = attempt.items[0].id;
      const evaluations = [
        {
          criterionId: 'atomicity',
          levelId: 'partial',
          evidence: ['事务全部成功或全部回滚'],
          explanation: '部分',
        },
        {
          criterionId: 'example',
          levelId: 'met',
          evidence: ['转账一起完成'],
          explanation: '例子有效',
        },
      ];
      const forged = await app.inject({
        method: 'POST',
        url: `/api/v1/agent/attempt-items/${itemId}/grades`,
        headers: agent,
        payload: { expectedGradeVersion: 0, criterionResults: evaluations, score: '10.00' },
      });
      expect(forged.statusCode).toBe(400);
      const graded = await app.inject({
        method: 'POST',
        url: `/api/v1/agent/attempt-items/${itemId}/grades`,
        headers: agent,
        payload: { expectedGradeVersion: 0, criterionResults: evaluations },
      });
      expect(graded.statusCode).toBe(200);
      expect(graded.json().data.grade).toMatchObject({
        source: 'external_agent',
        version: 1,
        score: '7.00',
      });
      const noReason = await app.inject({
        method: 'POST',
        url: `/api/v1/agent/attempt-items/${itemId}/grades`,
        headers: agent,
        payload: { expectedGradeVersion: 1, criterionResults: evaluations },
      });
      expect(noReason.statusCode).toBe(422);
      expect(noReason.json().error.code).toBe('REGRADE_REASON_REQUIRED');
      const correctedEvaluations = evaluations.map((evaluation) => ({
        ...evaluation,
        levelId: 'not_met',
        evidence: [],
      }));
      const corrected = await app.inject({
        method: 'POST',
        url: `/api/v1/agent/attempt-items/${itemId}/grades`,
        headers: agent,
        payload: {
          expectedGradeVersion: 1,
          criterionResults: correctedEvaluations,
          reason: '修正首次等级判断',
        },
      });
      expect(corrected.statusCode).toBe(200);
      expect(corrected.json().data.grade).toMatchObject({
        version: 2,
        score: '0.00',
        reason: '修正首次等级判断',
      });
      const current = await currentAttempt(app, attempt.id);
      expect(current.items[0].gradingHistory).toHaveLength(1);
      expect(current.items[0].gradingHistory[0].score).toBe('7.00');

      const modelAttempt = await lockedAttempt(app, ownerId, modelDefinition(), {
        text: '不能由外部批改覆盖',
      });
      const forbidden = await app.inject({
        method: 'POST',
        url: `/api/v1/agent/attempt-items/${modelAttempt.items[0].id}/grades`,
        headers: agent,
        payload: { expectedGradeVersion: 0, criterionResults: evaluations },
      });
      expect(forbidden.statusCode).toBe(409);
      expect(forbidden.json().error.code).toBe('GRADING_MODE_FORBIDDEN');
    },
  );
});

// Deliberately bypass the learning void route: worker guards must be sufficient even
// when a running job has not yet been cancelled by that route.
async function persistVoid(app: FastifyInstance, attemptId: string): Promise<Attempt> {
  return app.ctx.db.transaction(async (tx) => {
    const attempt = (await tx.get('attempts', attemptId))!;
    return tx.update('attempts', attempt.id, attempt.revision, {
      voidedAt: now(),
      voidedBy: attempt.ownerId,
      voidReason: '评分作废保护测试',
    });
  });
}

async function gradingState(app: FastifyInstance, attemptId: string, db = app.ctx.db) {
  return {
    attempt: await db.get('attempts', attemptId),
    wrongQuestions: await db.list('wrongQuestions'),
    plans: await db.list('plans'),
    auditLogs: await db.list('auditLogs'),
  };
}

describe('system blank grades and voided-attempt protection', () => {
  it('keeps blank rule/model/external reports final without model jobs or external grades for either purpose', async () => {
    const { app, admin, ownerId } = await setupApp();
    const provider = installProvider(() => {
      throw new Error('空白答案不得调用模型');
    });
    for (const purpose of ['learning', 'test'] as const) {
      for (const gradingMode of ['rule', 'model_rubric', 'external_rubric'] as const) {
        const short: QuestionDefinition =
          gradingMode === 'rule'
            ? { type: 'true_false', stem: '判断', gradingMode, gradingKey: { value: true } }
            : { ...modelDefinition(), gradingMode };
        const fill: QuestionDefinition =
          gradingMode === 'rule'
            ? {
                type: 'fill_blank',
                stem: '填空',
                gradingMode,
                slots: [{ id: 'a' }, { id: 'i' }],
                gradingKey: { acceptedAnswers: { a: ['A'], i: ['I'] } },
              }
            : { ...fillDefinition(), gradingMode };
        const cases: [QuestionDefinition, Answer | null][] = [
          [short, null],
          [fill, null],
          [fill, { slots: { a: ' \n', i: '\t' } }],
        ];
        if (gradingMode !== 'rule') cases.push([short, { text: ' \t\n' }]);
        for (const [definition, answer] of cases) {
          const attempt = await lockedAttempt(app, ownerId, definition, answer, purpose);
          expect(attempt.status).toBe('completed');
          expect(attempt.items[0]).toMatchObject({
            gradingStatus: 'completed',
            grade: { version: 1, source: 'system', score: '0.00', feedback: '未作答' },
          });
          expect(attempt.items[0].grade).not.toHaveProperty('modelId');
          const report = await app.inject({
            url: `/api/v1/attempts/${attempt.id}/report`,
            headers: admin,
          });
          expect(report.statusCode).toBe(200);
          expect(report.json().data).toMatchObject({
            isFinal: true,
            awardedScore: '0.00',
            maxScore: '10.00',
            pendingMaxScore: '0.00',
          });
          expect(report.json().data.attempt.items[0].grade).toMatchObject({
            source: 'system',
            feedback: '未作答',
          });
        }
      }
    }
    await app.ctx.grading.runOnce();
    expect(await app.ctx.db.list('gradingJobs')).toHaveLength(0);
    expect(provider.fake).not.toHaveBeenCalled();
    const agent = await agentHeaders(app, admin);
    const queue = await app.inject({ url: '/api/v1/agent/grading-queue', headers: agent });
    expect(queue.json().data).toEqual([]);
  });

  it.each(['rule', 'model_rubric', 'external_rubric'] as const)(
    'refuses locking/grading a voided %s item before changing generation',
    async (gradingMode) => {
      const { app, ownerId } = await setupApp();
      const definition: QuestionDefinition =
        gradingMode === 'rule'
          ? { type: 'true_false', stem: '判断', gradingMode, gradingKey: { value: true } }
          : { ...modelDefinition(), gradingMode };
      const attempt = await lockedAttempt(app, ownerId, definition, null);
      await persistVoid(app, attempt.id);
      const before = await gradingState(app, attempt.id);
      await expect(
        app.ctx.db.transaction(async (tx) => {
          const current = (await tx.get('attempts', attempt.id))!;
          await app.ctx.grading.gradeLockedItem(tx, current, current.items[0]);
        }),
      ).rejects.toMatchObject({ code: 'ATTEMPT_VOIDED', statusCode: 409 });
      expect(await gradingState(app, attempt.id)).toEqual(before);
      expect(await app.ctx.db.list('gradingJobs')).toHaveLength(0);
    },
  );

  it.each([
    ['queued', false],
    ['running', false],
    ['running', true],
    ['retry_wait', false],
    ['blocked_config', false],
    ['blocked_budget', false],
  ] as const)(
    'cancels a voided %s job (expired lease: %s) without refreshing learning state',
    async (status, expired) => {
      const { app, ownerId } = await setupApp();
      const provider = installProvider(() => {
        throw new Error('作废任务不得调用模型');
      });
      const attempt = await lockedAttempt(app, ownerId, modelDefinition(), { text: '待评分答案' });
      const job = (await app.ctx.db.list('gradingJobs'))[0];
      await app.ctx.db.update('gradingJobs', job.id, job.revision, {
        status,
        nextRunAt: status === 'retry_wait' ? new Date(Date.now() + 60_000).toISOString() : now(),
        leaseExpiresAt:
          status === 'running'
            ? new Date(Date.now() + (expired ? -1_000 : 60_000)).toISOString()
            : null,
      });
      await persistVoid(app, attempt.id);
      const before = await gradingState(app, attempt.id);
      await app.ctx.grading.runOnce();
      expect(await app.ctx.db.get('gradingJobs', job.id)).toMatchObject({
        status: 'cancelled',
        lastErrorCode: 'ATTEMPT_VOIDED',
        leaseExpiresAt: null,
        attemptCount: 0,
      });
      expect(await gradingState(app, attempt.id)).toEqual(before);
      expect(provider.fake).not.toHaveBeenCalled();
      const cancelled = await app.ctx.db.get('gradingJobs', job.id);
      await app.ctx.grading.runOnce();
      expect(await app.ctx.db.get('gradingJobs', job.id)).toEqual(cancelled);
    },
  );

  it('rechecks voidedAt when claiming after queue recovery and continues to the next live job', async () => {
    const { app, admin, ownerId } = await setupApp();
    const provider = installProvider((_request, payload) => {
      expect(payload.answer).toEqual({ text: '仍应评分的答案' });
      return responseWithCriteria(zeroCriterionEvaluations(modelDefinition()));
    });
    await configureModel(app, admin);
    const attempt = await lockedAttempt(app, ownerId, modelDefinition(), {
      text: '稍后作废的答案',
    });
    const job = (await app.ctx.db.list('gradingJobs'))[0];
    let voided!: Attempt;
    let live!: Attempt;
    const transaction = app.ctx.db.transaction.bind(app.ctx.db);
    const spy = vi
      .spyOn(app.ctx.db, 'transaction')
      .mockImplementationOnce(async <T>(fn: (tx: Database) => Promise<T>): Promise<T> => {
        const result = await transaction(fn);
        // Recovery saw a live attempt. Void it before the claim transaction starts.
        voided = await persistVoid(app, attempt.id);
        live = await lockedAttempt(app, ownerId, modelDefinition(), { text: '仍应评分的答案' });
        return result;
      });
    try {
      await app.ctx.grading.runOnce();
    } finally {
      spy.mockRestore();
    }
    expect(await currentAttempt(app, attempt.id)).toEqual(voided);
    expect(await app.ctx.db.get('gradingJobs', job.id)).toMatchObject({
      status: 'cancelled',
      lastErrorCode: 'ATTEMPT_VOIDED',
      leaseExpiresAt: null,
      attemptCount: 0,
    });
    expect((await currentAttempt(app, live.id)).items[0].grade).toMatchObject({
      source: 'model',
      score: '0.00',
    });
    expect(
      await app.ctx.db.findOne('wrongQuestions', {
        ownerId,
        questionId: attempt.items[0].questionId,
      }),
    ).toBeUndefined();
    expect(provider.chatRequests).toHaveLength(1);
  });

  it('cancels rather than writing blocked_config if voided after claim and configuration resolution fails', async () => {
    const { app, admin, ownerId } = await setupApp();
    const provider = installProvider(() => {
      throw new Error('无效配置不得调用模型');
    });
    const { connection } = await configureModel(app, admin);
    await app.ctx.db.update('modelConnections', connection.id, connection.revision, {
      enabled: false,
    });
    const attempt = await lockedAttempt(app, ownerId, modelDefinition(), { text: '待评分的答案' });
    const job = (await app.ctx.db.list('gradingJobs'))[0];
    let before!: Awaited<ReturnType<typeof gradingState>>;
    const transaction = app.ctx.db.transaction.bind(app.ctx.db);
    const spy = vi
      .spyOn(app.ctx.db, 'transaction')
      .mockImplementationOnce(transaction)
      .mockImplementationOnce(async <T>(fn: (tx: Database) => Promise<T>): Promise<T> => {
        const result = await transaction(fn);
        await persistVoid(app, attempt.id);
        before = await gradingState(app, attempt.id);
        return result;
      });
    try {
      await app.ctx.grading.runOnce();
    } finally {
      spy.mockRestore();
    }
    expect(await app.ctx.db.get('gradingJobs', job.id)).toMatchObject({
      status: 'cancelled',
      lastErrorCode: 'ATTEMPT_VOIDED',
      leaseExpiresAt: null,
      attemptCount: 1,
    });
    expect(await gradingState(app, attempt.id)).toEqual(before);
    expect(provider.chatRequests).toHaveLength(0);
  });

  it.each([
    ['agent', 'failed'],
    ['admin', 'failed'],
    ['admin', 'blocked_config'],
    ['admin', 'blocked_budget'],
    ['admin', 'retry_wait'],
    ['admin', 'cancelled'],
  ] as const)(
    'rejects %s retry of a voided %s job before rebind/queue writes',
    async (role, status) => {
      const { app, admin, ownerId } = await setupApp();
      const agent = await agentHeaders(app, admin);
      const attempt = await lockedAttempt(app, ownerId, modelDefinition(), { text: '待评分答案' });
      const job = (await app.ctx.db.list('gradingJobs'))[0];
      await app.ctx.db.update('gradingJobs', job.id, job.revision, { status });
      await persistVoid(app, attempt.id);
      const before = await gradingState(app, attempt.id);
      const jobs = await app.ctx.db.list('gradingJobs');
      const result = await app.inject({
        method: 'POST',
        url: `/api/v1/${role}/grading-jobs/${job.id}/retry`,
        headers: role === 'agent' ? agent : admin,
        payload: role === 'admin' ? { useDefaultProfile: true, reason: '不能复活作废任务' } : {},
      });
      expect(result.statusCode).toBe(409);
      expect(result.json().error.code).toBe('ATTEMPT_VOIDED');
      expect(await app.ctx.db.list('gradingJobs')).toEqual(jobs);
      expect(await gradingState(app, attempt.id)).toEqual(before);
    },
  );

  it.each([false, true])(
    'rejects external grading/correction of voided attempts (previous grade: %s)',
    async (hasGrade) => {
      const { app, admin, ownerId } = await setupApp();
      const agent = await agentHeaders(app, admin);
      const definition: QuestionDefinition = {
        ...modelDefinition(),
        gradingMode: 'external_rubric',
      };
      const attempt = await lockedAttempt(app, ownerId, definition, { text: '原答案' }, 'test');
      const url = `/api/v1/agent/attempt-items/${attempt.items[0].id}/grades`;
      if (hasGrade) {
        await app.inject({
          method: 'POST',
          url,
          headers: agent,
          payload: {
            expectedGradeVersion: 0,
            criterionResults: zeroCriterionEvaluations(definition),
          },
        });
      }
      expect((await currentAttempt(app, attempt.id)).items[0].grade?.version ?? 0).toBe(
        hasGrade ? 1 : 0,
      );
      await persistVoid(app, attempt.id);
      const before = await gradingState(app, attempt.id);
      const rejected = await app.inject({
        method: 'POST',
        url,
        headers: agent,
        payload: {
          expectedGradeVersion: hasGrade ? 1 : 0,
          criterionResults: zeroCriterionEvaluations(definition),
          ...(hasGrade ? { reason: '作废后不可修正' } : {}),
        },
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().error.code).toBe('ATTEMPT_VOIDED');
      const queue = await app.inject({ url: '/api/v1/agent/grading-queue', headers: agent });
      expect(queue.json().data).toEqual([]);
      expect(await gradingState(app, attempt.id)).toEqual(before);
    },
  );

  it.each([
    'success',
    'retryable_failure',
    'fatal_failure',
    'invalid_output',
    'already_cancelled',
    'already_cancelled_failure',
  ] as const)(
    'ignores in-flight %s after void without changing grades/history/generation or projections',
    async (outcome) => {
      const { app, admin, ownerId } = await setupApp();
      let release!: () => void;
      let markStarted!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let defer = false;
      const provider = installProvider(async () => {
        if (defer) {
          markStarted();
          await gate;
          if (outcome === 'retryable_failure' || outcome === 'already_cancelled_failure')
            return new Response('private failure', { status: 500 });
          if (outcome === 'fatal_failure') return new Response('private failure', { status: 401 });
          if (outcome === 'invalid_output') return responseWithCriteria([]);
        }
        return responseWithCriteria(zeroCriterionEvaluations(modelDefinition()));
      });
      await configureModel(app, admin);
      const attempt = await lockedAttempt(app, ownerId, modelDefinition(), { text: '原答案' });
      await app.ctx.grading.runOnce();
      const agent = await agentHeaders(app, admin);
      const url = `/api/v1/agent/attempt-items/${attempt.items[0].id}/regrade`;
      const payload = { expectedGradeVersion: 1, reason: '重评过程中作废' };
      expect((await app.inject({ method: 'POST', url, headers: agent, payload })).statusCode).toBe(
        202,
      );
      defer = true;
      const running = app.ctx.grading.runOnce();
      await started;
      const job = (await app.ctx.db.list('gradingJobs', { attemptId: attempt.id })).find(
        (entry) => entry.status === 'running',
      )!;
      // Queue the void transaction before the response returns. The worker writeback
      // must observe its committed state, not the snapshot it claimed earlier.
      let commitVoid!: () => void;
      let voidStarted!: () => void;
      const voidGate = new Promise<void>((resolve) => {
        commitVoid = resolve;
      });
      const voidReady = new Promise<void>((resolve) => {
        voidStarted = resolve;
      });
      let before!: Awaited<ReturnType<typeof gradingState>>;
      const voiding = app.ctx.db.transaction(async (tx) => {
        const current = (await tx.get('attempts', attempt.id))!;
        voidStarted();
        await voidGate;
        await tx.update('attempts', current.id, current.revision, {
          voidedAt: now(),
          voidedBy: ownerId,
          voidReason: '响应返回前作废',
        });
        if (outcome === 'already_cancelled' || outcome === 'already_cancelled_failure')
          await tx.update('gradingJobs', job.id, job.revision, {
            status: 'cancelled',
            lastErrorCode: 'ATTEMPT_VOIDED',
            leaseExpiresAt: null,
          });
        before = await gradingState(app, attempt.id, tx);
      });
      await voidReady;
      release();
      commitVoid();
      await voiding;
      await running;
      expect(await gradingState(app, attempt.id)).toEqual(before);
      expect(await app.ctx.db.get('gradingJobs', job.id)).toMatchObject({
        status: 'cancelled',
        lastErrorCode: 'ATTEMPT_VOIDED',
        leaseExpiresAt: null,
        attemptCount: 1,
      });
      expect((await currentAttempt(app, attempt.id)).items[0]).toMatchObject({
        generation: 2,
        grade: { version: 1, source: 'model', score: '0.00' },
        gradingHistory: [],
      });
      const jobs = await app.ctx.db.list('gradingJobs');
      const rejected = await app.inject({ method: 'POST', url, headers: agent, payload });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().error.code).toBe('ATTEMPT_VOIDED');
      expect(await app.ctx.db.list('gradingJobs')).toEqual(jobs);
      expect(await gradingState(app, attempt.id)).toEqual(before);
      expect(provider.chatRequests).toHaveLength(2);
    },
  );
});
