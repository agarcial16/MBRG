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
  /**
   * Pairs joined across a strip of non-land up to `maxGap` pixels wide, rather
   * than sharing pixels. Reported so the importer can say "these two were joined
   * across an outline" instead of leaving the user to wonder.
   */
  bridged: Array<[number, number]>;
}

/**
 * Options for `detectAdjacency`.
 */
export interface AdjacencyOptions {
  /**
   * How far apart two regions may be and still count as bordering, in pixels of
   * non-land between them.
   *
   * Almost every map worth importing draws an outline around each province, and
   * an outline is a strip of pixels that belongs to nobody: it is not land, so it
   * cannot connect two regions, and without a bridge the whole map comes out as
   * a pile of islands. The default of 3 covers the outlines maps actually use —
   * 1 to 3 px at typical resolutions — while staying far below the width of any
   * strait a player would consider a border.
   *
   * 0 disables it and restores strict pixel adjacency.
   */
  maxGap: number;
}

export const DEFAULT_ADJACENCY_OPTIONS: AdjacencyOptions = { maxGap: 3 };

/** Read a label safely: out-of-bounds and "no land" are both -1. */
export function labelAt(result: FlatColorResult, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= result.width || y >= result.height) return -1;
  return result.labels[y * result.width + x];
}

/**
 * Build the neighbour graph from a label map. Symmetric and sorted, because
 * `validateMap` demands symmetric adjacency and the sim must be deterministic.
 */
export function detectAdjacency(
  result: FlatColorResult,
  options: Partial<AdjacencyOptions> = {},
): AdjacencyResult {
  const opts: AdjacencyOptions = { ...DEFAULT_ADJACENCY_OPTIONS, ...options };
  const { width, height } = result;
  const neighbors = new Map<number, Set<number>>();
  for (const region of result.regions) neighbors.set(region.index, new Set());

  const link = (a: number, b: number, bridged = false): void => {
    if (a === b || a < 0 || b < 0) return;
    neighbors.get(a)?.add(b);
    neighbors.get(b)?.add(a);
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (bridged) bridgedKeys.add(key);
    else pixelLinked.add(key);
  };
  const bridgedKeys = new Set<string>();
  const pixelLinked = new Set<string>();

  // Every shared border is walked exactly once: to the right and downwards.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = labelAt(result, x, y);
      if (here < 0) continue;
      link(here, labelAt(result, x + 1, y));
      link(here, labelAt(result, x, y + 1));
    }
  }

  bridgeAcrossGaps(result, opts.maxGap, (a, b) => link(a, b, true));

  // Corner touches are reported, not linked: a province reachable only
  // diagonally is an island as far as the engine is concerned. Read after the
  // bridge, so a pair joined across an outline is not also called a corner
  // touch — with a 1 px outline between them, the diagonals would otherwise
  // report every border on the map.
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

  const bridged = [...bridgedKeys]
    .filter((key) => !pixelLinked.has(key))
    .map((key) => key.split('-').map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  return { neighbors: sorted, islands, cornerTouches, bridged };
}

/**
 * Join regions separated by a strip of non-land no wider than `maxGap`.
 *
 * A line scan in each direction, not a wavefront, and the reason is that the
 * gap being looked for *is* a line: an outline drawn around a province. Scanning
 * each row and each column while remembering the last land label seen keeps the
 * question literal — "was there land on both sides of at most `maxGap` pixels?"
 * — which a symmetric wavefront cannot answer without quietly doubling the
 * distance it claims to cover. It is also linear in pixels, so an 11.5M pixel map
 * costs one extra pass.
 *
 * A diagonal outline works too: a 45° line is a staircase, and each step of it is
 * a horizontal or vertical gap of one pixel.
 */
function bridgeAcrossGaps(
  result: FlatColorResult,
  maxGap: number,
  link: (a: number, b: number) => void,
): void {
  if (maxGap <= 0) return;
  const { width, height, labels } = result;

  const scan = (at: (i: number) => number, length: number): void => {
    let previous = -1;
    let gap = 0;
    for (let i = 0; i < length; i++) {
      const here = at(i);
      if (here >= 0) {
        if (gap > 0 && gap <= maxGap) link(previous, here);
        previous = here;
        gap = 0;
      } else if (previous >= 0) {
        gap++;
      }
      // Once the gap is wider than allowed, stop counting but keep the label: the
      // scan has to know the nearest land on the far side of a wide gap too.
    }
  };

  for (let y = 0; y < height; y++) {
    const row = y * width;
    scan((x) => labels[row + x], width);
  }
  for (let x = 0; x < width; x++) {
    scan((y) => labels[y * width + x], height);
  }
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
