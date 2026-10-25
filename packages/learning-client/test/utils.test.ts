import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatOptionLabel, optionPrefix } from '#learning-client/utils';

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

describe('optionPrefix', () => {
  it('labels options by position, including choices beyond Z', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 99].map(optionPrefix)).toEqual([
      'A.',
      'B.',
      'Z.',
      'AA.',
      'AB.',
      'AZ.',
      'BA.',
      'CV.',
    ]);
  });

  it('joins the prefix and option text with a visible space', () => {
    expect(formatOptionLabel(0, '选项')).toBe('A. 选项');
  });
});
