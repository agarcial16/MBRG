/**
 * Grids for the shaped-label tests (spec 006): sets of units given by coordinates, lines at known angles,
 * and the dev map piece index. Random data comes from the fixed-seed generator of `label-grids.ts`.
 */
import { buildEntryIndex } from '../../src/core/entries';
import { decodeIdPng } from '../../src/core/png';
import { buildPieceIndex } from '../../src/core/regions';
import type { PieceIndex } from '../../src/core/regions';
import { inflateStream } from '../../src/ui/load';
import { DEV_MAP, devPngBytes } from './dev-map';
import { gridOf } from './grids';
import { rng } from './label-grids';

export type Unit = readonly [number, number];

/** A piece index of one land entry holding exactly the given units (whole coordinates), with every piece listed. */
export function setOfUnits(units: readonly Unit[], width?: number, height?: number): { p: PieceIndex; pieces: number[] } {
  const w = width ?? Math.max(...units.map((u) => u[0])) + 2;
  const h = height ?? Math.max(...units.map((u) => u[1])) + 2;
  const key = new Set(units.map(([x, y]) => y * w + x));
  const p = buildPieceIndex(gridOf(w, h, (x, y) => (key.has(y * w + x) ? 1 : 0), { 1: 'land' }));
  return { p, pieces: Array.from({ length: p.entryOf.length }, (_, i) => i) };
}

/** `count` units on a line from (x0, y0) with the screen step (dx, dyUp): x grows by dx, y falls by dyUp. */
export function lineUnits(x0: number, y0: number, dx: number, dyUp: number, count: number): Unit[] {
  return Array.from({ length: count }, (_, k) => [x0 + k * dx, y0 - k * dyUp] as const);
}

/** A random set of distinct units inside a size x size square, from a fixed seed. */
export function randomUnits(seed: number, size: number, count: number): Unit[] {
  const next = rng(seed);
  const seen = new Set<number>();
  const units: Unit[] = [];
  while (units.length < count) {
    const x = Math.floor(next() * size);
    const y = Math.floor(next() * size);
    if (seen.has(y * size + x)) continue;
    seen.add(y * size + x);
    units.push([x, y]);
  }
  return units;
}

/**
 * A fixed-seed blob inside a size x size square: one to three thick segments between random points
 * (diagonal and bent shapes), as whole unit coordinates in row-major order.
 */
export function blobUnits(seed: number, size: number): Unit[] {
  const next = rng(seed);
  const cells = new Set<number>();
  const segments = 1 + Math.floor(next() * 3);
  for (let k = 0; k < segments; k++) {
    const thick = 1 + Math.floor(next() * 4);
    const pick = (): number => thick + Math.floor(next() * (size - 2 * thick));
    const x0 = pick();
    const y0 = pick();
    const x1 = pick();
    const y1 = pick();
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let s = 0; s <= steps; s++) {
      const cx = Math.round(x0 + ((x1 - x0) * s) / steps);
      const cy = Math.round(y0 + ((y1 - y0) * s) / steps);
      for (let oy = -thick; oy <= thick; oy++) {
        for (let ox = -thick; ox <= thick; ox++) {
          if (ox * ox + oy * oy > thick * thick) continue;
          cells.add((cy + oy) * size + (cx + ox));
        }
      }
    }
  }
  return Array.from(cells)
    .sort((a, b) => a - b)
    .map((c) => [c % size, Math.floor(c / size)] as const);
}

/**
 * A circular band: the units whose centre is within T / 2 of radius R from the circle centre (100, 20) for
 * sign > 0 (the band below it, a cup) or (100, 200) for sign < 0 (the band above it, a cap), within A degrees of the
 * vertical through the centre. Test code: trigonometry is allowed here.
 */
export function arcBandUnits(radius: number, thick: number, halfAngle: number, sign: 1 | -1): Unit[] {
  const units: Unit[] = [];
  const cx = 100;
  const cy = sign > 0 ? 20 : 200;
  for (let y = 0; y < 240; y++) {
    for (let x = 0; x < 200; x++) {
      const dx = x + 0.5 - cx;
      const dy = (y + 0.5 - cy) * sign;
      if (dy <= 0) continue;
      if (Math.abs(Math.sqrt(dx * dx + dy * dy) - radius) > thick / 2) continue;
      if ((Math.atan2(Math.abs(dx), dy) * 180) / Math.PI > halfAngle) continue;
      units.push([x, y] as const);
    }
  }
  return units;
}

/** Units of the rectangle [x0, x0 + w) x [y0, y0 + h). */
export function rectUnits(x0: number, y0: number, w: number, h: number): Unit[] {
  const units: Unit[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) units.push([x, y] as const);
  return units;
}

/** Units of a band: for each x in [x0, x1) the `thick` units from y = round(f(x)) downwards. */
export function bandUnits(x0: number, x1: number, thick: number, f: (x: number) => number): Unit[] {
  const units: Unit[] = [];
  for (let x = x0; x < x1; x++) for (let t = 0; t < thick; t++) units.push([x, Math.round(f(x)) + t] as const);
  return units;
}

/** The dev map piece index (decoded from the committed PNG). */
export async function devPieces(): Promise<PieceIndex> {
  const decoded = await decodeIdPng(devPngBytes(), inflateStream);
  if (!decoded.ok) throw new Error('png');
  return buildPieceIndex(buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values));
}

/**
 * One piece index holding several land entries (entry k + 1 = the k-th set of units, whole coordinates) in an
 * image of the given size, and the pieces of each entry. Sets must not share a unit.
 */
export function multiSets(sets: readonly (readonly Unit[])[], width: number, height: number): { p: PieceIndex; piecesOf: number[][] } {
  const owner = new Map<number, number>();
  sets.forEach((units, k) => {
    for (const [x, y] of units) {
      if (owner.has(y * width + x)) throw new Error('multiSets: sets share a unit');
      owner.set(y * width + x, k + 1);
    }
  });
  const kinds: Record<number, 'land'> = {};
  sets.forEach((_, k) => (kinds[k + 1] = 'land'));
  const p = buildPieceIndex(gridOf(width, height, (x, y) => owner.get(y * width + x) ?? 0, kinds));
  const piecesOf = sets.map((_, k) => Array.from({ length: p.entryOf.length }, (_v, i) => i).filter((i) => p.entryOf[i] === k + 1));
  return { p, piecesOf };
}
