import { checkIdImage, checkPresentation, validateMap } from '@mbrg/shared';
import { fromRgb } from './png-check';
import type { BuildError, PngCodec } from './types';

/**
 * FR-122: the checks on the in-memory outputs, in this order. An invalid map reports its errors
 * once and nothing else (the presentation and id image checks would only repeat them). Otherwise:
 * the presentation errors, then the id image errors, then the round trip of the encoded image:
 * `invalid-png` when it does not read back, `png-round-trip-mismatch` when it reads back to other
 * values or another size. An empty list means the package is valid. Pure (NFR-14).
 */
export function selfCheck(
  map: unknown,
  presentation: unknown,
  width: number,
  pixels: Uint32Array,
  png: Uint8Array,
  codec: PngCodec,
): BuildError[] {
  const mapResult = validateMap(map);
  if (!mapResult.ok) return [...mapResult.errors];

  const errors: BuildError[] = [];
  const named = checkPresentation(map, presentation);
  if (!named.ok) errors.push(...named.errors);
  const image = checkIdImage(map, width, width, pixels);
  if (!image.ok) errors.push(...image.errors);

  const decoded = codec.decode(png);
  if (!decoded.ok) {
    errors.push(...decoded.errors);
  } else if (
    decoded.value.width !== width ||
    decoded.value.height !== width ||
    decoded.value.rgb.length !== 3 * pixels.length ||
    !sameValues(fromRgb(decoded.value.rgb), pixels)
  ) {
    errors.push({ kind: 'png-round-trip-mismatch' });
  }
  return errors;
}

function sameValues(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
