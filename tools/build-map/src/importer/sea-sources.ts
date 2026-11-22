import type { Result } from '@mbrg/shared';
import { SEED_KIND_ORDER } from '../core/errors';
import { WATER } from '../core/rasterize';
import type { EnclosedSet } from '../core/sea';
import type { SeedError } from '../core/types';
import { locateSeed, type ViewSet } from './views';

/** The sea-zone seeds of the curation can fail like 003b's seeds do, but there is no `no-sea-seeds`: zero zones are allowed. */
export type SeaSeedError = Exclude<SeedError, { kind: 'no-sea-seeds' }>;

/** A seed of the curation (FR-598): its name and where it lies. */
export interface Seed {
  name: string;
  lon: number;
  lat: number;
}

/**
 * One sea zone, in the FR-605 order (sea territories in code-unit order of key, then seeds in list order). The pixels
 * of a sea territory's units already carry its `id` in the raster (the pixel step rasterized them as the last layers);
 * a seed zone brings its seed pixel.
 */
export interface SeaZone {
  id: number;
  seed?: Seed;
}

/** A 4-connected group of water pixels that no source reaches through water (003c), as pixel indexes in row-major order of discovery. */
export interface WaterSet {
  pixels: number[];
}

/** What the sea pass takes. */
export interface SeaInput {
  views: ViewSet;
  /** The composed raster: water is `WATER`, a sea territory's pixels already carry its zone id. Consumed (updated in place). */
  pixels: Uint32Array;
  zones: readonly SeaZone[];
  /**
   * Called with the enclosed sets, in row-major order of their first pixel, after they are isolated and before any zone
   * is assigned (FR-603: the gap fill of T2.8). It returns the sets that remain; it may turn the pixels of the sets it
   * removes into land.
   */
  between?: (sets: WaterSet[], pixels: Uint32Array) => WaterSet[];
}

/** The outcome of the sea pass: the raster with no water left, and the enclosed sets that joined a zone. */
export interface SeaResult {
  pixels: Uint32Array;
  enclosed: EnclosedSet[];
}

/**
 * FR-598: locates the pixel of every seed by the composed rule of FR-601 (the first inset whose projection holds it,
 * else the main projection) and checks it against the pre-sea raster, which is water: a pixel that holds `WATER` or
 * the pixels of a sea territory's zone. Errors come in `SEED_KIND_ORDER` and then by the first seed named, as 003b
 * does: `seed-outside-frame`, `seed-not-water`, `duplicate-seed-pixel` (`seed` and `seeds` are positions in the seed
 * list). A seed zone gets its pixel only when no earlier zone claimed it.
 */
export function locateSeeds(views: ViewSet, pixels: Uint32Array, zones: readonly SeaZone[]): Result<Map<number, number>, SeaSeedError> {
  const zoneIds = new Set(zones.map((zone) => zone.id));
  const errors: SeaSeedError[] = [];
  const located = new Map<number, number>();
  const shared = new Map<number, number[]>();
  const sharedAt = new Map<number, { x: number; y: number }>();
  let seedIndex = 0;
  zones.forEach((zone, z) => {
    const seed = zone.seed;
    if (seed === undefined) return;
    const index = seedIndex++;
    const at = locateSeed(views, seed.lon, seed.lat);
    if (at === null) {
      errors.push({ kind: 'seed-outside-frame', seed: index, name: seed.name });
      return;
    }
    const pixel = at.y * views.width + at.x;
    const value = pixels[pixel]!;
    if (value !== WATER && !zoneIds.has(value)) errors.push({ kind: 'seed-not-water', seed: index, name: seed.name });
    located.set(z, pixel);
    const group = shared.get(pixel);
    if (group) group.push(index);
    else {
      shared.set(pixel, [index]);
      sharedAt.set(pixel, { x: at.x, y: at.y });
    }
  });
  for (const [pixel, group] of shared) {
    if (group.length > 1) errors.push({ kind: 'duplicate-seed-pixel', seeds: group, x: sharedAt.get(pixel)!.x, y: sharedAt.get(pixel)!.y });
  }
  if (errors.length > 0) {
    const rank = (e: SeaSeedError): number => SEED_KIND_ORDER.indexOf(e.kind);
    // the sort is stable and every kind is found in the order of the seed list: by kind, then by the first seed named
    errors.sort((a, b) => rank(a) - rank(b));
    return { ok: false, errors };
  }
  return { ok: true, value: located };
}

/** The pixels that are sources, and the index in the zone list of the zone each belongs to. */
interface Sources {
  pixel: number[];
  zone: number[];
}

/** Every pixel that carries the id of a zone is a source of it (a sea territory's pixels and the seed pixels claimed). */
function sourcesOf(pixels: Uint32Array, zones: readonly SeaZone[]): Sources {
  const index = new Map<number, number>();
  zones.forEach((zone, z) => index.set(zone.id, z));
  const sources: Sources = { pixel: [], zone: [] };
  if (zones.length === 0) return sources;
  let low = Infinity;
  let high = -Infinity;
  for (const zone of zones) {
    if (zone.id < low) low = zone.id;
    if (zone.id > high) high = zone.id;
  }
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i]!;
    if (value < low || value > high) continue;
    const z = index.get(value);
    if (z !== undefined) {
      sources.pixel.push(i);
      sources.zone.push(z);
    }
  }
  return sources;
}

/**
 * 003c, before any zone is assigned: the water no source reaches through 4-adjacent water. One pass labels the water
 * reachable from the sources, one visit per pixel; every remaining group of water pixels is one set, in row-major order of
 * its first pixel.
 */
export function isolateEnclosed(width: number, pixels: Uint32Array, sourcePixels: readonly number[]): WaterSet[] {
  const total = width * width;
  const reached = new Uint8Array(total);
  const stack: number[] = [];
  for (const p of sourcePixels) {
    reached[p] = 1;
    stack.push(p);
  }
  const toward = (from: number, to: number): void => {
    if (pixels[to] === WATER && reached[to] === 0) {
      reached[to] = 1;
      stack.push(to);
    }
  };
  while (stack.length > 0) {
    const p = stack.pop()!;
    const x = p % width;
    if (p >= width) toward(p, p - width);
    if (p + width < total) toward(p, p + width);
    if (x > 0) toward(p, p - 1);
    if (x < width - 1) toward(p, p + 1);
  }
  const sets: WaterSet[] = [];
  for (let start = 0; start < total; start++) {
    if (pixels[start] !== WATER || reached[start] === 1) continue;
    const set = [start];
    reached[start] = 1;
    for (let head = 0; head < set.length; head++) {
      const p = set[head]!;
      const x = p % width;
      const visit = (q: number): void => {
        if (pixels[q] === WATER && reached[q] === 0) {
          reached[q] = 1;
          set.push(q);
        }
      };
      if (p >= width) visit(p - width);
      if (p + width < total) visit(p + width);
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
    }
    sets.push({ pixels: set });
  }
  return sets;
}

/**
 * FR-598, 003c FR-162: the water pass. Sources are the pixels that carry a zone id. `between` may take the small
 * enclosed sets away first (the gap fill). Every other water pixel goes, by a multi-source breadth-first search through
 * water, to the zone reached in the fewest 4-adjacent steps, a tie to the zone first in the FR-605 order; each
 * remaining enclosed set joins, whole, the zone with the nearest source or reached pixel by squared distance between
 * pixel centres (ties to the first zone in order). With no zone at all every water pixel becomes background (0).
 */
export function assignWater(width: number, pixels: Uint32Array, zones: readonly SeaZone[], between?: SeaInput['between']): SeaResult {
  const sources = sourcesOf(pixels, zones);
  let sets = isolateEnclosed(width, pixels, sources.pixel);
  if (between !== undefined) sets = between(sets, pixels);
  const total = width * width;
  if (zones.length === 0) {
    for (let i = 0; i < total; i++) if (pixels[i] === WATER) pixels[i] = 0;
    return { pixels, enclosed: [] };
  }

  const label = new Int32Array(total).fill(-1);
  const claim = new Int32Array(total).fill(-1);
  let frontier: number[] = sources.pixel.slice();
  sources.pixel.forEach((p, i) => (label[p] = sources.zone[i]!));
  const claimFrom = (from: number, to: number, touched: number[]): void => {
    if (pixels[to] !== WATER || label[to] !== -1) return;
    const zone = label[from]!;
    const current = claim[to]!;
    if (current === -1) {
      claim[to] = zone;
      touched.push(to);
    } else if (zone < current) {
      claim[to] = zone;
    }
  };
  while (frontier.length > 0) {
    const touched: number[] = [];
    for (const pixel of frontier) {
      const x = pixel % width;
      if (pixel >= width) claimFrom(pixel, pixel - width, touched);
      if (pixel + width < total) claimFrom(pixel, pixel + width, touched);
      if (x > 0) claimFrom(pixel, pixel - 1, touched);
      if (x < width - 1) claimFrom(pixel, pixel + 1, touched);
    }
    for (const pixel of touched) {
      label[pixel] = claim[pixel]!;
      claim[pixel] = -1;
    }
    frontier = touched;
  }
  // water the search reached takes its zone; the enclosed sets are still water here and are joined next
  for (let i = 0; i < total; i++) {
    if (pixels[i] === WATER && label[i] !== -1) pixels[i] = zones[label[i]!]!.id;
  }

  const enclosed: EnclosedSet[] = [];
  for (const set of sets) {
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
    for (const p of set.pixels) {
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
    if (bestZone === -1) {
      // no zone has a single pixel to join (every zone is empty): the water is background, and the empty zones fail later
      for (const p of set.pixels) pixels[p] = 0;
      continue;
    }
    const id = zones[bestZone]!.id;
    for (const p of set.pixels) pixels[p] = id;
    enclosed.push({ pixels: set.pixels.length, zone: id });
  }
  return { pixels, enclosed };
}

/**
 * FR-598: the whole sea pass on a composed raster: the seeds are located and checked, each claims its pixel when no
 * earlier zone has it, then the water is assigned (`assignWater`). `between` is the gap fill's place (FR-603).
 */
export function assignSea(input: SeaInput): Result<SeaResult, SeaSeedError> {
  const located = locateSeeds(input.views, input.pixels, input.zones);
  if (!located.ok) return located;
  for (const [z, pixel] of located.value) {
    if (input.pixels[pixel] === WATER) input.pixels[pixel] = input.zones[z]!.id;
  }
  return { ok: true, value: assignWater(input.views.width, input.pixels, input.zones, input.between) };
}
