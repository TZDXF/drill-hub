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
export interface AgentTokenView extends BaseRecord {
  name: string;
  prefix: string;
  scopes: Scope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
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
export interface AnswerLinkCreated {
  purpose: Attempt['purpose'];
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
export interface ProviderModel extends BaseRecord {
  connectionId: string;
  modelKey: string;
  displayName: string;
  enabled: boolean;
  verifiedConfigVersion: number | null;
  testError?: string | null;
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
  promptVersion: string;
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
export interface ClientPlatform {
  kind: 'web' | 'android';
  sessionPersistence: 'memory' | 'secure';
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
