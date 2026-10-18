import type {
  Answer,
  CriterionEvaluation,
  CriterionGrade,
  GradeResult,
  QuestionDefinition,
  Rubric,
  RubricCriterion,
} from '@drill-hub/contracts';
import { assert } from '../../core/errors.js';
import { now } from '../../core/ids.js';

const QUESTION_TYPES = new Set([
  'single_choice',
  'multiple_choice',
  'true_false',
  'fill_blank',
  'short_answer',
]);
const GRADING_MODES = new Set(['rule', 'model_rubric', 'external_rubric']);
const MAX_SCORE_MINOR = 100_000_000;
const MAX_WEIGHT = 1_000_000;
const MAX_TEXT_LENGTH = 100_000;
const MAX_CRITERIA = 100;

type PlainObject = Record<string, unknown>;

function isObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(
  value: unknown,
  field: string,
  maxLength = MAX_TEXT_LENGTH,
  allowBlank = false,
): string {
  assert(typeof value === 'string', 'INVALID_TEXT', `${field}必须是字符串`, 422);
  assert(value.length <= maxLength, 'TEXT_TOO_LONG', `${field}超过长度限制`);
  assert(allowBlank || value.trim().length > 0, 'INVALID_TEXT', `${field}不能为空`);
  return value;
}

function checkKeys(
  value: PlainObject,
  allowed: readonly string[],
  required: readonly string[],
  code: string,
): void {
  for (const key of Object.keys(value)) {
    assert(allowed.includes(key), code, `不允许字段 ${key}`, 400);
  }
  for (const key of required) {
    assert(Object.hasOwn(value, key), code, `缺少字段 ${key}`, 400);
  }
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseMaxScore(maxScore: string): number {
  assert(
    typeof maxScore === 'string' && /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(maxScore),
    'INVALID_MAX_SCORE',
    '题目满分必须是最多两位小数的非负十进制字符串',
  );
  const [whole, fraction = ''] = maxScore.split('.');
  const minor = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  assert(
    Number.isSafeInteger(minor) && minor > 0 && minor <= MAX_SCORE_MINOR,
    'INVALID_MAX_SCORE',
    '题目满分超出允许范围',
  );
  return minor;
}

export function formatScore(minor: number): string {
  assert(Number.isSafeInteger(minor) && minor >= 0, 'INVALID_SCORE', '分数必须是非负安全整数');
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

function validateRubric(definition: QuestionDefinition, rubric: Rubric): void {
  assert(isObject(rubric) && rubric.version === 1, 'INVALID_RUBRIC', '得分项版本必须为 1');
  assert(
    Array.isArray(rubric.criteria) &&
      rubric.criteria.length > 0 &&
      rubric.criteria.length <= MAX_CRITERIA,
    'INVALID_RUBRIC',
    '得分项数量必须在允许范围内',
  );
  const criterionIds = new Set<string>();
  const coveredSlots = new Set<string>();
  for (const criterion of rubric.criteria as RubricCriterion[]) {
    assert(isObject(criterion), 'INVALID_RUBRIC', '得分项格式无效');
    const criterionId = text(criterion.id, 'criterion.id', 128);
    assert(!criterionIds.has(criterionId), 'DUPLICATE_CRITERION', `得分项 ${criterionId} 重复`);
    criterionIds.add(criterionId);
    text(criterion.description, `criterion.${criterionId}.description`, 4_000);
    assert(
      Number.isSafeInteger(criterion.weight) &&
        criterion.weight > 0 &&
        criterion.weight <= MAX_WEIGHT,
      'INVALID_RUBRIC_WEIGHT',
      `得分项 ${criterionId} 权重无效`,
    );
    assert(
      Array.isArray(criterion.levels) &&
        criterion.levels.length >= 2 &&
        criterion.levels.length <= 32,
      'INVALID_RUBRIC_LEVELS',
      `得分项 ${criterionId} 等级数量无效`,
    );
    const levelIds = new Set<string>();
    let hasZero = false;
    let hasFull = false;
    for (const level of criterion.levels) {
      assert(isObject(level), 'INVALID_RUBRIC_LEVELS', '得分项等级格式无效');
      const levelId = text(level.id, `criterion.${criterionId}.level.id`, 128);
      assert(
        !levelIds.has(levelId),
        'DUPLICATE_LEVEL',
        `得分项 ${criterionId} 的等级 ${levelId} 重复`,
      );
      levelIds.add(levelId);
      assert(
        Number.isSafeInteger(level.creditBps) && level.creditBps >= 0 && level.creditBps <= 10_000,
        'INVALID_CREDIT_BPS',
        `得分项 ${criterionId} 的等级比例无效`,
      );
      text(level.description, `criterion.${criterionId}.level.${levelId}.description`, 4_000);
      if (level.creditBps === 0) hasZero = true;
      if (level.creditBps === 10_000) hasFull = true;
    }
    assert(
      hasZero && hasFull,
      'INCOMPLETE_RUBRIC_LEVELS',
      `得分项 ${criterionId} 必须包含零分和满分等级`,
    );
    if (definition.type === 'fill_blank') {
      const slotId = text(criterion.slotId, `criterion.${criterionId}.slotId`, 128);
      assert(
        definition.slots?.some((slot) => slot.id === slotId),
        'UNKNOWN_RUBRIC_SLOT',
        `得分项 ${criterionId} 绑定了不存在的空位`,
      );
      coveredSlots.add(slotId);
    } else {
      assert(
        criterion.slotId === undefined,
        'UNEXPECTED_RUBRIC_SLOT',
        `简答得分项 ${criterionId} 不能绑定空位`,
      );
    }
  }
  if (definition.type === 'fill_blank') {
    for (const slot of definition.slots ?? []) {
      assert(coveredSlots.has(slot.id), 'UNCOVERED_RUBRIC_SLOT', `空位 ${slot.id} 没有绑定得分项`);
    }
  }
}

/** Validate a frozen question definition before it is used by learning or grading. */
export function validateQuestion(definition: QuestionDefinition): void {
  const raw: unknown = definition;
  assert(isObject(raw), 'INVALID_QUESTION', '题目定义必须是对象');
  assert(
    typeof raw.type === 'string' && QUESTION_TYPES.has(raw.type),
    'INVALID_QUESTION_TYPE',
    '不支持的题型',
  );
  assert(
    typeof raw.gradingMode === 'string' && GRADING_MODES.has(raw.gradingMode),
    'INVALID_GRADING_MODE',
    '不支持的评分模式',
  );
  text(raw.stem, 'stem');
  const def = raw as unknown as QuestionDefinition;

  if (def.type === 'single_choice' || def.type === 'multiple_choice') {
    assert(
      Array.isArray(def.options) && def.options.length >= 2 && def.options.length <= 100,
      'INVALID_OPTIONS',
      '选择题必须提供 2 至 100 个选项',
    );
    const optionIds = new Set<string>();
    for (const option of def.options) {
      assert(isObject(option), 'INVALID_OPTIONS', '选项格式无效');
      const optionId = text(option.id, 'option.id', 128);
      assert(!optionIds.has(optionId), 'DUPLICATE_OPTION', `选项 ${optionId} 重复`);
      optionIds.add(optionId);
      text(option.text, `option.${optionId}.text`, 20_000);
    }
  } else {
    assert(def.options === undefined, 'UNEXPECTED_OPTIONS', '该题型不能提供选项');
  }

  if (def.type === 'fill_blank') {
    assert(
      Array.isArray(def.slots) && def.slots.length > 0 && def.slots.length <= 100,
      'INVALID_SLOTS',
      '填空题必须提供空位',
    );
    const slotIds = new Set<string>();
    for (const slot of def.slots) {
      assert(isObject(slot), 'INVALID_SLOTS', '空位格式无效');
      const slotId = text(slot.id, 'slot.id', 128);
      assert(!slotIds.has(slotId), 'DUPLICATE_SLOT', `空位 ${slotId} 重复`);
      slotIds.add(slotId);
    }
  } else {
    assert(def.slots === undefined, 'UNEXPECTED_SLOTS', '该题型不能提供空位');
  }

  if (def.gradingMode === 'rule') {
    assert(def.type !== 'short_answer', 'INVALID_GRADING_MODE', '简答题不能使用规则评分');
  } else {
    assert(
      def.type === 'short_answer' || def.type === 'fill_blank',
      'INVALID_GRADING_MODE',
      '得分项评分仅支持简答和填空',
    );
    assert(def.rubric !== undefined, 'RUBRIC_REQUIRED', '该评分模式必须提供得分项');
  }
  if (def.rubric !== undefined) validateRubric(def, def.rubric);

  const key: unknown = def.gradingKey;
  if (def.gradingMode === 'rule') {
    assert(isObject(key), 'GRADING_KEY_REQUIRED', '规则评分必须提供评分键');
    if (def.type === 'single_choice') {
      checkKeys(key, ['optionId'], ['optionId'], 'INVALID_GRADING_KEY');
      assert(
        typeof key.optionId === 'string' &&
          def.options?.some((option) => option.id === key.optionId),
        'INVALID_GRADING_KEY',
        '正确选项不存在',
      );
    } else if (def.type === 'multiple_choice') {
      checkKeys(key, ['optionIds'], ['optionIds'], 'INVALID_GRADING_KEY');
      assert(
        Array.isArray(key.optionIds) && key.optionIds.length > 0,
        'INVALID_GRADING_KEY',
        '多选评分键不能为空',
      );
      const ids = new Set<string>();
      for (const optionId of key.optionIds) {
        assert(
          typeof optionId === 'string' && def.options?.some((option) => option.id === optionId),
          'INVALID_GRADING_KEY',
          '正确选项不存在',
        );
        assert(!ids.has(optionId), 'DUPLICATE_GRADING_KEY_OPTION', '评分键中的选项重复');
        ids.add(optionId);
      }
    } else if (def.type === 'true_false') {
      checkKeys(key, ['value'], ['value'], 'INVALID_GRADING_KEY');
      assert(typeof key.value === 'boolean', 'INVALID_GRADING_KEY', '判断题评分键必须是布尔值');
    } else if (def.type === 'fill_blank') {
      checkKeys(key, ['acceptedAnswers'], ['acceptedAnswers'], 'INVALID_GRADING_KEY');
      assert(isObject(key.acceptedAnswers), 'INVALID_GRADING_KEY', '填空评分键格式无效');
      const accepted = key.acceptedAnswers;
      checkKeys(
        accepted,
        (def.slots ?? []).map((slot) => slot.id),
        (def.slots ?? []).map((slot) => slot.id),
        'INVALID_GRADING_KEY',
      );
      for (const slot of def.slots ?? []) {
        const answers = accepted[slot.id];
        assert(
          Array.isArray(answers) && answers.length > 0 && answers.length <= 100,
          'INVALID_GRADING_KEY',
          `空位 ${slot.id} 缺少可接受答案`,
        );
        const unique = new Set<string>();
        for (const answer of answers) {
          text(answer, `acceptedAnswers.${slot.id}`, 20_000);
          assert(
            !unique.has(answer),
            'DUPLICATE_ACCEPTED_ANSWER',
            `空位 ${slot.id} 的可接受答案重复`,
          );
          unique.add(answer);
        }
      }
    }
  }
  if (def.referenceAnswer !== undefined)
    text(def.referenceAnswer, 'referenceAnswer', MAX_TEXT_LENGTH, true);
  if (def.explanation !== undefined) text(def.explanation, 'explanation', 20_000, true);
}

/** Validate the exact answer shape; score/correct/submittedAt and other extras are rejected. */
export function validateAnswer(definition: QuestionDefinition, answer: Answer): void {
  validateQuestion(definition);
  const raw: unknown = answer;
  assert(isObject(raw), 'INVALID_ANSWER', '答案必须是对象', 400);
  if (definition.type === 'single_choice') {
    checkKeys(raw, ['optionId'], ['optionId'], 'INVALID_ANSWER');
    assert(
      typeof raw.optionId === 'string' &&
        definition.options?.some((option) => option.id === raw.optionId),
      'INVALID_ANSWER',
      '所选选项不存在',
      400,
    );
  } else if (definition.type === 'multiple_choice') {
    checkKeys(raw, ['optionIds'], ['optionIds'], 'INVALID_ANSWER');
    assert(Array.isArray(raw.optionIds), 'INVALID_ANSWER', '多选答案必须是数组', 400);
    const ids = new Set<string>();
    for (const optionId of raw.optionIds) {
      assert(
        typeof optionId === 'string' &&
          definition.options?.some((option) => option.id === optionId),
        'INVALID_ANSWER',
        '所选选项不存在',
        400,
      );
      assert(!ids.has(optionId), 'DUPLICATE_ANSWER_OPTION', '多选答案不能重复', 400);
      ids.add(optionId);
    }
  } else if (definition.type === 'true_false') {
    checkKeys(raw, ['value'], ['value'], 'INVALID_ANSWER');
    assert(typeof raw.value === 'boolean', 'INVALID_ANSWER', '判断题答案必须是布尔值', 400);
  } else if (definition.type === 'fill_blank') {
    checkKeys(raw, ['slots'], ['slots'], 'INVALID_ANSWER');
    assert(isObject(raw.slots), 'INVALID_ANSWER', '填空答案必须是空位映射', 400);
    const slotIds = (definition.slots ?? []).map((slot) => slot.id);
    checkKeys(raw.slots, slotIds, slotIds, 'INVALID_ANSWER');
    for (const slotId of slotIds) text(raw.slots[slotId], `slots.${slotId}`, MAX_TEXT_LENGTH, true);
  } else {
    checkKeys(raw, ['text'], ['text'], 'INVALID_ANSWER');
    text(raw.text, 'text', MAX_TEXT_LENGTH, true);
  }
}

export function isBlankAnswer(
  definition: QuestionDefinition,
  answer: Answer | null | undefined,
): boolean {
  if (answer === null || answer === undefined || !isObject(answer)) return true;
  const raw = answer as unknown as PlainObject;
  if (definition.type === 'single_choice')
    return typeof raw.optionId !== 'string' || raw.optionId.trim() === '';
  if (definition.type === 'multiple_choice')
    return !Array.isArray(raw.optionIds) || raw.optionIds.length === 0;
  if (definition.type === 'true_false') return typeof raw.value !== 'boolean';
  if (definition.type === 'fill_blank') {
    const slots = raw.slots;
    if (!isObject(slots)) return true;
    return (definition.slots ?? []).every((slot) => {
      const value = slots[slot.id];
      return typeof value !== 'string' || value.trim() === '';
    });
  }
  return typeof raw.text !== 'string' || raw.text.trim() === '';
}

interface Allocation {
  criterionId: string;
  maxMinor: number;
}

function allocateMaxScores(
  maxMinor: number,
  criteria: readonly { id: string; weight: number }[],
): Allocation[] {
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  assert(
    Number.isSafeInteger(totalWeight) && totalWeight > 0,
    'INVALID_RUBRIC_WEIGHT',
    '得分项总权重无效',
  );
  const allocated = criteria.map((criterion) => {
    const numerator = maxMinor * criterion.weight;
    assert(Number.isSafeInteger(numerator), 'INVALID_RUBRIC_WEIGHT', '分值计算超出安全整数范围');
    const max = Math.floor(numerator / totalWeight);
    return { criterionId: criterion.id, maxMinor: max, remainder: numerator % totalWeight };
  });
  let remaining = maxMinor - allocated.reduce((sum, criterion) => sum + criterion.maxMinor, 0);
  const order = [...allocated].sort(
    (a, b) => b.remainder - a.remainder || compareIds(a.criterionId, b.criterionId),
  );
  for (const criterion of order) {
    if (remaining === 0) break;
    criterion.maxMinor += 1;
    remaining -= 1;
  }
  assert(remaining === 0, 'INVALID_RUBRIC_ALLOCATION', '无法完整分配题目满分');
  assert(
    allocated.every((criterion) => criterion.maxMinor > 0),
    'INVALID_RUBRIC_ALLOCATION',
    '题目满分过低，存在零分得分项',
  );
  return allocated.map(({ criterionId, maxMinor }) => ({ criterionId, maxMinor: maxMinor }));
}

function zeroLevel(criterion: RubricCriterion): string {
  const level = criterion.levels.find((candidate) => candidate.creditBps === 0);
  assert(level, 'INCOMPLETE_RUBRIC_LEVELS', `得分项 ${criterion.id} 缺少零分等级`);
  return level.id;
}

export function zeroCriterionEvaluations(definition: QuestionDefinition): CriterionEvaluation[] {
  assert(definition.rubric, 'RUBRIC_REQUIRED', '缺少得分项');
  return definition.rubric.criteria.map((criterion) => ({
    criterionId: criterion.id,
    levelId: zeroLevel(criterion),
    evidence: [],
    explanation: '未作答',
  }));
}

function ruleResult(maxMinor: number, scoreMinor: number, feedback: string): GradeResult {
  return {
    version: 1,
    source: 'rule',
    score: formatScore(scoreMinor),
    maxScore: formatScore(maxMinor),
    criterionResults: [],
    feedback,
    createdAt: now(),
  };
}

/** Deterministic rule grading. Fill-blank matching is intentionally exact (no trim/case folding). */
export function gradeRule(
  definition: QuestionDefinition,
  answer: Answer | null,
  maxScore: string,
): GradeResult {
  validateQuestion(definition);
  assert(definition.gradingMode === 'rule', 'INVALID_GRADING_MODE', '该题不是规则评分');
  const maxMinor = parseMaxScore(maxScore);
  const blank = isBlankAnswer(definition, answer);
  if (answer !== null) validateAnswer(definition, answer);
  const slots = definition.slots ?? [];
  const allocation =
    definition.type === 'fill_blank'
      ? allocateMaxScores(
          maxMinor,
          slots.map((slot) => ({ id: slot.id, weight: 1 })),
        )
      : [];
  if (blank) return { ...ruleResult(maxMinor, 0, '未作答'), source: 'system' };

  if (definition.type === 'single_choice') {
    const correct = (answer as { optionId: string }).optionId === definition.gradingKey?.optionId;
    return ruleResult(maxMinor, correct ? maxMinor : 0, correct ? '回答正确' : '回答错误');
  }
  if (definition.type === 'multiple_choice') {
    const actual = (answer as { optionIds: string[] }).optionIds;
    const expected = definition.gradingKey?.optionIds ?? [];
    const correct =
      actual.length === expected.length && actual.every((optionId) => expected.includes(optionId));
    return ruleResult(maxMinor, correct ? maxMinor : 0, correct ? '回答正确' : '回答错误');
  }
  if (definition.type === 'true_false') {
    const correct = (answer as { value: boolean }).value === definition.gradingKey?.value;
    return ruleResult(maxMinor, correct ? maxMinor : 0, correct ? '回答正确' : '回答错误');
  }

  let scoreMinor = 0;
  let correctCount = 0;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const value = (answer as { slots: Record<string, string> }).slots[slot.id];
    const accepted = definition.gradingKey?.acceptedAnswers?.[slot.id] ?? [];
    if (accepted.includes(value)) {
      scoreMinor += allocation[index].maxMinor;
      correctCount += 1;
    }
  }
  const feedback =
    correctCount === slots.length ? '回答正确' : correctCount === 0 ? '回答错误' : '部分空位正确';
  return ruleResult(maxMinor, scoreMinor, feedback);
}

/** Validate rubric/max-score arithmetic before a model job can incur provider cost. */
export function validateRubricScore(definition: QuestionDefinition, maxScore: string): void {
  assert(definition.rubric, 'RUBRIC_REQUIRED', '缺少得分项');
  const maxMinor = parseMaxScore(maxScore);
  allocateMaxScores(maxMinor, definition.rubric.criteria);
}
export interface RubricGradeOptions {
  source: 'model' | 'external_agent' | 'system';
  version?: number;
  feedback?: string;
  modelId?: string;
  reason?: string;
  createdAt?: string;
}

function answerEvidenceSource(
  definition: QuestionDefinition,
  answer: Answer | null,
  criterion: RubricCriterion,
): string {
  if (answer === null || !isObject(answer)) return '';
  const raw = answer as unknown as PlainObject;
  if (definition.type === 'short_answer') return typeof raw.text === 'string' ? raw.text : '';
  if (!isObject(raw.slots) || !criterion.slotId) return '';
  const value = raw.slots[criterion.slotId];
  return typeof value === 'string' ? value : '';
}

/**
 * Validate discrete criterion judgments and compute all scores on the server.
 * Unknown/duplicate/missing criteria, model-provided scores and non-source evidence are rejected.
 */
export function gradeRubric(
  definition: QuestionDefinition,
  answer: Answer | null,
  maxScore: string,
  criterionResults: unknown,
  options: RubricGradeOptions,
): GradeResult {
  validateQuestion(definition);
  assert(
    definition.gradingMode !== 'rule' && definition.rubric,
    'INVALID_GRADING_MODE',
    '该题不使用得分项评分',
  );
  if (answer !== null) validateAnswer(definition, answer);
  const maxMinor = parseMaxScore(maxScore);
  assert(Array.isArray(criterionResults), 'INVALID_CRITERION_RESULTS', '逐项评分必须是数组');
  checkKeys(
    options as unknown as PlainObject,
    ['source', 'version', 'feedback', 'modelId', 'reason', 'createdAt'],
    ['source'],
    'INVALID_GRADE_OPTIONS',
  );
  const version = options.version ?? 1;
  assert(Number.isSafeInteger(version) && version > 0, 'INVALID_GRADE_VERSION', '评分版本无效');

  const byId = new Map<string, CriterionEvaluation>();
  for (const raw of criterionResults) {
    assert(isObject(raw), 'INVALID_CRITERION_RESULT', '逐项评分格式无效');
    checkKeys(
      raw,
      ['criterionId', 'levelId', 'evidence', 'explanation'],
      ['criterionId', 'levelId', 'evidence', 'explanation'],
      'INVALID_CRITERION_RESULT',
    );
    const criterionId = text(raw.criterionId, 'criterionId', 128);
    assert(!byId.has(criterionId), 'DUPLICATE_CRITERION_RESULT', `得分项 ${criterionId} 重复返回`);
    const criterion = definition.rubric.criteria.find((candidate) => candidate.id === criterionId);
    assert(criterion, 'UNKNOWN_CRITERION', `模型返回了未知得分项 ${criterionId}`);
    const levelId = text(raw.levelId, 'levelId', 128);
    assert(
      criterion.levels.some((level) => level.id === levelId),
      'UNKNOWN_RUBRIC_LEVEL',
      `得分项 ${criterionId} 的等级无效`,
    );
    assert(
      Array.isArray(raw.evidence) && raw.evidence.length <= 32,
      'INVALID_EVIDENCE',
      '证据必须是数量受限的数组',
    );
    const sourceText = answerEvidenceSource(definition, answer, criterion);
    const evidence = raw.evidence.map((fragment) => {
      const value = text(fragment, 'evidence', 4_000);
      assert(
        sourceText.includes(value),
        'EVIDENCE_NOT_IN_ANSWER',
        `得分项 ${criterionId} 的证据不是绑定答案原文`,
      );
      return value;
    });
    const explanation = text(raw.explanation, 'explanation', 4_000, true);
    byId.set(criterionId, { criterionId, levelId, evidence, explanation });
  }
  assert(
    byId.size === definition.rubric.criteria.length,
    'MISSING_CRITERION_RESULT',
    '逐项评分存在漏项',
  );

  const allocation = allocateMaxScores(maxMinor, definition.rubric.criteria);
  let scoreMinor = 0;
  const grades: CriterionGrade[] = definition.rubric.criteria.map((criterion, index) => {
    const evaluation = byId.get(criterion.id);
    assert(evaluation, 'MISSING_CRITERION_RESULT', `缺少得分项 ${criterion.id} 的评分`);
    const level = criterion.levels.find((candidate) => candidate.id === evaluation.levelId);
    assert(level, 'UNKNOWN_RUBRIC_LEVEL', '评分等级无效');
    const sourceText = answerEvidenceSource(definition, answer, criterion);
    if (sourceText.trim() === '') {
      assert(
        level.creditBps === 0 && evaluation.evidence.length === 0,
        'BLANK_SLOT_MUST_BE_ZERO',
        `空白答案绑定的得分项 ${criterion.id} 必须为零分`,
      );
    }
    if (level.creditBps > 0) {
      assert(
        evaluation.evidence.length > 0,
        'POSITIVE_GRADE_REQUIRES_EVIDENCE',
        `得分项 ${criterion.id} 的正分等级必须提供答案证据`,
      );
    }
    const itemMax = allocation[index].maxMinor;
    const itemScore = Math.floor((itemMax * level.creditBps + 5_000) / 10_000);
    scoreMinor += itemScore;
    return { ...evaluation, maxScore: formatScore(itemMax), score: formatScore(itemScore) };
  });
  assert(scoreMinor >= 0 && scoreMinor <= maxMinor, 'INVALID_SCORE', '评分结果超出题目满分');
  const feedback = options.feedback ?? '';
  text(feedback, 'feedback', 4_000, true);
  if (options.modelId !== undefined) text(options.modelId, 'modelId', 512);
  if (options.reason !== undefined) text(options.reason, 'reason', 4_000);
  return {
    version,
    source: options.source,
    score: formatScore(scoreMinor),
    maxScore: formatScore(maxMinor),
    criterionResults: grades,
    feedback,
    createdAt: options.createdAt ?? now(),
    ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
}

export function gradeBlankRubric(
  definition: QuestionDefinition,
  answer: Answer | null,
  maxScore: string,
): GradeResult {
  assert(isBlankAnswer(definition, answer), 'BLANK_ANSWER_REQUIRED', '仅空白答案可自动记零分');
  return gradeRubric(definition, answer, maxScore, zeroCriterionEvaluations(definition), {
    source: 'system',
    feedback: '未作答',
  });
}
