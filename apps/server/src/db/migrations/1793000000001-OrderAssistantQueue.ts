import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 持久化助手待发送队列的人工排序。 */
export class OrderAssistantQueue1793000000001 implements MigrationInterface {
  name = 'OrderAssistantQueue1793000000001';
  async up(runner: QueryRunner) {
    const queue = await runner.getTable('assistantQueuedMessages');
    if (queue && !queue.findColumnByName('position'))
      await runner.addColumn(
        'assistantQueuedMessages',
        new TableColumn({ name: 'position', type: 'integer', isNullable: false, default: 0 }),
      );
  }
  async down(runner: QueryRunner) {
    const queue = await runner.getTable('assistantQueuedMessages');
    if (queue?.findColumnByName('position'))
      await runner.dropColumn('assistantQueuedMessages', 'position');
  }
}
