import type { TokenUsageReport, TokenUsageTotals } from '@drill-hub/contracts';
import type { Database } from '#server/db/database.js';
import { assert } from '#server/core/errors.js';

export function emptyUsageTotals(): TokenUsageTotals {
  return {
    calls: 0,
    failedCalls: 0,
    unknownUsageCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

export async function tokenUsageReport(
  db: Database,
  ownerId: string | undefined,
  query: Record<string, unknown>,
  timestamp = new Date(),
): Promise<TokenUsageReport> {
  assert(
    Object.keys(query).every((key) => ['days', 'utcOffsetMinutes'].includes(key)),
    'INVALID_QUERY',
    '不支持的统计筛选参数',
    400,
  );
  const rawDays = query.days ?? '30';
  assert(
    typeof rawDays === 'string' && ['7', '30', '90'].includes(rawDays),
    'INVALID_QUERY',
    '统计范围必须是 7、30 或 90 天',
    400,
  );
  const rawOffset = query.utcOffsetMinutes ?? '0';
  assert(
    typeof rawOffset === 'string' && /^-?\d{1,3}$/.test(rawOffset),
    'INVALID_QUERY',
    '时区偏移格式无效',
    400,
  );
  const utcOffsetMinutes = Number(rawOffset);
  assert(
    utcOffsetMinutes >= -840 && utcOffsetMinutes <= 840,
    'INVALID_QUERY',
    '时区偏移超出范围',
    400,
  );
  const days = Number(rawDays);
  const dayMs = 86_400_000;
  const offsetMs = utcOffsetMinutes * 60_000;
  const localMidnight = Math.floor((timestamp.getTime() + offsetMs) / dayMs) * dayMs;
  const start = localMidnight - (days - 1) * dayMs;
  const end = localMidnight + dayMs;
  const result = await db.summarizeModelUsage(
    ownerId,
    new Date(start - offsetMs).toISOString(),
    new Date(end - offsetMs).toISOString(),
    utcOffsetMinutes,
  );
  const byDate = new Map(result.daily.map((day) => [day.date, day]));
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(start + index * dayMs).toISOString().slice(0, 10);
    return byDate.get(date) ?? { date, ...emptyUsageTotals() };
  });
  return {
    days,
    utcOffsetMinutes,
    fromDate: daily[0]!.date,
    toDate: daily.at(-1)!.date,
    totals: result.totals,
    daily,
    models: result.models,
  };
}
