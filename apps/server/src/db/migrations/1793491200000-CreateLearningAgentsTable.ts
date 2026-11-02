import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { common, definitions } from '#server/db/schema.js';

/** 用户自定义学习智能体表；人设作用于助手对话，无需迁移已有数据。 */
export class CreateLearningAgentsTable1793491200000 implements MigrationInterface {
  name = 'CreateLearningAgentsTable1793491200000';
  async up(runner: QueryRunner) {
    if (await runner.hasTable('learningAgents')) return;
    await runner.createTable(
      new Table({
        name: 'learningAgents',
        columns: Object.entries({ ...common, ...definitions.learningAgents }).map(
          ([key, field]) => ({
            name: key,
            type: field.replace('?', '') === 'json' ? 'text' : field.replace('?', ''),
            isPrimary: key === 'id',
            isNullable: field.endsWith('?'),
          }),
        ),
      }),
    );
    await runner.createIndex(
      'learningAgents',
      new TableIndex({ name: 'ix_learningAgents_owner', columnNames: ['ownerId'] }),
    );
  }
  async down(runner: QueryRunner) {
    if (!(await runner.hasTable('learningAgents'))) return;
    await runner.dropIndex('learningAgents', 'ix_learningAgents_owner');
    await runner.dropTable('learningAgents');
  }
}
