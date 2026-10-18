import { createApp } from '../apps/server/src/app.js';

const host = '127.0.0.1';
const port = 4179;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}；端到端测试服务必须使用 Playwright 生成的临时凭据`);
  return value;
}

async function main() {
  const username = requiredEnv('E2E_ADMIN_USERNAME');
  const password = requiredEnv('E2E_ADMIN_PASSWORD');
  const encryptionKey = requiredEnv('E2E_ENCRYPTION_KEY');
  if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    throw new Error('E2E_ENCRYPTION_KEY 必须是 64 位十六进制字符串');
  }

  const app = await createApp({
    databasePath: ':memory:',
    host,
    port,
    startWorkers: false,
    encryptionKey,
    bootstrapAdmin: { username, password, displayName: '端到端测试管理员' },
  });

  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    await app.close();
  }

  try {
    await app.listen({ host, port });
    console.log(`E2E server listening on http://${host}:${port}`);
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown()
        .then(() => {
          process.exitCode = 0;
        })
        .catch((error: unknown) => {
          console.error('E2E server failed to shut down cleanly', error);
          process.exitCode = 1;
        });
    });
  }
}

void main().catch((error: unknown) => {
  console.error('E2E server failed to start', error);
  process.exitCode = 1;
});
