import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate } from '../src/utils';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('formatDate', () => {
  it('keeps date-only values on the same calendar day in negative UTC offsets', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');

    expect(formatDate('2026-10-20', false)).toBe('2026/10/20');
    expect(formatDate('2024-02-29', false)).toBe('2024/02/29');
    expect(formatDate('2026-10-20T00:00:00.000Z', false)).toBe('2026/10/19');
  });
});
