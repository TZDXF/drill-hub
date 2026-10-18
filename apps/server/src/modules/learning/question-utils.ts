import type { QuestionDefinition } from '@drill-hub/contracts';
import { gradeBlankRubric, gradeRule, validateQuestion } from '../grading/engine.js';
import { assert, clone, isRecord } from './common.js';
import { scoreToMinor } from './scores.js';

export function questionDefinition(value: unknown): QuestionDefinition {
  assert(isRecord(value), 'INVALID_QUESTION', '题目定义必须是对象');
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
