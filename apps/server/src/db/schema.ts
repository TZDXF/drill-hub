import { EntitySchema, Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { TableName } from './records.js';
type Field = 'text' | 'integer' | 'boolean' | 'json' | 'text?' | 'integer?' | 'json?';
const common: Record<string, Field> = {
  id: 'text',
  createdAt: 'text',
  updatedAt: 'text',
  revision: 'integer',
};
export const definitions: Record<TableName, Record<string, Field>> = {
  users: {
    username: 'text',
    displayName: 'text',
    passwordHash: 'text',
    role: 'text',
    status: 'text',
    mustChangePassword: 'boolean',
  },
  sessions: {
    userId: 'text',
    channel: 'text',
    secretHash: 'text',
    refreshHash: 'text?',
    usedRefreshHashes: 'json',
    csrfHash: 'text?',
    expiresAt: 'text',
    refreshExpiresAt: 'text?',
    revokedAt: 'text?',
  },
  agentTokens: {
    ownerId: 'text',
    name: 'text',
    prefix: 'text',
    secretHash: 'text',
    encryptedSecret: 'text',
    scopes: 'json',
    expiresAt: 'text?',
    lastUsedAt: 'text?',
  },
  settings: { instanceId: 'text', displayName: 'text', defaultGradingProfileId: 'text?' },
  topics: { ownerId: 'text', title: 'text', goalText: 'text', archivedAt: 'text?' },
  contents: {
    ownerId: 'text',
    topicId: 'text',
    title: 'text',
    bodyText: 'text',
    archivedAt: 'text?',
  },
  plans: { ownerId: 'text', topicId: 'text', title: 'text', phases: 'json', archivedAt: 'text?' },
  questions: {
    ownerId: 'text',
    topicId: 'text',
    version: 'integer',
    definition: 'json',
    archivedAt: 'text?',
  },
  questionVersions: { ownerId: 'text', questionId: 'text', version: 'integer', definition: 'json' },
  assessments: {
    ownerId: 'text',
    topicId: 'text',
    kind: 'text',
    title: 'text',
    durationSeconds: 'integer?',
    items: 'json',
    archivedAt: 'text?',
  },
  answerLinks: {
    purpose: 'text',
    taskId: 'text?',
    ownerId: 'text',
    assessmentId: 'text',
    secretHash: 'text',
    expiresAt: 'text',
    revokedAt: 'text?',
    attemptId: 'text?',
  },
  attempts: {
    ownerId: 'text',
    topicId: 'text',
    assessmentId: 'text?',
    answerLinkId: 'text?',
    purpose: 'text',
    taskId: 'text?',
    voidedAt: 'text?',
    voidedBy: 'text?',
    voidReason: 'text?',
    title: 'text',
    kind: 'text',
    status: 'text',
    startedAt: 'text',
    expiresAt: 'text?',
    submittedAt: 'text?',
    submissionReason: 'text?',
    items: 'json',
  },
  wrongQuestions: {
    ownerId: 'text',
    topicId: 'text',
    questionId: 'text',
    masteryStatus: 'text',
    lastWrongAt: 'text',
    lastPracticedAt: 'text',
    wrongCount: 'integer',
  },
  modelConnections: {
    displayName: 'text',
    protocol: 'text',
    baseUrl: 'text',
    enabled: 'boolean',
    configVersion: 'integer',
    encryptedApiKey: 'text',
  },
  modelConnectionVersions: {
    connectionId: 'text',
    configVersion: 'integer',
    protocol: 'text',
    baseUrl: 'text',
    encryptedApiKey: 'text',
  },
  providerModels: {
    connectionId: 'text',
    modelKey: 'text',
    displayName: 'text',
    enabled: 'boolean',
    verifiedConfigVersion: 'integer?',
    testError: 'text?',
  },
  gradingProfiles: {
    providerModelId: 'text',
    connectionVersionId: 'text',
    modelIdSnapshot: 'text',
    promptVersion: 'text',
    timeoutMs: 'integer',
    maxRetries: 'integer',
    isDefault: 'boolean',
  },
  gradingJobs: {
    ownerId: 'text',
    attemptId: 'text',
    itemId: 'text',
    generation: 'integer',
    profileId: 'text?',
    status: 'text',
    attemptCount: 'integer',
    nextRunAt: 'text',
    leaseExpiresAt: 'text?',
    lastErrorCode: 'text?',
  },
  auditLogs: {
    ownerId: 'text?',
    actorId: 'text',
    action: 'text',
    resourceType: 'text',
    resourceId: 'text',
    summary: 'json',
  },
  idempotency: {
    ownerId: 'text',
    key: 'text',
    requestHash: 'text',
    result: 'json',
    expiresAt: 'text',
  },
};
const uniqueIndexes: Partial<Record<TableName, string[][]>> = {
  users: [['username']],
  sessions: [['secretHash']],
  agentTokens: [['secretHash']],
  answerLinks: [['secretHash']],
  questionVersions: [['questionId', 'version']],
  providerModels: [['connectionId', 'modelKey']],
  gradingJobs: [['attemptId', 'itemId', 'generation']],
  wrongQuestions: [['ownerId', 'questionId']],
  idempotency: [['ownerId', 'key']],
};
export const schemas = Object.entries(definitions).map(
  ([name, fields]) =>
    new EntitySchema({
      name,
      tableName: name,
      columns: Object.fromEntries(
        Object.entries({ ...common, ...fields }).map(([key, field]) => [
          key,
          {
            type: field.replace('?', '') === 'json' ? 'simple-json' : field.replace('?', ''),
            primary: key === 'id',
            nullable: field.endsWith('?'),
          },
        ]),
      ) as never,
      indices: (uniqueIndexes[name as TableName] ?? []).map((columns) => ({
        columns,
        unique: true,
      })),
    }),
);
export class InitialSchema1792195200000 implements MigrationInterface {
  name = 'InitialSchema1792195200000';
  async up(runner: QueryRunner) {
    for (const [name, fields] of Object.entries(definitions)) {
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
    for (const name of Object.keys(definitions).reverse()) await runner.dropTable(name);
  }
}

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
