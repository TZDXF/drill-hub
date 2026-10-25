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
  ApiLogView,
  LoginLogView,
  SearchProviderView,
  AssistantThread,
  AssistantMessageView,
  AssistantEventView,
  AssistantTurnView,
  McpServerView,
  AssistantSkillView,
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
  /** model_test 仅用于保留已发生的评分测试用量。 */
  purpose: 'grading' | 'model_test' | 'assistant';
  jobId: string | null;
  status: 'succeeded' | 'failed';
  usage: ModelTokenUsage | null;
}
export type ApiLogRecord = Omit<ApiLogView, 'username'>;
export type LoginLogRecord = LoginLogView;
export interface SearchProviderRecord extends Omit<SearchProviderView, 'apiKeyConfigured'> {
  encryptedApiKey: string;
}
export interface AssistantMessageRecord extends BaseRecord {
  ownerId: string;
  threadId: string;
  role: AssistantMessageView['role'];
  content: string;
  reasoning: string | null;
  images: import('@drill-hub/contracts').AssistantImageAttachment[];
  status: AssistantMessageView['status'];
  errorCode: string | null;
}
export interface AssistantEventRecord extends BaseRecord {
  ownerId: string;
  threadId: string;
  turnId: string;
  seq: number;
  type: AssistantEventView['type'];
  payload: Record<string, unknown>;
}
export interface AssistantQueuedMessageRecord extends BaseRecord {
  ownerId: string;
  threadId: string;
  content: string;
  mode: import('@drill-hub/contracts').AssistantQueueMode;
  position: number;
  promptContext: string | null;
  providerModelId: string | null;
  images: import('@drill-hub/contracts').AssistantImageAttachment[];
}
export interface AssistantTurnRecord extends BaseRecord {
  ownerId: string;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  status: AssistantTurnView['status'];
  errorCode: string | null;
  /** 本轮发起时的页面上下文描述，仅用于构造模型提示词，不在视图中返回。 */
  promptContext: string | null;
  /** 本轮请求指定的助手模型；null 表示由服务端自动选择。 */
  providerModelId: string | null;
}
export interface McpServerRecord extends BaseRecord {
  name: string;
  transport: McpServerView['transport'];
  command: string | null;
  args: string[];
  url: string | null;
  encryptedEnv: string | null;
  encryptedHeaders: string | null;
  timeoutSeconds: number;
  exposure: McpServerView['exposure'];
  enabled: boolean;
  testError: string | null;
}
export interface AssistantSkillRecord extends Omit<AssistantSkillView, never> {
  content: string;
}
export interface DatabaseTables {
  apiLogs: ApiLogRecord;
  loginLogs: LoginLogRecord;
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
  assistantThreads: AssistantThread;
  assistantMessages: AssistantMessageRecord;
  assistantEvents: AssistantEventRecord;
  assistantTurns: AssistantTurnRecord;
  assistantQueuedMessages: AssistantQueuedMessageRecord;
  searchProviders: SearchProviderRecord;
  mcpServers: McpServerRecord;
  assistantSkills: AssistantSkillRecord;
}
export type TableName = keyof DatabaseTables;
