import { EntitySchema, Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { TableName } from '#server/db/records.js';
type Field = 'text' | 'integer' | 'boolean' | 'json' | 'text?' | 'integer?' | 'json?';
const common: Record<string, Field> = {
  id: 'text',
  createdAt: 'text',
  updatedAt: 'text',
  revision: 'integer',
};
export const definitions: Record<TableName, Record<string, Field>> = {
  apiLogs: {
    requestId: 'text',
    ownerId: 'text?',
    actorId: 'text?',
    channel: 'text',
    method: 'text',
    route: 'text',
    statusCode: 'integer',
    durationMs: 'integer',
    ip: 'text',
    errorCode: 'text?',
  },
  loginLogs: {
    requestId: 'text',
    ownerId: 'text?',
    username: 'text?',
    channel: 'text',
    outcome: 'text',
    statusCode: 'integer',
    ip: 'text',
    errorCode: 'text?',
  },
  modelUsage: {
    ownerId: 'text',
    connectionId: 'text',
    modelKey: 'text',
    purpose: 'text',
    jobId: 'text?',
    status: 'text',
    usage: 'json?',
  },
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
    contextWindow: 'integer?',
    maxTokens: 'integer?',
    reasoning: 'boolean',
    input: 'json',
    costPerMillion: 'json?',
  },
  gradingProfiles: {
    providerModelId: 'text',
    connectionVersionId: 'text',
    modelIdSnapshot: 'text',
    concurrency: 'integer',
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
  assistantThreads: {
    ownerId: 'text',
    title: 'text',
    lastMessageAt: 'text',
    durableConversationId: 'integer?',
  },
  assistantMessages: {
    ownerId: 'text',
    threadId: 'text',
    role: 'text',
    content: 'text',
    reasoning: 'text?',
    images: 'json',
    status: 'text',
    errorCode: 'text?',
  },
  assistantEvents: {
    ownerId: 'text',
    threadId: 'text',
    turnId: 'text',
    seq: 'integer',
    type: 'text',
    payload: 'json',
  },
  assistantTurns: {
    ownerId: 'text',
    threadId: 'text',
    userMessageId: 'text',
    assistantMessageId: 'text',
    status: 'text',
    errorCode: 'text?',
    promptContext: 'text?',
    providerModelId: 'text?',
    apiCalls: 'integer',
    writeCalls: 'integer',
  },
  assistantQueuedMessages: {
    ownerId: 'text',
    threadId: 'text',
    content: 'text',
    mode: 'text',
    position: 'integer',
    promptContext: 'text?',
    providerModelId: 'text?',
    images: 'json',
  },
  searchProviders: {
    displayName: 'text',
    kind: 'text',
    baseUrl: 'text?',
    modelKey: 'text?',
    enabled: 'boolean',
    encryptedApiKey: 'text',
    testError: 'text?',
  },
  mcpServers: {
    name: 'text',
    transport: 'text',
    command: 'text?',
    args: 'json',
    url: 'text?',
    encryptedEnv: 'text?',
    encryptedHeaders: 'text?',
    timeoutSeconds: 'integer',
    exposure: 'text',
    enabled: 'boolean',
    testError: 'text?',
  },
  assistantSkills: {
    name: 'text',
    description: 'text',
    content: 'text',
    enabled: 'boolean',
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
  assistantEvents: [['threadId', 'seq']],
  mcpServers: [['name']],
  assistantSkills: [['name']],
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
      indices: [
        ...(uniqueIndexes[name as TableName] ?? []).map((columns) => ({ columns, unique: true })),
        ...(['auditLogs', 'apiLogs', 'loginLogs'].includes(name)
          ? [{ name: 'ix_' + name + '_date_id', columns: ['createdAt', 'id'] }]
          : []),
      ],
    }),
);
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
          ].includes(name),
      )
      .reverse())
      await runner.dropTable(name);
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

export class AddModelUsage1792368000000 implements MigrationInterface {
  name = 'AddModelUsage1792368000000';
  async up(runner: QueryRunner) {
    await runner.createTable(
      new Table({
        name: 'modelUsage',
        columns: Object.entries({ ...common, ...definitions.modelUsage }).map(([name, field]) => ({
          name,
          type: field.replace('?', '') === 'json' ? 'text' : field.replace('?', ''),
          isPrimary: name === 'id',
          isNullable: field.endsWith('?'),
        })),
      }),
    );
    await runner.createIndex(
      'modelUsage',
      new TableIndex({
        name: 'ix_modelUsage_owner_date',
        columnNames: ['ownerId', 'createdAt'],
      }),
    );
    await runner.createIndex(
      'modelUsage',
      new TableIndex({
        name: 'ix_modelUsage_date',
        columnNames: ['createdAt'],
      }),
    );
  }
  async down(runner: QueryRunner) {
    await runner.dropTable('modelUsage');
  }
}

export class AddAccessLogs1792368000001 implements MigrationInterface {
  name = 'AddAccessLogs1792368000001';
  async up(runner: QueryRunner) {
    for (const name of ['apiLogs', 'loginLogs'] as const) {
      await runner.createTable(
        new Table({
          name,
          columns: Object.entries({ ...common, ...definitions[name] }).map(([key, field]) => ({
            name: key,
            type: field.replace('?', '') === 'json' ? 'text' : field.replace('?', ''),
            isPrimary: key === 'id',
            isNullable: field.endsWith('?'),
          })),
        }),
      );
    }
    for (const name of ['auditLogs', 'apiLogs', 'loginLogs']) {
      await runner.createIndex(
        name,
        new TableIndex({
          name: 'ix_' + name + '_date_id',
          columnNames: ['createdAt', 'id'],
        }),
      );
    }
  }
  async down(runner: QueryRunner) {
    await runner.dropIndex('auditLogs', 'ix_auditLogs_date_id');
    await runner.dropTable('loginLogs');
    await runner.dropTable('apiLogs');
  }
}

const assistantTableNames = [
  'assistantThreads',
  'assistantMessages',
  'assistantEvents',
  'assistantTurns',
  'searchProviders',
  'mcpServers',
  'assistantSkills',
] as const;

/** 内置对话助手、搜索提供方、MCP 与 Skills 配置表；均为新增，无需迁移已有数据。 */
export class AddAssistantTables1792448000000 implements MigrationInterface {
  name = 'AddAssistantTables1792448000000';
  async up(runner: QueryRunner) {
    for (const name of assistantTableNames) {
      await runner.createTable(
        new Table({
          name,
          columns: Object.entries({ ...common, ...definitions[name] }).map(([key, field]) => ({
            name: key,
            type: field.replace('?', '') === 'json' ? 'text' : field.replace('?', ''),
            isPrimary: key === 'id',
            isNullable: field.endsWith('?'),
          })),
        }),
      );
      for (const [i, columns] of (uniqueIndexes[name] ?? []).entries())
        await runner.createIndex(
          name,
          new TableIndex({ name: 'uq_' + name + '_' + i, columnNames: columns, isUnique: true }),
        );
      if ('ownerId' in definitions[name])
        await runner.createIndex(
          name,
          new TableIndex({ name: 'ix_' + name + '_owner', columnNames: ['ownerId'] }),
        );
    }
    await runner.createIndex(
      'assistantTurns',
      new TableIndex({
        name: 'ix_assistantTurns_thread_status',
        columnNames: ['threadId', 'status'],
      }),
    );
  }
  async down(runner: QueryRunner) {
    await runner.dropIndex('assistantTurns', 'ix_assistantTurns_thread_status');
    for (const name of [...assistantTableNames].reverse()) {
      for (const [i, _columns] of (uniqueIndexes[name] ?? []).entries())
        await runner.dropIndex(name, 'uq_' + name + '_' + i);
      if ('ownerId' in definitions[name]) await runner.dropIndex(name, 'ix_' + name + '_owner');
      await runner.dropTable(name);
    }
  }
}

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

/** Pi Durable 持久会话绑定与跨重启可追踪的工具调用限额。 */
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
