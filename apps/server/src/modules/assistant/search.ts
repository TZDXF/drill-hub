import type { SearchProviderKind, SearchResultItem } from '@drill-hub/contracts';
import { AppError } from '#server/core/errors.js';
import {
  ProviderNetworkError,
  assertProviderHost,
  publicProviderDispatcher,
} from '#server/core/provider-network.js';
import type { SearchProviderRecord } from '#server/db/records.js';
import type { JsonObject } from '#server/modules/learning/common.js';

const DEFAULT_BASE_URLS: Record<SearchProviderKind, string | null> = {
  tavily: 'https://api.tavily.com',
  brave: 'https://api.search.brave.com',
  searxng: null,
  openai_responses: null,
};

const SEARCH_KINDS: SearchProviderKind[] = ['tavily', 'brave', 'searxng', 'openai_responses'];

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(422, 'INVALID_URL', 'baseUrl 必须是合法的 HTTP(S) 地址');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new AppError(422, 'INVALID_URL', 'baseUrl 只允许 HTTP 或 HTTPS');
  if (url.username || url.password || url.search || url.hash)
    throw new AppError(422, 'INVALID_URL', 'baseUrl 不能包含凭据、查询参数或片段');
  return url.toString().replace(/\/+$/, '');
}

export interface SearchProviderInput {
  displayName: string;
  kind: SearchProviderKind;
  baseUrl: string | null;
  modelKey: string | null;
  apiKey: string | null;
  enabled: boolean;
}

export function validateSearchProviderInput(raw: JsonObject): SearchProviderInput {
  if (!SEARCH_KINDS.includes(raw.kind as SearchProviderKind))
    throw new AppError(422, 'INVALID_SEARCH_KIND', '搜索服务类型无效');
  const kind = raw.kind as SearchProviderKind;
  const displayName =
    typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim() : '';
  if (!displayName || displayName.length > 200)
    throw new AppError(422, 'INVALID_FIELD', 'displayName 必须是 1 至 200 个字符');
  const rawBaseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl : null;
  if ((kind === 'searxng' || kind === 'openai_responses') && !rawBaseUrl)
    throw new AppError(422, 'INVALID_URL', '该搜索服务类型必须提供 baseUrl');
  const baseUrl = rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : DEFAULT_BASE_URLS[kind];
  const modelKey =
    typeof raw.modelKey === 'string' && raw.modelKey.trim() ? raw.modelKey.trim() : null;
  if (kind === 'openai_responses' && !modelKey)
    throw new AppError(422, 'INVALID_FIELD', 'openai_responses 类型必须提供 modelKey');
  const apiKey = typeof raw.apiKey === 'string' && raw.apiKey.trim() ? raw.apiKey.trim() : null;
  if (kind !== 'searxng' && !apiKey)
    throw new AppError(422, 'INVALID_FIELD', '该搜索服务需要 API 密钥');
  return {
    displayName,
    kind,
    baseUrl,
    modelKey,
    apiKey,
    enabled: raw.enabled === undefined ? true : raw.enabled === true,
  };
}

const SEARCH_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

async function searchFetch(url: URL, init: RequestInit, allowPrivate: boolean): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    assertProviderHost(url, allowPrivate);
    const requestOptions: RequestInit = { ...init, signal: controller.signal, redirect: 'manual' };
    // Node fetch supports Undici dispatchers; DOM RequestInit does not expose that extension.
    if (!allowPrivate) Object.assign(requestOptions, { dispatcher: publicProviderDispatcher });
    const response = await fetch(url, requestOptions);
    if (response.status >= 300 && response.status < 400)
      throw new AppError(502, 'SEARCH_PROVIDER_ERROR', '搜索服务禁止重定向');
    const text = await readLimited(response);
    if (!response.ok)
      throw new AppError(502, 'SEARCH_PROVIDER_ERROR', `搜索服务返回 ${response.status}`);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ProviderNetworkError)
      throw new AppError(403, 'SEARCH_ADDRESS_FORBIDDEN', '搜索服务地址被拒绝');
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'SEARCH_PROVIDER_ERROR', '搜索服务暂时不可用');
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let received = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES)
      throw new AppError(502, 'SEARCH_PROVIDER_ERROR', '搜索服务响应过大');
    chunks.push(value);
  }
  const total = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    total.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(total);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseTavily(payload: unknown): SearchResultItem[] {
  const results = asRecord(payload).results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, 20).map((raw) => {
    const item = asRecord(raw);
    return {
      title: clip(String(item.title ?? ''), 300),
      url: String(item.url ?? ''),
      snippet: clip(String(item.content ?? ''), 1000),
    };
  });
}

function parseBrave(payload: unknown): SearchResultItem[] {
  const results = asRecord(asRecord(payload).web).results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, 20).map((raw) => {
    const item = asRecord(raw);
    return {
      title: clip(String(item.title ?? ''), 300),
      url: String(item.url ?? ''),
      snippet: clip(String(item.description ?? ''), 1000),
    };
  });
}

function parseSearxng(payload: unknown): SearchResultItem[] {
  const results = asRecord(payload).results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, 20).map((raw) => {
    const item = asRecord(raw);
    return {
      title: clip(String(item.title ?? ''), 300),
      url: String(item.url ?? ''),
      snippet: clip(String(item.content ?? ''), 1000),
    };
  });
}

function parseOpenAiResponses(payload: unknown): SearchResultItem[] {
  const output = asRecord(payload).output;
  if (!Array.isArray(output)) return [];
  const items: SearchResultItem[] = [];
  let answerText = '';
  for (const entry of output) {
    const record = asRecord(entry);
    if (record.type !== 'message') continue;
    const content = record.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const item = asRecord(block);
      if (item.type !== 'output_text') continue;
      answerText += String(item.text ?? '');
      const annotations = item.annotations;
      if (Array.isArray(annotations))
        for (const annotation of annotations) {
          const citation = asRecord(annotation);
          if (citation.type !== 'url_citation') continue;
          items.push({
            title: clip(String(citation.title ?? '引用来源'), 300),
            url: String(citation.url ?? ''),
            snippet: clip(String(citation.text ?? answerText), 1000),
          });
        }
    }
  }
  if (!items.length && answerText.trim())
    items.push({ title: '搜索回答', url: '', snippet: clip(answerText, 1000) });
  return items;
}

export async function runSearch(input: {
  provider: SearchProviderRecord;
  apiKey: string | null;
  query: string;
  maxResults: number;
  allowPrivate: boolean;
}): Promise<SearchResultItem[]> {
  const { provider, apiKey, query, maxResults, allowPrivate } = input;
  const limit = Math.max(maxResults, 1);
  let parsed: SearchResultItem[];
  if (provider.kind === 'tavily') {
    const url = new URL(`${provider.baseUrl}/search`);
    parsed = parseTavily(
      await searchFetch(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ query, max_results: limit }),
        },
        allowPrivate,
      ),
    );
  } else if (provider.kind === 'brave') {
    const url = new URL(`${provider.baseUrl}/res/v1/web/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(limit));
    parsed = parseBrave(
      await searchFetch(
        url,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            ...(apiKey ? { 'x-subscription-token': apiKey } : {}),
          },
        },
        allowPrivate,
      ),
    );
  } else if (provider.kind === 'searxng') {
    const url = new URL(`${provider.baseUrl}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    parsed = parseSearxng(await searchFetch(url, { method: 'GET' }, allowPrivate));
  } else {
    const url = new URL(`${provider.baseUrl}/responses`);
    parsed = parseOpenAiResponses(
      await searchFetch(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: provider.modelKey,
            tools: [{ type: 'web_search' }],
            input: [
              {
                role: 'user',
                content: `使用 web_search 搜索“${query}”，并用不超过 300 字概括最重要的结果。`,
              },
            ],
          }),
        },
        allowPrivate,
      ),
    );
  }
  return parsed.filter((item) => item.title || item.snippet).slice(0, limit);
}

export async function testSearchProvider(
  provider: SearchProviderRecord,
  apiKey: string | null,
  allowPrivate: boolean,
): Promise<void> {
  const results = await runSearch({
    provider,
    apiKey,
    query: 'drill hub learning',
    maxResults: 2,
    allowPrivate,
  });
  if (!results.length) throw new AppError(502, 'SEARCH_PROVIDER_ERROR', '搜索服务未返回可用结果');
}
