import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Actor } from '#server/core/context.js';

/**
 * 助手内部令牌：仅由服务端在同一进程内签发并用于 app.inject 自调用，
 * 让助手的 drill_hub_api 工具以发起用户身份执行真实端点。
 * 令牌为无状态 HMAC 签名（密钥为主加密密钥），外部无法伪造；
 * 短 TTL、绑定单一 turn，不落库、不写日志。
 */
export const INTERNAL_TOKEN_PREFIX = 'dhi.';

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signInternalToken(input: {
  secret: string;
  userId: string;
  turnId: string;
  role: Actor['role'];
  expiresAt: number;
}): string {
  const payload = [input.userId, input.turnId, input.role, String(input.expiresAt)].join('.');
  return `${INTERNAL_TOKEN_PREFIX}${Buffer.from(payload).toString('base64url')}.${signature(
    input.secret,
    payload,
  )}`;
}

export function verifyInternalToken(
  token: string,
  secret: string,
  now = Date.now(),
): { userId: string; turnId: string; role: Actor['role'] } | null {
  if (!token.startsWith(INTERNAL_TOKEN_PREFIX)) return null;
  const body = token.slice(INTERNAL_TOKEN_PREFIX.length);
  const separator = body.lastIndexOf('.');
  if (separator <= 0) return null;
  let payload: string;
  try {
    payload = Buffer.from(body.slice(0, separator), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = signature(secret, payload);
  const provided = body.slice(separator + 1);
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return null;
  const parts = payload.split('.');
  if (parts.length !== 4) return null;
  const [userId, turnId, role, expiresAt] = parts;
  if (role !== 'admin' && role !== 'user') return null;
  const expiry = Number(expiresAt);
  if (!Number.isInteger(expiry) || now >= expiry) return null;
  return { userId, turnId, role };
}
