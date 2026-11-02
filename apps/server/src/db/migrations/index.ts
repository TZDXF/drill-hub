import type { MigrationInterface } from 'typeorm';
import { InitialSchema1792195200000 } from '#server/db/migrations/1792195200000-InitialSchema.js';
import { AddAnswerLinks1792195200001 } from '#server/db/migrations/1792195200001-AddAnswerLinks.js';
import { AddModelUsage1792368000000 } from '#server/db/migrations/1792368000000-AddModelUsage.js';
import { AddAccessLogs1792368000001 } from '#server/db/migrations/1792368000001-AddAccessLogs.js';
import { AddAssistantTables1792448000000 } from '#server/db/migrations/1792448000000-AddAssistantTables.js';
import { ReworkAssistantConfig1792450000000 } from '#server/db/migrations/1792450000000-ReworkAssistantConfig.js';
import { ExpandAssistantConversation1793000000000 } from '#server/db/migrations/1793000000000-ExpandAssistantConversation.js';
import { OrderAssistantQueue1793000000001 } from '#server/db/migrations/1793000000001-OrderAssistantQueue.js';
import { MigrateAssistantToDurable1793000000002 } from '#server/db/migrations/1793000000002-MigrateAssistantToDurable.js';
import { AddRateLimits1793100000000 } from '#server/db/migrations/1793100000000-AddRateLimits.js';
import { DropSessionCsrfHash1793100000001 } from '#server/db/migrations/1793100000001-DropSessionCsrfHash.js';
import { AddAssistantThreadArchive1793404800000 } from '#server/db/migrations/1793404800000-AddAssistantThreadArchive.js';
import { CreateLearningAgentsTable1793491200000 } from '#server/db/migrations/1793491200000-CreateLearningAgentsTable.js';
import { AddAssistantThreadAgentId1793491200001 } from '#server/db/migrations/1793491200001-AddAssistantThreadAgentId.js';

export {
  InitialSchema1792195200000,
  AddAnswerLinks1792195200001,
  AddModelUsage1792368000000,
  AddAccessLogs1792368000001,
  AddAssistantTables1792448000000,
  ReworkAssistantConfig1792450000000,
  ExpandAssistantConversation1793000000000,
  OrderAssistantQueue1793000000001,
  MigrateAssistantToDurable1793000000002,
  AddRateLimits1793100000000,
  DropSessionCsrfHash1793100000001,
  AddAssistantThreadArchive1793404800000,
  CreateLearningAgentsTable1793491200000,
  AddAssistantThreadAgentId1793491200001,
};
export type MigrationClass = new () => MigrationInterface;
/** 全部已注册 migration，按类名末尾的时间戳严格升序；运行时与 CLI 数据源共用此数组。 */
export const migrations: MigrationClass[] = [
  InitialSchema1792195200000,
  AddAnswerLinks1792195200001,
  AddModelUsage1792368000000,
  AddAccessLogs1792368000001,
  AddAssistantTables1792448000000,
  ReworkAssistantConfig1792450000000,
  ExpandAssistantConversation1793000000000,
  OrderAssistantQueue1793000000001,
  MigrateAssistantToDurable1793000000002,
  AddRateLimits1793100000000,
  DropSessionCsrfHash1793100000001,
  AddAssistantThreadArchive1793404800000,
  CreateLearningAgentsTable1793491200000,
  AddAssistantThreadAgentId1793491200001,
];
