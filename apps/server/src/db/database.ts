import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DataSource } from 'typeorm';
import type { EntityManager, FindOptionsWhere } from 'typeorm';
import type { DatabaseTables, TableName } from './records.js';
import { schemas, InitialSchema1792195200000, AddAnswerLinks1792195200001 } from './schema.js';
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
      migrations: [InitialSchema1792195200000, AddAnswerLinks1792195200001],
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
  async close() {
    await this.locked(() => this.source.destroy());
  }
}
