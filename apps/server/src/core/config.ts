import { randomBytes } from 'node:crypto';
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
  return {
    databasePath,
    host: overrides.host ?? process.env.HOST ?? (production ? '127.0.0.1' : '0.0.0.0'),
    port,
    encryptionKey,
    production,
    publicUrl: overrides.publicUrl ?? process.env.PUBLIC_URL,
  };
}
