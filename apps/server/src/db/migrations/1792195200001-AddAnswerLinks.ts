import { Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { common, definitions } from '#server/db/schema.js';

/** Adds temporary public answer links without requiring existing development data to be rebuilt. */
export class AddAnswerLinks1792195200001 implements MigrationInterface {
  name = 'AddAnswerLinks1792195200001';
  async up(runner: QueryRunner) {
    if (!(await runner.hasTable('answerLinks'))) {
      const fields = definitions.answerLinks;
      const all = { ...common, ...fields };
      await runner.createTable(
        new Table({
          name: 'answerLinks',
          columns: Object.entries(all).map(([key, field]) => ({
            name: key,
            type: field.replace('?', '') === 'json' ? 'text' : field.replace('?', ''),
            isPrimary: key === 'id',
            isNullable: field.endsWith('?'),
          })),
        }),
      );
      await runner.createIndex(
        'answerLinks',
        new TableIndex({ name: 'uq_answerLinks_0', columnNames: ['secretHash'], isUnique: true }),
      );
      await runner.createIndex(
        'answerLinks',
        new TableIndex({ name: 'ix_answerLinks_owner', columnNames: ['ownerId'] }),
      );
    }
    const attempts = await runner.getTable('attempts');
    if (attempts && !attempts.findColumnByName('answerLinkId')) {
      await runner.addColumn(
        'attempts',
        new TableColumn({ name: 'answerLinkId', type: 'text', isNullable: true }),
      );
    }
  }
  async down(runner: QueryRunner) {
    const attempts = await runner.getTable('attempts');
    if (attempts?.findColumnByName('answerLinkId')) {
      await runner.dropColumn('attempts', 'answerLinkId');
    }
    if (await runner.hasTable('answerLinks')) await runner.dropTable('answerLinks');
  }
}
