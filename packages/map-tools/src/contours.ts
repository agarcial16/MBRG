import type { Coord } from '@mbrg/shared';

import { labelAt } from './adjacency.js';
import type { FlatColorResult } from './flatColors.js';

/**
 * Region outlines, as loops shared between neighbours.
 *
 * Tracing each region's outline on its own is what produces visible seams: two
 * regions that share a border come out with *almost* the same points, not the
 * same points, and the renderer strokes any edge whose two sides disagree. So
 * nothing here is traced per region. Instead every boundary side of the label
 * map becomes a directed edge with its region on the left, all the edges are
 * chained into closed loops, and a loop is stored **once**. That single loop is
 * the outer ring of the region it encloses *and* a hole in the region that
 * surrounds it, so both polygons quote the same coordinates by construction.
 *
 * Corners live on the pixel grid (a W×H image has (W+1)×(H+1) of them), which
 * is what makes the shared vertices exactly equal rather than nearly equal.
 */

export interface ContourLoop {
  /** Corner coordinates, y down, without a repeated closing point. */
  points: Coord[];
  /**
   * Region the loop wraps around, or -1 for a lake (sea enclosed by a region).
   * The loop is this region's outer ring.
   */
  enclosed: number;
  /**
   * Region that surrounds the loop, or -1 for open sea. When it exists, the
   * loop is a hole in that region's polygon.
   */
  surrounds: number;
  /** Enclosed area in square pixels, after simplification. */
  area: number;
  /**
   * The two sides disagreed along the loop: a diagonal (saddle) configuration
   * where four regions meet. Reported so validation can flag it, because the
   * loop is then only an approximation of the real shape.
   */
  ambiguous: boolean;
}

export interface ContourOptions {
  /**
   * Douglas–Peucker tolerance in pixels. Simplification runs once per loop, so
   * both polygons that quote the loop get the same simplified points.
   */
  simplify: number;
  /** Loops smaller than this (in pixels²) are dropped as noise. */
  minLoopArea: number;
}

export const DEFAULT_CONTOUR_OPTIONS: ContourOptions = {
  simplify: 0.75,
  // 1 px² is a real enclave, not noise: a province with a one-pixel hole is
  // unusual but perfectly representable, and dropping it would leave the hole
  // unfilled in the polygon.
  minLoopArea: 1,
};

export interface ContourResult {
  loops: ContourLoop[];
  /** Region index → loops that enclose it (its outer rings). */
  ringsByRegion: Map<number, ContourLoop[]>;
  /** Region index → loops of other regions that sit inside it (its holes). */
  holesByRegion: Map<number, ContourLoop[]>;
  /**
   * Regions whose land falls into several disconnected pieces. A single
   * `polygon` plus `holes` cannot express that, so validation has to say so.
   */
  splitRegions: number[];
}

/** A boundary side of the label map, as a move between two grid corners. */
interface Edge {
  from: number;
  to: number;
  /** Region on the left of the walk, i.e. the one the loop encloses. */
  left: number;
  /** Region on the right: the neighbour, or -1 for sea / outside. */
  right: number;
  used: boolean;
}

/** Directions as 0=E, 1=S, 2=W, 3=N. `left(d)` is `(d + 3) % 4`. */
const E = 0;
const S = 1;
const W = 2;
const N = 3;

interface Grid {
  width: number;
  height: number;
  /** Corner id → y * (width + 1) + x. */
  stride: number;
}

function corner(grid: Grid, x: number, y: number): number {
  return y * grid.stride + x;
}

function cornerX(grid: Grid, id: number): number {
  return id % grid.stride;
}

function cornerY(grid: Grid, id: number): number {
  return Math.floor(id / grid.stride);
}

/** Which way does the move `from → to` go? */
function directionOf(grid: Grid, from: number, to: number): number {
  const dx = cornerX(grid, to) - cornerX(grid, from);
  const dy = cornerY(grid, to) - cornerY(grid, from);
  if (dx > 0) return E;
  if (dy > 0) return S;
  if (dx < 0) return W;
  return N;
}

/**
 * Collect every boundary side of the label map as a directed edge, with the
 * region on its left. A border between two regions is emitted twice, once from
 * each side and in opposite directions; the two halves chain into the two loops
 * that quote the same corners.
 *
 * With y pointing down, the left of a heading `d` is `(d.y, -d.x)`. Each side of
 * a pixel is therefore walked in the direction that keeps the pixel on its left:
 * a pixel's top edge is walked west, its bottom edge east, its left edge south
 * and its right edge north.
 */
function collectEdges(result: FlatColorResult, grid: Grid): Edge[] {
  const edges: Edge[] = [];
  const push = (from: number, to: number, left: number, right: number): void => {
    edges.push({ from, to, left, right, used: false });
  };

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const me = labelAt(result, x, y);
      if (me < 0) continue;
      const above = labelAt(result, x, y - 1);
      if (above !== me) push(corner(grid, x + 1, y), corner(grid, x, y), me, above);
      const below = labelAt(result, x, y + 1);
      if (below !== me) push(corner(grid, x, y + 1), corner(grid, x + 1, y + 1), me, below);
      const left = labelAt(result, x - 1, y);
      if (left !== me) push(corner(grid, x, y), corner(grid, x, y + 1), me, left);
      const right = labelAt(result, x + 1, y);
      if (right !== me) push(corner(grid, x + 1, y + 1), corner(grid, x + 1, y), me, right);
    }
  }
  return edges;
}

/** A closed chain of corners, with the labels seen on either side. */
interface Chain {
  /** Corner ids, first and last equal. */
  ids: number[];
  /** Region that emitted the edges, i.e. the one on the left of the walk. */
  left: number;
  /** The other side: the neighbour, or -1 for sea / outside the image. */
  right: number;
  ambiguous: boolean;
}

/**
 * Which region does a loop enclose? Walking with the region on the left gives
 * a negative signed area when the loop wraps *around* that region (its outer
 * ring) and a positive one when it wraps around the neighbour instead (a hole
 * in it). The sign is what tells the two cases apart — the side alone cannot.
 */
function classify(chain: Chain, points: Coord[], grid: Grid): { enclosed: number; surrounds: number } {
  const area = signedArea(points);
  return area < 0
    ? { enclosed: chain.left, surrounds: chain.right }
    : { enclosed: chain.right, surrounds: chain.left };
}

/**
 * Chain edges into closed loops. At a corner where two loops cross (four
 * regions meeting in a checkerboard) there are two valid continuations; turning
 * right splits the crossing into two separate loops, which is what we want —
 * turning left would merge two regions into one figure-eight.
 */
function chainLoops(edges: Edge[], grid: Grid): Chain[] {
  const outgoing = new Map<number, Edge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from);
    if (list) list.push(edge);
    else outgoing.set(edge.from, [edge]);
  }

  const chains: Chain[] = [];
  for (const start of edges) {
    if (start.used) continue;
    const ids: number[] = [start.from];
    let edge = start;
    const left = start.left;
    const right = start.right;
    let ambiguous = false;

    for (let guard = 0; guard <= edges.length; guard++) {
      edge.used = true;
      ids.push(edge.to);
      if (edge.to === start.from) break; // closed
      if (edge.left !== left || edge.right !== right) ambiguous = true;

      // Only follow edges of the *same* region. At a corner where several
      // regions meet, the other sides' edges also start there, and taking one
      // would splice this region's outline into its neighbour's — the walk
      // would wander off and no loop would close. Within a single region the
      // turn preference below is what resolves a diagonal crossing.
      const candidates = (outgoing.get(edge.to) ?? []).filter(
        (e) => !e.used && e.left === left,
      );
      if (candidates.length === 0) {
        ids.length = 0; // open chain: not a loop, drop it
        break;
      }
      const heading = directionOf(grid, edge.from, edge.to);
      // Right turn, then straight on, then left, then back: deterministic, and
      // it splits diagonal crossings into separate loops instead of merging
      // two regions into one figure-eight.
      const preference = [(heading + 1) % 4, heading, (heading + 3) % 4, (heading + 2) % 4];
      let next: Edge | undefined;
      let bestRank = preference.length;
      for (const candidate of candidates) {
        const rank = preference.indexOf(directionOf(grid, candidate.from, candidate.to));
        if (rank >= 0 && rank < bestRank) {
          bestRank = rank;
          next = candidate;
        }
      }
      if (!next) {
        ids.length = 0;
        break;
      }
      edge = next;
    }

    if (ids.length >= 4 && ids[0] === ids[ids.length - 1]) {
      chains.push({ ids, left, right, ambiguous });
    }
  }
  return chains;
}

/** Shoelace area, signed. */
function signedArea(points: Coord[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Is a point inside a ring? Even-odd ray casting, boundary counts as outside. */
export function pointInRing(points: Coord[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A point strictly inside a loop. For a loop around a region we can use one of
 * that region's own pixels, which is exact. A lake has no region, so its
 * bounding box is sampled instead — and a lake whose middle happens to be
 * outside itself (a C-shaped pond) is reported as ambiguous rather than
 * silently losing its hole.
 */
function interiorPoint(
  loop: ContourLoop,
  result: FlatColorResult,
): { point: Coord; inside: boolean } {
  if (loop.enclosed >= 0) {
    const region = result.regions.find((r) => r.index === loop.enclosed);
    const packed = region?.pixels[0];
    if (packed !== undefined) {
      return { point: [packed % result.width, Math.floor(packed / result.width)], inside: true };
    }
  }
  const xs = loop.points.map(([x]) => x);
  const ys = loop.points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  for (let i = 1; i <= 3; i++) {
    for (let j = 1; j <= 3; j++) {
      const p: Coord = [minX + ((maxX - minX) * i) / 4, minY + ((maxY - minY) * j) / 4];
      if (pointInRing(loop.points, p[0], p[1])) return { point: p, inside: true };
    }
  }
  return { point: [(minX + maxX) / 2, (minY + maxY) / 2], inside: false };
}

/**
 * Douglas–Peucker simplification of a closed ring, anchored at its topmost then
 * leftmost point so the result does not depend on where the walk happened to
 * start. Endpoints are kept, so the ring stays closed.
 */
export function simplifyRing(points: Coord[], tolerance: number): Coord[] {
  if (tolerance <= 0 || points.length < 4) return points;

  // Rotate so the walk starts at a stable corner.
  let anchor = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[anchor];
    const [bx, by] = points[i];
    if (by < ay || (by === ay && bx < ax)) anchor = i;
  }
  const ring = [...points.slice(anchor), ...points.slice(0, anchor)];
  ring.push(ring[0]); // closed for the recursive pass

  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    const [x1, y1] = ring[lo];
    const [x2, y2] = ring[hi];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstIndex = -1;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = ring[i];
      let dist: number;
      if (len2 === 0) {
        dist = Math.hypot(px - x1, py - y1);
      } else {
        const cross = Math.abs(dx * (y1 - py) - (x1 - px) * dy);
        dist = cross / Math.sqrt(len2);
      }
      if (dist > worst) {
        worst = dist;
        worstIndex = i;
      }
    }
    if (worst > tolerance && worstIndex > 0) {
      keep[worstIndex] = 1;
      stack.push([lo, worstIndex], [worstIndex, hi]);
    }
  }

  // Drop the closing duplicate: a ring here never repeats its first point.
  const kept = ring.filter((_, i) => keep[i] === 1);
  if (kept.length > 1 && kept[0][0] === kept[kept.length - 1][0] && kept[0][1] === kept[kept.length - 1][1]) {
    kept.pop();
  }
  return kept;
}

/** Trace every region outline into loops that neighbours share. */
export function traceContours(
  result: FlatColorResult,
  options: Partial<ContourOptions> = {},
): ContourResult {
  const opts: ContourOptions = { ...DEFAULT_CONTOUR_OPTIONS, ...options };
  const grid: Grid = { width: result.width, height: result.height, stride: result.width + 1 };

  const chains = chainLoops(collectEdges(result, grid), grid);

  // A border is traced twice, once from each side. Deduplicate on the *raw*
  // corner ids, before simplification: the two walks visit the same corners in
  // opposite order, and simplifying them separately could round a shared
  // border differently on each side — which is exactly the seam we are here to
  // avoid. Simplify once, after merging, and both sides quote those points.
  const unique = new Map<string, Chain>();
  for (const chain of chains) {
    // The key must ignore the repeated closing corner: the two walks close at
    // opposite ends of the same boundary, so including it would give each side
    // a different key and they would never merge.
    const key = chain.ids
      .slice(0, -1)
      .sort((a, b) => a - b)
      .join(',');
    const seen = unique.get(key);
    if (seen) {
      // The two sides must agree on who is inside; if they don't, the pixel
      // pattern is a diagonal crossing.
      const points = (c: Chain): Coord[] =>
        c.ids.slice(0, -1).map((id) => [cornerX(grid, id), cornerY(grid, id)] as Coord);
      if (classify(chain, points(chain), grid).enclosed !== classify(seen, points(seen), grid).enclosed) {
        seen.ambiguous = true;
      }
      continue;
    }
    unique.set(key, chain);
  }

  const loops: ContourLoop[] = [];
  for (const chain of unique.values()) {
    const raw = chain.ids.slice(0, -1); // drop the repeated closing corner
    if (raw.length < 3) continue;
    const rawPoints = raw.map((id) => [cornerX(grid, id), cornerY(grid, id)] as Coord);
    const { enclosed, surrounds } = classify(chain, rawPoints, grid);
    if (Math.abs(signedArea(rawPoints)) < opts.minLoopArea) continue;

    let points = simplifyRing(rawPoints, opts.simplify);
    if (points.length < 3) continue;
    const area = Math.abs(signedArea(points));
    if (area < opts.minLoopArea) continue;

    loops.push({ points, enclosed, surrounds, area, ambiguous: chain.ambiguous });
  }

  const ringsByRegion = new Map<number, ContourLoop[]>();
  const holesByRegion = new Map<number, ContourLoop[]>();
  for (const region of result.regions) {
    ringsByRegion.set(region.index, []);
    holesByRegion.set(region.index, []);
  }
  for (const loop of loops) {
    // A lake is a loop that encloses no region but sits inside one.
    if (loop.enclosed >= 0) ringsByRegion.get(loop.enclosed)?.push(loop);
  }

  // The region on the other side of a boundary is not automatically the one
  // that *encircles* it: in a map where one region is split in two by another,
  // each half borders the middle strip without being inside it. Only a loop
  // that really falls inside a neighbour's outer ring is a hole in it, so the
  // ring is where the two must be filled — and both quote the same loop.
  for (const loop of loops) {
    if (loop.surrounds < 0) continue;
    const inner = interiorPoint(loop, result);
    if (!inner.inside) {
      loop.ambiguous = true;
      continue;
    }
    const surrounds = ringsByRegion.get(loop.surrounds) ?? [];
    if (surrounds.some((ring) => pointInRing(ring.points, inner.point[0], inner.point[1]))) {
      holesByRegion.get(loop.surrounds)?.push(loop);
    }
  }

  const splitRegions = [...ringsByRegion.entries()]
    .filter(([, rings]) => rings.length > 1)
    .map(([index]) => index)
    .sort((a, b) => a - b);

  return { loops, ringsByRegion, holesByRegion, splitRegions };
}
