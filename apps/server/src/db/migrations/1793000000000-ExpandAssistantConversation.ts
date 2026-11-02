import { Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { common, definitions } from '#server/db/schema.js';

/** Streaming reasoning, image input, persistent follow-up queues and conversation forking. */
export class ExpandAssistantConversation1793000000000 implements MigrationInterface {
  name = 'ExpandAssistantConversation1793000000000';
  async up(runner: QueryRunner) {
    const messages = await runner.getTable('assistantMessages');
    if (messages && !messages.findColumnByName('reasoning'))
      await runner.addColumn(
        'assistantMessages',
        new TableColumn({ name: 'reasoning', type: 'text', isNullable: true }),
      );
    if (messages && !messages.findColumnByName('images'))
      await runner.addColumn(
        'assistantMessages',
        new TableColumn({ name: 'images', type: 'text', isNullable: false, default: "'[]'" }),
      );
    if (!(await runner.hasTable('assistantQueuedMessages'))) {
      await runner.createTable(
        new Table({
          name: 'assistantQueuedMessages',
          columns: Object.entries({ ...common, ...definitions.assistantQueuedMessages }).map(
            ([key, field]) => ({
              name: key,
              type: field === 'json' ? 'text' : field.replace('?', ''),
              isPrimary: key === 'id',
              isNullable: field.endsWith('?'),
            }),
          ),
        }),
      );
      await runner.createIndex(
        'assistantQueuedMessages',
        new TableIndex({
          name: 'ix_assistant_queue_thread_created',
          columnNames: ['threadId', 'createdAt', 'id'],
        }),
      );
    }
  }
  async down(runner: QueryRunner) {
    if (await runner.hasTable('assistantQueuedMessages'))
      await runner.dropTable('assistantQueuedMessages');
    const messages = await runner.getTable('assistantMessages');
    if (messages?.findColumnByName('images'))
      await runner.dropColumn('assistantMessages', 'images');
    if (messages?.findColumnByName('reasoning'))
      await runner.dropColumn('assistantMessages', 'reasoning');
  }
}
