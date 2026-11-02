import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { TableName } from '#server/db/records.js';
import { common, definitions, uniqueIndexes } from '#server/db/schema.js';

export class InitialSchema1792195200000 implements MigrationInterface {
  name = 'InitialSchema1792195200000';
  async up(runner: QueryRunner) {
    for (const [name, fields] of Object.entries(definitions).filter(
      ([name]) =>
        ![
          'modelUsage',
          'apiLogs',
          'loginLogs',
          'assistantThreads',
          'assistantMessages',
          'assistantEvents',
          'assistantTurns',
          'assistantQueuedMessages',
          'searchProviders',
          'mcpServers',
          'assistantSkills',
          'rateLimits',
        ].includes(name),
    )) {
      const all = { ...common, ...fields };
      await runner.createTable(
        new Table({
          name,
          columns: Object.entries(all).map(([key, field]) => ({
            name: key,
            type: field.replace('?', '') === 'json' ? 'text' : field.replace('?', ''),
            isPrimary: key === 'id',
            isNullable: field.endsWith('?'),
          })),
        }),
      );
      for (const [i, columns] of (uniqueIndexes[name as TableName] ?? []).entries())
        await runner.createIndex(
          name,
          new TableIndex({ name: 'uq_' + name + '_' + i, columnNames: columns, isUnique: true }),
        );
      if ('ownerId' in fields)
        await runner.createIndex(
          name,
          new TableIndex({ name: 'ix_' + name + '_owner', columnNames: ['ownerId'] }),
        );
    }
    await runner.createIndex(
      'gradingJobs',
      new TableIndex({ name: 'ix_jobs_status', columnNames: ['status', 'nextRunAt'] }),
    );
    await runner.createIndex(
      'sessions',
      new TableIndex({ name: 'ix_session_refresh', columnNames: ['refreshHash'] }),
    );
  }
  async down(runner: QueryRunner) {
    for (const name of Object.keys(definitions)
      .filter(
        (name) =>
          ![
            'modelUsage',
            'apiLogs',
            'loginLogs',
            'assistantThreads',
            'assistantMessages',
            'assistantEvents',
            'assistantTurns',
            'assistantQueuedMessages',
            'searchProviders',
            'mcpServers',
            'assistantSkills',
            'rateLimits',
          ].includes(name),
      )
      .reverse())
      await runner.dropTable(name);
  }
}
