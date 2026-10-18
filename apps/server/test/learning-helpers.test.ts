import { afterEach, describe, expect, it } from 'vitest';
import type { Attempt, AttemptItemSnapshot, GradeResult } from '@drill-hub/contracts';
import { Database } from '../src/db/database.js';
import { baseRecord } from '../src/core/ids.js';
import { optionalScheduledDate } from '../src/modules/learning/common.js';
import {
  refreshAttempt,
  syncWrongQuestions,
  updateAttemptStatus,
} from '../src/modules/learning/helpers.js';

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

describe('syncWrongQuestions', () => {
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
