import type { GroupingError, SeedError } from './types';

/** FR-113: error kinds in the order of the spec table. */
export const GROUPING_KIND_ORDER: readonly GroupingError['kind'][] = [
  'duplicate-country',
  'unknown-country',
  'duplicate-territory-key',
  'invalid-territory-country',
  'territory-color',
  'empty-territory',
  'missing-territory-name',
  'unknown-province',
  'duplicate-province-assignment',
  'province-country-mismatch',
  'unassigned-province',
  'empty-country',
];

/** FR-116: seed error kinds in the order of the spec. */
export const SEED_KIND_ORDER: readonly SeedError['kind'][] = [
  'no-sea-seeds',
  'seed-outside-frame',
  'seed-not-water',
  'duplicate-seed-pixel',
];

/** Code-unit order of two texts (never locale-aware). */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Own-property read of a value from untrusted data (never the prototype chain). */
export function own(object: object, key: string): unknown {
  return Object.hasOwn(object, key) ? (object as Record<string, unknown>)[key] : undefined;
}

/** FR-121 "present": an own field holding a non-empty text. */
export function presentText(object: object, key: string): string | undefined {
  const value = own(object, key);
  return typeof value === 'string' && value !== '' ? value : undefined;
}
