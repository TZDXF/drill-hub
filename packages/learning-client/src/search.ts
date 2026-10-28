import Fuse, { type FuseResultMatch, type RangeTuple } from 'fuse.js';

export function createListSearch<T>(items: T[], keys: string[]): Fuse<T> {
  return new Fuse(items, {
    keys,
    includeMatches: true,
    threshold: 0.25,
    ignoreLocation: true,
    findAllMatches: true,
  });
}

export function matchRanges(
  matches: readonly FuseResultMatch[] | undefined,
  key: string,
): readonly RangeTuple[] {
  return matches?.find((match) => match.key === key)?.indices ?? [];
}

export interface HighlightPart {
  text: string;
  highlighted: boolean;
}

export function highlightParts(
  text: string,
  query = '',
  indices?: readonly RangeTuple[],
): HighlightPart[] {
  let ranges = indices;
  if (!ranges) {
    const literal = query.trim();
    if (!literal) return [{ text, highlighted: false }];
    const pattern = new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    ranges = Array.from(text.matchAll(pattern), (match) => [
      match.index,
      match.index + match[0].length - 1,
    ]);
  }
  const merged: RangeTuple[] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < 0 || end < start || start >= text.length) continue;
    const last = merged.at(-1);
    const limit = Math.min(end, text.length - 1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], limit);
    else merged.push([start, limit]);
  }
  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), highlighted: false });
    parts.push({ text: text.slice(start, end + 1), highlighted: true });
    cursor = end + 1;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false });
  return parts;
}
