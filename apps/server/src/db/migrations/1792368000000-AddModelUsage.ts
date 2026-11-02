import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { common, definitions } from '#server/db/schema.js';

export class AddModelUsage1792368000000 implements MigrationInterface {
  name = 'AddModelUsage1792368000000';
  async up(runner: QueryRunner) {
    await runner.createTable(
      new Table({
        name: 'modelUsage',
        columns: Object.entries({ ...common, ...definitions.modelUsage }).map(([name, field]) => ({
          name,
          type: field.replace('?', '') === 'json' ? 'text' : field.replace('?', ''),
          isPrimary: name === 'id',
          isNullable: field.endsWith('?'),
        })),
      }),
    );
    await runner.createIndex(
      'modelUsage',
      new TableIndex({
        name: 'ix_modelUsage_owner_date',
        columnNames: ['ownerId', 'createdAt'],
      }),
    );
    await runner.createIndex(
      'modelUsage',
      new TableIndex({
        name: 'ix_modelUsage_date',
        columnNames: ['createdAt'],
      }),
    );
  }
  async down(runner: QueryRunner) {
    await runner.dropTable('modelUsage');
  }
}
