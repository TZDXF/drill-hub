import type { LocationQueryValue } from 'vue-router';

export function questionIndexFromQuery(
  value: LocationQueryValue | LocationQueryValue[] | undefined,
  itemCount: number,
): number {
  const query = Array.isArray(value) ? value[0] : value;
  if (!query || !/^[1-9]\d*$/.test(query)) return 0;
  const index = Number(query) - 1;
  return Number.isSafeInteger(index) && index < itemCount ? index : 0;
}
