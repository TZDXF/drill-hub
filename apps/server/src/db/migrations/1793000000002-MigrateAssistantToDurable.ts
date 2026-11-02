import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Pi Durable 持久会话绑定与跨重启可追踪的工具调用用量。 */
export class MigrateAssistantToDurable1793000000002 implements MigrationInterface {
  name = 'MigrateAssistantToDurable1793000000002';
  async up(runner: QueryRunner) {
    const threads = await runner.getTable('assistantThreads');
    if (threads && !threads.findColumnByName('durableConversationId'))
      await runner.addColumn(
        'assistantThreads',
        new TableColumn({ name: 'durableConversationId', type: 'integer', isNullable: true }),
      );
    const turns = await runner.getTable('assistantTurns');
    for (const name of ['apiCalls', 'writeCalls']) {
      if (turns && !turns.findColumnByName(name))
        await runner.addColumn(
          'assistantTurns',
          new TableColumn({ name, type: 'integer', isNullable: false, default: 0 }),
        );
    }
  }
  async down(runner: QueryRunner) {
    const threads = await runner.getTable('assistantThreads');
    if (threads?.findColumnByName('durableConversationId'))
      await runner.dropColumn('assistantThreads', 'durableConversationId');
    const turns = await runner.getTable('assistantTurns');
    for (const name of ['apiCalls', 'writeCalls']) {
      if (turns?.findColumnByName(name)) await runner.dropColumn('assistantTurns', name);
    }
  }
}
