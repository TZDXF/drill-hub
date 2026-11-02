import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 助手对话归档：线程补齐归档时间列（旧库建表时无该列）。 */
export class AddAssistantThreadArchive1793404800000 implements MigrationInterface {
  name = 'AddAssistantThreadArchive1793404800000';
  async up(runner: QueryRunner) {
    const threads = await runner.getTable('assistantThreads');
    if (threads && !threads.findColumnByName('archivedAt'))
      await runner.addColumn(
        'assistantThreads',
        new TableColumn({ name: 'archivedAt', type: 'text', isNullable: true }),
      );
  }
  async down(runner: QueryRunner) {
    const threads = await runner.getTable('assistantThreads');
    if (threads?.findColumnByName('archivedAt'))
      await runner.dropColumn('assistantThreads', 'archivedAt');
  }
}
