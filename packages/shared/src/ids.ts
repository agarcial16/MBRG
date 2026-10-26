export const MAX_ID = 0xffffff;

/** FR-3: number type, integer, 1..16,777,215 inclusive. 0 is reserved. */
export function isValidId(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= MAX_ID;
}
