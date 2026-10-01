import type { ColorRegion, FlatColorResult } from './flatColors.js';

/**
 * Which regions share a *land border*.
 *
 * Only 4-connected neighbours count. Two provinces that merely touch at a
 * corner are not neighbours: the engine hands provinces to a bordering
 * faction, and a corner touch is not a border you can walk across. Such a
 * region is reported as an island instead, so the validation screen can ask
 * for a maritime link rather than silently inventing one.
 */
export interface AdjacencyResult {
  /** Region index → sorted region indices it shares a border with. */
  neighbors: Map<number, number[]>;
  /** Regions with no land neighbour at all (islands, or corner-only touches). */
  islands: number[];
  /** Unordered pairs of regions that touch only diagonally. */
  cornerTouches: Array<[number, number]>;
}

/** Read a label safely: out-of-bounds and "no land" are both -1. */
export function labelAt(result: FlatColorResult, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= result.width || y >= result.height) return -1;
  return result.labels[y * result.width + x];
}

/**
 * Build the neighbour graph from a label map. Symmetric and sorted, because
 * `validateMap` demands symmetric adjacency and the sim must be deterministic.
 */
export function detectAdjacency(result: FlatColorResult): AdjacencyResult {
  const { width, height } = result;
  const neighbors = new Map<number, Set<number>>();
  for (const region of result.regions) neighbors.set(region.index, new Set());

  const link = (a: number, b: number): void => {
    if (a === b || a < 0 || b < 0) return;
    neighbors.get(a)?.add(b);
    neighbors.get(b)?.add(a);
  };

  // Every shared border is walked exactly once: to the right and downwards.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = labelAt(result, x, y);
      if (here < 0) continue;
      link(here, labelAt(result, x + 1, y));
      link(here, labelAt(result, x, y + 1));
    }
  }

  // Corner touches are reported, not linked: a province reachable only
  // diagonally is an island as far as the engine is concerned.
  const cornerTouches: Array<[number, number]> = [];
  const seenCorners = new Set<string>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = labelAt(result, x, y);
      if (here < 0) continue;
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
      ] as const) {
        const other = labelAt(result, x + dx, y + dy);
        if (other < 0 || other === here) continue;
        if (neighbors.get(here)?.has(other)) continue; // they do share a border
        const key = here < other ? `${here}-${other}` : `${other}-${here}`;
        if (seenCorners.has(key)) continue;
        seenCorners.add(key);
        cornerTouches.push(here < other ? [here, other] : [other, here]);
      }
    }
  }

  const sorted = new Map<number, number[]>();
  const islands: number[] = [];
  for (const region of result.regions) {
    const list = [...(neighbors.get(region.index) ?? [])].sort((a, b) => a - b);
    sorted.set(region.index, list);
    if (list.length === 0) islands.push(region.index);
  }

  return { neighbors: sorted, islands, cornerTouches };
}

/** Neighbour lists in the shape `Territory.neighbors` wants, keyed by region index. */
export function neighborIdLists(
  adjacency: AdjacencyResult,
  idOf: (index: number) => string,
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const [index, list] of adjacency.neighbors) {
    out.set(index, list.map(idOf));
  }
  return out;
}

/** Territory ids of the reported islands, for the validation screen. */
export function islandIds(adjacency: AdjacencyResult, idOf: (index: number) => string): string[] {
  return adjacency.islands.map(idOf);
}

/** Region indices that were dropped as speckle, by id, for reporting. */
export function regionIds(regions: readonly ColorRegion[]): string[] {
  return regions.map((r) => `r${r.index}`);
}
