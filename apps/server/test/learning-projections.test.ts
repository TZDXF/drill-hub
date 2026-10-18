import { describe, expect, it } from 'vitest';
import type { Attempt, QuestionDefinition } from '@drill-hub/contracts';
import { baseRecord } from '../src/core/ids.js';
import { gradeRubric, gradeRule } from '../src/modules/grading/engine.js';
import { toAttemptReport, toAttemptView } from '../src/modules/learning/projections.js';

const timestamp = '2026-10-18T08:00:00.000Z';
const definition: QuestionDefinition = {
  type: 'short_answer',
  stem: '说明缓存穿透的成因和应对策略',
  gradingMode: 'external_rubric',
  referenceAnswer: '缓存穿透可使用布隆过滤器或空值缓存缓解',
  rubric: {
    version: 1,
    criteria: [
      {
        id: 'penetration',
        description: '缓存穿透的成因与应对策略',
        weight: 1,
        levels: [
          { id: 'nm', creditBps: 0, description: '未达到要求' },
          { id: 'partial', creditBps: 5000, description: '部分达到要求' },
          { id: 'met', creditBps: 10000, description: '达到要求' },
        ],
      },
    ],
  },
};

function gradedAttempt(levelId = 'nm'): Attempt {
  const frozenDefinition = structuredClone(definition);
  const answer = { text: '增大缓存' };
  const grade = gradeRubric(
    frozenDefinition,
    answer,
    '3.33',
    [
      {
        criterionId: 'penetration',
        levelId,
        explanation: '按冻结的评分标准判断',
        evidence: ['增大缓存'],
      },
    ],
    { source: 'external_agent', createdAt: timestamp },
  );
  return {
    ...baseRecord(),
    ownerId: 'user-1',
    topicId: 'topic-1',
    assessmentId: null,
    answerLinkId: null,
    purpose: 'learning',
    taskId: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    title: '缓存练习',
    kind: 'practice',
    status: 'completed',
    startedAt: timestamp,
    expiresAt: null,
    submittedAt: timestamp,
    submissionReason: 'user_submitted',
    items: [
      {
        id: 'item-1',
        questionId: 'question-1',
        questionVersion: 1,
        definition: frozenDefinition,
        maxScore: '3.33',
        answer,
        answerRevision: 1,
        lockedAt: timestamp,
        gradingStatus: 'completed',
        generation: 1,
        grade,
        gradingHistory: [structuredClone(grade)],
      },
    ],
  };
}

describe('learner grade descriptions', () => {
  it('projects the attempt source without exposing ownership or link identifiers', () => {
    const attempt = gradedAttempt();
    expect(toAttemptView(attempt).source).toBe('personal');
    attempt.answerLinkId = 'temporary-link';
    const view = toAttemptView(attempt);
    expect(view.source).toBe('answer_link');
    expect(view).not.toHaveProperty('answerLinkId');
    expect(view).not.toHaveProperty('ownerId');
  });

  it.each([
    ['nm', '未达到要求'],
    ['partial', '部分达到要求'],
    ['met', '达到要求'],
  ])('resolves %s using descriptions from the frozen question', (levelId, description) => {
    const attempt = gradedAttempt(levelId);
    const original = structuredClone(attempt);
    const result = toAttemptReport(attempt).attempt.items[0].grade!.criterionResults[0];
    expect(result).toEqual({
      ...attempt.items[0].grade!.criterionResults[0],
      criterionDescription: '缓存穿透的成因与应对策略',
      levelDescription: description,
    });
    expect(attempt).toEqual(original);
    expect(attempt.items[0].grade!.criterionResults[0]).not.toHaveProperty('criterionDescription');
  });

  it('does not expose grades or descriptions before an exam is submitted', () => {
    const attempt = gradedAttempt();
    attempt.kind = 'exam';
    attempt.submittedAt = null;
    const hidden = toAttemptView(attempt).items[0];
    expect(hidden.grade).toBeNull();
    expect(hidden).not.toHaveProperty('rubric');
    expect(hidden).not.toHaveProperty('referenceAnswer');
    attempt.submittedAt = timestamp;
    expect(toAttemptView(attempt).items[0].grade!.criterionResults[0].levelDescription).toBe(
      '未达到要求',
    );
  });

  it('does not expose practice feedback before the item is locked', () => {
    const attempt = gradedAttempt();
    attempt.items[0].lockedAt = null;
    expect(toAttemptView(attempt).items[0].grade).toBeNull();
  });

  it('retains descriptions for the valid grade while regrading is running', () => {
    const attempt = gradedAttempt();
    attempt.items[0].gradingStatus = 'running';
    const report = toAttemptReport(attempt);
    expect(report.hasActiveRegrading).toBe(true);
    expect(report.attempt.items[0].grade!.criterionResults[0].criterionDescription).toBe(
      '缓存穿透的成因与应对策略',
    );
  });

  it('keeps ungraded feedback pending and rule grades free of rubric requirements', () => {
    const attempt = gradedAttempt();
    attempt.items[0].grade = null;
    attempt.items[0].gradingStatus = 'pending';
    expect(toAttemptView(attempt).items[0].grade).toBeNull();
    const rule: QuestionDefinition = {
      type: 'true_false',
      stem: '判断正误',
      gradingMode: 'rule',
      gradingKey: { value: true },
    };
    attempt.items[0].definition = rule;
    attempt.items[0].grade = gradeRule(rule, { value: true }, '3.33');
    expect(toAttemptView(attempt).items[0].grade).toEqual(attempt.items[0].grade);
  });
});
