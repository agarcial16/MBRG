import { imageInputError } from './image-input';
import type { InvalidImageError } from './package-errors';
import type { ContactPair } from './package-types';
import type { Result } from './types';

const SHIFT = 16777216; // 2^24: ids are below it, so min * SHIFT + max is exact in a double

/**
 * FR-108: the unordered pairs {A, B} of distinct non-zero values with at least one pair of
 * 4-adjacent pixels. Needs no map. Pairs are [a, b] with a < b, ascending by a then b.
 * Invalid input (FR-110 condition) reports `invalid-image` and returns no result.
 */
export function contactPairs(
  width: unknown,
  height: unknown,
  pixels: unknown,
): Result<ContactPair[], InvalidImageError> {
  const error = imageInputError(width, height, pixels);
  if (error) return { ok: false, errors: [error] };
  const w = width as number;
  const h = height as number;
  const p = pixels as ArrayLike<number>;
  const keys = new Set<number>();
  const add = (v: number, u: number): void => {
    if (u === 0 || u === v) return;
    keys.add(v < u ? v * SHIFT + u : u * SHIFT + v);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = p[i] as number;
      if (v === 0) continue;
      if (x + 1 < w) add(v, p[i + 1] as number);
      if (y + 1 < h) add(v, p[i + w] as number);
    }
  }
  const sorted = [...keys].sort((a, b) => a - b);
  return {
    ok: true,
    value: sorted.map((k): ContactPair => {
      const b = k % SHIFT;
      return [(k - b) / SHIFT, b];
    }),
  };
}
