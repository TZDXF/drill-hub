import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DataSource } from 'typeorm';
import type { EntityManager, FindOptionsWhere } from 'typeorm';
import type { DatabaseTables, TableName } from '#server/db/records.js';
import {
  schemas,
  definitions,
  InitialSchema1792195200000,
  AddAnswerLinks1792195200001,
  AddModelUsage1792368000000,
  AddAccessLogs1792368000001,
  AddAssistantTables1792448000000,
  ReworkAssistantConfig1792450000000,
  ExpandAssistantConversation1793000000000,
  OrderAssistantQueue1793000000001,
  MigrateAssistantToDurable1793000000002,
  AddRateLimits1793100000000,
} from '#server/db/schema.js';
import type {
  AuditLogView,
  ApiLogView,
  LoginLogView,
  LogPage,
  LogFilters,
  TokenUsageTotals,
  TokenUsageReport,
} from '@drill-hub/contracts';
import { AppError } from '#server/core/errors.js';
interface Queue {
  tail: Promise<void>;
}
export type DatabaseDriver = 'sqlite' | 'postgres';
export interface DatabaseOpenOptions {
  driver?: DatabaseDriver;
  /** SQLite 文件路径或 ':memory:'；driver 为 postgres 时忽略。 */
  database?: string;
  /** Postgres 连接串；driver 为 postgres 时必填。 */
  url?: string;
}
export class Database {
  private constructor(
    private source: DataSource,
    private manager: EntityManager,
    private queue: Queue,
    private readonly dialect: DatabaseDriver,
    private inTransaction = false,
  ) {}
  static async open(target: string | DatabaseOpenOptions = {}) {
    const options: DatabaseOpenOptions =
      typeof target === 'string' ? { driver: 'sqlite', database: target } : target;
    const driver = options.driver ?? 'sqlite';
    if (driver === 'postgres' && !options.url)
      throw new Error('Postgres 数据库需要提供 DATABASE_URL');
    if (driver === 'sqlite' && (options.database ?? ':memory:') !== ':memory:')
      await mkdir(dirname(options.database!), { recursive: true });
    const source = new DataSource({
      ...(driver === 'postgres'
        ? { type: 'postgres' as const, url: options.url! }
        : {
            type: 'better-sqlite3' as const,
            database: options.database ?? ':memory:',
            prepareDatabase(db: { pragma: (statement: string) => unknown }) {
              db.pragma('foreign_keys = ON');
              db.pragma('busy_timeout = 5000');
              if (options.database !== ':memory:') db.pragma('journal_mode = WAL');
            },
          }),
      entities: schemas,
      migrations: [
        InitialSchema1792195200000,
        AddAnswerLinks1792195200001,
        AddModelUsage1792368000000,
        AddAccessLogs1792368000001,
        AddAssistantTables1792448000000,
        ReworkAssistantConfig1792450000000,
        ExpandAssistantConversation1793000000000,
        OrderAssistantQueue1793000000001,
        MigrateAssistantToDurable1793000000002,
        AddRateLimits1793100000000,
      ],
      synchronize: false,
      logging: false,
      invalidWhereValuesBehavior: { null: 'sql-null', undefined: 'throw' },
    });
    await source.initialize();
    await source.runMigrations();
    return new Database(source, source.manager, { tail: Promise.resolve() }, driver);
  }
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn();
    const previous = this.queue.tail;
    let release!: () => void;
    this.queue.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
  async pruneAccessLogs(retentionDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    await this.locked(async () => {
      for (const table of ['apiLogs', 'loginLogs']) {
        await this.manager
          .getRepository(table)
          .createQueryBuilder()
          .delete()
          .where('createdAt < :cutoff', { cutoff })
          .execute();
      }
    });
  }
  async get<K extends TableName>(table: K, id: string): Promise<DatabaseTables[K] | undefined> {
    return this.findOne(table, { id } as Partial<DatabaseTables[K]>);
  }
  async findOne<K extends TableName>(
    table: K,
    where: Partial<DatabaseTables[K]>,
  ): Promise<DatabaseTables[K] | undefined> {
    return this.locked(async () => {
      const row = await this.manager
        .getRepository<DatabaseTables[K]>(table)
        .findOneBy(where as FindOptionsWhere<DatabaseTables[K]>);
      return row ?? undefined;
    });
  }
  /** Only materialize attempts containing a touched question; items are stored as JSON text. */
  async listAttemptsForQuestions(
    ownerId: string,
    questionIds: string[],
  ): Promise<DatabaseTables['attempts'][]> {
    if (!questionIds.length) return [];
    return this.locked(() => {
      const items =
        this.dialect === 'postgres'
          ? `json_array_elements(CAST(attempt.items AS json)) AS item`
          : `json_each(attempt.items) AS item`;
      const question =
        this.dialect === 'postgres'
          ? `item->>'questionId'`
          : `json_extract(item.value, '$.questionId')`;
      return this.manager
        .getRepository<DatabaseTables['attempts']>('attempts')
        .createQueryBuilder('attempt')
        .where('attempt.ownerId = :ownerId', { ownerId })
        .andWhere(`EXISTS (SELECT 1 FROM ${items} WHERE ${question} IN (:...questionIds))`, {
          questionIds,
        })
        .orderBy('attempt.createdAt', 'DESC')
        .getMany();
    });
  }

  async listActiveGradingJobs(): Promise<DatabaseTables['gradingJobs'][]> {
    return this.locked(() =>
      this.manager
        .getRepository<DatabaseTables['gradingJobs']>('gradingJobs')
        .createQueryBuilder('job')
        .where('job.status IN (:...statuses)', {
          statuses: ['queued', 'running', 'retry_wait', 'blocked_config', 'blocked_budget'],
        })
        .getMany(),
    );
  }

  async listDueGradingJobs(timestamp: string): Promise<DatabaseTables['gradingJobs'][]> {
    return this.locked(() =>
      this.manager
        .getRepository<DatabaseTables['gradingJobs']>('gradingJobs')
        .createQueryBuilder('job')
        .where('job.status IN (:...statuses)', { statuses: ['queued', 'retry_wait'] })
        .andWhere('job.nextRunAt <= :timestamp', { timestamp })
        .orderBy('job.nextRunAt', 'ASC')
        .addOrderBy('job.createdAt', 'ASC')
        .getMany(),
    );
  }

  async countRunningGradingJobs(profileId: string | null): Promise<number> {
    return this.locked(() => {
      const query = this.manager
        .getRepository<DatabaseTables['gradingJobs']>('gradingJobs')
        .createQueryBuilder('job')
        .where('job.status = :status', { status: 'running' });
      return (
        profileId === null
          ? query.andWhere('job.profileId IS NULL')
          : query.andWhere('job.profileId = :profileId', { profileId })
      ).getCount();
    });
  }
  async list<K extends TableName>(
    table: K,
    where: Partial<DatabaseTables[K]> = {},
  ): Promise<DatabaseTables[K][]> {
    return this.locked(() =>
      this.manager.getRepository<DatabaseTables[K]>(table).find({
        where: where as FindOptionsWhere<DatabaseTables[K]>,
        order: { createdAt: 'DESC' } as never,
      }),
    );
  }
  async insert<K extends TableName>(table: K, row: DatabaseTables[K]): Promise<DatabaseTables[K]> {
    return this.locked(async () => {
      await this.manager.getRepository(table).insert(row);
      return structuredClone(row);
    });
  }
  async update<K extends TableName>(
    table: K,
    id: string,
    expectedRevision: number,
    changes: Partial<DatabaseTables[K]>,
  ): Promise<DatabaseTables[K]> {
    return this.locked(async () => {
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
        throw new AppError(422, 'INVALID_REVISION', '必须提供有效的数据版本');
      const patch = {
        ...changes,
        updatedAt: new Date().toISOString(),
        revision: expectedRevision + 1,
      } as Record<string, unknown>;
      delete patch.id;
      delete patch.createdAt;
      const result = await this.manager
        .getRepository(table)
        .update({ id, revision: expectedRevision }, patch);
      if (result.affected !== 1)
        throw new AppError(409, 'VERSION_CONFLICT', '数据已发生变化，请刷新后重试');
      return await this.manager
        .getRepository<DatabaseTables[K]>(table)
        .findOneByOrFail({ id } as FindOptionsWhere<DatabaseTables[K]>);
    });
  }
  async delete<K extends TableName>(table: K, id: string) {
    await this.locked(async () => {
      await this.manager.getRepository(table).delete({ id });
    });
  }
  /** 按条件批量删除，返回受影响行数；用于聚合根级联清理。 */
  async deleteWhere<K extends TableName>(
    table: K,
    where: Record<string, unknown>,
  ): Promise<number> {
    return this.locked(async () => {
      const result = await this.manager
        .getRepository(table)
        .delete(where as FindOptionsWhere<DatabaseTables[K]>);
      return result.affected ?? 0;
    });
  }
  async transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    return this.locked(() =>
      this.source.transaction((manager) =>
        fn(new Database(this.source, manager, this.queue, this.dialect, true)),
      ),
    );
  }
  /** Raw SQL 片段中的标识符统一加引号，避免 PG 把混合大小写标识符折叠为小写。 */
  private quotePath(path: string): string {
    return path
      .split('.')
      .map((part) => `"${part}"`)
      .join('.');
  }
  private usageFieldExpression(field: string): string {
    const usage = this.quotePath('u.usage');
    return this.dialect === 'postgres'
      ? `COALESCE(SUM(CAST(${usage}::jsonb ->> '${field}' AS numeric)), 0)`
      : `COALESCE(SUM(json_extract(${usage}, '$.${field}')), 0)`;
  }
  private usageDayExpression(): string {
    const createdAt = this.quotePath('u.createdAt');
    return this.dialect === 'postgres'
      ? `to_char((${createdAt}::timestamptz + CAST(:offset AS integer) * interval '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
      : `date(${createdAt}, :offset)`;
  }
  /** PG 的 bigint/numeric 聚合经驱动返回字符串；按契约归一为 number。 */
  private normalizeUsageTotals<T extends Partial<TokenUsageTotals>>(row: T): T {
    for (const field of [
      'calls',
      'failedCalls',
      'unknownUsageCalls',
      'promptTokens',
      'completionTokens',
      'totalTokens',
    ] as const) {
      const value = row[field];
      if (value !== undefined) (row as Record<string, unknown>)[field] = Number(value);
    }
    return row;
  }
  async summarizeModelUsage(
    ownerId: string | undefined,
    from: string,
    until: string,
    utcOffsetMinutes: number,
  ) {
    return this.locked(async () => {
      const query = this.manager
        .getRepository('modelUsage')
        .createQueryBuilder('u')
        .where('"u"."createdAt" >= :from AND "u"."createdAt" < :until', { from, until });
      if (ownerId !== undefined) query.andWhere('"u"."ownerId" = :ownerId', { ownerId });
      query
        .select('COUNT(*)', 'calls')
        .addSelect(
          'COALESCE(SUM(CASE WHEN "u"."status" = \'failed\' THEN 1 ELSE 0 END), 0)',
          'failedCalls',
        )
        .addSelect(
          'COALESCE(SUM(CASE WHEN "u"."usage" IS NULL THEN 1 ELSE 0 END), 0)',
          'unknownUsageCalls',
        );
      for (const field of ['promptTokens', 'completionTokens', 'totalTokens']) {
        query.addSelect(this.usageFieldExpression(field), field);
      }
      const totals = this.normalizeUsageTotals(
        (await query.clone().getRawOne<TokenUsageTotals>())!,
      );
      const date = this.usageDayExpression();
      const daily = await query
        .clone()
        .addSelect(date, 'date')
        .setParameter(
          'offset',
          this.dialect === 'postgres' ? utcOffsetMinutes : `${utcOffsetMinutes} minutes`,
        )
        .groupBy(date)
        .orderBy(date, 'ASC')
        .getRawMany<TokenUsageReport['daily'][number]>();
      for (const day of daily) this.normalizeUsageTotals(day);
      const models = await query
        .clone()
        .addSelect('"u"."connectionId"', 'connectionId')
        .addSelect('"u"."modelKey"', 'modelKey')
        .groupBy('"u"."connectionId"')
        .addGroupBy('"u"."modelKey"')
        .orderBy('"totalTokens"', 'DESC')
        .addOrderBy('"u"."connectionId"', 'ASC')
        .addOrderBy('"u"."modelKey"', 'ASC')
        .getRawMany<TokenUsageReport['models'][number]>();
      for (const model of models) this.normalizeUsageTotals(model);
      return { totals: totals!, daily, models };
    });
  }
  async queryLogs<K extends 'auditLogs' | 'apiLogs' | 'loginLogs'>(
    table: K,
    filters: LogFilters,
  ): Promise<
    LogPage<{ auditLogs: AuditLogView; apiLogs: ApiLogView; loginLogs: LoginLogView }[K]>
  > {
    return this.locked(async () => {
      const query = this.manager
        .getRepository(table)
        .createQueryBuilder('l')
        .leftJoin('users', 'u', '"u"."id" = "l"."ownerId"');
      const fields =
        table === 'auditLogs'
          ? [
              'id',
              'createdAt',
              'updatedAt',
              'revision',
              'ownerId',
              'actorId',
              'action',
              'resourceType',
              'resourceId',
            ]
          : Object.keys({
              id: '',
              createdAt: '',
              updatedAt: '',
              revision: '',
              ...definitions[table],
            });
      query.select(fields.map((field) => `"l"."${field}" AS "${field}"`));
      if (table !== 'loginLogs') query.addSelect('"u"."username"', 'username');
      if (filters.from) query.andWhere('"l"."createdAt" >= :from', { from: filters.from });
      if (filters.until) query.andWhere('"l"."createdAt" < :until', { until: filters.until });
      if (filters.q) {
        const columns =
          table === 'auditLogs'
            ? ['l.action', 'l.resourceType', 'l.resourceId', 'l.ownerId', 'l.actorId', 'u.username']
            : table === 'apiLogs'
              ? [
                  'l.route',
                  'l.requestId',
                  'l.ownerId',
                  'l.actorId',
                  'u.username',
                  'l.ip',
                  'l.errorCode',
                ]
              : ['l.username', 'l.ownerId', 'l.requestId', 'l.ip', 'l.errorCode'];
        const contains = (column: string) => {
          const quoted = this.quotePath(column);
          return this.dialect === 'postgres'
            ? `strpos(lower(${quoted}), lower(:q)) > 0`
            : `instr(lower(${quoted}), lower(:q)) > 0`;
        };
        query.andWhere('(' + columns.map((column) => contains(column)).join(' OR ') + ')', {
          q: filters.q,
        });
      }
      if (table !== 'auditLogs' && filters.channel)
        query.andWhere('"l"."channel" = :channel', { channel: filters.channel });
      if (table !== 'auditLogs' && filters.statusCode)
        query.andWhere('"l"."statusCode" = :status', { status: filters.statusCode });
      if (table === 'apiLogs' && filters.method)
        query.andWhere('"l"."method" = :method', { method: filters.method });
      if (table === 'loginLogs' && filters.outcome)
        query.andWhere('"l"."outcome" = :outcome', { outcome: filters.outcome });
      const total = await query.getCount();
      const items = await query
        .orderBy('"l"."createdAt"', 'DESC')
        .addOrderBy('"l"."id"', 'DESC')
        .offset((filters.page - 1) * filters.pageSize)
        .limit(filters.pageSize)
        .getRawMany<{ auditLogs: AuditLogView; apiLogs: ApiLogView; loginLogs: LoginLogView }[K]>();
      return { items, total, page: filters.page, pageSize: filters.pageSize };
    });
  }
  async close() {
    await this.locked(() => this.source.destroy());
  }
}
