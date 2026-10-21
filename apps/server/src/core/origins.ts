import type { FastifyRequest } from 'fastify';
import type { ServerConfig } from './context.js';
import { isLoopbackUrl } from './public-url.js';

/** Never infer cross-origin trust from forwarded headers or a non-loopback Host. */
export function isTrustedOrigin(
  origin: string,
  request: FastifyRequest,
  config: ServerConfig,
): boolean {
  if (origin === 'null') return false;
  if (config.corsOrigins.includes(origin)) return true;
  if (config.publicUrl) return new URL(config.publicUrl).origin === origin;
  try {
    const target = `${request.protocol}://${request.headers.host}`;
    return isLoopbackUrl(target) && new URL(target).origin === origin;
  } catch {
    return false;
  }
}
