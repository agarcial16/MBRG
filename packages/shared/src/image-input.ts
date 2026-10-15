import type { InvalidImageError } from './package-errors';

const MAX_VALUE = 0xffffff;

function isDimension(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1;
}

/**
 * FR-110 `invalid-image` condition: W or H not an integer >= 1; pixel values neither a
 * plain list nor a typed array; length != W x H; or any value not an integer 0..16,777,215
 * (text, null, BigInt, a hole, NaN, infinities, fractions and -0 all fail).
 * Walks by index so a sparse list cannot be skipped. Returns the error, or undefined.
 */
export function imageInputError(
  width: unknown,
  height: unknown,
  pixels: unknown,
): InvalidImageError | undefined {
  const bad: InvalidImageError = { kind: 'invalid-image' };
  if (!isDimension(width) || !isDimension(height)) return bad;
  const isList = Array.isArray(pixels);
  const isTyped = ArrayBuffer.isView(pixels) && !(pixels instanceof DataView);
  if (!isList && !isTyped) return bad;
  const list = pixels as ArrayLike<unknown>;
  if (list.length !== width * height) return bad;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (
      typeof v !== 'number' ||
      !Number.isInteger(v) ||
      Object.is(v, -0) ||
      v < 0 ||
      v > MAX_VALUE
    ) {
      return bad;
    }
  }
  return undefined;
}
