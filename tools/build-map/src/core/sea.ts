import type { Result } from '@mbrg/shared';
import { SEED_KIND_ORDER } from './errors';
import { project, toPixel, type Frame, type ProjectionCenter } from './projection';
import { WATER } from './rasterize';
import type { SeaSeed, SeedError, SeedPixel } from './types';

/**
 * FR-116: sea zones. `seedPixels` locates and checks the seeds; `assignSeaZones` gives every water
 * pixel to the seed reached in the fewest 4-adjacent steps through water, ties to the seed listed
 * first. FR-162 (spec 003c): water no seed can reach (enclosed water) joins, set by set, the zone
 * nearest in a straight line, so no water pixel is background. Pure and deterministic (NFR-14).
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

/** One enclosed water set (FR-162) and the map id of the sea zone it joined. */
export interface EnclosedSet {
  pixels: number;
  zone: number;
}

/**
 * Layered multi-source breadth-first search. Layer 0 is the seed pixels; each next layer is the
 * unlabelled water pixels 4-adjacent to the previous layer, and each takes the smallest seed
 * position among the previous-layer pixels around it (so a tie goes to the seed listed first,
 * whatever order the pixels are visited in). `ids[i]` is the map id of seed `i`. Returns a new
 * array: water pixels become a sea zone id. Land and background pixels are copied unchanged.
 * Enclosed water goes to the nearest zone (`assignSeaZonesDetailed`).
 */
export function assignSeaZones(
  width: number,
  pixels: Uint32Array,
  seeds: readonly SeedPixel[],
  ids: readonly number[],
): Uint32Array {
  return assignSeaZonesDetailed(width, pixels, seeds, ids).pixels;
}

/**
 * `assignSeaZones` plus the list of enclosed water sets (FR-162), in row-major order of their first
 * pixel. A set is a 4-connected group of water pixels that the seed search did not reach. It goes
 * whole to the zone with the smallest squared distance between pixel centres, over all pairs of a
 * pixel of the set and a pixel the seed search gave to a zone (never another enclosed set, so the
 * order of the sets does not matter); equal distances go to the seed listed first. Only when there
 * is no seed at all is water left as water.
 */
export function assignSeaZonesDetailed(
  width: number,
  pixels: Uint32Array,
  seeds: readonly SeedPixel[],
  ids: readonly number[],
): { pixels: Uint32Array; enclosed: EnclosedSet[] } {
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
    if (pixels[i] === WATER && label[i] !== -1) out[i] = ids[label[i]!]!;
  }
  const enclosed = seeds.length === 0 ? [] : joinEnclosedWater(width, pixels, label, ids, out);
  return { pixels: out, enclosed };
}

/**
 * FR-162: labels the enclosed sets, finds each one's nearest zone with a ring search around every
 * pixel of the set (pruned by the best squared distance so far, so it stays cheap even for a big
 * set) and paints the set in `out`. `label` holds the zone index of the pixels the seed search reached.
 */
function joinEnclosedWater(
  width: number,
  pixels: Uint32Array,
  label: Int32Array,
  ids: readonly number[],
  out: Uint32Array,
): EnclosedSet[] {
  const total = width * width;
  const seen = new Uint8Array(total);
  const enclosed: EnclosedSet[] = [];
  for (let start = 0; start < total; start++) {
    if (pixels[start] !== WATER || label[start] !== -1 || seen[start]) continue;
    const set = [start];
    seen[start] = 1;
    for (let head = 0; head < set.length; head++) {
      const p = set[head]!;
      const x = p % width;
      const visit = (q: number): void => {
        if (pixels[q] === WATER && label[q] === -1 && !seen[q]) {
          seen[q] = 1;
          set.push(q);
        }
      };
      if (p >= width) visit(p - width);
      if (p + width < total) visit(p + width);
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
    }

    let bestD2 = Infinity;
    let bestZone = -1;
    const consider = (q: number, d2: number): void => {
      const zone = label[q]!;
      if (zone === -1) return;
      if (d2 < bestD2 || (d2 === bestD2 && zone < bestZone)) {
        bestD2 = d2;
        bestZone = zone;
      }
    };
    for (const p of set) {
      const px = p % width;
      const py = (p - px) / width;
      for (let r = 1; r * r <= bestD2 && r < width; r++) {
        const y0 = py - r;
        const y1 = py + r;
        const x0 = px - r;
        const x1 = px + r;
        for (let x = Math.max(x0, 0); x <= Math.min(x1, width - 1); x++) {
          if (y0 >= 0) consider(y0 * width + x, (x - px) ** 2 + r * r);
          if (y1 < width) consider(y1 * width + x, (x - px) ** 2 + r * r);
        }
        for (let y = Math.max(y0 + 1, 0); y <= Math.min(y1 - 1, width - 1); y++) {
          if (x0 >= 0) consider(y * width + x0, r * r + (y - py) ** 2);
          if (x1 < width) consider(y * width + x1, r * r + (y - py) ** 2);
        }
      }
    }
    const zoneId = ids[bestZone]!;
    for (const p of set) out[p] = zoneId;
    enclosed.push({ pixels: set.length, zone: zoneId });
  }
  return enclosed;
}
