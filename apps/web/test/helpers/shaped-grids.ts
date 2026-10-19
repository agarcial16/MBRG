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

/** The dev map piece index (decoded from the committed PNG). */
export async function devPieces(): Promise<PieceIndex> {
  const decoded = await decodeIdPng(devPngBytes(), inflateStream);
  if (!decoded.ok) throw new Error('png');
  return buildPieceIndex(buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values));
}
