import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { common, definitions, uniqueIndexes } from '#server/db/schema.js';

const assistantTableNames = [
  'assistantThreads',
  'assistantMessages',
  'assistantEvents',
  'assistantTurns',
  'searchProviders',
  'mcpServers',
  'assistantSkills',
] as const;

/** 内置对话助手、搜索提供方、MCP 与 Skills 配置表；均为新增，无需迁移已有数据。 */
export class AddAssistantTables1792448000000 implements MigrationInterface {
  name = 'AddAssistantTables1792448000000';
  async up(runner: QueryRunner) {
    for (const name of assistantTableNames) {
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
      for (const [i, columns] of (uniqueIndexes[name] ?? []).entries())
        await runner.createIndex(
          name,
          new TableIndex({ name: 'uq_' + name + '_' + i, columnNames: columns, isUnique: true }),
        );
      if ('ownerId' in definitions[name])
        await runner.createIndex(
          name,
          new TableIndex({ name: 'ix_' + name + '_owner', columnNames: ['ownerId'] }),
        );
    }
    await runner.createIndex(
      'assistantTurns',
      new TableIndex({
        name: 'ix_assistantTurns_thread_status',
        columnNames: ['threadId', 'status'],
      }),
    );
  }
  async down(runner: QueryRunner) {
    await runner.dropIndex('assistantTurns', 'ix_assistantTurns_thread_status');
    for (const name of [...assistantTableNames].reverse()) {
      for (const [i, _columns] of (uniqueIndexes[name] ?? []).entries())
        await runner.dropIndex(name, 'uq_' + name + '_' + i);
      if ('ownerId' in definitions[name]) await runner.dropIndex(name, 'ix_' + name + '_owner');
      await runner.dropTable(name);
    }
  }
}
