export const API_VERSION = 1;
export const APP_VERSION = '0.1.0';
export type Role = 'admin' | 'user';
export type Scope =
  | 'read'
  | 'content:write'
  | 'assessment:write'
  | 'grading:request'
  | 'grade:write'
  | 'attempt:write'
  | 'archive:write';
export const AGENT_SCOPES: Scope[] = [
  'read',
  'content:write',
  'assessment:write',
  'grading:request',
  'grade:write',
  'attempt:write',
  'archive:write',
];
export interface ApiMeta {
  requestId: string;
  serverTime: string;
}
export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}
export interface ApiFailure {
  error: { code: string; message: string; fields?: Record<string, string> };
  meta: ApiMeta;
}
export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
export interface UserView extends BaseRecord {
  username: string;
  displayName: string;
  role: Role;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
}
export interface ServerInfo {
  service: 'drill-hub';
  instanceId: string;
  displayName: string;
  apiMajor: number;
  minClientVersion: string;
  capabilities: string[];
  publicBaseUrl: string;
  publicUrlSource: 'configured' | 'request';
  isLoopback: boolean;
}
export interface LoginResult {
  user: UserView;
  csrfToken?: string;
  accessToken?: string;
  refreshToken?: string;
}
/** GET /me/sessions 返回的当前有效会话。 */
export interface SessionView {
  id: string;
  channel: 'web' | 'mobile';
  createdAt: string;
  expiresAt: string;
  current: boolean;
}
export interface AgentTokenView extends BaseRecord {
  name: string;
  prefix: string;
  scopes: Scope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
}
/** 创建时返回完整令牌；应按敏感信息处理。 */
export interface AgentTokenCreated extends AgentTokenView {
  token: string;
}
export interface AgentCapabilities {
  apiVersion: number;
  scopes: Scope[];
  questionTypes: QuestionType[];
  gradingModes: GradingMode[];
  limitations: string[];
}
export interface AgentQuestionBatchItem {
  clientRef: string | null;
  questionId: string;
  questionRevisionId: string;
  revision: number;
  webUrl: string;
}
export interface AgentLearningSummary {
  topics: Topic[];
  plans: LearningPlan[];
  recentAttempts: Attempt[];
  wrongQuestions: WrongQuestion[];
}
export interface AgentTokenScopesUpdate {
  expectedRevision: number;
  scopes: Scope[];
}
export interface AgentTokenSecret {
  token: string;
}
export interface Topic extends BaseRecord {
  ownerId: string;
  title: string;
  goalText: string;
  archivedAt: string | null;
}
export interface Content extends BaseRecord {
  ownerId: string;
  topicId: string;
  title: string;
  /** Markdown 源码；阅读页静态渲染，服务端按原文保存。 */
  bodyText: string;
  archivedAt: string | null;
}
export type TaskKind = 'reading' | 'practice' | 'exam' | 'manual';
export interface LearningTask {
  id: string;
  title: string;
  kind: TaskKind;
  targetId: string | null;
  scheduledDate: string | null;
  estimatedMinutes: number | null;
  status: 'todo' | 'in_progress' | 'completed';
  completedAt: string | null;
}
export interface PlanPhase {
  id: string;
  title: string;
  tasks: LearningTask[];
}
export interface LearningPlan extends BaseRecord {
  ownerId: string;
  topicId: string;
  title: string;
  phases: PlanPhase[];
  archivedAt: string | null;
}
export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'short_answer';
export type GradingMode = 'rule' | 'model_rubric' | 'external_rubric';
export interface QuestionOption {
  id: string;
  text: string;
}
export interface RubricLevel {
  id: string;
  creditBps: number;
  description: string;
}
export interface RubricCriterion {
  id: string;
  description: string;
  weight: number;
  levels: RubricLevel[];
  slotId?: string;
}
export interface Rubric {
  version: 1;
  criteria: RubricCriterion[];
}
export interface QuestionDefinition {
  type: QuestionType;
  stem: string;
  options?: QuestionOption[];
  slots?: { id: string }[];
  gradingMode: GradingMode;
  gradingKey?: {
    optionId?: string;
    optionIds?: string[];
    value?: boolean;
    acceptedAnswers?: Record<string, string[]>;
  };
  referenceAnswer?: string;
  rubric?: Rubric;
  explanation?: string;
  tags?: string[];
}
export interface Question extends BaseRecord {
  ownerId: string;
  topicId: string;
  version: number;
  definition: QuestionDefinition;
  archivedAt: string | null;
}
export interface AssessmentItem {
  questionId: string;
  questionVersion: number;
  maxScore: string;
}
export interface Assessment extends BaseRecord {
  ownerId: string;
  topicId: string;
  kind: 'practice' | 'exam';
  title: string;
  durationSeconds: number | null;
  items: AssessmentItem[];
  archivedAt: string | null;
}
/** Learners cannot configure scores; retry maxScore comes from a frozen historical item. */
export type WrongQuestionPracticeInput = {
  title?: string;
  purpose?: Attempt['purpose'];
} & (
  | { questionId: string; items?: never }
  | { items: { questionId: string }[]; questionId?: never }
);
export interface AnswerLinkCreated {
  purpose: Attempt['purpose'];
  /** Resolved single task: explicit or uniquely matched for learning; null means unassociated. */
  taskId: string | null;
  id: string;
  assessmentId: string;
  expiresAt: string;
  /** 包含临时秘钥的完整答题地址；秘钥位于 URL 片段中，不会发送给服务端日志。 */
  answerUrl: string;
}
export interface PublicAssessmentSummary {
  id: string;
  title: string;
  kind: 'practice' | 'exam';
  durationSeconds: number | null;
  itemCount: number;
}
export interface PublicAnswerContext {
  purpose: Attempt['purpose'];
  assessment: PublicAssessmentSummary;
  expiresAt: string;
  attempt: AttemptView | null;
}
export type Answer =
  | { optionId: string }
  | { optionIds: string[] }
  | { value: boolean }
  | { slots: Record<string, string> }
  | { text: string };
export interface CriterionEvaluation {
  criterionId: string;
  levelId: string;
  evidence: string[];
  explanation: string;
}
export interface CriterionGrade extends CriterionEvaluation {
  maxScore: string;
  score: string;
}
export interface GradeResult {
  version: number;
  source: 'rule' | 'model' | 'external_agent' | 'system';
  score: string;
  maxScore: string;
  criterionResults: CriterionGrade[];
  feedback: string;
  createdAt: string;
  modelId?: string;
  reason?: string;
}
export interface CriterionGradeView extends CriterionGrade {
  criterionDescription: string;
  levelDescription: string;
}
export interface GradeResultView extends Omit<GradeResult, 'criterionResults'> {
  criterionResults: CriterionGradeView[];
}
export interface AttemptItemSnapshot {
  id: string;
  questionId: string;
  questionVersion: number;
  definition: QuestionDefinition;
  maxScore: string;
  answer: Answer | null;
  answerRevision: number;
  lockedAt: string | null;
  gradingStatus: 'not_started' | 'pending' | 'running' | 'failed' | 'completed';
  generation: number;
  grade: GradeResult | null;
  gradingHistory: GradeResult[];
}
export interface Attempt extends BaseRecord {
  ownerId: string;
  topicId: string;
  assessmentId: string | null;
  /** 链接作答同样归属 ownerId；保留入口来源供追溯。 */
  answerLinkId: string | null;
  purpose: 'learning' | 'test';
  /** Resolved single task: explicit or uniquely matched for learning; null means unassociated. */
  taskId: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  title: string;
  kind: 'practice' | 'exam';
  status: 'in_progress' | 'pending_grading' | 'completed';
  startedAt: string;
  expiresAt: string | null;
  submittedAt: string | null;
  submissionReason: 'user_submitted' | 'time_expired' | null;
  items: AttemptItemSnapshot[];
}
export interface AttemptItemView {
  id: string;
  questionId: string;
  type: QuestionType;
  stem: string;
  options?: QuestionOption[];
  slots?: { id: string }[];
  maxScore: string;
  answer: Answer | null;
  answerRevision: number;
  lockedAt: string | null;
  answerStatus: 'unanswered' | 'partial' | 'answered';
  gradingStatus: AttemptItemSnapshot['gradingStatus'];
  grade: GradeResultView | null;
  explanation?: string;
  gradingKey?: QuestionDefinition['gradingKey'];
  referenceAnswer?: string;
}
export interface AttemptView extends Omit<Attempt, 'items' | 'ownerId' | 'answerLinkId'> {
  source: 'personal' | 'answer_link';
  items: AttemptItemView[];
}
export interface AttemptReport {
  attempt: AttemptView;
  awardedScore: string;
  maxScore: string;
  pendingMaxScore: string;
  isFinal: boolean;
  failedCount: number;
  hasActiveRegrading: boolean;
  unansweredCount: number;
}
export interface WrongQuestion extends BaseRecord {
  ownerId: string;
  topicId: string;
  questionId: string;
  masteryStatus: 'pending' | 'reviewing' | 'mastered';
  lastWrongAt: string;
  lastPracticedAt: string;
  wrongCount: number;
}
export interface Dashboard {
  topics: number;
  pendingTasks: number;
  completedAttempts: number;
  pendingGrading: number;
  wrongQuestions: number;
  recentAttempts: AttemptView[];
}
export type ModelProtocol = 'chat_completions';
export interface ModelConnectionView extends BaseRecord {
  displayName: string;
  protocol: ModelProtocol;
  baseUrl: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  configVersion: number;
}
/** 模型价格费率，单位为美元 / 百万 tokens（与 models.dev 的 cost 一致）。 */
export interface ModelCostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
export interface ProviderModel extends BaseRecord {
  connectionId: string;
  modelKey: string;
  displayName: string;
  enabled: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  reasoning: boolean;
  input: ('text' | 'image')[];
  costPerMillion: ModelCostRates | null;
}
export interface DiscoveredProviderModel {
  modelKey: string;
  displayName?: string;
}
export interface ProviderModelImportResult {
  created: ProviderModel[];
  skipped: string[];
}
export interface GradingProfile extends BaseRecord {
  providerModelId: string;
  connectionVersionId: string;
  modelIdSnapshot: string;
  concurrency: number;
  timeoutMs: number;
  maxRetries: number;
  isDefault: boolean;
}
export interface GradingJob extends BaseRecord {
  ownerId: string;
  attemptId: string;
  itemId: string;
  generation: number;
  profileId: string | null;
  status:
    | 'queued'
    | 'running'
    | 'retry_wait'
    | 'succeeded'
    | 'failed'
    | 'blocked_config'
    | 'blocked_budget'
    | 'cancelled';
  attemptCount: number;
  nextRunAt: string;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
}
export interface ServerConnection {
  baseUrl: string;
  instanceId: string;
  displayName: string;
}
export interface StoredMobileSession {
  user: UserView;
  refreshToken: string;
}
export type ClientLocale = 'zh-CN' | 'en';

export interface ClientPlatform {
  kind: 'web' | 'android';
  sessionPersistence: 'memory' | 'secure';
  getLocale(): string | null;
  setLocale(locale: ClientLocale): void;
  getConnection(): Promise<ServerConnection | null>;
  setConnection(value: ServerConnection | null): Promise<void>;
  getSession(connection: ServerConnection): Promise<StoredMobileSession | null>;
  setSession(connection: ServerConnection, value: StoredMobileSession | null): Promise<void>;
}

export interface WrongQuestionListItem extends WrongQuestion {
  stem: string;
  topicTitle: string;
  type: QuestionType | null;
}

/** Provider-reported counts, never an estimate from answer length. */
export interface ModelTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
export interface TokenUsageTotals extends ModelTokenUsage {
  calls: number;
  failedCalls: number;
  unknownUsageCalls: number;
}
export interface TokenUsageReport {
  days: number;
  utcOffsetMinutes: number;
  fromDate: string;
  toDate: string;
  totals: TokenUsageTotals;
  daily: (TokenUsageTotals & { date: string })[];
  models: (TokenUsageTotals & { connectionId: string; modelKey: string })[];
}

/** 管理员只读审计视图，不包含业务正文、凭据或自由文本摘要。 */
export interface AuditLogView extends BaseRecord {
  ownerId: string | null;
  username: string | null;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
}
export type LogChannel = 'web' | 'mobile' | 'agent' | 'public' | 'anonymous';
export interface ApiLogView extends BaseRecord {
  requestId: string;
  ownerId: string | null;
  username: string | null;
  actorId: string | null;
  channel: LogChannel;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  ip: string;
  errorCode: string | null;
}
export interface LoginLogView extends BaseRecord {
  requestId: string;
  ownerId: string | null;
  username: string | null;
  channel: 'web' | 'mobile';
  outcome: 'succeeded' | 'failed';
  statusCode: number;
  ip: string;
  errorCode: string | null;
}
export interface LogPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface LogFilters {
  page: number;
  pageSize: number;
  q?: string;
  from?: string;
  until?: string;
  channel?: LogChannel;
  method?: string;
  statusCode?: number;
  outcome?: LoginLogView['outcome'];
}

// ===== 内置对话助手（交互式用户功能，非外部 Agent API） =====
export type SearchProviderKind = 'tavily' | 'brave' | 'searxng' | 'openai_responses';
export interface SearchProviderView extends BaseRecord {
  displayName: string;
  kind: SearchProviderKind;
  baseUrl: string | null;
  modelKey: string | null;
  enabled: boolean;
  apiKeyConfigured: boolean;
  testError: string | null;
}
export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}
export type AssistantRouteName =
  | 'home'
  | 'topics'
  | 'topic'
  | 'plan'
  | 'content'
  | 'assessment'
  | 'attempt'
  | 'report'
  | 'wrong-questions'
  | 'wrong-question-detail'
  | 'history'
  | 'archive';
export type AssistantLayoutMode = 'split' | 'chat' | 'content';
export type AssistantUiAction =
  | {
      type: 'navigate';
      route: AssistantRouteName;
      params?: Record<string, string>;
      query?: Record<string, string>;
    }
  | { type: 'set_layout'; mode: AssistantLayoutMode; chatWidth?: number };
export interface AssistantThread extends BaseRecord {
  ownerId: string;
  title: string;
  lastMessageAt: string;
}
export type AssistantMessageStatus = 'complete' | 'streaming' | 'failed' | 'interrupted';
export interface AssistantImageAttachment {
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  /** Base64 image data, without a data-url prefix. */
  data: string;
}
export interface AssistantMessageView extends BaseRecord {
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning: string | null;
  images: AssistantImageAttachment[];
  status: AssistantMessageStatus;
  errorCode: string | null;
}
export type AssistantQueueMode = 'steer' | 'followUp';
export interface AssistantQueuedMessage extends BaseRecord {
  threadId: string;
  content: string;
  mode: AssistantQueueMode;
  position: number;
  providerModelId: string | null;
  images: AssistantImageAttachment[];
}
export interface AssistantTimelineTurn {
  id: string;
  userMessageId: string;
  question: string;
  answer: string;
  createdAt: string;
}
export type AssistantEventType = 'status' | 'tool_call' | 'tool_result' | 'ui_action' | 'error';
export interface AssistantEventView {
  id: string;
  threadId: string;
  turnId: string;
  seq: number;
  type: AssistantEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}
export interface AssistantTurnView extends BaseRecord {
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  errorCode: string | null;
  /** 本轮使用的助手模型；null 表示由服务端自动选择。 */
  providerModelId: string | null;
}
export interface AssistantThreadDetail {
  thread: AssistantThread;
  turns: AssistantTurnView[];
  messages: AssistantMessageView[];
  events: AssistantEventView[];
  activeTurn: AssistantTurnView | null;
  queued: AssistantQueuedMessage[];
  timeline: AssistantTimelineTurn[];
  hasOlder: boolean;
  oldestMessageId: string | null;
}
export interface AssistantStatus {
  modelConfigured: boolean;
  searchEnabled: boolean;
  mcpEnabled: boolean;
  customSkills: number;
}
/** 对话中可选的助手模型（仅启用的模型及其连接）。 */
export interface AssistantModelOption {
  id: string;
  connectionId: string;
  connectionName: string;
  modelKey: string;
  displayName: string;
  reasoning: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  costPerMillion: ModelCostRates | null;
}
/** models.dev 目录中匹配到的模型默认参数与价格。 */
export interface ModelCatalogMatch {
  providerId: string;
  providerName: string;
  modelId: string;
  name: string | null;
  reasoning: boolean;
  input: ('text' | 'image')[];
  contextWindow: number | null;
  maxTokens: number | null;
  costPerMillion: ModelCostRates | null;
}
export type McpTransport = 'stdio' | 'http';
export interface McpServerView extends BaseRecord {
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  envConfigured: boolean;
  headersConfigured: boolean;
  timeoutSeconds: number;
  exposure: 'direct' | 'deferred';
  enabled: boolean;
  testError: string | null;
}
export interface AssistantSkillView extends BaseRecord {
  name: string;
  description: string;
  enabled: boolean;
}
