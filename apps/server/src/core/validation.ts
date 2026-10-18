import { AppError } from './errors.js';
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
