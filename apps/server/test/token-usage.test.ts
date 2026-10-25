import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '#server/app.js';
import { Database } from '#server/db/database.js';
import type { ModelUsageRecord } from '#server/db/records.js';
import { baseRecord } from '#server/core/ids.js';
import { tokenUsageReport } from '#server/modules/grading/token-usage.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function seed(db: Database, overrides: Partial<ModelUsageRecord> = {}) {
  return db.insert('modelUsage', {
    ...baseRecord(),
    createdAt: '2026-10-19T02:00:00.000Z',
    ownerId: 'alice',
    connectionId: 'connection-a',
    modelKey: 'model-a',
    purpose: 'grading',
    jobId: 'job-a',
    status: 'succeeded',
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    ...overrides,
  });
}
const timestamp = new Date('2026-10-19T10:00:00.000Z');

describe('token usage aggregation', () => {
  it('separates owners, counts failed/unknown/zero calls, groups connections and fills empty dates', async () => {
    const db = await Database.open(':memory:');
    try {
      await seed(db);
      await seed(db, { status: 'failed' }); // A failed grade can still consume tokens.
      await seed(db, { usage: null, status: 'failed' });
      await seed(db, {
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        purpose: 'model_test',
      });
      await seed(db, { ownerId: 'bob', connectionId: 'connection-b' });
      await seed(db, { createdAt: '2026-09-01T00:00:00.000Z' });
      const own = await tokenUsageReport(db, 'alice', { days: '7' }, timestamp);
      expect(own.totals).toEqual({
        promptTokens: 200,
        completionTokens: 40,
        totalTokens: 240,
        calls: 4,
        failedCalls: 2,
        unknownUsageCalls: 1,
      });
      expect(own.daily).toHaveLength(7);
      expect(own.daily[0]).toMatchObject({ date: '2026-10-13', calls: 0, totalTokens: 0 });
      expect(own.daily.at(-1)).toMatchObject({ date: '2026-10-19', calls: 4 });
      expect(own.models).toHaveLength(1);
      const all = await tokenUsageReport(db, undefined, { days: '7' }, timestamp);
      expect(all.totals.calls).toBe(5);
      expect(all.models).toHaveLength(2);
      expect(all.models[0]).toMatchObject({ connectionId: 'connection-a', totalTokens: 240 });
      const empty = await tokenUsageReport(db, 'nobody', {}, timestamp);
      expect(empty.totals.calls).toBe(0);
      expect(empty.daily).toHaveLength(30);
      expect(empty.models).toEqual([]);
    } finally {
      await db.close();
    }
  });
  it.each([480, -300])(
    'uses offset %s at inclusive start and exclusive end of the date range',
    async (offset) => {
      const db = await Database.open(':memory:');
      try {
        const midnight = Date.parse('2026-10-19T00:00:00.000Z') - offset * 60_000;
        const start = midnight - 6 * 86_400_000;
        const end = midnight + 86_400_000;
        for (const time of [start - 1, start, midnight - 1, midnight, end - 1, end]) {
          await seed(db, { createdAt: new Date(time).toISOString() });
        }
        const report = await tokenUsageReport(
          db,
          'alice',
          { days: '7', utcOffsetMinutes: String(offset) },
          timestamp,
        );
        expect(report.fromDate).toBe('2026-10-13');
        expect(report.toDate).toBe('2026-10-19');
        expect(report.totals.calls).toBe(4);
        expect(report.daily.at(-1)?.calls).toBe(2);
        expect(report.daily.at(-2)?.calls).toBe(1);
      } finally {
        await db.close();
      }
    },
  );
});

describe('token usage endpoints', () => {
  it('requires a user session, restricts all-site stats to admins and rejects unsupported filters', async () => {
    const password = 'Token-usage-test-only-42!';
    const app = await createApp({
      databasePath: ':memory:',
      encryptionKey: 'b'.repeat(64),
      startWorkers: false,
      bootstrapAdmin: { username: 'usage-admin', password },
    });
    apps.push(app);
    const adminRecord = (await app.ctx.db.list('users'))[0]!;
    const user = await app.ctx.db.insert('users', {
      ...adminRecord,
      ...baseRecord(),
      username: 'usage-user',
      role: 'user',
    });
    async function session(username: string) {
      const result = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/web/login',
        payload: { username, password },
      });
      expect(result.statusCode).toBe(200);
      return {
        cookie: result.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
        'x-csrf-token': result.json().data.csrfToken,
      };
    }
    const admin = await session(adminRecord.username);
    const ordinary = await session(user.username);
    await seed(app.ctx.db, { ownerId: adminRecord.id, createdAt: new Date().toISOString() });
    await seed(app.ctx.db, {
      ownerId: user.id,
      createdAt: new Date().toISOString(),
      modelKey: 'private-user-model',
    });
    expect((await app.inject({ url: '/api/v1/me/token-usage' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/admin/token-usage', headers: ordinary })).statusCode,
    ).toBe(403);
    const own = await app.inject({ url: '/api/v1/me/token-usage', headers: ordinary });
    expect(own.statusCode).toBe(200);
    expect(own.json().data.totals.calls).toBe(1);
    expect(own.json().data.models).toHaveLength(1);
    expect(own.json().data.models[0].modelKey).toBe('private-user-model');
    expect(own.json().meta.requestId).toBeTypeOf('string');
    const all = await app.inject({ url: '/api/v1/admin/token-usage?days=90', headers: admin });
    expect(all.statusCode).toBe(200);
    expect(all.json().data.totals.calls).toBe(2);
    expect(all.json().data.daily).toHaveLength(90);
    expect(all.body).not.toContain('passwordHash');
    expect(all.body).not.toContain('ownerId');
    for (const query of [
      'days=1',
      'days=7&days=30',
      'utcOffsetMinutes=999',
      'utcOffsetMinutes=NaN',
      'utcOffsetMinutes=1.5',
      'ownerId=alice',
      'days=30.0',
    ]) {
      const result = await app.inject({
        url: `/api/v1/me/token-usage?${query}`,
        headers: ordinary,
      });
      expect(result.statusCode).toBe(400);
      expect(result.json().error.code).toBe('INVALID_QUERY');
    }
    const token = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens',
      headers: admin,
      payload: { name: 'usage-test', scopes: ['read'] },
    });
    expect(token.statusCode).toBe(200);
    const agentRequest = await app.inject({
      url: '/api/v1/me/token-usage',
      headers: { authorization: `Bearer ${token.json().data.token}` },
    });
    expect(agentRequest.statusCode).toBe(401);
  });
});
