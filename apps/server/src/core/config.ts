import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerConfig } from './context.js';
const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
export async function loadConfig(overrides: Partial<ServerConfig> = {}): Promise<ServerConfig> {
  const production = overrides.production ?? process.env.NODE_ENV === 'production';
  const databasePath =
    overrides.databasePath ??
    resolve(workspaceRoot, process.env.DATABASE_PATH ?? '.data/drill-hub.sqlite');
  let encryptionKey = overrides.encryptionKey ?? process.env.DRILL_HUB_ENCRYPTION_KEY ?? '';
  if (!encryptionKey) {
    if (production) throw new Error('Production requires DRILL_HUB_ENCRYPTION_KEY');
    const keyPath = resolve(workspaceRoot, '.data/dev-encryption-key');
    await mkdir(dirname(keyPath), { recursive: true });
    try {
      encryptionKey = (await readFile(keyPath, 'utf8')).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      encryptionKey = randomBytes(32).toString('hex');
      try {
        await writeFile(keyPath, encryptionKey, { mode: 0o600, flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        encryptionKey = (await readFile(keyPath, 'utf8')).trim();
      }
    }
  }
  const port = overrides.port ?? Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const corsOrigins =
    overrides.corsOrigins ??
    (process.env.CORS_ORIGINS ?? (production ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  for (const origin of corsOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('Invalid CORS_ORIGINS');
    }
    if (
      !['http:', 'https:', 'tauri:'].includes(parsed.protocol) ||
      parsed.hostname.includes('*') ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '/' && parsed.pathname !== '') ||
      (parsed.protocol === 'tauri:' ? origin !== 'tauri://localhost' : parsed.origin !== origin)
    ) {
      throw new Error('Invalid CORS_ORIGINS: use exact scheme, host and port');
    }
  }
  const trustedProxies =
    overrides.trustedProxies ??
    (process.env.TRUSTED_PROXIES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  for (const proxy of trustedProxies) {
    const [address, prefix, extra] = proxy.split('/');
    const family = isIP(address ?? '');
    if (
      !family ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)))
    ) {
      throw new Error('Invalid TRUSTED_PROXIES: use explicit IP addresses or non-universal CIDRs');
    }
  }
  const privateUrls = process.env.ALLOW_PRIVATE_MODEL_URLS;
  if (privateUrls !== undefined && !['true', 'false'].includes(privateUrls))
    throw new Error('Invalid ALLOW_PRIVATE_MODEL_URLS');
  const accessLogRetentionDays =
    overrides.accessLogRetentionDays ?? Number(process.env.ACCESS_LOG_RETENTION_DAYS ?? 7);
  if (
    !Number.isInteger(accessLogRetentionDays) ||
    accessLogRetentionDays < 1 ||
    accessLogRetentionDays > 365
  )
    throw new Error('Invalid ACCESS_LOG_RETENTION_DAYS');
  return {
    corsOrigins,
    trustedProxies,
    allowPrivateModelUrls: overrides.allowPrivateModelUrls ?? privateUrls === 'true',
    accessLogRetentionDays,
    databasePath,
    host: overrides.host ?? process.env.HOST ?? (production ? '127.0.0.1' : '0.0.0.0'),
    port,
    encryptionKey,
    production,
    publicUrl: overrides.publicUrl ?? process.env.PUBLIC_URL,
  };
}
