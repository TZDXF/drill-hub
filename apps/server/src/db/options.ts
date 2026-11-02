import type { DataSourceOptions } from 'typeorm';
import type { MigrationClass } from '#server/db/migrations/index.js';
import { schemas } from '#server/db/schema.js';
export type DatabaseDriver = 'sqlite' | 'postgres';
export interface DataSourceDbOptions {
  driver: DatabaseDriver;
  /** SQLite 文件路径或 ':memory:'；driver 为 postgres 时忽略。 */
  database?: string;
  /** Postgres 连接串；driver 为 postgres 时必填。 */
  url?: string;
}
/** 构建运行时（Database.open）与 CLI 数据源（data-source.ts）共用的 TypeORM 选项。 */
export function buildDataSourceOptions(
  options: DataSourceDbOptions,
  migrations: MigrationClass[],
): DataSourceOptions {
  return {
    ...(options.driver === 'postgres'
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
    migrations,
    synchronize: false,
    logging: false,
    invalidWhereValuesBehavior: { null: 'sql-null', undefined: 'throw' },
  };
}
