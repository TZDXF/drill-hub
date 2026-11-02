import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 助手线程绑定学习智能体：补齐 agentId 列。 */
export class AddAssistantThreadAgentId1793491200001 implements MigrationInterface {
  name = 'AddAssistantThreadAgentId1793491200001';
  async up(runner: QueryRunner) {
    const threads = await runner.getTable('assistantThreads');
    if (threads && !threads.findColumnByName('agentId'))
      await runner.addColumn(
        'assistantThreads',
        new TableColumn({ name: 'agentId', type: 'text', isNullable: true }),
      );
  }
  async down(runner: QueryRunner) {
    const threads = await runner.getTable('assistantThreads');
    if (threads?.findColumnByName('agentId'))
      await runner.dropColumn('assistantThreads', 'agentId');
  }
}
