import type { SourcePolygon } from './types';

/**
 * FR-115, NFR-23: assign each whole pixel to exactly one value by its centre point. Input is in
 * continuous pixel space (u, v); the centre of pixel (x, y) is (x + 0.5, y + 0.5). Scanline over
 * edges bucketed by row, no antialiasing and no coverage: a value is never blended or invented.
 * Pure and deterministic (NFR-14): fixed iteration order, no ambient state.
 */

/** Value of a pixel in no layer: a water pixel (FR-115). Larger than every id (24-bit). */
export const WATER = 0xffffffff;

/** One value (a land territory id, or 0 for other land) and the polygons that make it up. */
export interface RasterLayer {
  value: number;
  polygons: SourcePolygon[];
}

type Point = [number, number];

/** The edges of a ring grouped by the rows whose centre height they touch. */
interface RingRows {
  coords: Point[];
  y0: number;
  y1: number;
  /** start[y - y0] .. start[y - y0 + 1] index into `edges`. */
  start: Int32Array;
  edges: Int32Array;
}

function bucketRing(coords: Point[], width: number): RingRows | null {
  const n = coords.length;
  const from = new Int32Array(n);
  const to = new Int32Array(n);
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = coords[i]!;
    const b = coords[(i + 1) % n]!;
    const vmin = Math.min(a[1], b[1]);
    const vmax = Math.max(a[1], b[1]);
    // Rows y with vmin <= y + 0.5 <= vmax, clipped to the image.
    const ys = Math.max(0, Math.ceil(vmin - 0.5));
    const ye = Math.min(width - 1, Math.floor(vmax - 0.5));
    from[i] = ys;
    to[i] = ye;
    if (ys <= ye) {
      if (ys < y0) y0 = ys;
      if (ye > y1) y1 = ye;
    }
  }
  if (y0 > y1) return null;
  const rows = y1 - y0 + 1;
  const start = new Int32Array(rows + 1);
  for (let i = 0; i < n; i++) {
    for (let y = from[i]!; y <= to[i]!; y++) start[y - y0 + 1]!++;
  }
  for (let r = 0; r < rows; r++) start[r + 1]! += start[r]!;
  const fill = start.slice(0, rows);
  const edges = new Int32Array(start[rows]!);
  for (let i = 0; i < n; i++) {
    for (let y = from[i]!; y <= to[i]!; y++) {
      const slot = fill[y - y0]!;
      edges[slot] = i;
      fill[y - y0] = slot + 1;
    }
  }
  return { coords, y0, y1, start, edges };
}

/**
 * Scan one ring at the centre height vc of row y. `cross`: sorted even-odd crossings (pairs
 * bound the inside). `bound`: flat closed intervals [lo, hi] of boundary points on this height
 * (every edge point at vc; a horizontal edge at vc gives its whole span).
 */
function scanRing(ring: RingRows, y: number, vc: number, cross: number[], bound: number[]): void {
  cross.length = 0;
  bound.length = 0;
  const n = ring.coords.length;
  const r = y - ring.y0;
  for (let k = ring.start[r]!; k < ring.start[r + 1]!; k++) {
    const i = ring.edges[k]!;
    let a = ring.coords[i]!;
    let b = ring.coords[(i + 1) % n]!;
    if (a[1] > b[1]) {
      // Evaluate every edge from its upper end, so a shared edge gives identical values to both sides.
      const t = a;
      a = b;
      b = t;
    }
    const [u1, v1] = a;
    const [u2, v2] = b;
    if (v1 === v2) {
      bound.push(Math.min(u1, u2), Math.max(u1, u2));
      continue;
    }
    let u: number;
    if (vc === v1) u = u1;
    else if (vc === v2) u = u2;
    else u = u1 + ((vc - v1) * (u2 - u1)) / (v2 - v1);
    bound.push(u, u);
    if (v1 > vc !== v2 > vc) cross.push(u);
  }
  cross.sort((p, q) => p - q);
}

/** Mark pixels whose centre lies in the closed interval [a, b]. */
function markClosed(mark: Uint8Array, a: number, b: number, value: number, width: number, t: Touched): void {
  const xs = Math.max(0, Math.ceil(a - 0.5));
  const xe = Math.min(width - 1, Math.floor(b - 0.5));
  for (let x = xs; x <= xe; x++) mark[x] = value;
  if (xs <= xe) touch(t, xs, xe);
}

/** Mark pixels whose centre lies in the open interval (a, b). */
function markOpen(mark: Uint8Array, a: number, b: number, value: number, width: number, t: Touched): void {
  const xs = Math.max(0, Math.floor(a - 0.5) + 1);
  const xe = Math.min(width - 1, Math.ceil(b - 0.5) - 1);
  for (let x = xs; x <= xe; x++) mark[x] = value;
  if (xs <= xe) touch(t, xs, xe);
}

interface Touched {
  lo: number;
  hi: number;
}

function touch(t: Touched, lo: number, hi: number): void {
  if (lo < t.lo) t.lo = lo;
  if (hi > t.hi) t.hi = hi;
}

function resetTouched(t: Touched): void {
  t.lo = Infinity;
  t.hi = -Infinity;
}

/**
 * Rasterize the layers, first layer first: a pixel takes the value of the first layer whose
 * polygons contain its centre (FR-115), else WATER. `width` is W (the image is W x W).
 */
export function rasterize(width: number, layers: readonly RasterLayer[]): Uint32Array {
  const out = new Uint32Array(width * width).fill(WATER);
  const inside = new Uint8Array(width);
  const removed = new Uint8Array(width);
  const strict = new Uint8Array(width);
  const cross: number[] = [];
  const bound: number[] = [];
  const outerT: Touched = { lo: Infinity, hi: -Infinity };
  const holeT: Touched = { lo: Infinity, hi: -Infinity };
  const strictT: Touched = { lo: Infinity, hi: -Infinity };

  for (const layer of layers) {
    for (const polygon of layer.polygons) {
      const outer = bucketRing(polygon.outer.coords, width);
      if (outer === null) continue;
      const holes: RingRows[] = [];
      for (const h of polygon.holes) {
        const b = bucketRing(h.coords, width);
        if (b !== null) holes.push(b);
      }
      for (let y = outer.y0; y <= outer.y1; y++) {
        const vc = y + 0.5;
        resetTouched(outerT);
        scanRing(outer, y, vc, cross, bound);
        // Inside by even-odd (closed: its ends are boundary points) plus every boundary point.
        for (let i = 0; i + 1 < cross.length; i += 2) markClosed(inside, cross[i]!, cross[i + 1]!, 1, width, outerT);
        for (let i = 0; i + 1 < bound.length; i += 2) markClosed(inside, bound[i]!, bound[i + 1]!, 1, width, outerT);
        if (outerT.lo > outerT.hi) continue;

        // Each hole removes its strict interior (inside by even-odd and not on its boundary).
        resetTouched(holeT);
        for (const hole of holes) {
          if (y < hole.y0 || y > hole.y1) continue;
          scanRing(hole, y, vc, cross, bound);
          resetTouched(strictT);
          for (let i = 0; i + 1 < cross.length; i += 2) markOpen(strict, cross[i]!, cross[i + 1]!, 1, width, strictT);
          for (let i = 0; i + 1 < bound.length; i += 2) markClosed(strict, bound[i]!, bound[i + 1]!, 0, width, strictT);
          for (let x = strictT.lo; x <= strictT.hi; x++) {
            if (strict[x] === 1) removed[x] = 1;
            strict[x] = 0;
          }
          if (strictT.lo <= strictT.hi) touch(holeT, strictT.lo, strictT.hi);
        }

        const base = y * width;
        for (let x = outerT.lo; x <= outerT.hi; x++) {
          if (inside[x] === 1 && removed[x] === 0 && out[base + x] === WATER) out[base + x] = layer.value;
          inside[x] = 0;
        }
        for (let x = holeT.lo; x <= holeT.hi; x++) removed[x] = 0;
      }
    }
  }
  return out;
}
