import { AppError } from '#server/core/errors.js';
import type { ModelCatalogMatch, ModelCostRates } from '@drill-hub/contracts';

const CATALOG_URL = 'https://models.dev/api.json';
const CATALOG_TIMEOUT_MS = 15000;
const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_MATCHES = 20;

interface CatalogCache {
  fetchedAt: number;
  data: unknown;
}
let cache: CatalogCache | null = null;

interface CatalogModelEntry {
  id?: unknown;
  name?: unknown;
  reasoning?: unknown;
  modalities?: { input?: unknown };
  limit?: { context?: unknown; output?: unknown };
  cost?: Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseCost(entry: CatalogModelEntry): ModelCostRates | null {
  const cost = entry.cost;
  if (!cost || typeof cost !== 'object') return null;
  const input = asFiniteNumber(cost.input);
  const output = asFiniteNumber(cost.output);
  if (input === null || output === null) return null;
  return {
    input,
    output,
    cacheRead: asFiniteNumber(cost.cache_read) ?? 0,
    cacheWrite: asFiniteNumber(cost.cache_write) ?? 0,
  };
}

function parseEntry(
  providerId: string,
  providerName: string,
  modelId: string,
  entry: CatalogModelEntry,
): ModelCatalogMatch {
  const modalitiesInput = Array.isArray(entry.modalities?.input)
    ? (entry.modalities?.input as unknown[])
    : [];
  const input = modalitiesInput.filter(
    (item): item is 'text' | 'image' => item === 'text' || item === 'image',
  );
  return {
    providerId,
    providerName,
    modelId,
    name: typeof entry.name === 'string' && entry.name ? entry.name : null,
    reasoning: entry.reasoning === true,
    input: input.length ? input : ['text'],
    contextWindow: asFiniteNumber(entry.limit?.context),
    maxTokens: asFiniteNumber(entry.limit?.output),
    costPerMillion: parseCost(entry),
  };
}

function iterCatalog(catalog: unknown, visit: (match: ModelCatalogMatch) => void): void {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return;
  for (const [providerId, providerValue] of Object.entries(catalog as Record<string, unknown>)) {
    if (!providerValue || typeof providerValue !== 'object') continue;
    const provider = providerValue as { name?: unknown; models?: unknown };
    if (!provider.models || typeof provider.models !== 'object') continue;
    const providerName =
      typeof provider.name === 'string' && provider.name ? provider.name : providerId;
    for (const [modelId, entryValue] of Object.entries(
      provider.models as Record<string, unknown>,
    )) {
      if (!entryValue || typeof entryValue !== 'object' || Array.isArray(entryValue)) continue;
      visit(parseEntry(providerId, providerName, modelId, entryValue as CatalogModelEntry));
    }
  }
}

/**
 * 在 models.dev 目录中按关键词匹配模型。完全等于 model id 的条目排最前，
 * 其后按「id 前缀 → id 包含 → 名称包含」排序，最多返回 20 条。
 */
export function searchModelsCatalog(
  catalog: unknown,
  query: string,
  limit = MAX_MATCHES,
): ModelCatalogMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored: { match: ModelCatalogMatch; score: number }[] = [];
  iterCatalog(catalog, (match) => {
    const id = match.modelId.toLowerCase();
    const name = (match.name ?? '').toLowerCase();
    let score: number | null = null;
    if (id === needle) score = 0;
    else if (id.startsWith(needle)) score = 1;
    else if (id.includes(needle)) score = 2;
    else if (name.includes(needle)) score = 3;
    if (score !== null) scored.push({ match, score });
  });
  scored.sort(
    (left, right) =>
      left.score - right.score ||
      left.match.modelId.localeCompare(right.match.modelId) ||
      left.match.providerId.localeCompare(right.match.providerId),
  );
  return scored.slice(0, limit).map((entry) => entry.match);
}

/** 按完整模型 ID 精确匹配；带供应商前缀时，再尝试去掉前缀的 ID。 */
export function findExactModelsCatalogMatch(
  catalog: unknown,
  modelKey: string,
): ModelCatalogMatch | null {
  const key = modelKey.trim().toLowerCase();
  const unprefixed = key.slice(key.lastIndexOf('/') + 1);
  for (const query of [...new Set([key, unprefixed])]) {
    const match = searchModelsCatalog(catalog, query).find(
      (item) => item.modelId.toLowerCase() === query,
    );
    if (match) return match;
  }
  return null;
}

/** 获取 models.dev 目录（内存缓存 6 小时）。 */
export async function fetchModelsCatalog(): Promise<unknown> {
  if (cache && Date.now() - cache.fetchedAt < CATALOG_REFRESH_MS) return cache.data;
  let data: unknown;
  try {
    const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    if (!response.ok)
      throw new AppError(
        502,
        'MODEL_CATALOG_UNAVAILABLE',
        `models.dev 请求失败（HTTP ${response.status}）`,
      );
    data = await response.json();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'MODEL_CATALOG_UNAVAILABLE', 'models.dev 暂时不可用，请稍后重试');
  }
  cache = { fetchedAt: Date.now(), data };
  return data;
}
