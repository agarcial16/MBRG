import type { Result } from '@mbrg/shared';
import { SEED_KIND_ORDER } from './errors';
import { project, toPixel, type Frame, type ProjectionCenter } from './projection';
import { WATER } from './rasterize';
import type { SeaSeed, SeedError, SeedPixel } from './types';

/**
 * FR-116: sea zones. `seedPixels` locates and checks the seeds; `assignSeaZones` gives every water
 * pixel to the seed reached in the fewest 4-adjacent steps through water, ties to the seed listed
 * first, and turns water no seed can reach into background. Pure and deterministic (NFR-14).
 */

/**
 * The pixel of each seed (FR-114: a point on a pixel edge lies in the pixel to its east or
 * south; on the frame's east or south edge it is outside). Reports, in `SEED_KIND_ORDER` and then
 * by the position of the first seed named, every seed that is outside the frame or not on a water
 * pixel, and every group of seeds sharing a pixel.
 */
export function seedPixels(
  seeds: readonly SeaSeed[],
  center: ProjectionCenter,
  frame: Frame,
  width: number,
  pixels: Uint32Array,
): Result<SeedPixel[], SeedError> {
  if (seeds.length === 0) return { ok: false, errors: [{ kind: 'no-sea-seeds' }] };
  const errors: SeedError[] = [];
  const located: SeedPixel[] = [];
  const bySharedPixel = new Map<number, number[]>();
  seeds.forEach((seed, index) => {
    const [px, py] = project(center, seed.lon, seed.lat);
    const at = toPixel(frame, width, px, py);
    located.push({ x: at.x, y: at.y });
    if (!at.inside) {
      errors.push({ kind: 'seed-outside-frame', seed: index, name: seed.name });
      return;
    }
    const pixel = at.y * width + at.x;
    if (pixels[pixel] !== WATER) {
      errors.push({ kind: 'seed-not-water', seed: index, name: seed.name });
    }
    const group = bySharedPixel.get(pixel);
    if (group) group.push(index);
    else bySharedPixel.set(pixel, [index]);
  });
  for (const group of bySharedPixel.values()) {
    if (group.length < 2) continue;
    const first = located[group[0]!]!;
    errors.push({ kind: 'duplicate-seed-pixel', seeds: group, x: first.x, y: first.y });
  }
  if (errors.length === 0) return { ok: true, value: located };
  const rank = (e: SeedError): number => SEED_KIND_ORDER.indexOf(e.kind);
  const position = (e: SeedError): number => (e.kind === 'no-sea-seeds' ? 0 : 'seeds' in e ? e.seeds[0]! : e.seed);
  errors.sort((a, b) => rank(a) - rank(b) || position(a) - position(b));
  return { ok: false, errors };
}

/**
 * Layered multi-source breadth-first search. Layer 0 is the seed pixels; each next layer is the
 * unlabelled water pixels 4-adjacent to the previous layer, and each takes the smallest seed
 * position among the previous-layer pixels around it (so a tie goes to the seed listed first,
 * whatever order the pixels are visited in). `ids[i]` is the map id of seed `i`. Returns a new
 * array: water pixels become a sea zone id, or 0 (background) when no seed can reach them.
 * Land and background pixels are copied unchanged.
 */
export function assignSeaZones(
  width: number,
  pixels: Uint32Array,
  seeds: readonly SeedPixel[],
  ids: readonly number[],
): Uint32Array {
  const total = width * width;
  const label = new Int32Array(total).fill(-1);
  const claim = new Int32Array(total).fill(-1);
  let frontier: number[] = [];
  seeds.forEach((seed, index) => {
    const pixel = seed.y * width + seed.x;
    label[pixel] = index;
    frontier.push(pixel);
  });
  const claimFrom = (from: number, to: number, touched: number[]): void => {
    if (pixels[to] !== WATER || label[to] !== -1) return;
    const seed = label[from]!;
    const current = claim[to]!;
    if (current === -1) {
      claim[to] = seed;
      touched.push(to);
    } else if (seed < current) {
      claim[to] = seed;
    }
  };
  while (frontier.length > 0) {
    const touched: number[] = [];
    for (const pixel of frontier) {
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (y > 0) claimFrom(pixel, pixel - width, touched);
      if (y < width - 1) claimFrom(pixel, pixel + width, touched);
      if (x > 0) claimFrom(pixel, pixel - 1, touched);
      if (x < width - 1) claimFrom(pixel, pixel + 1, touched);
    }
    for (const pixel of touched) {
      label[pixel] = claim[pixel]!;
      claim[pixel] = -1;
    }
    frontier = touched;
  }
  const out = pixels.slice();
  for (let i = 0; i < total; i++) {
    if (pixels[i] === WATER) out[i] = label[i] === -1 ? 0 : ids[label[i]!]!;
  }
  return out;
}
