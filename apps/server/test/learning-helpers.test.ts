import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Attempt, AttemptItemSnapshot, GradeResult } from '@drill-hub/contracts';
import { Database } from '#server/db/database.js';
import { baseRecord } from '#server/core/ids.js';
import { optionalScheduledDate } from '#server/modules/learning/common.js';
import {
  refreshAttempt,
  syncWrongQuestions,
  updateAttemptStatus,
} from '#server/modules/learning/helpers.js';

const databases: Database[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

async function openDatabase() {
  const db = await Database.open(':memory:');
  databases.push(db);
  return db;
}

function grade(score: string, createdAt = '2026-10-17T12:00:00.000Z'): GradeResult {
  return {
    version: 1,
    source: 'rule',
    score,
    maxScore: '10.00',
    criterionResults: [],
    feedback: '',
    createdAt,
  };
}

function item(
  id: string,
  questionId: string,
  result: GradeResult | null,
  lockedAt: string,
): AttemptItemSnapshot {
  return {
    id,
    questionId,
    questionVersion: 1,
    definition: {
      type: 'true_false',
      stem: 'test',
      gradingMode: 'rule',
      gradingKey: { value: true },
    },
    maxScore: '10.00',
    answer: { value: false },
    answerRevision: 1,
    lockedAt,
    gradingStatus: result ? 'completed' : 'pending',
    generation: result ? 1 : 0,
    grade: result,
    gradingHistory: [],
  };
}

function attempt(id: string, ownerId: string, practiceItem: AttemptItemSnapshot): Attempt {
  return {
    ...baseRecord(),
    id,
    ownerId,
    topicId: 'topic-1',
    assessmentId: null,
    answerLinkId: null,
    purpose: 'learning',
    taskId: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    title: 'practice',
    kind: 'practice',
    status: 'in_progress',
    startedAt: '2026-10-17T11:00:00.000Z',
    expiresAt: null,
    submittedAt: null,
    submissionReason: null,
    items: [practiceItem],
  };
}

describe('updateAttemptStatus', () => {
  it('keeps practice in progress and treats previous grades as final during regrading', () => {
    const current = attempt(
      'a1',
      'u1',
      item('i1', 'q1', grade('10.00'), '2026-10-17T12:00:00.000Z'),
    );
    expect(updateAttemptStatus(current).status).toBe('in_progress');
    current.submittedAt = '2026-10-17T12:01:00.000Z';
    current.submissionReason = 'user_submitted';
    current.items[0].gradingStatus = 'running';
    expect(updateAttemptStatus(current).status).toBe('completed');
    current.items[0].grade = null;
    expect(updateAttemptStatus(current).status).toBe('pending_grading');
    expect(current.status).toBe('in_progress');
  });
});

describe('PostgreSQL question lookup', () => {
  // Supply an explicitly dedicated test database; each run owns and removes only its random schema.
  it.skipIf(!process.env.TEST_POSTGRES_URL)(
    'filters JSON item arrays and owner without losing attempts',
    async () => {
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
        const a = attempt('a', 'u1', item('i1', "q'1", grade('0.00'), '2026-10-17T12:00:00.000Z'));
        const b = attempt('b', 'u1', item('i2', 'q2', grade('0.00'), '2026-10-17T12:00:00.000Z'));
        const c = attempt('c', 'u2', item('i3', "q'1", grade('0.00'), '2026-10-17T12:00:00.000Z'));
        for (const value of [a, b, c]) await db.insert('attempts', value);
        expect((await db.listAttemptsForQuestions('u1', ["q'1"])).map((value) => value.id)).toEqual(
          ['a'],
        );
        await syncWrongQuestions(db, a);
        expect(await db.list('wrongQuestions')).toMatchObject([
          { ownerId: 'u1', questionId: "q'1", wrongCount: 1 },
        ]);
        expect(await db.list('attempts')).toHaveLength(3);
      } finally {
        await db?.close();
        if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        await pool.end();
      }
    },
  );
});

describe('syncWrongQuestions', () => {
  it('selects active and due jobs without dropping terminal history', async () => {
    const db = await openDatabase();
    const common = {
      ownerId: 'u1',
      attemptId: 'a',
      itemId: 'i',
      generation: 1,
      profileId: null,
      attemptCount: 0,
      leaseExpiresAt: null,
      lastErrorCode: null,
    };
    for (const [id, status, nextRunAt] of [
      ['due', 'queued', '2026-10-17T12:00:00.000Z'],
      ['future', 'retry_wait', '2026-10-19T12:00:00.000Z'],
      ['running', 'running', '2026-10-17T12:00:00.000Z'],
      ['done', 'succeeded', '2026-10-17T12:00:00.000Z'],
    ] as const) {
      await db.insert('gradingJobs', {
        ...baseRecord(),
        ...common,
        id,
        itemId: id,
        status,
        nextRunAt,
      });
    }
    expect((await db.listDueGradingJobs('2026-10-18T00:00:00.000Z')).map((job) => job.id)).toEqual([
      'due',
    ]);
    expect((await db.listActiveGradingJobs()).map((job) => job.id).sort()).toEqual([
      'due',
      'future',
      'running',
    ]);
    expect(await db.countRunningGradingJobs(null)).toBe(1);
    expect(await db.countRunningGradingJobs('other')).toBe(0);
    expect(await db.get('gradingJobs', 'done')).toBeDefined();
  });

  it('selects only matching owner and question attempts without changing historical facts', async () => {
    const db = await openDatabase();
    const a = attempt('a', 'u1', item('i1', 'q1', grade('0.00'), '2026-10-17T12:00:00.000Z'));
    const b = attempt('b', 'u1', item('i2', 'q2', grade('0.00'), '2026-10-17T12:00:00.000Z'));
    const c = attempt('c', 'u2', item('i3', 'q1', grade('0.00'), '2026-10-17T12:00:00.000Z'));
    for (const value of [a, b, c]) await db.insert('attempts', value);
    expect((await db.listAttemptsForQuestions('u1', ['q1'])).map((value) => value.id)).toEqual([
      'a',
    ]);
    expect(await db.listAttemptsForQuestions('u1', [])).toEqual([]);
    await syncWrongQuestions(db, a);
    expect(await db.list('wrongQuestions')).toMatchObject([
      { ownerId: 'u1', questionId: 'q1', wrongCount: 1 },
    ]);
    expect(await db.list('attempts')).toHaveLength(3);
  });

  it.each(['0.00', '10.00'])(
    'includes owner-attributed link grades (%s) when rebuilding learning projections',
    async (score) => {
      const db = await openDatabase();
      const linkAttempt = attempt(
        'link-attempt',
        'u1',
        item('link-item', 'q1', grade(score), '2026-10-17T13:00:00.000Z'),
      );
      linkAttempt.answerLinkId = 'temporary-link';
      await db.insert('attempts', linkAttempt);
      await syncWrongQuestions(db, linkAttempt);
      expect(await db.list('wrongQuestions')).toHaveLength(score === '0.00' ? 1 : 0);

      const personal = attempt(
        'personal',
        'u1',
        item('personal-item', 'q1', grade('4.00'), '2026-10-17T12:00:00.000Z'),
      );
      await db.insert('attempts', personal);
      await syncWrongQuestions(db, personal);
      expect(await db.findOne('wrongQuestions', { ownerId: 'u1', questionId: 'q1' })).toMatchObject(
        {
          wrongCount: score === '0.00' ? 2 : 1,
          lastWrongAt: score === '0.00' ? '2026-10-17T13:00:00.000Z' : '2026-10-17T12:00:00.000Z',
          lastPracticedAt: '2026-10-17T13:00:00.000Z',
        },
      );
    },
  );

  it('is idempotent, preserves mistakes after correct practice, and rebuilds after regrading', async () => {
    const db = await openDatabase();
    const wrong = attempt('a1', 'u1', item('i1', 'q1', grade('4.00'), '2026-10-17T12:00:00.000Z'));
    wrong.submittedAt = '2026-10-17T12:00:00.000Z';
    wrong.submissionReason = 'user_submitted';
    await db.insert('attempts', wrong);

    await syncWrongQuestions(db, wrong);
    await syncWrongQuestions(db, wrong);
    const created = await db.findOne('wrongQuestions', { ownerId: 'u1', questionId: 'q1' });
    expect(created).toMatchObject({ wrongCount: 1, masteryStatus: 'pending' });

    const correct = attempt(
      'a2',
      'u1',
      item('i2', 'q1', grade('10.00'), '2026-10-17T13:00:00.000Z'),
    );
    correct.submittedAt = '2026-10-17T13:00:00.000Z';
    correct.submissionReason = 'user_submitted';
    await db.insert('attempts', correct);
    await syncWrongQuestions(db, correct);
    expect(await db.findOne('wrongQuestions', { ownerId: 'u1', questionId: 'q1' })).toMatchObject({
      wrongCount: 1,
      lastPracticedAt: '2026-10-17T13:00:00.000Z',
    });

    wrong.items[0].grade = { ...grade('10.00'), version: 2 };
    await syncWrongQuestions(db, wrong);
    expect(await db.findOne('wrongQuestions', { ownerId: 'u1', questionId: 'q1' })).toBeUndefined();
  });

  it('refreshAttempt persists status and item grades with CAS', async () => {
    const db = await openDatabase();
    const current = attempt('a1', 'u1', item('i1', 'q1', null, '2026-10-17T12:00:00.000Z'));
    current.submittedAt = '2026-10-17T12:00:00.000Z';
    current.submissionReason = 'user_submitted';
    await db.insert('attempts', current);
    current.items[0].grade = grade('0.00');
    current.items[0].gradingStatus = 'completed';
    const saved = await db.transaction((tx) => refreshAttempt(tx, current));
    expect(saved.status).toBe('completed');
    expect(saved.revision).toBe(current.revision + 1);
    expect((await db.get('attempts', current.id))?.items[0].grade?.score).toBe('0.00');
  });
});

describe('optionalScheduledDate', () => {
  it('accepts real calendar dates and rejects normalized invalid dates', () => {
    expect(optionalScheduledDate('2024-02-29')).toBe('2024-02-29');
    expect(optionalScheduledDate('2026-10-20')).toBe('2026-10-20');
    for (const value of ['2026-02-29', '2026-02-31', '2026-04-31']) {
      expect(() => optionalScheduledDate(value)).toThrowError(
        expect.objectContaining({ code: 'INVALID_DATE' }),
      );
    }
  });
});
