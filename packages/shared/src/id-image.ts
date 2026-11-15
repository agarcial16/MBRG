import { contactPairs } from './contact';
import type { ValidationError } from './errors';
import { imageInputError } from './image-input';
import type { IdImageError } from './package-errors';
import type { IdImage } from './package-types';
import type { Result } from './types';
import { validateMap } from './validate';

/**
 * FR-107..FR-110: checks decoded id image values against a map.
 * Invalid map -> exactly the map errors; invalid image input -> `invalid-image` alone;
 * otherwise unknown ids, entries without pixels, then adjacency errors (contact vs links).
 * Adjacency errors are ordered by the map position of `a` (the earlier entry), then of `b`.
 */
export function checkIdImage(
  map: unknown,
  width: unknown,
  height: unknown,
  pixels: unknown,
): Result<IdImage, ValidationError | IdImageError> {
  const m = validateMap(map);
  if (!m.ok) return m;
  const bad = imageInputError(width, height, pixels);
  if (bad) return { ok: false, errors: [bad] };
  const w = width as number;
  const p = pixels as ArrayLike<number>;
  const entries = m.value.territories;

  const position = new Map<number, number>();
  for (let i = 0; i < entries.length; i++) position.set(entries[i]!.id, i);

  // One pass: pixel counts per value (insertion order = first pixel in row-major order).
  const counts = new Map<number, { count: number; first: number }>();
  for (let i = 0; i < p.length; i++) {
    const v = p[i] as number;
    if (v === 0) continue;
    const seen = counts.get(v);
    if (seen) seen.count++;
    else counts.set(v, { count: 1, first: i });
  }

  const errors: IdImageError[] = [];
  for (const [id, { count, first }] of counts) {
    if (position.has(id)) continue;
    errors.push({
      kind: 'unknown-pixel-id',
      id,
      pixelCount: count,
      firstPixel: { x: first % w, y: Math.floor(first / w) },
    });
  }
  for (let i = 0; i < entries.length; i++) {
    const id = entries[i]!.id;
    if (!counts.has(id)) errors.push({ kind: 'missing-territory-pixels', territory: id });
  }

  // Contact restricted to pairs of map entries, as map-position keys (a before b).
  const contact = new Set<string>();
  const pairs = contactPairs(width, height, pixels);
  if (pairs.ok) {
    for (const [x, y] of pairs.value) {
      const px = position.get(x);
      const py = position.get(y);
      if (px === undefined || py === undefined) continue;
      contact.add(px < py ? `${px}:${py}` : `${py}:${px}`);
    }
  }
  const linked = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const neighbors = entries[i]!.neighbors;
    for (let j = 0; j < neighbors.length; j++) {
      const q = position.get(neighbors[j]!);
      if (q !== undefined && q > i) linked.add(`${i}:${q}`);
    }
  }
  const byPosition = (keys: Set<string>, other: Set<string>): Array<[number, number]> =>
    [...keys]
      .filter((k) => !other.has(k))
      .map((k): [number, number] => {
        const [a, b] = k.split(':');
        return [Number(a), Number(b)];
      })
      .sort((s, t) => s[0] - t[0] || s[1] - t[1]);
  for (const [a, b] of byPosition(contact, linked)) {
    errors.push({ kind: 'missing-adjacency', a: entries[a]!.id, b: entries[b]!.id });
  }
  for (const [a, b] of byPosition(linked, contact)) {
    errors.push({ kind: 'extra-adjacency', a: entries[a]!.id, b: entries[b]!.id });
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { width: w, height: height as number, pixels: p } };
}
