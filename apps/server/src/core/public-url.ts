import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

type PublicUrlRequest = { protocol: string; headers: FastifyRequest['headers'] };

export interface PublicUrlInfo {
  publicBaseUrl: string;
  publicUrlSource: 'configured' | 'request';
  isLoopback: boolean;
}

/** Deployment base, not an API endpoint. Keep path prefixes when appending public links. */
export function normalizePublicBaseUrl(value: string): string {
  try {
    const input = value.trim();
    const hasControl = [...input].some((character) => character < ' ' || character === '\u007f');
    if (!/^https?:\/\/[^/]/i.test(input) || hasControl || /[\s\\?#]/u.test(input)) {
      throw new Error('Invalid public URL');
    }
    const url = new URL(input);
    if (!url.hostname || url.username || url.password || input.split('/')[2]!.includes('@')) {
      throw new Error('Invalid public URL');
    }
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    throw new AppError(
      503,
      'INVALID_PUBLIC_URL',
      'PUBLIC_URL 必须是有效的 HTTP/HTTPS 公开部署地址，可包含路径，但不能包含凭据、查询参数或片段',
    );
  }
}

function isLoopbackUrl(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname.toLowerCase().replace(/\.$/, '');
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname) ||
    hostname === '[::1]' ||
    /^\[::ffff:7f[\da-f]{2}:[\da-f]{1,4}\]$/.test(hostname)
  );
}

export function resolvePublicUrl(request: PublicUrlRequest, configuredUrl?: string): PublicUrlInfo {
  const configured = configuredUrl?.trim();
  let publicBaseUrl: string;
  if (configured) {
    publicBaseUrl = normalizePublicBaseUrl(configured);
  } else {
    try {
      const host = request.headers.host;
      if (!host || !/^https?$/.test(request.protocol) || /[\s/\\?#@]/u.test(host)) {
        throw new Error('Invalid request origin');
      }
      publicBaseUrl = normalizePublicBaseUrl(`${request.protocol}://${host}`);
    } catch {
      throw new AppError(
        503,
        'PUBLIC_URL_UNAVAILABLE',
        '无法从请求确定公开地址，请配置 PUBLIC_URL',
      );
    }
  }
  return {
    publicBaseUrl,
    publicUrlSource: configured ? 'configured' : 'request',
    isLoopback: isLoopbackUrl(publicBaseUrl),
  };
}
