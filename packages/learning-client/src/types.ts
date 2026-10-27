import type {
  AgentTokenCreated,
  Answer,
  AttemptItemView,
  AttemptView,
  GradeResult,
  ModelProtocol,
  Question,
  QuestionType,
  Scope,
  UserView,
  WrongQuestionPracticeInput,
} from '@drill-hub/contracts';
import { localizedRecord, translate } from '#learning-client/utils';

export interface CsrfResult {
  csrfToken: string;
}

export type { AgentTokenCreated };

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
}

export interface AdminUserCreated extends UserView {
  temporaryPassword?: string;
}

export interface PasswordResetResult {
  temporaryPassword?: string;
  password?: string;
}

export const questionTypeLabels: Record<QuestionType, string> = localizedRecord<QuestionType>({
  single_choice: 'core.questionType.single_choice',
  multiple_choice: 'core.questionType.multiple_choice',
  true_false: 'core.questionType.true_false',
  fill_blank: 'core.questionType.fill_blank',
  short_answer: 'core.questionType.short_answer',
});

export const scopeLabels: Record<Scope, string> = localizedRecord<Scope>({
  read: 'core.scope.read',
  'content:write': 'core.scope.content:write',
  'assessment:write': 'core.scope.assessment:write',
  'attempt:write': 'core.scope.attempt:write',
  'grading:request': 'core.scope.grading:request',
  'grade:write': 'core.scope.grade:write',
  'archive:write': 'core.scope.archive:write',
  'topic:purge': 'core.scope.topic:purge',
});

export const resourceTypeLabels: Record<ArchiveResourceType, string> =
  localizedRecord<ArchiveResourceType>({
    topic: 'core.resourceType.topic',
    plan: 'core.resourceType.plan',
    content: 'core.resourceType.content',
    question: 'core.resourceType.question',
    assessment: 'core.resourceType.assessment',
  });

export function isAnswerEmpty(answer: Answer | null | undefined): boolean {
  if (!answer) return true;
  if ('text' in answer) return !answer.text.trim();
  if ('optionId' in answer) return !answer.optionId;
  if ('optionIds' in answer) return answer.optionIds.length === 0;
  if ('slots' in answer) return Object.values(answer.slots).every((value) => !value.trim());
  return false;
}

export function answerText(answer: Answer | null | undefined): string {
  if (!answer) return translate('core.common.unanswered');
  if ('text' in answer) return answer.text || translate('core.common.unanswered');
  if ('optionId' in answer) return answer.optionId;
  if ('optionIds' in answer)
    return (
      answer.optionIds.join(translate('core.answer.optionSeparator')) ||
      translate('core.common.unanswered')
    );
  if ('value' in answer)
    return answer.value ? translate('core.common.correct') : translate('core.common.incorrect');
  return Object.entries(answer.slots)
    .map(([slot, value]) =>
      translate('core.answer.slot', { slot, value: value || translate('core.common.unanswered') }),
    )
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

export function wrongPracticeRequest(detail: WrongQuestionDetailView): WrongQuestionPracticeInput {
  return { items: [{ questionId: detail.questionId }] };
}
