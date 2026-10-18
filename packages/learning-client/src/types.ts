import type {
  AgentTokenView,
  Answer,
  AttemptItemView,
  AttemptView,
  GradeResult,
  ModelProtocol,
  Question,
  QuestionType,
  Scope,
  UserView,
} from '@drill-hub/contracts';

export interface CsrfResult {
  csrfToken: string;
}

export interface SessionView {
  id: string;
  kind?: 'web' | 'android';
  channel?: 'web' | 'mobile';
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  userAgent?: string | null;
  current?: boolean;
}

export interface AgentTokenCreated {
  secret?: string;
  token?: string | AgentTokenView;
  accessToken?: string;
  agentToken?: AgentTokenView;
}

export interface WrongQuestionHistoryItem {
  id?: string;
  attemptId?: string;
  itemId?: string;
  answeredAt?: string | null;
  createdAt?: string;
  answer?: Answer | null;
  grade?: GradeResult | null;
  gradingStatus?: AttemptItemView['gradingStatus'];
}

export interface WrongQuestionDetailView {
  id: string;
  questionId: string;
  topicId: string;
  masteryStatus: 'pending' | 'reviewing' | 'mastered';
  lastWrongAt: string;
  lastPracticedAt: string;
  wrongCount: number;
  revision: number;
  question?: Question;
  history?: WrongQuestionHistoryItem[];
  attempts?: AttemptView[];
}

export type ArchiveResourceType = 'topic' | 'plan' | 'content' | 'question' | 'assessment';

export interface ArchiveEntry {
  resourceType: ArchiveResourceType;
  id: string;
  title: string;
  archivedAt: string | null;
  revision: number | null;
}

export interface ModelAdapter {
  id?: string;
  name?: string;
  displayName?: string;
  protocol: ModelProtocol;
  promptVersions?: string[];
}

export interface AdminUserCreated extends UserView {
  temporaryPassword?: string;
}

export interface PasswordResetResult {
  temporaryPassword?: string;
  password?: string;
}

export const questionTypeLabels: Record<QuestionType, string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  fill_blank: '填空题',
  short_answer: '简答题',
};

export const scopeLabels: Record<Scope, string> = {
  read: '读取学习内容与结果',
  'content:write': '创建与调整主题、计划、内容',
  'assessment:write': '创建与调整练习和考试',
  'attempt:write': '作废作答记录（需填写原因）',
  'grading:request': '请求评分重试与有原因的重评',
  'grade:write': '提交外部评分模式的得分项等级',
  'archive:write': '归档与恢复资源',
};

export const resourceTypeLabels: Record<ArchiveResourceType, string> = {
  topic: '主题',
  plan: '计划',
  content: '内容',
  question: '题目',
  assessment: '练习 / 考试',
};

export function isAnswerEmpty(answer: Answer | null | undefined): boolean {
  if (!answer) return true;
  if ('text' in answer) return !answer.text.trim();
  if ('optionId' in answer) return !answer.optionId;
  if ('optionIds' in answer) return answer.optionIds.length === 0;
  if ('slots' in answer) return Object.values(answer.slots).every((value) => !value.trim());
  return false;
}

export function answerText(answer: Answer | null | undefined): string {
  if (!answer) return '未作答';
  if ('text' in answer) return answer.text || '未作答';
  if ('optionId' in answer) return answer.optionId;
  if ('optionIds' in answer) return answer.optionIds.join('、') || '未作答';
  if ('value' in answer) return answer.value ? '正确' : '错误';
  return Object.entries(answer.slots)
    .map(([slot, value]) => `${slot}：${value || '未作答'}`)
    .join('\n');
}

export function emptyAnswer(item: Pick<AttemptItemView, 'type' | 'slots'>): Answer {
  switch (item.type) {
    case 'single_choice':
      return { optionId: '' };
    case 'multiple_choice':
      return { optionIds: [] };
    case 'true_false':
      return { value: false };
    case 'fill_blank':
      return { slots: Object.fromEntries((item.slots ?? []).map((slot) => [slot.id, ''])) };
    case 'short_answer':
      return { text: '' };
  }
}

export function asAttemptView(value: AttemptView | { attempt: AttemptView }): AttemptView {
  return 'attempt' in value ? value.attempt : value;
}

export function wrongPracticeRequest(detail: WrongQuestionDetailView) {
  const snapshot = detail.attempts
    ?.flatMap((attempt) => attempt.items)
    .find((item) => item.questionId === detail.questionId && typeof item.maxScore === 'string');
  if (!snapshot) {
    throw new Error('服务端错题详情缺少历史题目分值，无法按真实评分配置开始重练');
  }
  return { items: [{ questionId: detail.questionId, maxScore: snapshot.maxScore }] };
}
