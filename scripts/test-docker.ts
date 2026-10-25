import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const image = process.argv[2] ?? 'drill-hub:nightly-test';
const suffix = randomBytes(8).toString('hex');
const container = `drill-hub-smoke-${suffix}`;
const volume = `${container}-data`;
const username = `docker_${suffix}`;
const password = randomBytes(24).toString('hex');
const encryptionKey = randomBytes(32).toString('hex');
const env = {
  ...process.env,
  DRILL_HUB_IMAGE: image,
  DRILL_HUB_ENCRYPTION_KEY: encryptionKey,
  ADMIN_USERNAME: username,
  ADMIN_PASSWORD: password,
};

function docker(...args: string[]): string {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    env,
    timeout: 120_000,
  });
  assert.equal(result.status, 0, `Docker 命令失败：${args.slice(0, 2).join(' ')}`);
  return result.stdout.trim();
}

async function start(bootstrap: boolean): Promise<string> {
  const args = [
    'run',
    '--detach',
    '--name',
    container,
    '--publish',
    '127.0.0.1::3000',
    '--mount',
    `type=volume,source=${volume},target=/app/data`,
    '--env',
    'NODE_ENV=production',
    '--env',
    'HOST=0.0.0.0',
    '--env',
    'PORT=3000',
    '--env',
    'PUBLIC_URL=http://localhost:3000',
    '--env',
    'DRILL_HUB_ENCRYPTION_KEY',
  ];
  if (bootstrap) args.push('--env', 'ADMIN_USERNAME', '--env', 'ADMIN_PASSWORD');
  docker(...args, image);
  const user = docker('inspect', '--format', '{{.Config.User}}', container);
  assert.ok(user && !['root', '0'].includes(user.split(':')[0]!), '镜像必须使用非 root 用户');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    assert.equal(
      docker('inspect', '--format', '{{.State.Status}}', container),
      'running',
      '容器未能保持运行',
    );
    const health = docker('inspect', '--format', '{{.State.Health.Status}}', container);
    if (health === 'healthy') {
      const address = docker('port', container, '3000/tcp');
      assert.match(address, /^127\.0\.0\.1:\d+$/);
      return `http://${address}`;
    }
    assert.notEqual(health, 'unhealthy', '容器健康检查失败');
    await setTimeout(1000);
  }
  throw new Error('等待容器健康检查超时');
}

async function data<T>(response: Response): Promise<T> {
  assert.equal(response.status, 200, 'API 响应应成功');
  return ((await response.json()) as { data: T }).data;
}

async function request(base: string, path: string, options?: RequestInit): Promise<Response> {
  return fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(10_000) });
}

type ComposeConfig = {
  services: Record<string, { image: string; build?: unknown; environment: Record<string, string> }>;
};
function composeConfig(
  files: string[],
  options: { env?: Record<string, string> } = {},
): ComposeConfig {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      '.env.example',
      ...files.flatMap((file) => ['--file', file]),
      'config',
      '--format',
      'json',
    ],
    { encoding: 'utf8', env: { ...env, ...options.env }, timeout: 120_000 },
  );
  assert.equal(result.status, 0, `Docker 命令失败：compose config ${files.join(' ')}`);
  return JSON.parse(result.stdout) as ComposeConfig;
}

async function main() {
  const compose = composeConfig(['docker-compose.yml']);
  const service = compose.services['drill-hub']!;
  assert.equal(service.image, image, 'Compose 应支持覆盖镜像标签');
  assert.equal(service.build, undefined, '线上镜像部署不应依赖源码构建');
  assert.equal(service.environment.DATABASE_PATH, '/app/data/drill-hub.sqlite');
  assert.equal(service.environment.NODE_ENV, 'production');
  assert.equal(service.environment.DATABASE_DRIVER, 'sqlite', '默认应启用 SQLite');
  assert.ok(!('postgres' in compose.services), '默认启动不应包含 PostgreSQL 服务');
  const withPostgres = composeConfig(['docker-compose.yml'], {
    env: { DATABASE_DRIVER: 'postgres', POSTGRES_PASSWORD: 'pg-smoke' },
  });
  assert.equal(
    withPostgres.services['drill-hub']?.environment.DATABASE_DRIVER,
    'postgres',
    'DATABASE_DRIVER=postgres 应切换服务端数据库驱动',
  );
  assert.match(
    withPostgres.services['drill-hub']?.environment.DATABASE_URL ?? '',
    /^postgres:\/\//,
    'PostgreSQL 模式应提供默认连接串',
  );
  const dev = composeConfig(['docker-compose.dev.yml']);
  assert.ok(dev.services['drill-hub']?.build, '开发配置应从源码构建启动');
  assert.equal(
    dev.services['drill-hub']?.environment.DATABASE_DRIVER,
    'sqlite',
    '开发配置默认应启用 SQLite',
  );
  assert.ok(!('postgres' in dev.services), '开发配置默认不应包含 PostgreSQL 服务');

  const missingKey = spawnSync(
    'docker',
    ['compose', '--env-file', '.env.example', 'config', '--format', 'json'],
    { encoding: 'utf8', env: { ...env, DRILL_HUB_ENCRYPTION_KEY: '' }, timeout: 30_000 },
  );
  assert.notEqual(missingKey.status, 0, 'Compose 应拒绝缺少生产主密钥的配置');
  assert.match(missingKey.stderr, /DRILL_HUB_ENCRYPTION_KEY/);

  docker('volume', 'create', volume);
  let cleanupFailed = false;
  try {
    let base = await start(true);
    // 在镜像的普通用户和真实数据卷下构建助手会话，不调用模型供应商。
    docker(
      'exec',
      container,
      'node',
      '--input-type=module',
      '-e',
      `
        import assert from 'node:assert/strict';
        import { readFile } from 'node:fs/promises';
        import { dirname, join } from 'node:path';
        import { PiSessionFactory } from './apps/server/dist/modules/assistant/pi-session.js';
        const connection = {
          id: 'docker-smoke', enabled: true, baseUrl: 'https://provider.invalid/v1',
          encryptedApiKey: null,
        };
        const model = {
          id: 'docker-model', connectionId: connection.id, modelKey: 'smoke-model',
          displayName: 'Smoke model', enabled: true, createdAt: '2026-01-01T00:00:00Z',
        };
        const factory = new PiSessionFactory({
          config: { databasePath: process.env.DATABASE_PATH },
          db: { list: async (table) => ({
            modelConnections: [connection], providerModels: [model],
            assistantSkills: [], mcpServers: [],
          })[table] ?? [] },
        });
        const { session } = await factory.buildSession({ app: {}, customTools: [] });
        session.dispose();
        const modelsPath = join(dirname(process.env.DATABASE_PATH), 'assistant-runtime', 'models.json');
        assert.match(await readFile(modelsPath, 'utf8'), /smoke-model/);
      `,
    );
    const deployment = docker('exec', container, 'cat', '/app/deploy/docker-compose.yml');
    assert.match(deployment, /ghcr\.io\/tzdxf\/drill-hub:nightly/, '镜像应包含部署配置');
    assert.match(
      deployment,
      /postgres:17-alpine/,
      '镜像部署配置应包含可解除注释的 PostgreSQL 配置',
    );
    const template = docker('exec', container, 'cat', '/app/deploy/.env.example');
    assert.match(template, /DRILL_HUB_ENCRYPTION_KEY/, '镜像应包含现有环境变量模板');
    assert.ok(!template.includes(encryptionKey), '部署模板不得包含实际主密钥');
    assert.equal((await request(base, '/api/v1/health')).status, 200);
    const page = await request(base, '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    const html = await page.text();
    const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
    assert.ok(script, '镜像必须包含构建后的 Web 入口');
    const asset = await request(base, script);
    assert.equal(asset.status, 200, 'Web 入口引用的脚本应可访问');
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);
    const spa = await request(base, '/login');
    assert.equal(spa.status, 200);
    assert.match(spa.headers.get('content-type') ?? '', /text\/html/);
    assert.equal((await request(base, '/api/v1/me')).status, 401);

    const info = await data<{ instanceId: string }>(await request(base, '/api/v1/server-info'));
    const login = await request(base, '/api/v1/auth/web/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const session = await data<{
      csrfToken: string;
      user: { id: string; role: string; revision: number };
    }>(login);
    assert.equal(session.user.role, 'admin', '空数据库应初始化管理员');
    assert.ok(session.csrfToken);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    assert.ok(cookie, 'Web 登录应设置会话 Cookie');
    const displayName = `Docker 验收 ${suffix}`;
    const rejected = await request(base, '/api/v1/me', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ displayName, expectedRevision: session.user.revision }),
    });
    assert.equal(rejected.status, 403, 'Cookie 写入缺少 CSRF 时应拒绝');
    await data(
      await request(base, '/api/v1/me', {
        method: 'PATCH',
        headers: {
          cookie,
          'content-type': 'application/json',
          'x-csrf-token': session.csrfToken,
        },
        body: JSON.stringify({ displayName, expectedRevision: session.user.revision }),
      }),
    );

    docker('rm', '--force', container);
    base = await start(false);
    const persistedInfo = await data<{ instanceId: string }>(
      await request(base, '/api/v1/server-info'),
    );
    assert.equal(persistedInfo.instanceId, info.instanceId, '重建容器应保留数据库身份');
    const user = await data<{ id: string; displayName: string }>(
      await request(base, '/api/v1/me', { headers: { cookie } }),
    );
    assert.equal(user.id, session.user.id, '重建容器应保留账号和原会话');
    assert.equal(user.displayName, displayName, '重建容器应保留已写入的数据');
  } finally {
    for (const args of [
      ['rm', '--force', container],
      ['volume', 'rm', volume],
    ]) {
      const result = spawnSync('docker', args, { stdio: 'ignore', timeout: 30_000 });
      if (result.status !== 0) cleanupFailed = true;
    }
    if (cleanupFailed) {
      console.error('Docker 验收资源清理失败，请检查临时容器和卷');
      process.exitCode = 1;
    }
  }
  if (!cleanupFailed)
    console.log(
      'Docker 验收通过：Compose、非 root、助手会话初始化、健康检查、Web、登录、CSRF 和数据卷持久化。',
    );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Docker 验收失败');
  process.exitCode = 1;
});
