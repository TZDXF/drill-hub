import { AppError } from '#server/core/errors.js';

const SCORE_PATTERN = /^(?:0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/;

/** Parse an external decimal score into integer hundredths. */
export function scoreToMinor(value: unknown, field = 'score', allowZero = true): number {
  if (typeof value !== 'string') {
    throw new AppError(422, 'INVALID_SCORE', `${field} must be a decimal string`, {
      [field]: 'Use a decimal string with at most two fractional digits.',
    });
  }
  if (!SCORE_PATTERN.test(value)) {
    throw new AppError(422, 'INVALID_SCORE', `${field} must have at most two decimal places`, {
      [field]: 'Invalid score.',
    });
  }
  const [whole, fraction = ''] = value.split('.');
  const parsed = Number(whole) * 100 + Number(fraction.padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(parsed)) {
    throw new AppError(422, 'INVALID_SCORE', `${field} is outside the supported range`, {
      [field]: 'Score is too large.',
    });
  }
  if (!allowZero && parsed === 0) {
    throw new AppError(422, 'INVALID_SCORE', `${field} must be greater than zero`, {
      [field]: 'Score must be greater than zero.',
    });
  }
  return parsed;
}

export function minorToScore(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError(500, 'SCORE_OVERFLOW', 'Score is outside the supported range');
  }
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

export function sumScores(values: string[]): string {
  return minorToScore(values.reduce((sum, value) => sum + scoreToMinor(value), 0));
}

export function compareScores(left: string, right: string): number {
  return scoreToMinor(left) - scoreToMinor(right);
}
