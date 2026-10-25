import { describe, expect, it } from 'vitest';
import { searchModelsCatalog } from '#server/modules/grading/models-dev.js';

const catalog = {
  deepseek: {
    name: 'DeepSeek',
    models: {
      'deepseek-v4-pro': {
        name: 'DeepSeek V4 Pro',
        reasoning: true,
        modalities: { input: ['text'] },
        limit: { context: 1000000, output: 384000 },
        cost: { input: 5, output: 25, cache_read: 0.5 },
      },
      'deepseek-v4-lite': {
        name: 'DeepSeek V4 Lite',
        reasoning: false,
        modalities: { input: ['text', 'image'] },
        limit: { context: 128000, output: 8192 },
        cost: { input: 0.2, output: 0.8 },
      },
    },
  },
  openai: {
    name: 'OpenAI',
    models: {
      'gpt-4o': {
        name: 'GPT-4o',
        modalities: { input: ['text', 'image'] },
        limit: { context: 128000, output: 16384 },
        cost: { input: 2.5, output: 10, cache_read: 1.25, cache_write: 0 },
      },
    },
  },
};

describe('searchModelsCatalog', () => {
  it('returns empty results for blank queries', () => {
    expect(searchModelsCatalog(catalog, '  ')).toEqual([]);
  });

  it('finds models by id substring and normalizes cost fields', () => {
    const matches = searchModelsCatalog(catalog, 'v4');
    expect(matches.map((match) => match.modelId)).toEqual(['deepseek-v4-lite', 'deepseek-v4-pro']);
    const lite = matches[0]!;
    expect(lite).toMatchObject({
      providerId: 'deepseek',
      providerName: 'DeepSeek',
      reasoning: false,
      input: ['text', 'image'],
      contextWindow: 128000,
      maxTokens: 8192,
      costPerMillion: { input: 0.2, output: 0.8, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it('ranks exact id matches first', () => {
    const matches = searchModelsCatalog(catalog, 'gpt-4o');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.providerId).toBe('openai');
    expect(matches[0]!.costPerMillion).toEqual({
      input: 2.5,
      output: 10,
      cacheRead: 1.25,
      cacheWrite: 0,
    });
  });

  it('falls back to name matching and tolerates malformed entries', () => {
    const messy = {
      broken: { name: 'Broken', models: { bad: 'not-an-object', worse: null } },
      named: {
        name: null,
        models: {
          'weird-id': { name: 'Llama 4 Scout', limit: {}, cost: { input: 1 } },
        },
      },
    };
    expect(searchModelsCatalog(messy, 'llama')).toHaveLength(1);
    const match = searchModelsCatalog(messy, 'weird')[0]!;
    expect(match.contextWindow).toBeNull();
    // 缺少 output 价格时视为无效条目，不返回价格。
    expect(match.costPerMillion).toBeNull();
    expect(searchModelsCatalog(messy, 'xx')).toEqual([]);
  });
});
