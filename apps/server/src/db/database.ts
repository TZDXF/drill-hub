import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DataSource } from 'typeorm';
import type { EntityManager, FindOptionsWhere } from 'typeorm';
import type { DatabaseTables, TableName } from './records.js';
import {
  schemas,
  definitions,
  InitialSchema1792195200000,
  AddAnswerLinks1792195200001,
  AddModelUsage1792368000000,
  AddAccessLogs1792368000001,
} from './schema.js';
import type {
  AuditLogView,
  ApiLogView,
  LoginLogView,
  LogPage,
  LogFilters,
  TokenUsageTotals,
  TokenUsageReport,
} from '@drill-hub/contracts';
import { AppError } from '../core/errors.js';
interface Queue {
  tail: Promise<void>;
}
export class Database {
  private constructor(
    private source: DataSource,
    private manager: EntityManager,
    private queue: Queue,
    private inTransaction = false,
  ) {}
  static async open(database: string) {
    if (database !== ':memory:') await mkdir(dirname(database), { recursive: true });
    const source = new DataSource({
      type: 'better-sqlite3',
      database,
      entities: schemas,
      migrations: [
        InitialSchema1792195200000,
        AddAnswerLinks1792195200001,
        AddModelUsage1792368000000,
        AddAccessLogs1792368000001,
      ],
      synchronize: false,
      logging: false,
      invalidWhereValuesBehavior: { null: 'sql-null', undefined: 'throw' },
      prepareDatabase(db) {
        db.pragma('foreign_keys = ON');
        db.pragma('busy_timeout = 5000');
        if (database !== ':memory:') db.pragma('journal_mode = WAL');
      },
    });
    await source.initialize();
    await source.runMigrations();
    return new Database(source, source.manager, { tail: Promise.resolve() });
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
  async transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    return this.locked(() =>
      this.source.transaction((manager) =>
        fn(new Database(this.source, manager, this.queue, true)),
      ),
    );
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
        .where('u.createdAt >= :from AND u.createdAt < :until', { from, until });
      if (ownerId !== undefined) query.andWhere('u.ownerId = :ownerId', { ownerId });
      query
        .select('COUNT(*)', 'calls')
        .addSelect(
          "COALESCE(SUM(CASE WHEN u.status = 'failed' THEN 1 ELSE 0 END), 0)",
          'failedCalls',
        )
        .addSelect(
          'COALESCE(SUM(CASE WHEN u.usage IS NULL THEN 1 ELSE 0 END), 0)',
          'unknownUsageCalls',
        )
        .addSelect(
          "COALESCE(SUM(CASE WHEN u.purpose = 'model_test' THEN 1 ELSE 0 END), 0)",
          'modelTestCalls',
        );
      for (const field of ['promptTokens', 'completionTokens', 'totalTokens']) {
        query.addSelect(`COALESCE(SUM(json_extract(u.usage, '$.${field}')), 0)`, field);
      }
      const totals = await query.clone().getRawOne<TokenUsageTotals>();
      const date = 'date(u.createdAt, :offset)';
      const daily = await query
        .clone()
        .addSelect(date, 'date')
        .setParameter('offset', `${utcOffsetMinutes} minutes`)
        .groupBy(date)
        .orderBy(date, 'ASC')
        .getRawMany<TokenUsageReport['daily'][number]>();
      const models = await query
        .clone()
        .addSelect('u.connectionId', 'connectionId')
        .addSelect('u.modelKey', 'modelKey')
        .groupBy('u.connectionId')
        .addGroupBy('u.modelKey')
        .orderBy('totalTokens', 'DESC')
        .addOrderBy('u.connectionId', 'ASC')
        .addOrderBy('u.modelKey', 'ASC')
        .getRawMany<TokenUsageReport['models'][number]>();
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
        .leftJoin('users', 'u', 'u.id = l.ownerId');
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
      query.select(fields.map((field) => `l.${field} AS "${field}"`));
      if (table !== 'loginLogs') query.addSelect('u.username', 'username');
      if (filters.from) query.andWhere('l.createdAt >= :from', { from: filters.from });
      if (filters.until) query.andWhere('l.createdAt < :until', { until: filters.until });
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
        query.andWhere(
          '(' +
            columns.map((column) => `instr(lower(${column}), lower(:q)) > 0`).join(' OR ') +
            ')',
          { q: filters.q },
        );
      }
      if (table !== 'auditLogs' && filters.channel)
        query.andWhere('l.channel = :channel', { channel: filters.channel });
      if (table !== 'auditLogs' && filters.statusCode)
        query.andWhere('l.statusCode = :status', { status: filters.statusCode });
      if (table === 'apiLogs' && filters.method)
        query.andWhere('l.method = :method', { method: filters.method });
      if (table === 'loginLogs' && filters.outcome)
        query.andWhere('l.outcome = :outcome', { outcome: filters.outcome });
      const total = await query.getCount();
      const items = await query
        .orderBy('l.createdAt', 'DESC')
        .addOrderBy('l.id', 'DESC')
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
