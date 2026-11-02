import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CSRF 令牌改为时间窗派生，不再落库。 */
export class DropSessionCsrfHash1793100000001 implements MigrationInterface {
  name = 'DropSessionCsrfHash1793100000001';
  async up(runner: QueryRunner) {
    const sessions = await runner.getTable('sessions');
    if (sessions?.findColumnByName('csrfHash')) await runner.dropColumn('sessions', 'csrfHash');
  }
  async down(runner: QueryRunner) {
    const sessions = await runner.getTable('sessions');
    if (sessions && !sessions.findColumnByName('csrfHash'))
      await runner.addColumn(
        'sessions',
        new TableColumn({ name: 'csrfHash', type: 'text', isNullable: true }),
      );
  }
}
