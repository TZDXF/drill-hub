import { describe, expect, it } from 'vitest';
import { id } from '#server/core/ids.js';

describe('id', () => {
  it('generates URL-safe 16-character IDs from 96 random bits', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => id()));

    expect(ids).toHaveLength(1000);
    for (const value of ids) expect(value).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});
