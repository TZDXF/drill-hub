import { describe, expect, it } from 'vitest';
import { questionDefinition } from '../src/modules/learning/question-utils.js';

const definition = {
  type: 'true_false',
  stem: '事务具有原子性',
  gradingMode: 'rule',
  gradingKey: { value: true },
};

describe('questionDefinition', () => {
  it('clones an allowed definition without modifying the input', () => {
    const result = questionDefinition(definition);
    expect(result).toEqual(definition);
    expect(result).not.toBe(definition);
    result.gradingKey!.value = false;
    expect(definition.gradingKey.value).toBe(true);
  });

  it.each([
    { ...definition, unexpected: true },
    { ...definition, clientRef: 'transport-only' },
    { ...definition, options: [{ id: 'a', text: '选项', score: '100' }] },
    { ...definition, slots: [{ id: 'a', ownerId: 'forged' }] },
    { ...definition, gradingKey: { value: true, correct: true } },
    { ...definition, rubric: { version: 1, criteria: [], score: '100' } },
    {
      ...definition,
      rubric: { version: 1, criteria: [{ id: 'a', weight: 1, levels: [], maxScore: '100' }] },
    },
    {
      ...definition,
      rubric: {
        version: 1,
        criteria: [{ id: 'a', weight: 1, levels: [{ id: 'a', creditBps: 10000, score: '100' }] }],
      },
    },
  ])('rejects unknown fields rather than silently removing them (%#)', (input) => {
    expect(() => questionDefinition(input)).toThrowError(
      expect.objectContaining({ code: 'INVALID_QUESTION_FIELD', statusCode: 422 }),
    );
  });

  it('allows slot IDs that match reserved names inside the accepted-answer map', () => {
    const input = {
      type: 'fill_blank',
      stem: '补全定义',
      slots: [{ id: 'score' }, { id: 'ownerId' }],
      gradingMode: 'rule',
      gradingKey: { acceptedAnswers: { score: ['分数'], ownerId: ['所有者'] } },
    };
    expect(questionDefinition(input)).toEqual(input);
  });
});
