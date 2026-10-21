import type { QuestionDefinition } from '@drill-hub/contracts';
import { gradeBlankRubric, gradeRule, validateQuestion } from '../grading/engine.js';
import { assert, clone, isRecord, rejectClientFacts } from './common.js';
import { scoreToMinor } from './scores.js';

export function questionDefinition(value: unknown): QuestionDefinition {
  assert(isRecord(value), 'INVALID_QUESTION', '题目定义必须是对象');
  rejectClientFacts(value);
  const keys = (record: Record<string, unknown>, allowed: string[]) => {
    assert(
      Object.keys(record).every((key) => allowed.includes(key)),
      'INVALID_QUESTION_FIELD',
      '题目包含不允许的字段',
    );
  };
  keys(value, [
    'type',
    'stem',
    'options',
    'slots',
    'gradingMode',
    'gradingKey',
    'referenceAnswer',
    'rubric',
    'explanation',
    'tags',
  ]);
  for (const [field, allowed] of [
    ['options', ['id', 'text']],
    ['slots', ['id']],
  ] as const) {
    if (Array.isArray(value[field]))
      for (const item of value[field]) if (isRecord(item)) keys(item, [...allowed]);
  }
  if (isRecord(value.gradingKey))
    keys(value.gradingKey, ['optionId', 'optionIds', 'value', 'acceptedAnswers']);
  if (isRecord(value.rubric)) {
    keys(value.rubric, ['version', 'criteria']);
    if (Array.isArray(value.rubric.criteria))
      for (const criterion of value.rubric.criteria) {
        if (!isRecord(criterion)) continue;
        keys(criterion, ['id', 'description', 'weight', 'levels', 'slotId']);
        if (Array.isArray(criterion.levels))
          for (const level of criterion.levels) {
            if (isRecord(level)) keys(level, ['id', 'creditBps', 'description']);
          }
      }
  }
  const definition = clone(value) as unknown as QuestionDefinition;
  validateQuestion(definition);
  return definition;
}

/** Validate the frozen maxScore using the grading engine's own allocation logic. */
export function validateScoringConfiguration(
  definition: QuestionDefinition,
  maxScore: unknown,
): string {
  scoreToMinor(maxScore, 'maxScore', false);
  if (definition.gradingMode === 'rule') gradeRule(definition, null, maxScore as string);
  else gradeBlankRubric(definition, null, maxScore as string);
  return maxScore as string;
}
