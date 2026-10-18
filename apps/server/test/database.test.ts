import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/db/database.js';
import { baseRecord } from '../src/core/ids.js';
describe('SQLite storage and migrations', () => {
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
