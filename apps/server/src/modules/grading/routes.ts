import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  Attempt,
  AttemptItemSnapshot,
  GradingJob,
  GradingProfile,
  ModelConnectionView,
  ProviderModel,
} from '@drill-hub/contracts';
import type { Actor, AppContext } from '../../core/context.js';
import { AppError, assert } from '../../core/errors.js';
import { baseRecord, now } from '../../core/ids.js';
import type { Database } from '../../db/database.js';
import type { ModelConnectionRecord } from '../../db/records.js';
import { refreshAttempt } from '../learning/helpers.js';
import { normalizeProviderBaseUrl, ProviderError, PROMPT_VERSION } from './chat-completions.js';
import { gradeRubric, isBlankAnswer } from './engine.js';
import { gradingRuntime, isActiveGradingJob } from './service.js';

import { tokenUsageReport } from './token-usage.js';

const PREFIX = '/api/v1';
type JsonObject = Record<string, unknown>;

function body(request: FastifyRequest, allowEmpty = false): JsonObject {
  const value = request.body;
  if (allowEmpty && (value === null || value === undefined)) return {};
  assert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'INVALID_BODY',
    '请求体必须是 JSON 对象',
    400,
  );
  return value as JsonObject;
}

function keys(value: JsonObject, allowed: readonly string[]): void {
  for (const key of Object.keys(value))
    assert(allowed.includes(key), 'CLIENT_FIELD_FORBIDDEN', `不允许字段 ${key}`, 400);
}

function requiredText(value: unknown, field: string, maxLength: number, trim = true): string {
  assert(
    typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength,
    'INVALID_FIELD',
    `${field} 格式无效`,
  );
  return trim ? value.trim() : value;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  assert(typeof value === 'boolean', 'INVALID_FIELD', '布尔字段格式无效');
  return value;
}

function expectedRevision(value: JsonObject): number {
  assert(
    Number.isInteger(value.expectedRevision) && (value.expectedRevision as number) >= 1,
    'INVALID_REVISION',
    'expectedRevision 无效',
  );
  return value.expectedRevision as number;
}

function expectedGradeVersion(value: JsonObject, allowZero: boolean): number {
  const minimum = allowZero ? 0 : 1;
  assert(
    Number.isInteger(value.expectedGradeVersion) &&
      (value.expectedGradeVersion as number) >= minimum,
    'INVALID_GRADE_VERSION',
    'expectedGradeVersion 无效',
  );
  return value.expectedGradeVersion as number;
}

function apiKey(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  assert(typeof value === 'string' && value.length <= 8_192, 'INVALID_API_KEY', 'API 密钥格式无效');
  return value;
}

function encryptedKey(ctx: AppContext, plain: string): string {
  return plain ? ctx.vault.encrypt(plain) : '';
}

function modelImportInput(value: unknown): Array<{ modelKey: string; displayName?: string }> {
  assert(
    Array.isArray(value) && value.length > 0 && value.length <= 1_000,
    'INVALID_FIELD',
    'models 必须包含 1 至 1000 个模型',
  );
  return value.map((item, index) => {
    assert(
      item !== null && typeof item === 'object' && !Array.isArray(item),
      'INVALID_FIELD',
      `models[${index}] 格式无效`,
    );
    const entry = item as JsonObject;
    keys(entry, ['modelKey', 'displayName']);
    const modelKey = requiredText(entry.modelKey, `models[${index}].modelKey`, 512);
    const displayName =
      entry.displayName === undefined
        ? undefined
        : requiredText(entry.displayName, `models[${index}].displayName`, 200);
    return { modelKey, ...(displayName ? { displayName } : {}) };
  });
}

function connectionView(record: ModelConnectionRecord): ModelConnectionView {
  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: record.revision,
    displayName: record.displayName,
    protocol: record.protocol,
    baseUrl: record.baseUrl,
    enabled: record.enabled,
    configVersion: record.configVersion,
    apiKeyConfigured: record.encryptedApiKey.length > 0,
  };
}

function normalizedUrl(value: unknown): string {
  try {
    return normalizeProviderBaseUrl(value);
  } catch (error) {
    if (error instanceof ProviderError) throw new AppError(422, error.code, '模型地址格式无效');
    throw error;
  }
}

function providerFailure(error: unknown, message = '模型服务调用失败，请检查配置后重试'): never {
  if (error instanceof ProviderError) throw new AppError(502, error.code, message);
  throw error;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof ProviderError || error instanceof AppError) return error.code;
  return 'MODEL_TEST_FAILED';
}

async function findOwnedItem(
  db: Database,
  ownerId: string,
  itemId: string,
): Promise<{ attempt: Attempt; item: AttemptItemSnapshot }> {
  const attempts = await db.list('attempts', { ownerId });
  for (const attempt of attempts) {
    const item = attempt.items.find((candidate) => candidate.id === itemId);
    if (item) return { attempt, item };
  }
  throw new AppError(404, 'NOT_FOUND', '作答题目不存在');
}

function integerInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  assert(
    Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum,
    'INVALID_FIELD',
    `${field} 超出允许范围`,
  );
  return value as number;
}

async function assertCurrentModelVerified(
  db: Database,
  providerModelId: string,
): Promise<{
  model: ProviderModel;
  connection: ModelConnectionRecord;
  connectionVersionId: string;
}> {
  const model = await db.get('providerModels', providerModelId);
  assert(model, 'PROVIDER_MODEL_NOT_FOUND', '模型不存在', 404);
  const connection = await db.get('modelConnections', model.connectionId);
  assert(connection, 'MODEL_CONNECTION_NOT_FOUND', '模型连接不存在', 404);
  assert(connection.enabled, 'PROVIDER_DISABLED', '模型连接已停用', 409);
  assert(model.enabled, 'MODEL_DISABLED', '模型已停用', 409);
  const version = await db.findOne('modelConnectionVersions', {
    connectionId: connection.id,
    configVersion: connection.configVersion,
  });
  assert(version, 'CONNECTION_VERSION_NOT_FOUND', '模型连接版本不存在', 422);
  assert(
    model.verifiedConfigVersion === version.configVersion,
    'STALE_MODEL_VERIFICATION',
    '模型尚未通过当前连接版本的评分能力测试',
    409,
  );
  return { model, connection, connectionVersionId: version.id };
}

async function assertProfileUsable(db: Database, profile: GradingProfile): Promise<void> {
  const current = await assertCurrentModelVerified(db, profile.providerModelId);
  assert(
    current.connectionVersionId === profile.connectionVersionId,
    'STALE_MODEL_VERIFICATION',
    '评分配置不是当前已验证连接版本',
    409,
  );
  assert(
    profile.promptVersion === PROMPT_VERSION,
    'UNSUPPORTED_PROMPT_VERSION',
    '提示词版本不受支持',
    422,
  );
}

async function setDefaultProfile(
  ctx: AppContext,
  actor: Actor,
  tx: Database,
  profile: GradingProfile,
): Promise<GradingProfile> {
  await assertProfileUsable(tx, profile);
  const profiles = await tx.list('gradingProfiles');
  let selected = profile;
  for (const candidate of profiles) {
    const shouldBeDefault = candidate.id === profile.id;
    if (candidate.isDefault !== shouldBeDefault) {
      const updated = await tx.update('gradingProfiles', candidate.id, candidate.revision, {
        isDefault: shouldBeDefault,
      });
      if (candidate.id === profile.id) selected = updated;
    }
  }
  const settings = await tx.get('settings', 'global');
  assert(settings, 'SETTINGS_NOT_FOUND', '系统设置不存在', 500);
  await tx.update('settings', settings.id, settings.revision, {
    defaultGradingProfileId: profile.id,
  });
  await ctx.audit(actor, 'grading_profile.default_changed', 'gradingProfile', profile.id, {}, tx);
  return selected;
}

async function retryJob(
  ctx: AppContext,
  actor: Actor,
  jobId: string,
  admin: boolean,
  input: JsonObject,
): Promise<GradingJob> {
  keys(
    input,
    admin
      ? ['expectedRevision', 'reason', 'useDefaultProfile', 'rebindToDefault']
      : ['expectedRevision'],
  );
  return ctx.db.transaction(async (tx) => {
    const job = await tx.get('gradingJobs', jobId);
    assert(job && (admin || job.ownerId === actor.userId), 'NOT_FOUND', '评分任务不存在', 404);
    const attempt = await tx.get('attempts', job.attemptId);
    assert(attempt, 'ATTEMPT_ITEM_NOT_FOUND', '评分任务对应的作答不存在', 409);
    assert(attempt.voidedAt === null, 'ATTEMPT_VOIDED', '作答已作废', 409);
    const allowed = admin
      ? ['failed', 'blocked_config', 'blocked_budget', 'retry_wait']
      : ['failed'];
    assert(allowed.includes(job.status), 'GRADING_JOB_NOT_RETRYABLE', '当前任务状态不能重试', 409);
    if (input.expectedRevision !== undefined) {
      assert(
        job.revision === expectedRevision(input),
        'VERSION_CONFLICT',
        '任务已发生变化，请刷新后重试',
        409,
      );
    }
    const rebind = admin && (input.useDefaultProfile === true || input.rebindToDefault === true);
    let reason: string | undefined;
    if (rebind) reason = requiredText(input.reason, 'reason', 4_000);
    else assert(input.reason === undefined, 'REASON_NOT_ALLOWED', '未改绑配置时不需要原因', 422);
    let profileId = job.profileId;
    if (rebind || profileId === null) {
      const settings = await tx.get('settings', 'global');
      profileId = settings?.defaultGradingProfileId ?? null;
    }
    assert(profileId, 'DEFAULT_PROFILE_NOT_CONFIGURED', '尚未配置默认评分模型', 422);
    assert(
      await tx.get('gradingProfiles', profileId),
      'GRADING_PROFILE_NOT_FOUND',
      '评分配置不存在',
      422,
    );
    const updated = await tx.update('gradingJobs', job.id, job.revision, {
      profileId,
      status: 'queued',
      attemptCount: 0,
      nextRunAt: now(),
      leaseExpiresAt: null,
      lastErrorCode: null,
    });
    const item = attempt.items.find((candidate) => candidate.id === job.itemId);
    assert(
      attempt && item && item.generation === job.generation,
      'ATTEMPT_ITEM_NOT_FOUND',
      '评分任务对应的作答不存在',
      409,
    );
    item.gradingStatus = 'pending';
    await refreshAttempt(tx, attempt);
    await ctx.audit(
      actor,
      admin ? 'grading_job.admin_retried' : 'grading_job.retried',
      'gradingJob',
      job.id,
      {
        ...(reason ? { reason } : {}),
        profileId,
        generation: job.generation,
      },
      tx,
    );
    return updated;
  });
}

export async function registerGradingRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Querystring: Record<string, unknown> }>(`${PREFIX}/me/token-usage`, async (request) => {
    const actor = await ctx.requireUser(request);
    return { data: await tokenUsageReport(ctx.db, actor.userId, request.query) };
  });
  app.get<{ Querystring: Record<string, unknown> }>(
    `${PREFIX}/admin/token-usage`,
    async (request) => {
      await ctx.requireAdmin(request);
      return { data: await tokenUsageReport(ctx.db, undefined, request.query) };
    },
  );

  app.get(`${PREFIX}/admin/model-adapters`, async (request) => {
    await ctx.requireAdmin(request);
    return {
      data: [
        {
          protocol: 'chat_completions',
          displayName: 'Chat Completions compatible',
          promptVersions: [PROMPT_VERSION],
          fields: ['displayName', 'baseUrl', 'apiKey', 'modelKey'],
          supportsManualModels: true,
        },
      ],
    };
  });

  app.get(`${PREFIX}/admin/model-connections`, async (request) => {
    await ctx.requireAdmin(request);
    return { data: (await ctx.db.list('modelConnections')).map(connectionView) };
  });

  app.post(`${PREFIX}/admin/model-connections/test`, async (request) => {
    const actor = await ctx.requireAdmin(request);
    const input = body(request);
    keys(input, ['connectionId', 'baseUrl', 'apiKey']);
    const connectionId =
      input.connectionId === undefined
        ? null
        : requiredText(input.connectionId, 'connectionId', 128);
    const baseUrl = normalizedUrl(input.baseUrl);
    let plainApiKey: string;
    if (input.apiKey !== undefined) {
      plainApiKey = apiKey(input.apiKey);
    } else {
      assert(connectionId, 'INVALID_API_KEY', 'API 密钥格式无效');
      const connection = await ctx.db.get('modelConnections', connectionId);
      assert(connection, 'NOT_FOUND', '模型连接不存在', 404);
      const version = await ctx.db.findOne('modelConnectionVersions', {
        connectionId: connection.id,
        configVersion: connection.configVersion,
      });
      assert(version, 'CONNECTION_VERSION_NOT_FOUND', '模型连接版本不存在', 422);
      plainApiKey = version.encryptedApiKey ? ctx.vault.decrypt(version.encryptedApiKey) : '';
    }
    try {
      await gradingRuntime(ctx).testConnectionConfig({ baseUrl, apiKey: plainApiKey });
    } catch (error) {
      await ctx.audit(
        actor,
        'model_connection.config_test_failed',
        'modelConnection',
        connectionId ?? 'draft',
        { errorCode: safeErrorCode(error) },
      );
      providerFailure(error);
    }
    await ctx.audit(
      actor,
      'model_connection.config_tested',
      'modelConnection',
      connectionId ?? 'draft',
      {},
    );
    return { data: { tested: true, connectionId } };
  });

  app.post(`${PREFIX}/admin/model-connections`, async (request, reply) => {
    const actor = await ctx.requireAdmin(request);
    const input = body(request);
    keys(input, ['displayName', 'protocol', 'baseUrl', 'apiKey', 'enabled']);
    assert(
      input.protocol === 'chat_completions',
      'UNSUPPORTED_MODEL_PROTOCOL',
      '仅支持已实现的 chat_completions 协议',
    );
    const displayName = requiredText(input.displayName, 'displayName', 200);
    const baseUrl = normalizedUrl(input.baseUrl);
    const enabled = optionalBoolean(input.enabled, true);
    const encryptedApiKey = encryptedKey(ctx, apiKey(input.apiKey));
    const connection = await ctx.db.transaction(async (tx) => {
      const record = await tx.insert('modelConnections', {
        ...baseRecord(),
        displayName,
        protocol: 'chat_completions' as const,
        baseUrl,
        enabled,
        configVersion: 1,
        encryptedApiKey,
      });
      await tx.insert('modelConnectionVersions', {
        ...baseRecord(),
        connectionId: record.id,
        configVersion: 1,
        protocol: record.protocol,
        baseUrl,
        encryptedApiKey,
      });
      await ctx.audit(
        actor,
        'model_connection.created',
        'modelConnection',
        record.id,
        { protocol: record.protocol, baseUrl },
        tx,
      );
      return record;
    });
    reply.code(201);
    return { data: connectionView(connection) };
  });

  app.patch<{ Params: { id: string } }>(
    `${PREFIX}/admin/model-connections/:id`,
    async (request) => {
      const actor = await ctx.requireAdmin(request);
      const input = body(request);
      keys(input, ['expectedRevision', 'displayName', 'baseUrl', 'apiKey', 'enabled']);
      const revision = expectedRevision(input);
      const updated = await ctx.db.transaction(async (tx) => {
        const current = await tx.get('modelConnections', request.params.id);
        assert(current, 'NOT_FOUND', '模型连接不存在', 404);
        const currentVersion = await tx.findOne('modelConnectionVersions', {
          connectionId: current.id,
          configVersion: current.configVersion,
        });
        assert(currentVersion, 'CONNECTION_VERSION_NOT_FOUND', '模型连接版本不存在', 422);
        const displayName =
          input.displayName === undefined
            ? current.displayName
            : requiredText(input.displayName, 'displayName', 200);
        const baseUrl =
          input.baseUrl === undefined ? current.baseUrl : normalizedUrl(input.baseUrl);
        const enabled = optionalBoolean(input.enabled, current.enabled);
        const credentialChanged = input.apiKey !== undefined;
        const connectionChanged = credentialChanged || baseUrl !== current.baseUrl;
        const configVersion = connectionChanged ? current.configVersion + 1 : current.configVersion;
        const encryptedApiKey = credentialChanged
          ? encryptedKey(ctx, apiKey(input.apiKey))
          : currentVersion.encryptedApiKey;
        const record = await tx.update('modelConnections', current.id, revision, {
          displayName,
          baseUrl,
          enabled,
          configVersion,
          encryptedApiKey,
        });
        if (connectionChanged) {
          await tx.insert('modelConnectionVersions', {
            ...baseRecord(),
            connectionId: current.id,
            configVersion,
            protocol: current.protocol,
            baseUrl,
            encryptedApiKey,
          });
        }
        await ctx.audit(
          actor,
          'model_connection.updated',
          'modelConnection',
          current.id,
          {
            configVersion,
            enabled,
            credentialRotated: credentialChanged,
          },
          tx,
        );
        return record;
      });
      return { data: connectionView(updated) };
    },
  );

  app.post<{ Params: { id: string } }>(
    `${PREFIX}/admin/model-connections/:id/test`,
    async (request) => {
      const actor = await ctx.requireAdmin(request);
      const input = body(request, true);
      keys(input, []);
      try {
        await gradingRuntime(ctx).testConnection(request.params.id);
      } catch (error) {
        await ctx.audit(
          actor,
          'model_connection.test_failed',
          'modelConnection',
          request.params.id,
          { errorCode: safeErrorCode(error) },
        );
        providerFailure(error);
      }
      await ctx.audit(actor, 'model_connection.tested', 'modelConnection', request.params.id, {});
      return { data: { tested: true, connectionId: request.params.id } };
    },
  );

  app.post<{ Params: { id: string } }>(
    `${PREFIX}/admin/model-connections/:id/models/discover`,
    async (request) => {
      const actor = await ctx.requireAdmin(request);
      const input = body(request, true);
      keys(input, []);
      try {
        const models = await gradingRuntime(ctx).discoverProviderModels(request.params.id);
        await ctx.audit(actor, 'provider_models.discovered', 'modelConnection', request.params.id, {
          count: models.length,
        });
        return { data: { models } };
      } catch (error) {
        await ctx.audit(
          actor,
          'provider_models.discovery_failed',
          'modelConnection',
          request.params.id,
          { errorCode: safeErrorCode(error) },
        );
        providerFailure(
          error,
          error instanceof ProviderError && error.code === 'MODEL_LIST_INVALID_RESPONSE'
            ? '供应商未返回兼容的模型列表，请手动添加模型 ID'
            : '自动获取模型失败，请检查连接与鉴权后重试',
        );
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    `${PREFIX}/admin/model-connections/:id/models/import`,
    async (request, reply) => {
      const actor = await ctx.requireAdmin(request);
      const input = body(request);
      keys(input, ['models']);
      const candidates = modelImportInput(input.models);
      const result = await ctx.db.transaction(async (tx) => {
        assert(
          await tx.get('modelConnections', request.params.id),
          'NOT_FOUND',
          '模型连接不存在',
          404,
        );
        const existing = await tx.list('providerModels', { connectionId: request.params.id });
        const existingKeys = new Set(existing.map((model) => model.modelKey));
        const requested = new Set<string>();
        const created: ProviderModel[] = [];
        const skipped: string[] = [];
        for (const candidate of candidates) {
          if (requested.has(candidate.modelKey) || existingKeys.has(candidate.modelKey)) {
            skipped.push(candidate.modelKey);
            continue;
          }
          requested.add(candidate.modelKey);
          const record = await tx.insert('providerModels', {
            ...baseRecord(),
            connectionId: request.params.id,
            modelKey: candidate.modelKey,
            displayName: candidate.displayName ?? candidate.modelKey,
            enabled: true,
            verifiedConfigVersion: null,
            testError: null,
          });
          created.push(record);
        }
        await ctx.audit(
          actor,
          'provider_models.imported',
          'modelConnection',
          request.params.id,
          { created: created.length, skipped: skipped.length },
          tx,
        );
        return { created, skipped };
      });
      reply.code(result.created.length ? 201 : 200);
      return { data: result };
    },
  );

  app.get<{ Params: { id: string } }>(
    `${PREFIX}/admin/model-connections/:id/models`,
    async (request) => {
      await ctx.requireAdmin(request);
      assert(
        await ctx.db.get('modelConnections', request.params.id),
        'NOT_FOUND',
        '模型连接不存在',
        404,
      );
      return { data: await ctx.db.list('providerModels', { connectionId: request.params.id }) };
    },
  );

  app.post<{ Params: { id: string } }>(
    `${PREFIX}/admin/model-connections/:id/models`,
    async (request, reply) => {
      const actor = await ctx.requireAdmin(request);
      const input = body(request);
      keys(input, ['modelKey', 'displayName', 'enabled']);
      const modelKey = requiredText(input.modelKey, 'modelKey', 512);
      const displayName =
        input.displayName === undefined
          ? modelKey
          : requiredText(input.displayName, 'displayName', 200);
      const enabled = optionalBoolean(input.enabled, true);
      const model = await ctx.db.transaction(async (tx) => {
        assert(
          await tx.get('modelConnections', request.params.id),
          'NOT_FOUND',
          '模型连接不存在',
          404,
        );
        assert(
          !(await tx.findOne('providerModels', { connectionId: request.params.id, modelKey })),
          'MODEL_ALREADY_EXISTS',
          '该模型标识已存在',
          409,
        );
        const record = await tx.insert('providerModels', {
          ...baseRecord(),
          connectionId: request.params.id,
          modelKey,
          displayName,
          enabled,
          verifiedConfigVersion: null,
          testError: null,
        });
        await ctx.audit(
          actor,
          'provider_model.created',
          'providerModel',
          record.id,
          { modelKey },
          tx,
        );
        return record;
      });
      reply.code(201);
      return { data: model };
    },
  );

  app.patch<{ Params: { id: string } }>(`${PREFIX}/admin/provider-models/:id`, async (request) => {
    const actor = await ctx.requireAdmin(request);
    const input = body(request);
    keys(input, ['expectedRevision', 'modelKey', 'displayName', 'enabled']);
    const revision = expectedRevision(input);
    const updated = await ctx.db.transaction(async (tx) => {
      const current = await tx.get('providerModels', request.params.id);
      assert(current, 'NOT_FOUND', '模型不存在', 404);
      const modelKey =
        input.modelKey === undefined
          ? current.modelKey
          : requiredText(input.modelKey, 'modelKey', 512);
      if (modelKey !== current.modelKey) {
        const duplicate = await tx.findOne('providerModels', {
          connectionId: current.connectionId,
          modelKey,
        });
        assert(
          !duplicate || duplicate.id === current.id,
          'MODEL_ALREADY_EXISTS',
          '该模型标识已存在',
          409,
        );
      }
      const displayName =
        input.displayName === undefined
          ? current.displayName
          : requiredText(input.displayName, 'displayName', 200);
      const enabled = optionalBoolean(input.enabled, current.enabled);
      const identityChanged = modelKey !== current.modelKey;
      const record = await tx.update('providerModels', current.id, revision, {
        modelKey,
        displayName,
        enabled,
        verifiedConfigVersion: identityChanged ? null : current.verifiedConfigVersion,
        testError: identityChanged ? null : (current.testError ?? null),
      });
      await ctx.audit(
        actor,
        'provider_model.updated',
        'providerModel',
        current.id,
        { modelKey, enabled },
        tx,
      );
      return record;
    });
    return { data: updated };
  });

  app.post<{ Params: { id: string } }>(
    `${PREFIX}/admin/provider-models/:id/test`,
    async (request) => {
      const actor = await ctx.requireAdmin(request);
      const input = body(request, true);
      keys(input, []);
      try {
        const grade = await gradingRuntime(ctx).testProviderModel(request.params.id, actor.userId);
        const model = await ctx.db.get('providerModels', request.params.id);
        await ctx.audit(actor, 'provider_model.tested', 'providerModel', request.params.id, {
          verifiedConfigVersion: model?.verifiedConfigVersion ?? null,
        });
        return { data: { providerModel: model, result: grade } };
      } catch (error) {
        await ctx.audit(actor, 'provider_model.test_failed', 'providerModel', request.params.id, {
          errorCode: safeErrorCode(error),
        });
        providerFailure(error);
      }
    },
  );

  app.get(`${PREFIX}/admin/grading-profiles`, async (request) => {
    await ctx.requireAdmin(request);
    return { data: await ctx.db.list('gradingProfiles') };
  });

  app.post(`${PREFIX}/admin/grading-profiles`, async (request, reply) => {
    const actor = await ctx.requireAdmin(request);
    const input = body(request);
    keys(input, ['providerModelId', 'promptVersion', 'timeoutMs', 'maxRetries', 'isDefault']);
    const providerModelId = requiredText(input.providerModelId, 'providerModelId', 128);
    const promptVersion =
      input.promptVersion === undefined
        ? PROMPT_VERSION
        : requiredText(input.promptVersion, 'promptVersion', 128);
    assert(promptVersion === PROMPT_VERSION, 'UNSUPPORTED_PROMPT_VERSION', '提示词版本不受支持');
    const timeoutMs = integerInRange(input.timeoutMs, 'timeoutMs', 100, 120_000, 30_000);
    const maxRetries = integerInRange(input.maxRetries, 'maxRetries', 0, 5, 2);
    const isDefault = optionalBoolean(input.isDefault, false);
    const profile = await ctx.db.transaction(async (tx) => {
      const verified = await assertCurrentModelVerified(tx, providerModelId);
      let record = await tx.insert('gradingProfiles', {
        ...baseRecord(),
        providerModelId,
        connectionVersionId: verified.connectionVersionId,
        modelIdSnapshot: verified.model.modelKey,
        promptVersion,
        timeoutMs,
        maxRetries,
        isDefault: false,
      });
      if (isDefault) record = await setDefaultProfile(ctx, actor, tx, record);
      await ctx.audit(
        actor,
        'grading_profile.created',
        'gradingProfile',
        record.id,
        {
          providerModelId,
          connectionVersionId: record.connectionVersionId,
          isDefault,
        },
        tx,
      );
      return record;
    });
    reply.code(201);
    return { data: profile };
  });

  app.post<{ Params: { id: string } }>(
    `${PREFIX}/admin/grading-profiles/:id/default`,
    async (request) => {
      const actor = await ctx.requireAdmin(request);
      const input = body(request, true);
      keys(input, ['expectedRevision']);
      const profile = await ctx.db.transaction(async (tx) => {
        const current = await tx.get('gradingProfiles', request.params.id);
        assert(current, 'NOT_FOUND', '评分配置不存在', 404);
        if (input.expectedRevision !== undefined)
          assert(
            current.revision === expectedRevision(input),
            'VERSION_CONFLICT',
            '配置已变化',
            409,
          );
        return setDefaultProfile(ctx, actor, tx, current);
      });
      return { data: profile };
    },
  );

  app.get(`${PREFIX}/admin/grading-jobs`, async (request) => {
    await ctx.requireAdmin(request);
    return { data: await ctx.db.list('gradingJobs') };
  });

  app.post<{ Params: { id: string } }>(
    `${PREFIX}/admin/grading-jobs/:id/retry`,
    async (request, reply) => {
      const actor = await ctx.requireAdmin(request);
      const job = await retryJob(ctx, actor, request.params.id, true, body(request, true));
      reply.code(202);
      return { data: job };
    },
  );

  app.get(`${PREFIX}/agent/grading-jobs`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    return { data: await ctx.db.list('gradingJobs', { ownerId: actor.userId }) };
  });

  app.post<{ Params: { id: string } }>(
    `${PREFIX}/agent/grading-jobs/:id/retry`,
    async (request, reply) => {
      const actor = await ctx.requireAgent(request, 'grading:request');
      const job = await retryJob(ctx, actor, request.params.id, false, body(request, true));
      reply.code(202);
      return { data: job };
    },
  );

  app.get(`${PREFIX}/agent/grading-queue`, async (request) => {
    const actor = await ctx.requireAgent(request, 'read');
    const attempts = await ctx.db.list('attempts', { ownerId: actor.userId });
    const queue: Record<string, unknown>[] = [];
    for (const attempt of attempts) {
      if (attempt.voidedAt !== null) continue;
      for (const item of attempt.items) {
        if (
          item.lockedAt !== null &&
          item.grade === null &&
          item.gradingStatus === 'pending' &&
          item.definition.gradingMode === 'external_rubric' &&
          !isBlankAnswer(item.definition, item.answer)
        ) {
          queue.push({
            attemptId: attempt.id,
            itemId: item.id,
            questionId: item.questionId,
            questionVersion: item.questionVersion,
            definition: item.definition,
            maxScore: item.maxScore,
            answer: item.answer,
            answerRevision: item.answerRevision,
            lockedAt: item.lockedAt,
            generation: item.generation,
            expectedGradeVersion: 0,
          });
        }
      }
    }
    return { data: queue };
  });

  app.post<{ Params: { id: string } }>(
    `${PREFIX}/agent/attempt-items/:id/grades`,
    async (request) => {
      const actor = await ctx.requireAgent(request, 'grade:write');
      const input = body(request);
      keys(input, ['expectedGradeVersion', 'criterionResults', 'reason']);
      const expected = expectedGradeVersion(input, true);
      const result = await ctx.db.transaction(async (tx) => {
        const { attempt, item } = await findOwnedItem(tx, actor.userId, request.params.id);
        assert(attempt.voidedAt === null, 'ATTEMPT_VOIDED', '作答已作废', 409);
        assert(item.lockedAt !== null, 'ATTEMPT_ITEM_NOT_LOCKED', '答案尚未锁定', 409);
        assert(
          item.definition.gradingMode === 'external_rubric',
          'GRADING_MODE_FORBIDDEN',
          '仅 external_rubric 允许外部逐项批改',
          409,
        );
        assert(
          !isBlankAnswer(item.definition, item.answer),
          'BLANK_ANSWER',
          '空白答案已由服务端记零分',
          409,
        );
        const previous = item.grade;
        assert(
          (previous?.version ?? 0) === expected,
          'GRADE_VERSION_CONFLICT',
          '评分版本已变化，请刷新后重试',
          409,
        );
        const reason =
          input.reason === undefined ? undefined : requiredText(input.reason, 'reason', 4_000);
        if (previous) assert(reason, 'REGRADE_REASON_REQUIRED', '修正评分必须提供原因', 422);
        const grade = gradeRubric(
          item.definition,
          item.answer,
          item.maxScore,
          input.criterionResults,
          {
            source: 'external_agent',
            version: expected + 1,
            feedback: '',
            ...(reason ? { reason } : {}),
          },
        );
        if (previous) {
          item.gradingHistory = [...item.gradingHistory, previous];
          item.generation += 1;
        }
        item.grade = grade;
        item.gradingStatus = 'completed';
        await refreshAttempt(tx, attempt);
        await ctx.audit(
          actor,
          previous ? 'external_grade.corrected' : 'external_grade.created',
          'attemptItem',
          item.id,
          {
            attemptId: attempt.id,
            gradeVersion: grade.version,
            ...(reason ? { reason } : {}),
          },
          tx,
        );
        return { attemptId: attempt.id, itemId: item.id, grade };
      });
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    `${PREFIX}/agent/attempt-items/:id/regrade`,
    async (request, reply) => {
      const actor = await ctx.requireAgent(request, 'grading:request');
      const input = body(request);
      keys(input, ['expectedGradeVersion', 'reason']);
      const expected = expectedGradeVersion(input, false);
      const reason = requiredText(input.reason, 'reason', 4_000);
      const job = await ctx.db.transaction(async (tx) => {
        const { attempt, item } = await findOwnedItem(tx, actor.userId, request.params.id);
        assert(attempt.voidedAt === null, 'ATTEMPT_VOIDED', '作答已作废', 409);
        assert(item.lockedAt !== null, 'ATTEMPT_ITEM_NOT_LOCKED', '答案尚未锁定', 409);
        assert(
          item.definition.gradingMode === 'model_rubric',
          'GRADING_MODE_FORBIDDEN',
          '仅 model_rubric 可以请求模型重评',
          409,
        );
        assert(
          !isBlankAnswer(item.definition, item.answer),
          'BLANK_ANSWER',
          '空白答案无需模型重评',
          409,
        );
        assert(
          item.grade && item.grade.version === expected,
          'GRADE_VERSION_CONFLICT',
          '评分版本已变化，请刷新后重试',
          409,
        );
        const jobs = await tx.list('gradingJobs', { attemptId: attempt.id, itemId: item.id });
        assert(
          !jobs.some(isActiveGradingJob),
          'GRADING_ALREADY_ACTIVE',
          '已有进行中的评分任务',
          409,
        );
        const settings = await tx.get('settings', 'global');
        const profile = settings?.defaultGradingProfileId
          ? await tx.get('gradingProfiles', settings.defaultGradingProfileId)
          : undefined;
        item.generation += 1;
        item.gradingStatus = 'pending';
        const record = await tx.insert('gradingJobs', {
          ...baseRecord(),
          ownerId: attempt.ownerId,
          attemptId: attempt.id,
          itemId: item.id,
          generation: item.generation,
          profileId: profile?.id ?? null,
          status: profile ? 'queued' : 'blocked_config',
          attemptCount: 0,
          nextRunAt: now(),
          leaseExpiresAt: null,
          lastErrorCode: profile ? null : 'DEFAULT_PROFILE_NOT_CONFIGURED',
        });
        await refreshAttempt(tx, attempt);
        await ctx.audit(
          actor,
          'model_regrade.requested',
          'attemptItem',
          item.id,
          {
            attemptId: attempt.id,
            previousGradeVersion: expected,
            generation: item.generation,
            reason,
            profileId: profile?.id ?? null,
          },
          tx,
        );
        return record;
      });
      reply.code(202);
      return { data: job };
    },
  );
}
