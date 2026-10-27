import type { FastifyRequest } from 'fastify';
import type { Attempt, BaseRecord } from '@drill-hub/contracts';
import { AppError, assert } from '#server/core/errors.js';
import { expectedRevision } from '#server/core/validation.js';
export { assert } from '#server/core/errors.js';
export { body, expectedRevision, isRecord } from '#server/core/validation.js';
import type { Database } from '#server/db/database.js';
import type { DatabaseTables } from '#server/db/records.js';

export const API_PREFIX = '/api/v1';
export type JsonObject = Record<string, unknown>;

export type OwnedTableName = {
  [K in keyof DatabaseTables]: DatabaseTables[K] extends { ownerId: string } ? K : never;
}[keyof DatabaseTables];

export function params(request: FastifyRequest): Record<string, string> {
  return request.params as Record<string, string>;
}

export function query(request: FastifyRequest): Record<string, unknown> {
  return (request.query ?? {}) as Record<string, unknown>;
}

export function requiredString(value: JsonObject, key: string, maxLength = 500): string {
  const text = value[key];
  assert(
    typeof text === 'string' && text.trim().length > 0,
    'INVALID_FIELD',
    `${key} 不能为空`,
    422,
    {
      [key]: '必须是非空字符串',
    },
  );
  assert(text.length <= maxLength, 'INVALID_FIELD', `${key} 过长`, 422, {
    [key]: `最多 ${maxLength} 个字符`,
  });
  return text;
}

export function optionalString(
  value: JsonObject,
  key: string,
  fallback: string,
  maxLength = 500,
  allowEmpty = false,
): string {
  if (value[key] === undefined) return fallback;
  const text = value[key];
  assert(
    typeof text === 'string' && (allowEmpty || text.trim().length > 0),
    'INVALID_FIELD',
    `${key} 格式无效`,
    422,
    {
      [key]: '必须是字符串',
    },
  );
  assert(text.length <= maxLength, 'INVALID_FIELD', `${key} 过长`, 422, {
    [key]: `最多 ${maxLength} 个字符`,
  });
  return text;
}

export function optionalRevision(value: JsonObject): number | undefined {
  if (value.expectedRevision === undefined) return undefined;
  return expectedRevision(value);
}

export function checkRevision(record: BaseRecord, revision: number): void {
  if (record.revision !== revision) {
    throw new AppError(409, 'VERSION_CONFLICT', '数据已发生变化，请刷新后重试');
  }
}

export function positiveInteger(value: unknown, field: string, maximum = 100000): number {
  assert(
    Number.isInteger(value) && (value as number) > 0 && (value as number) <= maximum,
    'INVALID_FIELD',
    `${field} 无效`,
    422,
    {
      [field]: `必须是 1 到 ${maximum} 的整数`,
    },
  );
  return value as number;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function optionalScheduledDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  assert(
    typeof value === 'string' && isCalendarDate(value),
    'INVALID_DATE',
    'scheduledDate 无效',
    422,
    {
      scheduledDate: '必须是 YYYY-MM-DD',
    },
  );
  return value;
}

export async function owned<K extends OwnedTableName>(
  db: Database,
  table: K,
  recordId: string,
  ownerId: string,
): Promise<DatabaseTables[K]> {
  const record = await db.get(table, recordId);
  assert(record && record.ownerId === ownerId, 'NOT_FOUND', '资源不存在', 404);
  return record;
}

export async function ownedTopic(
  db: Database,
  topicId: string,
  ownerId: string,
  requireActive = false,
) {
  const topic = await owned(db, 'topics', topicId, ownerId);
  if (requireActive)
    assert(topic.archivedAt === null, 'TOPIC_ARCHIVED', '主题已归档，不能执行此操作', 409);
  return topic;
}

export function archiveState(value: unknown): 'active' | 'archived' | 'all' {
  if (value === undefined) return 'active';
  assert(
    value === 'active' || value === 'archived' || value === 'all',
    'INVALID_ARCHIVE_STATE',
    'archiveState 无效',
    400,
  );
  return value;
}

export function matchesArchive(
  record: { archivedAt: string | null },
  state: 'active' | 'archived' | 'all',
): boolean {
  return (
    state === 'all' ||
    (state === 'archived' ? record.archivedAt !== null : record.archivedAt === null)
  );
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function expired(attempt: Attempt, at = Date.now()): boolean {
  return attempt.expiresAt !== null && at >= Date.parse(attempt.expiresAt);
}

export async function findAttemptWithItem(db: Database, ownerId: string, itemId: string) {
  const attempts = await db.list('attempts', { ownerId });
  for (const attempt of attempts) {
    const item = attempt.items.find((candidate) => candidate.id === itemId);
    if (item) return { attempt, item };
  }
  throw new AppError(404, 'NOT_FOUND', '作答题目不存在');
}

export function rejectClientFacts(value: JsonObject): void {
  for (const key of [
    'ownerId',
    'score',
    'maxScore',
    'correct',
    'submittedAt',
    'gradingStatus',
    'answerStatus',
    'voidedAt',
    'voidedBy',
    'voidReason',
    'startedAt',
    'answerLinkId',
  ]) {
    assert(value[key] === undefined, 'CLIENT_FACT_FORBIDDEN', `客户端不能提供 ${key}`, 422, {
      [key]: '该字段由服务端确定',
    });
  }
}
