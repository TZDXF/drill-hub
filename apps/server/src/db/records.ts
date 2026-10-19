import type {
  BaseRecord,
  UserView,
  Scope,
  Topic,
  Content,
  LearningPlan,
  Question,
  Assessment,
  Attempt,
  WrongQuestion,
  ModelConnectionView,
  ProviderModel,
  GradingProfile,
  GradingJob,
  ModelTokenUsage,
} from '@drill-hub/contracts';
export interface UserRecord extends UserView {
  passwordHash: string;
}
export interface SessionRecord extends BaseRecord {
  userId: string;
  channel: 'web' | 'mobile';
  secretHash: string;
  refreshHash: string | null;
  usedRefreshHashes: string[];
  csrfHash: string | null;
  expiresAt: string;
  refreshExpiresAt: string | null;
  revokedAt: string | null;
}
export interface AgentTokenRecord extends BaseRecord {
  ownerId: string;
  name: string;
  prefix: string;
  secretHash: string;
  encryptedSecret: string;
  scopes: Scope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
}
export interface SettingsRecord extends BaseRecord {
  instanceId: string;
  displayName: string;
  defaultGradingProfileId: string | null;
}
export interface QuestionVersionRecord extends BaseRecord {
  ownerId: string;
  questionId: string;
  version: number;
  definition: Question['definition'];
}
export interface AnswerLinkRecord extends BaseRecord {
  purpose: Attempt['purpose'];
  taskId: string | null;
  ownerId: string;
  assessmentId: string;
  secretHash: string;
  expiresAt: string;
  revokedAt: string | null;
  attemptId: string | null;
}
export interface ModelConnectionRecord extends Omit<ModelConnectionView, 'apiKeyConfigured'> {
  encryptedApiKey: string;
}
export interface ModelConnectionVersionRecord extends BaseRecord {
  connectionId: string;
  configVersion: number;
  protocol: ModelConnectionRecord['protocol'];
  baseUrl: string;
  encryptedApiKey: string;
}
export interface AuditRecord extends BaseRecord {
  ownerId: string | null;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  summary: Record<string, unknown>;
}
export interface IdempotencyRecord extends BaseRecord {
  ownerId: string;
  key: string;
  requestHash: string;
  result: unknown;
  expiresAt: string;
}
export interface ModelUsageRecord extends BaseRecord {
  ownerId: string;
  connectionId: string;
  modelKey: string;
  purpose: 'grading' | 'model_test';
  jobId: string | null;
  status: 'succeeded' | 'failed';
  usage: ModelTokenUsage | null;
}
export interface DatabaseTables {
  modelUsage: ModelUsageRecord;
  users: UserRecord;
  sessions: SessionRecord;
  agentTokens: AgentTokenRecord;
  settings: SettingsRecord;
  topics: Topic;
  contents: Content;
  plans: LearningPlan;
  questions: Question;
  questionVersions: QuestionVersionRecord;
  assessments: Assessment;
  answerLinks: AnswerLinkRecord;
  attempts: Attempt;
  wrongQuestions: WrongQuestion;
  modelConnections: ModelConnectionRecord;
  modelConnectionVersions: ModelConnectionVersionRecord;
  providerModels: ProviderModel;
  gradingProfiles: GradingProfile;
  gradingJobs: GradingJob;
  auditLogs: AuditRecord;
  idempotency: IdempotencyRecord;
}
export type TableName = keyof DatabaseTables;
