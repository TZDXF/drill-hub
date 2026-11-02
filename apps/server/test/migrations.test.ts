import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import pg from 'pg';
import { Database } from '#server/db/database.js';
import { migrations } from '#server/db/migrations/index.js';

const migrationsDir = new URL('../src/db/migrations/', import.meta.url);
const fileClassNames = new Set<string>(
  await Promise.all(
    (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
      .map(async (name) => {
        const mod = (await import(`../src/db/migrations/${name}`)) as Record<string, unknown>;
        return Object.values(mod)
          .filter(
            (exp): exp is (new () => unknown) & { name: string } =>
              typeof exp === 'function' &&
              typeof (exp as { prototype?: { up?: unknown } }).prototype?.up === 'function',
          )
          .map((exp) => exp.name);
      }),
  ).then((names) => names.flat()),
);

describe('migrations 注册表', () => {
  it('migrations 目录中的每个类都已注册且按时间戳严格升序', () => {
    expect(fileClassNames.size).toBeGreaterThan(0);
    expect(new Set(migrations.map((migration) => migration.name))).toEqual(fileClassNames);
    const timestamps = migrations.map((migration) => Number(/(\d{13})$/.exec(migration.name)?.[1]));
    expect(timestamps.every((timestamp) => Number.isFinite(timestamp))).toBe(true);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(new Set(timestamps).size).toBe(timestamps.length);
  });
  it('类实例的 name 属性与类名一致（TypeORM 以该属性记录迁移名）', () => {
    for (const migration of migrations) expect(new migration().name).toBe(migration.name);
  });
});

describe('schema 漂移', () => {
  it('内存库跑完全部 migration 后实体元数据与库结构一致', async () => {
    const db = await Database.open({ driver: 'sqlite', database: ':memory:' });
    try {
      const diff = await db.schemaDiff();
      expect(diff.upQueries).toEqual([]);
      expect(diff.downQueries).toEqual([]);
    } finally {
      await db.close();
    }
  });
  // Supply an explicitly dedicated test database; each run owns and removes only its random schema.
  it.skipIf(!process.env.TEST_POSTGRES_URL)('postgres 同样无漂移', async () => {
    const url = process.env.TEST_POSTGRES_URL!;
    const schema = `drill_test_${randomUUID().replaceAll('-', '')}`;
    const pool = new pg.Pool({ connectionString: url });
    let db: Database | undefined;
    let created = false;
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      const scoped = new URL(url);
      scoped.searchParams.set('options', `-c search_path=${schema}`);
      db = await Database.open({ driver: 'postgres', url: scoped.toString() });
      const diff = await db.schemaDiff();
      expect(diff.upQueries).toEqual([]);
      expect(diff.downQueries).toEqual([]);
    } finally {
      await db?.close();
      if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  });
});
