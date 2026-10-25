import { describe, expect, it } from 'vitest';
import type { AttemptItemView, AttemptView } from '@drill-hub/contracts';
import {
  answerStatusLabels,
  canContinueAttempt,
  draftAnswerStatus,
  gradingStatusLabels,
} from '#learning-client/attemptPresentation';

const item: AttemptItemView = {
  id: 'item-1',
  questionId: 'question-1',
  type: 'fill_blank',
  stem: '填写两个空',
  slots: [{ id: 'first' }, { id: 'second' }],
  maxScore: '10.00',
  answer: null,
  answerRevision: 0,
  answerStatus: 'unanswered',
  lockedAt: null,
  gradingStatus: 'not_started',
  grade: null,
};
const attempt: AttemptView = {
  id: 'attempt-1',
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
  revision: 1,
  topicId: 'topic-1',
  assessmentId: 'assessment-1',
  taskId: null,
  purpose: 'learning',
  source: 'personal',
  title: '作答状态测试',
  kind: 'practice',
  status: 'in_progress',
  startedAt: '2026-10-18T00:00:00.000Z',
  expiresAt: null,
  submittedAt: null,
  submissionReason: null,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  items: [item],
};

describe('作答状态展示', () => {
  it('区分未作答、部分填空与完整填空，不把空白字符当作答案', () => {
    expect(draftAnswerStatus(item, null)).toBe('unanswered');
    expect(draftAnswerStatus(item, { slots: { first: '  ', second: '' } })).toBe('unanswered');
    expect(draftAnswerStatus(item, { slots: { first: '答案' } })).toBe('partial');
    expect(draftAnswerStatus(item, { slots: { first: '答案', second: '  ' } })).toBe('partial');
    expect(draftAnswerStatus(item, { slots: { first: '答案', second: '答案' } })).toBe('answered');
  });

  it('判断题 false 是有效答案，未选择和空白简答是未作答', () => {
    expect(draftAnswerStatus({ ...item, type: 'true_false' }, { value: false })).toBe('answered');
    expect(draftAnswerStatus({ ...item, type: 'single_choice' }, { optionId: '' })).toBe(
      'unanswered',
    );
    expect(draftAnswerStatus({ ...item, type: 'short_answer' }, { text: '  ' })).toBe('unanswered');
    expect(draftAnswerStatus({ ...item, type: 'multiple_choice' }, { optionIds: ['a'] })).toBe(
      'answered',
    );
  });

  it('答案状态与评分执行状态独立展示', () => {
    expect(answerStatusLabels.unanswered).toBe('未作答');
    expect(answerStatusLabels.partial).toBe('部分作答');
    expect(gradingStatusLabels.not_started).toBe('尚未评分');
    expect(gradingStatusLabels.completed).toBe('已评分');
  });

  it('正式与测试作答都能继续，只有作废、交卷和登录查看链接作答不能继续', () => {
    expect(canContinueAttempt(attempt)).toBe(true);
    expect(canContinueAttempt({ ...attempt, purpose: 'test' })).toBe(true);
    expect(canContinueAttempt({ ...attempt, voidedAt: '2026-10-18T01:00:00.000Z' })).toBe(false);
    expect(canContinueAttempt({ ...attempt, status: 'completed' })).toBe(false);
    expect(canContinueAttempt({ ...attempt, status: 'pending_grading' })).toBe(false);
    expect(canContinueAttempt({ ...attempt, source: 'answer_link' })).toBe(false);
  });
});
