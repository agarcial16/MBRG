import type { InvalidImageError } from './package-errors';
import type { Rgb } from './package-types';
import type { Result } from './types';

const MAX_VALUE = 0xffffff;

/** An integer in [0, max] that is not -0. Rejects every non-number. */
function isIntegerIn(x: unknown, max: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && !Object.is(x, -0) && x >= 0 && x <= max;
}

function invalid(): { ok: false; errors: InvalidImageError[] } {
  return { ok: false, errors: [{ kind: 'invalid-image' }] };
}

/** FR-106: value 0..16,777,215 -> channels (R, G, B). Outside the domain: invalid-image. */
export function encodePixel(value: unknown): Result<Rgb, InvalidImageError> {
  if (!isIntegerIn(value, MAX_VALUE)) return invalid();
  return { ok: true, value: [(value >> 16) & 255, (value >> 8) & 255, value & 255] };
}

/** FR-106: channels (R, G, B), each an integer 0..255 -> R * 65,536 + G * 256 + B. */
export function decodePixel(r: unknown, g: unknown, b: unknown): Result<number, InvalidImageError> {
  if (!isIntegerIn(r, 255) || !isIntegerIn(g, 255) || !isIntegerIn(b, 255)) return invalid();
  return { ok: true, value: r * 65536 + g * 256 + b };
}
