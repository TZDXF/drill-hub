import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/db/database.js';
import { DataSource } from 'typeorm';
import { InitialSchema1792195200000, AddAnswerLinks1792195200001 } from '../src/db/schema.js';
import { baseRecord } from '../src/core/ids.js';
describe('SQLite storage and migrations', () => {
  it('opens via the options form with an explicit sqlite driver', async () => {
    const db = await Database.open({ driver: 'sqlite', database: ':memory:' });
    try {
      await db.insert('topics', {
        ...baseRecord(),
        ownerId: 'owner',
        title: '配置式打开',
        goalText: '',
        archivedAt: null,
      });
      expect(await db.list('topics')).toHaveLength(1);
    } finally {
      await db.close();
    }
  });
  it('rejects a postgres driver without a connection URL', async () => {
    await expect(Database.open({ driver: 'postgres' })).rejects.toThrow(
      'Postgres 数据库需要提供 DATABASE_URL',
    );
  });
  it('migrates, rolls back transactions and rejects stale versions', async () => {
    const db = await Database.open(':memory:');
    try {
      const topic = await db.insert('topics', {
        ...baseRecord(),
        ownerId: 'owner',
        title: '题目',
        goalText: '',
        archivedAt: null,
      });
      await expect(
        db.transaction(async (tx) => {
          await tx.insert('topics', {
            ...baseRecord(),
            id: 'rollback',
            ownerId: 'owner',
            title: '不可留下',
            goalText: '',
            archivedAt: null,
          });
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await db.get('topics', 'rollback')).toBeUndefined();
      const updates = await Promise.allSettled([
        db.update('topics', topic.id, topic.revision, { title: 'first' }),
        db.update('topics', topic.id, topic.revision, { title: 'second' }),
      ]);
      expect(updates.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(updates.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect((await db.get('topics', topic.id))?.revision).toBe(2);
      expect(await db.list('topics', { ownerId: 'another' })).toEqual([]);
    } finally {
      await db.close();
    }
  });
  it('preserves data after closing and reopening a migrated database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'drill-hub-db-test-'));
    const filename = join(directory, 'test.sqlite');
    let db = await Database.open(filename);
    try {
      const topic = await db.insert('topics', {
        ...baseRecord(),
        ownerId: 'owner',
        title: '持久学习',
        goalText: '',
        archivedAt: null,
      });
      await db.close();
      db = await Database.open(filename);
      expect((await db.get('topics', topic.id))?.title).toBe('持久学习');
    } finally {
      await db.close();
      for (const suffix of ['', '-wal', '-shm']) await rm(filename + suffix, { force: true });
      await rmdir(directory);
    }
  });
});

it('adds model usage to an existing development schema without losing learning data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'drill-hub-usage-migration-'));
  const path = join(directory, 'development.sqlite');
  const old = new DataSource({
    type: 'better-sqlite3',
    database: path,
    synchronize: false,
    migrations: [InitialSchema1792195200000, AddAnswerLinks1792195200001],
  });
  try {
    await old.initialize();
    await old.runMigrations();
    await old
      .createQueryBuilder()
      .insert()
      .into('topics')
      .values({
        ...baseRecord(),
        id: 'preserved-topic',
        ownerId: 'owner',
        title: '保留的主题',
        goalText: '',
        archivedAt: null,
      })
      .execute();
    await old.destroy();
    const db = await Database.open(path);
    try {
      expect((await db.get('topics', 'preserved-topic'))?.title).toBe('保留的主题');
      await db.insert('modelUsage', {
        ...baseRecord(),
        ownerId: 'owner',
        connectionId: 'connection',
        modelKey: 'model',
        purpose: 'grading',
        jobId: null,
        status: 'succeeded',
        usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
      });
    } finally {
      await db.close();
    }
    const reopened = await Database.open(path);
    try {
      expect(await reopened.list('modelUsage')).toHaveLength(1);
    } finally {
      await reopened.close();
    }
  } finally {
    if (old.isInitialized) await old.destroy();
    await rm(path, { force: true });
    await rmdir(directory);
  }
});
