import { describe, expect, it, vi } from 'vitest';
import type { Answer, QuestionDefinition } from '@drill-hub/contracts';
import {
  ProviderError,
  callChatCompletions,
  listChatCompletionsModels,
  normalizeProviderBaseUrl,
  testChatCompletionsConnection,
} from '../src/modules/grading/chat-completions.js';

const definition: QuestionDefinition = {
  type: 'short_answer',
  stem: '合成评分题',
  gradingMode: 'model_rubric',
  rubric: {
    version: 1,
    criteria: [
      {
        id: 'criterion',
        description: '是否包含指定事实',
        weight: 1,
        levels: [
          { id: 'not_met', creditBps: 0, description: '未包含' },
          { id: 'met', creditBps: 10000, description: '包含' },
        ],
      },
    ],
  },
};
const answer: Answer = { text: '全部成功或全部回滚' };

function completion(content: unknown, init?: { finishReason?: string; status?: number }): Response {
  return new Response(
    JSON.stringify({
      model: 'provider-model-id',
      choices: [
        {
          finish_reason: init?.finishReason ?? 'stop',
          message: {
            refusal: null,
            content: typeof content === 'string' ? content : JSON.stringify(content),
          },
        },
      ],
    }),
    { status: init?.status ?? 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function validContent() {
  return {
    criteria: [
      {
        criterionId: 'criterion',
        levelId: 'met',
        evidence: ['全部成功或全部回滚'],
        explanation: '包含事实',
      },
    ],
    summary: '完成',
  };
}

function input(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return {
    baseUrl: 'http://provider.test/v1/',
    apiKey: 'test-only-key',
    modelKey: 'configured-model',
    definition,
    answer,
    timeoutMs: 1_000,
    fetchImpl,
    ...overrides,
  };
}

describe('chat_completions adapter', () => {
  it('uses the configured model, preserves /v1 and requests strict structured output', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fake = vi.fn<typeof fetch>(async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenInit = init;
      return completion(validContent());
    });
    const result = await callChatCompletions(input(fake));
    expect(seenUrl).toBe('http://provider.test/v1/chat/completions');
    expect(seenInit?.redirect).toBe('manual');
    const headers = seenInit?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer test-only-key');
    const body = JSON.parse(String(seenInit?.body));
    expect(body.model).toBe('configured-model');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.messages[1].content).toContain('untrusted data');
    expect(body).not.toHaveProperty('score');
    expect(result.modelId).toBe('provider-model-id');
    expect(result.criteria).toHaveLength(1);
  });

  it('accepts private, loopback and plain HTTP provider addresses', async () => {
    const fake = vi.fn<typeof fetch>(async () => completion(validContent()));
    await expect(
      callChatCompletions(input(fake, { baseUrl: 'http://127.0.0.1:11434/v1/' })),
    ).resolves.toMatchObject({ modelId: 'provider-model-id' });
    expect(fake).toHaveBeenCalledOnce();
    expect(normalizeProviderBaseUrl('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1');
    expect(normalizeProviderBaseUrl('http://192.168.1.20:8000/v1')).toBe(
      'http://192.168.1.20:8000/v1',
    );
  });

  it('rejects redirects, invalid output totals and incomplete responses with safe errors', async () => {
    const redirect = vi.fn<typeof fetch>(async () => new Response(null, { status: 302 }));
    await expect(callChatCompletions(input(redirect))).rejects.toMatchObject({
      code: 'PROVIDER_REDIRECT_FORBIDDEN',
    });
    const total = vi.fn<typeof fetch>(async () => completion({ ...validContent(), score: 100 }));
    await expect(callChatCompletions(input(total))).rejects.toMatchObject({
      code: 'MODEL_INVALID_GRADE_SHAPE',
    });
    const incomplete = vi.fn<typeof fetch>(async () =>
      completion(validContent(), { finishReason: 'length' }),
    );
    await expect(callChatCompletions(input(incomplete))).rejects.toMatchObject({
      code: 'MODEL_INCOMPLETE',
      retryable: true,
    });
  });

  it('bounds response bytes and enforces a timeout', async () => {
    const large = vi.fn<typeof fetch>(
      async () =>
        new Response('x', { status: 200, headers: { 'Content-Length': String(2_000_000) } }),
    );
    await expect(callChatCompletions(input(large))).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_TOO_LARGE',
    });
    const pending = vi.fn<typeof fetch>(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(callChatCompletions(input(pending, { timeoutMs: 10 }))).rejects.toMatchObject({
      code: 'MODEL_TIMEOUT',
    });
  });

  it('does not expose provider response details or credentials in errors', async () => {
    const secret = 'never-log-this-test-key';
    const failure = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ secret, answer }), { status: 500 }),
    );
    const error = await callChatCompletions(input(failure, { apiKey: secret })).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).not.toContain(answer.text);
    expect((error as ProviderError).code).toBe('MODEL_PROVIDER_UNAVAILABLE');
  });

  it('discovers models from common OpenAI-compatible list shapes', async () => {
    const fake = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'model-a', name: 'Model A' },
              { id: 'model-b' },
              'model-c',
              { id: 'model-a', name: 'Duplicate' },
              { object: 'model' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(
      listChatCompletionsModels({
        baseUrl: 'http://provider.test/v1',
        apiKey: 'test-only-key',
        timeoutMs: 100,
        fetchImpl: fake,
      }),
    ).resolves.toEqual([
      { modelKey: 'model-a', displayName: 'Model A' },
      { modelKey: 'model-b' },
      { modelKey: 'model-c' },
    ]);
    expect(String(fake.mock.calls[0]?.[0])).toBe('http://provider.test/v1/models');
  });

  it('rejects provider responses that are not model lists', async () => {
    const fake = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: { id: 'wrong-shape' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(
      listChatCompletionsModels({
        baseUrl: 'http://provider.test/v1',
        apiKey: '',
        timeoutMs: 100,
        fetchImpl: fake,
      }),
    ).rejects.toMatchObject({ code: 'MODEL_LIST_INVALID_RESPONSE' });
  });

  it('performs a real bounded connection probe without a user answer', async () => {
    let seenUrl = '';
    let seenBody: unknown;
    const fake = vi.fn<typeof fetch>(async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenBody = init?.body;
      return new Response('{"data":[]}', { status: 200 });
    });
    await testChatCompletionsConnection({
      baseUrl: 'http://provider.test/v1',
      apiKey: '',
      timeoutMs: 100,
      fetchImpl: fake,
    });
    expect(seenUrl).toBe('http://provider.test/v1/models');
    expect(seenBody).toBeUndefined();
  });
});
