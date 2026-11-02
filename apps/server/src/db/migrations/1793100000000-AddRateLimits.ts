import { Table } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { common, definitions } from '#server/db/schema.js';

/** 多实例共享的限流桶；id 即桶键。 */
export class AddRateLimits1793100000000 implements MigrationInterface {
  name = 'AddRateLimits1793100000000';
  async up(runner: QueryRunner) {
    if (await runner.hasTable('rateLimits')) return;
    await runner.createTable(
      new Table({
        name: 'rateLimits',
        columns: Object.entries({ ...common, ...definitions.rateLimits }).map(([name, field]) => ({
          name,
          type: field.replace('?', ''),
          isPrimary: name === 'id',
          isNullable: field.endsWith('?'),
        })),
      }),
    );
  }
  async down(runner: QueryRunner) {
    if (await runner.hasTable('rateLimits')) await runner.dropTable('rateLimits');
  }
}
