import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { common, definitions } from '#server/db/schema.js';

export class AddAccessLogs1792368000001 implements MigrationInterface {
  name = 'AddAccessLogs1792368000001';
  async up(runner: QueryRunner) {
    for (const name of ['apiLogs', 'loginLogs'] as const) {
      await runner.createTable(
        new Table({
          name,
          columns: Object.entries({ ...common, ...definitions[name] }).map(([key, field]) => ({
            name: key,
            type: field.replace('?', '') === 'json' ? 'text' : field.replace('?', ''),
            isPrimary: key === 'id',
            isNullable: field.endsWith('?'),
          })),
        }),
      );
    }
    for (const name of ['auditLogs', 'apiLogs', 'loginLogs']) {
      await runner.createIndex(
        name,
        new TableIndex({
          name: 'ix_' + name + '_date_id',
          columnNames: ['createdAt', 'id'],
        }),
      );
    }
  }
  async down(runner: QueryRunner) {
    await runner.dropIndex('auditLogs', 'ix_auditLogs_date_id');
    await runner.dropTable('loginLogs');
    await runner.dropTable('apiLogs');
  }
}
