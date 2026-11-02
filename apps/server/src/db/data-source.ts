import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { resolveDatabaseEnv } from '#server/core/config.js';
import { migrations } from '#server/db/migrations/index.js';
import { buildDataSourceOptions } from '#server/db/options.js';

/** 供 TypeORM CLI（migration:generate/run/revert/check）使用；运行时入口是 Database.open。 */
const databaseEnv = resolveDatabaseEnv();
export const dataSource = new DataSource(
  buildDataSourceOptions(
    { driver: databaseEnv.driver, database: databaseEnv.path, url: databaseEnv.url },
    migrations,
  ),
);
