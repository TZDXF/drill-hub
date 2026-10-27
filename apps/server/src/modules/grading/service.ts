import type {
  Attempt,
  AttemptItemSnapshot,
  DiscoveredProviderModel,
  GradeResult,
  GradingJob,
  GradingProfile,
  ProviderModel,
  ModelTokenUsage,
} from '@drill-hub/contracts';
import type { AppContext, GradingService } from '#server/core/context.js';
import { AppError } from '#server/core/errors.js';
import { baseRecord, now } from '#server/core/ids.js';
import type { Database } from '#server/db/database.js';
import type {
  ModelConnectionRecord,
  ModelConnectionVersionRecord,
  ModelUsageRecord,
} from '#server/db/records.js';
import type {
  ChatCompletionInput,
  ChatCompletionOutput,
} from '#server/modules/grading/chat-completions.js';
import { refreshAttempt } from '#server/modules/learning/helpers.js';
import {
  callChatCompletions,
  listChatCompletionsModels,
  ProviderError,
  testChatCompletionsConnection,
} from '#server/modules/grading/chat-completions.js';
import {
  gradeBlankRubric,
  gradeRubric,
  gradeRule,
  isBlankAnswer,
  validateAnswer,
  validateQuestion,
  validateRubricScore,
  zeroCriterionEvaluations,
} from '#server/modules/grading/engine.js';

export interface GradingServiceOptions {
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  retryBaseDelayMs?: number;
  leaseMs?: number;
  maxJobsPerRun?: number;
  onError?: (event: 'worker' | 'usage') => void;
}

interface ClaimedJob {
  job: GradingJob;
  leaseRevision: number;
  item: AttemptItemSnapshot;
  baseGradeVersion: number;
  maxRetries: number;
}

interface ResolvedConfig {
  profile: GradingProfile;
  providerModel: ProviderModel;
  connection: ModelConnectionRecord;
  version: ModelConnectionVersionRecord;
}

const CONFIG_ERROR_CODES = new Set([
  'DEFAULT_PROFILE_NOT_CONFIGURED',
  'GRADING_PROFILE_NOT_FOUND',
  'PROVIDER_MODEL_NOT_FOUND',
  'MODEL_CONNECTION_NOT_FOUND',
  'CONNECTION_VERSION_NOT_FOUND',
  'PROVIDER_DISABLED',
  'MODEL_DISABLED',
  'STALE_CONNECTION_VERSION',
  'SECRET_UNAVAILABLE',
  'PROVIDER_ADDRESS_FORBIDDEN',
]);

function decryptApiKey(ctx: AppContext, envelope: string): string {
  return envelope ? ctx.vault.decrypt(envelope) : '';
}
function configError(code: string): never {
  throw new ProviderError(code, false);
}

function safeExecutionError(error: unknown): {
  code: string;
  retryable: boolean;
  blockedConfig: boolean;
} {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      retryable: error.retryable,
      blockedConfig: CONFIG_ERROR_CODES.has(error.code),
    };
  }
  if (error instanceof AppError) {
    return {
      code: error.code,
      retryable: error.code !== 'SECRET_UNAVAILABLE',
      blockedConfig: CONFIG_ERROR_CODES.has(error.code),
    };
  }
  return { code: 'MODEL_OUTPUT_INVALID', retryable: true, blockedConfig: false };
}

function activeJob(job: GradingJob): boolean {
  return (
    job.status === 'queued' ||
    job.status === 'running' ||
    job.status === 'retry_wait' ||
    job.status === 'blocked_config' ||
    job.status === 'blocked_budget'
  );
}

export class GradingServiceImpl implements GradingService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeRun: Promise<void> | undefined;
  private started = false;
  private readonly pollIntervalMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly leaseMs: number;
  private readonly maxJobsPerRun: number;

  constructor(
    private readonly ctx: AppContext,
    private readonly options: GradingServiceOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    this.leaseMs = options.leaseMs ?? 180_000;
    this.maxJobsPerRun = options.maxJobsPerRun ?? 25;
  }

  async gradeLockedItem(db: Database, attempt: Attempt, item: AttemptItemSnapshot): Promise<void> {
    if (attempt.voidedAt !== null) throw new AppError(409, 'ATTEMPT_VOIDED', '作答已作废');
    const definition = item.definition;
    validateQuestion(definition);
    if (definition.gradingMode !== 'rule') validateRubricScore(definition, item.maxScore);
    if (item.answer !== null) validateAnswer(definition, item.answer);
    item.generation += 1;
    if (definition.gradingMode === 'rule') {
      item.grade = gradeRule(definition, item.answer, item.maxScore);
      item.gradingStatus = 'completed';
      return;
    }
    if (isBlankAnswer(definition, item.answer)) {
      item.grade = gradeBlankRubric(definition, item.answer, item.maxScore);
      item.gradingStatus = 'completed';
      return;
    }
    item.gradingStatus = 'pending';
    if (definition.gradingMode === 'external_rubric') return;

    const settings = await db.get('settings', 'global');
    const profile = settings?.defaultGradingProfileId
      ? await db.get('gradingProfiles', settings.defaultGradingProfileId)
      : undefined;
    const timestamp = now();
    await db.insert('gradingJobs', {
      ...baseRecord(),
      ownerId: attempt.ownerId,
      attemptId: attempt.id,
      itemId: item.id,
      generation: item.generation,
      profileId: profile?.id ?? null,
      status: profile ? 'queued' : 'blocked_config',
      attemptCount: 0,
      nextRunAt: timestamp,
      leaseExpiresAt: null,
      lastErrorCode: profile ? null : 'DEFAULT_PROFILE_NOT_CONFIGURED',
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.runOnce().catch(() => this.options.onError?.('worker'));
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => this.options.onError?.('worker'));
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  runOnce(): Promise<void> {
    if (this.activeRun) return this.activeRun;
    const run = this.drainQueue();
    this.activeRun = run;
    void run
      .finally(() => {
        if (this.activeRun === run) this.activeRun = undefined;
      })
      .catch(() => undefined);
    return run;
  }

  private async drainQueue(): Promise<void> {
    await this.recoverExpiredLeases();
    const running = new Set<Promise<void>>();
    let failure: { error: unknown } | undefined;
    try {
      for (let count = 0; count < this.maxJobsPerRun;) {
        const claimed = await this.claimNextJob();
        if (claimed) {
          count += 1;
          const execution = this.executeClaimedJob(claimed);
          // Attach a handler immediately while the scheduler is claiming other jobs.
          void execution.catch(() => undefined);
          running.add(execution);
        } else if (!running.size) {
          break;
        }
        if (!claimed || count === this.maxJobsPerRun) {
          const completed = await Promise.race(
            [...running].map(async (execution) => {
              await execution;
              return { execution };
            }),
          );
          running.delete(completed.execution);
        }
      }
    } catch (error) {
      failure = { error };
    }
    // Do not release activeRun until all already-claimed calls have settled.
    const results = await Promise.allSettled(running);
    if (failure) throw failure.error;
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }

  private async cancelVoidedJob(
    tx: Database,
    job: GradingJob,
    attempt: Attempt | undefined,
  ): Promise<boolean> {
    if (!attempt || attempt.voidedAt === null) return false;
    await tx.update('gradingJobs', job.id, job.revision, {
      status: 'cancelled',
      leaseExpiresAt: null,
      lastErrorCode: 'ATTEMPT_VOIDED',
    });
    return true;
  }

  private async recoverExpiredLeases(): Promise<void> {
    const active = await this.ctx.db.listActiveGradingJobs();
    for (const candidate of active) {
      await this.ctx.db.transaction(async (tx) => {
        const job = await tx.get('gradingJobs', candidate.id);
        if (!job || !activeJob(job) || job.revision !== candidate.revision) return;
        const attempt = await tx.get('attempts', job.attemptId);
        // Do not refresh a voided attempt: that would rebuild personal projections.
        if (await this.cancelVoidedJob(tx, job, attempt)) return;
        if (job.status === 'blocked_config') {
          // Only retry errors whose resolution can be verified without making a model call.
          // Network and secret errors require an explicit retry to avoid a polling loop.
          const recoverable = new Set([
            'DEFAULT_PROFILE_NOT_CONFIGURED',
            'GRADING_PROFILE_NOT_FOUND',
            'PROVIDER_MODEL_NOT_FOUND',
            'MODEL_CONNECTION_NOT_FOUND',
            'CONNECTION_VERSION_NOT_FOUND',
            'PROVIDER_DISABLED',
            'MODEL_DISABLED',
          ]);
          if (!job.lastErrorCode || !recoverable.has(job.lastErrorCode)) return;
          const item = attempt?.items.find((entry) => entry.id === job.itemId);
          if (
            !attempt ||
            !item ||
            item.generation !== job.generation ||
            item.lockedAt === null ||
            item.definition.gradingMode !== 'model_rubric'
          )
            return;
          const profileId =
            job.profileId ?? (await tx.get('settings', 'global'))?.defaultGradingProfileId ?? null;
          try {
            await this.resolveConfig(profileId, tx);
          } catch (error) {
            if (error instanceof ProviderError && CONFIG_ERROR_CODES.has(error.code)) return;
            throw error;
          }
          await tx.update('gradingJobs', job.id, job.revision, {
            profileId,
            status: 'queued',
            nextRunAt: now(),
            leaseExpiresAt: null,
            lastErrorCode: null,
          });
          return;
        }
        if (
          job.status !== 'running' ||
          !job.leaseExpiresAt ||
          Date.parse(job.leaseExpiresAt) > Date.now()
        )
          return;
        await tx.update('gradingJobs', job.id, job.revision, {
          status: 'queued',
          nextRunAt: now(),
          leaseExpiresAt: null,
          lastErrorCode: 'WORKER_LEASE_EXPIRED',
        });
        const item = attempt?.items.find((candidateItem) => candidateItem.id === job.itemId);
        if (
          attempt &&
          item &&
          item.generation === job.generation &&
          item.gradingStatus === 'running'
        ) {
          item.gradingStatus = 'pending';
          await refreshAttempt(tx, attempt);
        }
      });
    }
  }

  private async claimNextJob(): Promise<ClaimedJob | null> {
    return this.ctx.db.transaction(async (tx) => {
      const candidates = await tx.listDueGradingJobs(now());
      for (const candidate of candidates) {
        const attempt = await tx.get('attempts', candidate.attemptId);
        if (await this.cancelVoidedJob(tx, candidate, attempt)) continue;
        const item = attempt?.items.find((candidateItem) => candidateItem.id === candidate.itemId);
        if (
          !attempt ||
          !item ||
          item.generation !== candidate.generation ||
          item.definition.gradingMode !== 'model_rubric' ||
          item.lockedAt === null
        ) {
          await tx.update('gradingJobs', candidate.id, candidate.revision, {
            status: 'failed',
            leaseExpiresAt: null,
            lastErrorCode: 'ATTEMPT_ITEM_NOT_FOUND',
          });
          continue;
        }
        const profile = candidate.profileId
          ? await tx.get('gradingProfiles', candidate.profileId)
          : undefined;
        // Claims are serialized in the DB transaction; no model call holds the lock.
        const runningCount = await tx.countRunningGradingJobs(candidate.profileId);
        if (runningCount >= (profile?.concurrency ?? 2)) continue;
        const leaseDuration = Math.max(this.leaseMs, (profile?.timeoutMs ?? 0) + 10_000);
        const claimedJob = await tx.update('gradingJobs', candidate.id, candidate.revision, {
          status: 'running',
          attemptCount: candidate.attemptCount + 1,
          leaseExpiresAt: new Date(Date.now() + leaseDuration).toISOString(),
          lastErrorCode: null,
        });
        const baseGradeVersion = item.grade?.version ?? 0;
        item.gradingStatus = 'running';
        await refreshAttempt(tx, attempt);
        return {
          job: candidate,
          leaseRevision: claimedJob.revision,
          item: structuredClone(item),
          baseGradeVersion,
          maxRetries: profile?.maxRetries ?? 0,
        };
      }
      return null;
    });
  }

  private async resolveConfig(
    profileId: string | null,
    db: Database = this.ctx.db,
  ): Promise<ResolvedConfig> {
    if (!profileId) configError('DEFAULT_PROFILE_NOT_CONFIGURED');
    const profile = await db.get('gradingProfiles', profileId);
    if (!profile) configError('GRADING_PROFILE_NOT_FOUND');
    const providerModel = await db.get('providerModels', profile.providerModelId);
    if (!providerModel) configError('PROVIDER_MODEL_NOT_FOUND');
    const version = await db.get('modelConnectionVersions', profile.connectionVersionId);
    if (!version) configError('CONNECTION_VERSION_NOT_FOUND');
    const connection = await db.get('modelConnections', version.connectionId);
    if (!connection) configError('MODEL_CONNECTION_NOT_FOUND');
    if (providerModel.connectionId !== connection.id || version.connectionId !== connection.id)
      configError('CONNECTION_VERSION_NOT_FOUND');
    if (!connection.enabled) configError('PROVIDER_DISABLED');
    if (!providerModel.enabled) configError('MODEL_DISABLED');
    return { profile, providerModel, connection, version };
  }

  private async gradeWithUsage(
    input: ChatCompletionInput,
    metadata: Pick<ModelUsageRecord, 'ownerId' | 'connectionId' | 'purpose' | 'jobId'>,
    evaluate: (output: ChatCompletionOutput) => GradeResult,
  ): Promise<GradeResult> {
    // Preserve request time across slow responses; no database transaction spans model I/O.
    const record = baseRecord();
    let usage: ModelTokenUsage | null = null;
    let status: ModelUsageRecord['status'] = 'failed';
    try {
      const output = await callChatCompletions({
        ...input,
        onUsage: (value) => {
          usage = value;
        },
      });
      const grade = evaluate(output);
      status = 'succeeded';
      return grade;
    } finally {
      // Append once per actual call, including retries, refusals and invalid grades.
      try {
        await this.ctx.db.insert('modelUsage', {
          ...record,
          ...metadata,
          modelKey: input.modelKey,
          status,
          usage,
        });
      } catch {
        // Usage accounting must not replace a model result or its original error.
        this.options.onError?.('usage');
      }
    }
  }

  private async executeClaimedJob(claimed: ClaimedJob): Promise<void> {
    let config: ResolvedConfig;
    try {
      config = await this.resolveConfig(claimed.job.profileId);
    } catch (error) {
      if (error instanceof ProviderError) {
        await this.failClaimedJob(claimed, safeExecutionError(error));
        return;
      }
      throw error;
    }

    let grade: GradeResult;
    try {
      if (!claimed.item.answer) throw new ProviderError('ANSWER_NOT_AVAILABLE', false);
      validateQuestion(claimed.item.definition);
      validateAnswer(claimed.item.definition, claimed.item.answer);
      validateRubricScore(claimed.item.definition, claimed.item.maxScore);
      const rubric = claimed.item.definition.rubric;
      if (!rubric) throw new ProviderError('RUBRIC_REQUIRED', false);
      const blankCriteria = new Set<string>();
      if (claimed.item.definition.type === 'fill_blank' && 'slots' in claimed.item.answer) {
        for (const criterion of rubric.criteria) {
          if (criterion.slotId && claimed.item.answer.slots[criterion.slotId]?.trim() === '')
            blankCriteria.add(criterion.id);
        }
      }
      const pendingCriterionIds = rubric.criteria
        .filter((criterion) => !blankCriteria.has(criterion.id))
        .map((criterion) => criterion.id);
      const apiKey = decryptApiKey(this.ctx, config.version.encryptedApiKey);
      const automatic = zeroCriterionEvaluations(claimed.item.definition).filter((evaluation) =>
        blankCriteria.has(evaluation.criterionId),
      );
      grade = await this.gradeWithUsage(
        {
          baseUrl: config.version.baseUrl,
          apiKey,
          modelKey: config.profile.modelIdSnapshot,
          definition: claimed.item.definition,
          answer: claimed.item.answer,
          pendingCriterionIds,
          timeoutMs: config.profile.timeoutMs,
          allowPrivateUrls: this.ctx.config.allowPrivateModelUrls,
          fetchImpl: this.options.fetchImpl,
        },
        {
          ownerId: claimed.job.ownerId,
          connectionId: config.connection.id,
          purpose: 'grading',
          jobId: claimed.job.id,
        },
        (output) =>
          gradeRubric(
            claimed.item.definition,
            claimed.item.answer,
            claimed.item.maxScore,
            [...automatic, ...output.criteria],
            {
              source: 'model',
              version: claimed.baseGradeVersion + 1,
              feedback: output.summary,
              modelId: output.modelId,
            },
          ),
      );
    } catch (error) {
      await this.failClaimedJob(claimed, safeExecutionError(error));
      return;
    }

    try {
      await this.ctx.db.transaction(async (tx) => {
        const job = await tx.get('gradingJobs', claimed.job.id);
        if (
          !job ||
          job.status !== 'running' ||
          job.revision !== claimed.leaseRevision ||
          job.generation !== claimed.job.generation
        )
          return;
        const attempt = await tx.get('attempts', job.attemptId);
        if (await this.cancelVoidedJob(tx, job, attempt)) return;
        const item = attempt?.items.find((candidate) => candidate.id === job.itemId);
        if (
          !attempt ||
          !item ||
          item.generation !== job.generation ||
          (item.grade?.version ?? 0) !== claimed.baseGradeVersion ||
          item.definition.gradingMode !== 'model_rubric'
        ) {
          await tx.update('gradingJobs', job.id, job.revision, {
            status: 'failed',
            leaseExpiresAt: null,
            lastErrorCode: 'STALE_GRADING_RESULT',
          });
          return;
        }
        if (item.grade) item.gradingHistory = [...item.gradingHistory, item.grade];
        item.grade = grade;
        item.gradingStatus = 'completed';
        await refreshAttempt(tx, attempt);
        await tx.update('gradingJobs', job.id, job.revision, {
          status: 'succeeded',
          leaseExpiresAt: null,
          lastErrorCode: null,
        });
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 409) return;
      throw error;
    }
  }

  private async failClaimedJob(
    claimed: ClaimedJob,
    failure: { code: string; retryable: boolean; blockedConfig: boolean },
  ): Promise<void> {
    try {
      await this.ctx.db.transaction(async (tx) => {
        const job = await tx.get('gradingJobs', claimed.job.id);
        if (
          !job ||
          job.status !== 'running' ||
          job.revision !== claimed.leaseRevision ||
          job.generation !== claimed.job.generation
        )
          return;
        const attempt = await tx.get('attempts', job.attemptId);
        if (await this.cancelVoidedJob(tx, job, attempt)) return;
        const canRetry =
          failure.retryable && !failure.blockedConfig && job.attemptCount <= claimed.maxRetries;
        const status: GradingJob['status'] = failure.blockedConfig
          ? 'blocked_config'
          : canRetry
            ? 'retry_wait'
            : 'failed';
        const delay = Math.min(
          60_000,
          this.retryBaseDelayMs * 2 ** Math.max(0, job.attemptCount - 1),
        );
        await tx.update('gradingJobs', job.id, job.revision, {
          status,
          nextRunAt: new Date(Date.now() + (canRetry ? delay : 0)).toISOString(),
          leaseExpiresAt: null,
          lastErrorCode: failure.code,
        });
        const item = attempt?.items.find((candidate) => candidate.id === job.itemId);
        if (attempt && item && item.generation === job.generation) {
          item.gradingStatus = status === 'failed' ? 'failed' : 'pending';
          await refreshAttempt(tx, attempt);
        }
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 409) return;
      throw error;
    }
  }

  async testConnection(connectionId: string): Promise<void> {
    const connection = await this.ctx.db.get('modelConnections', connectionId);
    if (!connection) throw new AppError(404, 'NOT_FOUND', '模型连接不存在');
    const version = await this.ctx.db.findOne('modelConnectionVersions', {
      connectionId: connection.id,
      configVersion: connection.configVersion,
    });
    if (!version) throw new AppError(422, 'CONNECTION_VERSION_NOT_FOUND', '模型连接版本不存在');
    await this.testConnectionConfig({
      baseUrl: version.baseUrl,
      apiKey: decryptApiKey(this.ctx, version.encryptedApiKey),
    });
  }

  async testConnectionConfig(input: { baseUrl: string; apiKey: string }): Promise<void> {
    await testChatCompletionsConnection({
      ...input,
      timeoutMs: 15_000,
      allowPrivateUrls: this.ctx.config.allowPrivateModelUrls,
      fetchImpl: this.options.fetchImpl,
    });
  }

  async discoverProviderModels(connectionId: string): Promise<DiscoveredProviderModel[]> {
    const connection = await this.ctx.db.get('modelConnections', connectionId);
    if (!connection) throw new AppError(404, 'NOT_FOUND', '模型连接不存在');
    const version = await this.ctx.db.findOne('modelConnectionVersions', {
      connectionId: connection.id,
      configVersion: connection.configVersion,
    });
    if (!version) throw new AppError(422, 'CONNECTION_VERSION_NOT_FOUND', '模型连接版本不存在');
    return listChatCompletionsModels({
      baseUrl: version.baseUrl,
      apiKey: decryptApiKey(this.ctx, version.encryptedApiKey),
      timeoutMs: 15_000,
      allowPrivateUrls: this.ctx.config.allowPrivateModelUrls,
      fetchImpl: this.options.fetchImpl,
    });
  }
}

const runtimes = new WeakMap<AppContext, GradingServiceImpl>();

export function createGradingService(
  ctx: AppContext,
  options: GradingServiceOptions = {},
): GradingService {
  const service = new GradingServiceImpl(ctx, options);
  runtimes.set(ctx, service);
  return service;
}

export function gradingRuntime(ctx: AppContext): GradingServiceImpl {
  const service = runtimes.get(ctx);
  if (!service) throw new Error('Grading service has not been initialized');
  return service;
}

export function isActiveGradingJob(job: GradingJob): boolean {
  return activeJob(job);
}
