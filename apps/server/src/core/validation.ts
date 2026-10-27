import type { FastifyRequest } from 'fastify';
import { AppError, assert } from '#server/core/errors.js';

export function body(request: FastifyRequest, allowEmpty = false): Record<string, unknown> {
  const value = request.body;
  if (allowEmpty && (value === undefined || value === null)) return {};
  assert(isRecord(value), 'INVALID_BODY', '请求体必须是 JSON 对象', 400);
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectedRevision(value: Record<string, unknown>): number {
  const revision = value.expectedRevision;
  assert(
    Number.isInteger(revision) && (revision as number) >= 1,
    'INVALID_REVISION',
    'expectedRevision 无效',
    422,
    { expectedRevision: '必须是大于等于 1 的整数' },
  );
  return revision as number;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError(422, 'INVALID_BODY', '请求内容必须是对象');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 200, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max)
    throw new AppError(422, 'INVALID_FIELD', label + '格式不正确');
  return value.trim();
}
export function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    throw new AppError(422, 'INVALID_REVISION', '请提供有效的数据版本');
  return value;
}
