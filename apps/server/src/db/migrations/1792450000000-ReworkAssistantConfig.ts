import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 助手配置重构：移除全局助手设置表（上限/超时/默认模型），对话改为按轮选择模型；模型支持默认参数与价格。 */
export class ReworkAssistantConfig1792450000000 implements MigrationInterface {
  name = 'ReworkAssistantConfig1792450000000';
  async up(runner: QueryRunner) {
    if (await runner.hasTable('assistantSettings')) await runner.dropTable('assistantSettings');
    const modelColumns: TableColumn[] = [
      new TableColumn({ name: 'contextWindow', type: 'integer', isNullable: true }),
      new TableColumn({ name: 'maxTokens', type: 'integer', isNullable: true }),
      new TableColumn({ name: 'reasoning', type: 'boolean', default: false }),
      new TableColumn({ name: 'input', type: 'text', isNullable: true }),
      new TableColumn({ name: 'costPerMillion', type: 'text', isNullable: true }),
    ];
    for (const column of modelColumns) {
      const table = await runner.getTable('providerModels');
      if (table && !table.findColumnByName(column.name))
        await runner.addColumn('providerModels', column);
    }
    const turns = await runner.getTable('assistantTurns');
    if (turns && !turns.findColumnByName('providerModelId'))
      await runner.addColumn(
        'assistantTurns',
        new TableColumn({ name: 'providerModelId', type: 'text', isNullable: true }),
      );
  }
  async down(runner: QueryRunner) {
    const turns = await runner.getTable('assistantTurns');
    if (turns?.findColumnByName('providerModelId'))
      await runner.dropColumn('assistantTurns', 'providerModelId');
    for (const name of ['contextWindow', 'maxTokens', 'reasoning', 'input', 'costPerMillion']) {
      const table = await runner.getTable('providerModels');
      if (table?.findColumnByName(name)) await runner.dropColumn('providerModels', name);
    }
  }
}
