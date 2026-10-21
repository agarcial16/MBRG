// The centred candidate of a label: the horizontal and straight frames that fit and lie in the centre disc of a
// widening step, chosen by the FR-220 order (spec 007 FR-219, FR-220, FR-228, NFR-43; plan 007 PD3, PD4, PD5 and
// section 6). Pure. The disc, every tie and the prune thresholds are decided with BigInt and whole numbers
// (`label-centre.ts`); fit tests are the 005 box rule and the 006 straight footprints, unchanged. The doubles used
// here only choose which cells and rows to look at (supersets with a margin of two units): the pinned tests decide.
import type { CentreParams } from './centre-params';
import { axisAngle, axisExtent, shapesOf } from './label-axis';
import type { Shape } from './label-axis';
import { boxDistance, boxRowInterval, centreSums, compareKeys, dyadic, endStep, factionHeightCap, regionBox, unitDistance, unitRowInterval } from './label-centre';
import type { CentreKey, CentreSums, RegionBox } from './label-centre';
import type { LabelRole } from './label-frame';
import type { LabelBox, LayoutParams } from './label-layout';
import { arcRadius, arcSearch, squaredDistanceMap, straightFootprint } from './label-shape';
import type { ArcFrame, DistanceMap, Footprint, InLandFrame, StraightFrame } from './label-shape';
import type { PieceIndex } from './regions';
import type { ShapeParams } from './shape-params';

/** The centred candidate: a horizontal 005 box or a straight frame. */
export type CentredFrame = { shape: 'horizontal'; box: LabelBox } | StraightFrame;

/** `prune: false` runs the plain definition (no distance prune, no relaxed height bound): used by the tests. */
export interface CentredOptions {
  prune?: boolean;
  /** Filled with the heights found (0: none) and the upper bound of the relaxed horizontal search: for the figures and the logs. */
  report?: { hStraight: number; angleStraight: number; hHorizontal: number; horizontalBound: number };
}

/** Cells of the set in the exact disc of one step, or in a superset disc, in descending squared distance to the non-set. */
interface Cells {
  cells: Int32Array;
  /** One byte per window cell, 1 for the cells of the list; built when the arc search first needs it. */
  mask?: Uint8Array;
}

/** The arc shapes of a label set (tangent theta* at the midpoint) and the axis extent L, computed once per label. */
export interface ArcAxis {
  extent: number;
  /** The arc shapes in the 006 shape order (empty when no arc can meet the tangent limit or L = 0). */
  arcs: readonly Shape[];
  /** The largest height an arc frame of these shapes can have (R - h / 2 - M > 0 with some slack): a superset bound. */
  heightBound: number;
}

/** Per-label data computed once and shared by every step k (plan PD7). */
export interface CentredCache {
  sums: CentreSums;
  box: RegionBox;
  aspect: number;
  margin: number;
  /** The window of the set (box plus a ring); d2 holds the exact squared distances, or 0 / 1 (set) when `distance` is false. */
  map: DistanceMap;
  /** True when `map.d2` is the exact distance map (it enables the distance prune); false: set membership only. */
  distance: boolean;
  /** Consecutive set cells from a cell to the right (0 for a cell outside the set), over the distance-map window. */
  right: Int32Array;
  /** Length of the whole horizontal run of set cells through a cell (0 outside the set); built when first needed. */
  through: Int32Array | undefined;
  /** Sx / n and Sy / n as doubles: only to bound row and cell ranges (supersets). */
  mx: number;
  my: number;
  /** The number of units as a double: only for supersets. */
  count: number;
  discs: Map<number, Cells>;
  wides: Map<number, Cells>;
  discParams: CentreParams | undefined;
  /** The arc shapes and extent, built when the first arc search runs (plan PD7). */
  axis: ArcAxis | undefined;
  /** The exact distance map used by the arc search when `distance` is false; built when first needed. */
  arcMap: DistanceMap | undefined;
}

/** Slack of the distance prune, scaled: 2 eps = 1/512 (eps = 1/1024 map unit, far above the rounding of the pinned formulas). */
const SLACK_DENOMINATOR = 512n;

/** The relaxed height bound is built only when more than this many heights would otherwise be scanned one by one. */
const RELAXED_LEVELS = 8;

/** Largest threshold returned (a squared distance above any image of up to 2^16 units a side). */
const THRESHOLD_CAP = 1099511627776;

/**
 * The smallest squared distance d2 (whole) of a unit centre to the nearest non-set unit centre that the prune does
 * NOT skip, for a frame whose inscribed disc has the diameter m + 2M (m = min(h, w), exact as W / 2^E) lowered by
 * `extra` (0 for straight frames, 2 for the unit holding a box centre: it lies within 1 of the centre of the box).
 * A frame is skipped iff Q > 0 and 4 d2 < Q^2 with Q = m + 2M - extra - 1/512; every non-set unit centre that close
 * lies inside the grown rectangle, so the pinned fit test rejects the frame. Exact, in BigInt.
 */
export function distanceThreshold(m: number, margin: number, extra: number): number {
  const { W, E } = dyadic(m);
  const e = BigInt(E);
  // Q scaled by 512 * 2^E
  const q = SLACK_DENOMINATOR * W + (SLACK_DENOMINATOR * BigInt(2 * margin - extra) - 1n) * (1n << e);
  if (q <= 0n) return 0;
  const den = 4n * SLACK_DENOMINATOR * SLACK_DENOMINATOR * (1n << (2n * e));
  const t = (q * q + den - 1n) / den;
  return t > BigInt(THRESHOLD_CAP) ? THRESHOLD_CAP : Number(t);
}

function checkInputs(aspect: number, margin: number): void {
  if (!(typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0)) throw new RangeError(`label aspect must be a positive finite number, got ${String(aspect)}`);
  if (!Number.isInteger(margin) || margin < 1) throw new RangeError(`label margin must be a whole number >= 1, got ${String(margin)}`);
}

/** The window of a set of pieces (box plus a one-unit ring) with 1 for a set cell and 0 elsewhere: no distances. */
function membershipMap(p: PieceIndex, pieces: readonly number[], box: RegionBox): DistanceMap {
  const x0 = box.xmin - 1;
  const y0 = box.ymin - 1;
  const w = box.xmax - box.xmin + 3;
  const h = box.ymax - box.ymin + 3;
  const d2 = new Int32Array(w * h);
  for (const piece of pieces) {
    for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
      const u = p.units[k]!;
      const x = u % p.width;
      const y = (u - x) / p.width;
      d2[(y - y0) * w + (x - x0)] = 1;
    }
  }
  return { x0, y0, w, h, d2 };
}

/**
 * The per-label cache of a non-empty set of pieces. `distance` builds the exact distance map that enables the distance
 * prune (plan PD5); the default is off: measured in Node on the dev map, the map costs about 110 ms for Francia at
 * round 4 and 0 ms of the territory total are saved by the prune (T3 log), so the cache then holds set membership only.
 */
export function centredCache(p: PieceIndex, pieces: readonly number[], aspect: number, margin: number, distance = false): CentredCache {
  checkInputs(aspect, margin);
  const sums = centreSums(p, pieces);
  const box = regionBox(p, pieces);
  const map = distance ? squaredDistanceMap(p, pieces) : membershipMap(p, pieces, box);
  const { w: mw, h: mh, d2 } = map;
  const right = new Int32Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    for (let x = mw - 1; x >= 0; x--) {
      const cell = y * mw + x;
      if (d2[cell]! > 0) right[cell] = (x + 1 < mw ? right[cell + 1]! : 0) + 1;
    }
  }
  const n = Number(sums.n);
  return {
    sums,
    box,
    aspect,
    margin,
    map,
    distance,
    right,
    through: undefined,
    mx: Number(sums.sx) / n,
    my: Number(sums.sy) / n,
    count: n,
    discs: new Map(),
    wides: new Map(),
    discParams: undefined,
    axis: undefined,
    arcMap: undefined,
  };
}

/** k q sqrt(n) as a double, plus a margin of two units: a radius for supersets only (never decides). */
function reachOf(c: CentredCache, cp: CentreParams, k: number, extra: number): number {
  return k * ((cp.centreFraction.num / cp.centreFraction.den) * Math.sqrt(c.count)) + extra;
}

function throughOf(c: CentredCache): Int32Array {
  if (c.through !== undefined) return c.through;
  const { w: mw, h: mh, d2 } = c.map;
  const through = new Int32Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    let x = 0;
    while (x < mw) {
      if (d2[y * mw + x]! === 0) {
        x++;
        continue;
      }
      let end = x;
      while (end < mw && d2[y * mw + end]! > 0) end++;
      for (let i = x; i < end; i++) through[y * mw + i] = end - x;
      x = end;
    }
  }
  c.through = through;
  return through;
}

/** The cells of `list` (window cell indices) sorted by descending squared distance to the non-set. */
function sortedByDistance(c: CentredCache, list: readonly number[]): Cells {
  const { w: mw, h: mh, d2 } = c.map;
  const size = mw * mh;
  const keys = new Float64Array(list.length);
  for (let i = 0; i < list.length; i++) keys[i] = d2[list[i]!]! * size + list[i]!;
  keys.sort();
  const cells = new Int32Array(list.length);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[keys.length - 1 - i]!;
    cells[i] = key % size;
  }
  return { cells };
}

/** The set cells whose unit centre is in the exact centre disc of step k (row intervals, plan PD3). */
function discOf(c: CentredCache, cp: CentreParams, k: number): Cells {
  if (c.discParams !== cp) {
    c.discs.clear();
    c.wides.clear();
    c.discParams = cp;
  }
  const known = c.discs.get(k);
  if (known !== undefined) return known;
  const { x0: wx, y0: wy, w: mw, d2 } = c.map;
  const reach = reachOf(c, cp, k, 2);
  const list: number[] = [];
  const yLo = Math.max(c.box.ymin, Math.floor(c.my - reach));
  const yHi = Math.min(c.box.ymax, Math.ceil(c.my + reach));
  for (let cy = yLo; cy <= yHi; cy++) {
    const iv = unitRowInterval(c.sums, cp, k, cy);
    if (iv === undefined) continue;
    const lo = Math.max(iv[0], c.box.xmin);
    const hi = Math.min(iv[1], c.box.xmax);
    for (let cx = lo; cx <= hi; cx++) {
      const cell = (cy - wy) * mw + (cx - wx);
      if (d2[cell]! > 0) list.push(cell);
    }
  }
  const out = sortedByDistance(c, list);
  c.discs.set(k, out);
  return out;
}

/**
 * A superset of the cells that can contain the centre of a box in the disc of step k: the set cells whose centre is
 * within k rho + 1.5 of C (the cell of a box centre is within 0.71 of it). Doubles with a margin: a superset only.
 */
function wideOf(c: CentredCache, cp: CentreParams, k: number): Cells {
  discOf(c, cp, k); // also resets the caches when the parameters change
  const known = c.wides.get(k);
  if (known !== undefined) return known;
  const { x0: wx, y0: wy, w: mw, d2 } = c.map;
  const reach = reachOf(c, cp, k, 1.5);
  const list: number[] = [];
  const yLo = Math.max(c.box.ymin, Math.floor(c.my - reach));
  const yHi = Math.min(c.box.ymax, Math.ceil(c.my + reach));
  for (let cy = yLo; cy <= yHi; cy++) {
    const dy = cy - c.my;
    const rest = reach * reach - dy * dy;
    if (rest < 0) continue;
    const half = Math.sqrt(rest);
    const lo = Math.max(Math.ceil(c.mx - half), c.box.xmin);
    const hi = Math.min(Math.floor(c.mx + half), c.box.xmax);
    for (let cx = lo; cx <= hi; cx++) {
      const cell = (cy - wy) * mw + (cx - wx);
      if (d2[cell]! > 0) list.push(cell);
    }
  }
  const out = sortedByDistance(c, list);
  c.wides.set(k, out);
  return out;
}

/** The 005 fit (columns and rows of set units), for any whole x0, y0 and h with w = h * aspect: false outside the set's box. */
export function boxFits(c: CentredCache, x0: number, y0: number, h: number, w: number): boolean {
  const m = c.margin;
  const cols = 2 * m + Math.floor(w - 0.5) + 1;
  const rows = h + 2 * m;
  const first = x0 - m;
  const top = y0 - m;
  if (first < c.box.xmin || first + cols - 1 > c.box.xmax || top < c.box.ymin || top + rows - 1 > c.box.ymax) return false;
  return boxFitsInside(c, x0, y0, cols, rows);
}

/** `boxFits` for a box already known to lie inside the box of the set: the rows from the extremes inwards. */
function boxFitsInside(c: CentredCache, x0: number, y0: number, cols: number, rows: number): boolean {
  const { right } = c;
  const mw = c.map.w;
  const base = x0 - c.margin - c.map.x0;
  const r0 = y0 - c.margin - c.map.y0;
  if (right[r0 * mw + base]! < cols || right[(r0 + rows - 1) * mw + base]! < cols) return false;
  for (let r = 1; r < rows - 1; r++) if (right[(r0 + r) * mw + base]! < cols) return false;
  return true;
}

/** True when the footprint, placed at the window cell, holds only set cells (straight frames have no edge cells). */
function footprintFits(c: CentredCache, fp: Footprint, cell: number): boolean {
  const { w: mw, h: mh } = c.map;
  const { rows } = fp;
  const y = Math.floor(cell / mw);
  const x = cell - y * mw;
  for (let i = 0; i < rows.length; i += 3) {
    const ix = x + rows[i + 1]!;
    const iy = y + rows[i]!;
    if (ix < 0 || iy < 0 || ix >= mw || iy >= mh || c.right[iy * mw + ix]! < rows[i + 2]!) return false;
  }
  return true;
}

/**
 * Index of the nearest candidate: the exact squared centre distance, then the smallest y, then the smallest x
 * (FR-220 steps 5 to 7). `approx` is a double estimate of the distance used only to drop the candidates that cannot
 * tie with the nearest (a margin of 1e-9 relative); the exact keys decide among the rest.
 */
export function nearestFrame(count: number, approx: (i: number) => number, key: (i: number) => CentreKey, y: (i: number) => number, x: (i: number) => number): number {
  let dmin = Infinity;
  for (let i = 0; i < count; i++) dmin = Math.min(dmin, approx(i));
  const limit = dmin * (1 + 1e-9) + 1e-9;
  let best = -1;
  let bestKey: CentreKey | undefined;
  for (let i = 0; i < count; i++) {
    if (approx(i) > limit) continue;
    const ki = key(i);
    const d = bestKey === undefined ? -1 : compareKeys(ki, bestKey);
    if (d < 0 || (d === 0 && (y(i) < y(best) || (y(i) === y(best) && x(i) < x(best))))) {
      best = i;
      bestKey = ki;
    }
  }
  return best;
}

/**
 * The centred candidate of a label at step k (FR-219, FR-220): among the horizontal frames and the straight frames at
 * +-15, +-30 and +-45 degrees that fit and whose centre lies in the disc of step k, with heights from 1 up to `top`
 * (undefined: only the size of the region), the frame of the largest height; at equal height horizontal first, then the
 * first straight angle of `cp.straightAngles`; then the smallest exact squared distance to C, the smallest centre y and
 * the smallest centre x. Undefined when nothing fits.
 */
export function centredCandidate(
  p: PieceIndex,
  pieces: readonly number[],
  aspect: number,
  margin: number,
  cp: CentreParams,
  k: number,
  c: CentredCache,
  top: number | undefined,
  options?: CentredOptions,
): CentredFrame | undefined {
  checkInputs(aspect, margin);
  if (pieces.length === 0 || p.width === 0) return undefined;
  const usePrune = options?.prune !== false; // false: the plain definition
  const thresholds = usePrune && c.distance; // the distance prune needs the exact distance map
  const { box, map, sums } = c;
  const { w: mw, d2 } = map;
  const bound = box.xmax - box.xmin + 1 + (box.ymax - box.ymin + 1);
  const topH = Math.min(top ?? bound, bound);
  if (topH < 1) return undefined;
  const disc = discOf(c, cp, k).cells;

  // ---- straight frames: for each angle, the largest height by binary search (the grown rectangle only grows with h)
  const footprints = new Map<string, Footprint>();
  const footprintAt = (angle: number, h: number): Footprint => {
    const id = `${String(angle)}|${String(h)}`;
    let fp = footprints.get(id);
    if (fp === undefined) {
      fp = straightFootprint(angle, h * aspect, h, margin);
      footprints.set(id, fp);
    }
    return fp;
  };
  /** Visits the fitting centre cells of a straight shape at height h in descending distance order; stops when `visit` returns true. */
  const straightEach = (angle: number, h: number, visit: (cell: number) => boolean): void => {
    const w = h * aspect;
    const thr = thresholds ? distanceThreshold(Math.min(h, w), margin, 0) : 0;
    if (disc.length === 0 || d2[disc[0]!]! < thr) return;
    const fp = footprintAt(angle, h);
    for (let i = 0; i < disc.length; i++) {
      const cell = disc[i]!;
      if (d2[cell]! < thr) break;
      if (footprintFits(c, fp, cell) && visit(cell)) return;
    }
  };
  const straightAny = (angle: number, h: number): boolean => {
    let found = false;
    straightEach(angle, h, () => (found = true));
    return found;
  };
  let hS = 0;
  let angleS = 0;
  // With a cap (a faction label), the cap first, for every angle: when it fits the first such angle wins (FR-220
  // steps 3 and 4) and nothing needs to be searched. Without a cap the region size is no height anyone reaches.
  let hiAll = topH;
  if (top !== undefined) {
    for (const angle of cp.straightAngles) {
      if (straightAny(angle, topH)) {
        hS = topH;
        angleS = angle;
        break;
      }
    }
    hiAll = topH - 1;
  }
  if (hS === 0) {
    for (const angle of cp.straightAngles) {
      const start = hS + 1; // a later angle wins only with a strictly larger height
      if (start > hiAll || !straightAny(angle, start)) continue;
      let lo = start;
      let hi = hiAll;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (straightAny(angle, mid)) lo = mid;
        else hi = mid - 1;
      }
      hS = lo;
      angleS = angle;
    }
  }

  // ---- horizontal frames: the centre moves with h, so no binary search; a monotone necessary bound, then a scan down
  const colsOf = (w: number): number => 2 * margin + Math.floor(w - 0.5) + 1;
  const relaxed = (h: number): boolean => {
    const w = h * aspect;
    const cols = colsOf(w);
    const thr = thresholds ? distanceThreshold(Math.min(h, w), margin, 2) : 0;
    const through = throughOf(c);
    const wide = wideOf(c, cp, k).cells;
    for (let i = 0; i < wide.length; i++) {
      const cell = wide[i]!;
      if (d2[cell]! < thr) break;
      if (through[cell]! >= cols) return true;
    }
    return false;
  };
  let ub = topH;
  if (usePrune && topH - Math.max(hS, 1) > RELAXED_LEVELS) {
    if (!relaxed(1)) ub = 0;
    else {
      let lo = 1;
      let hi = topH;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (relaxed(mid)) lo = mid;
        else hi = mid - 1;
      }
      ub = lo;
    }
  }
  const boxH = box.ymax - box.ymin + 1;
  const boxW = box.xmax - box.xmin + 1;
  /** Visits the fitting boxes (x0, y0) of height h with the centre in the disc, row by row; stops when `visit` returns true. */
  const horizontalEach = (h: number, visit: (x0: number, y0: number) => boolean): void => {
    const w = h * aspect;
    const cols = colsOf(w);
    const rows = h + 2 * margin;
    if (rows > boxH || cols > boxW) return;
    const thr = thresholds ? distanceThreshold(Math.min(h, w), margin, 2) : 0;
    const reach = reachOf(c, cp, k, 2);
    const cyd = c.my + 0.5; // C y
    const yLo = Math.max(box.ymin + margin, Math.ceil(cyd - reach - h / 2));
    const yHi = Math.min(box.ymax - h - margin + 1, Math.floor(cyd + reach - h / 2));
    const xLoBox = box.xmin + margin;
    const xHiBox = box.xmax - margin - Math.floor(w - 0.5);
    for (let y0 = yLo; y0 <= yHi; y0++) {
      const iv = boxRowInterval(sums, cp, k, y0, h, w);
      if (iv === undefined) continue;
      const hi = Math.min(iv[1], xHiBox);
      for (let x0 = Math.max(iv[0], xLoBox); x0 <= hi; x0++) {
        if (thr > 0) {
          const cell = (y0 + Math.floor(h / 2) - map.y0) * mw + (Math.floor(x0 + w / 2) - map.x0);
          if (d2[cell]! < thr) continue;
        }
        if (boxFitsInside(c, x0, y0, cols, rows) && visit(x0, y0)) return;
      }
    }
  };
  let hH = 0;
  for (let h = Math.min(ub, topH); h >= Math.max(hS, 1); h--) {
    let found = false;
    horizontalEach(h, () => (found = true));
    if (found) {
      hH = h;
      break;
    }
  }

  if (options?.report !== undefined) Object.assign(options.report, { hStraight: hS, angleStraight: angleS, hHorizontal: hH, horizontalBound: ub });

  // ---- the winner among the frames of the winning height
  if (hH > 0) {
    const w = hH * aspect;
    const xs: number[] = [];
    const ys: number[] = [];
    horizontalEach(hH, (x0, y0) => {
      xs.push(x0);
      ys.push(y0);
      return false;
    });
    const mxd = c.mx + 0.5;
    const myd = c.my + 0.5;
    const win = nearestFrame(
      xs.length,
      (i) => {
        const dx = xs[i]! + w / 2 - mxd;
        const dy = ys[i]! + hH / 2 - myd;
        return dx * dx + dy * dy;
      },
      (i) => boxDistance(sums, xs[i]!, ys[i]!, hH, w),
      (i) => ys[i]!,
      (i) => xs[i]!,
    );
    return { shape: 'horizontal', box: { x0: xs[win]!, y0: ys[win]!, h: hH, w } };
  }
  if (hS > 0) {
    const w = hS * aspect;
    const xs: number[] = [];
    const ys: number[] = [];
    straightEach(angleS, hS, (cell) => {
      const y = Math.floor(cell / mw);
      xs.push(cell - y * mw + map.x0);
      ys.push(y + map.y0);
      return false;
    });
    const win = nearestFrame(
      xs.length,
      (i) => {
        const dx = xs[i]! - c.mx;
        const dy = ys[i]! - c.my;
        return dx * dx + dy * dy;
      },
      (i) => unitDistance(sums, xs[i]!, ys[i]!),
      (i) => ys[i]!,
      (i) => xs[i]!,
    );
    return { shape: 'straight', cx: xs[win]! + 0.5, cy: ys[win]! + 0.5, angle: angleS, h: hS, w };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------
// Arcs, the FR-221 choice, the FR-222 widening and the faction cap (spec 007 FR-221, FR-222, FR-230; plan PD6 to PD8).
// ---------------------------------------------------------------------------------------------------------

/** The height of an in-land frame (a horizontal frame is a box). */
export function frameHeight(f: InLandFrame): number {
  return f.shape === 'horizontal' ? f.box.h : f.h;
}

/** The smallest arc height the FR-221 choice can use: ceil(G x hC) (G = 1.25), or 1 when there is no centred candidate. */
export function arcMinHeight(centredHeight: number | undefined, sp: ShapeParams): number {
  return centredHeight === undefined ? 1 : Math.ceil(sp.shapeGain * centredHeight);
}

/**
 * The FR-221 choice: the arc candidate IF it exists AND (no centred candidate exists OR its height is at least
 * G x the centred candidate's height), otherwise the centred candidate (possibly none).
 */
export function chooseInLand(arc: ArcFrame | undefined, centred: CentredFrame | undefined, sp: ShapeParams): InLandFrame | undefined {
  if (arc !== undefined && (centred === undefined || arc.h >= arcMinHeight(frameHeight(centred), sp))) return arc;
  return centred;
}

/** The arc shapes of the label set and the axis extent, cached in the label cache. */
function axisOf(p: PieceIndex, pieces: readonly number[], sp: ShapeParams, cp: CentreParams, margin: number, c: CentredCache): ArcAxis {
  if (c.axis !== undefined) return c.axis;
  const theta = axisAngle(p, pieces);
  const extent = axisExtent(p, pieces, theta);
  // |theta| above the limit: theta + alpha > limit (or theta - alpha < -limit) for every alpha > 0, so no arc can exist.
  const arcs = Math.abs(theta) > cp.angleLimit ? [] : shapesOf(theta, extent, sp).filter((s) => s.shape === 'arc');
  let heightBound = 0;
  for (const s of arcs) {
    if (s.shape === 'arc') heightBound = Math.max(heightBound, Math.floor(2 * (arcRadius(extent, s.bend) - margin)) + 1);
  }
  c.axis = { extent, arcs, heightBound };
  return c.axis;
}

/** One byte per window cell of the cells of a list (a list of window cell indices). */
function maskOf(c: CentredCache, cells: Cells): Uint8Array {
  if (cells.mask !== undefined) return cells.mask;
  const mask = new Uint8Array(c.map.w * c.map.h);
  for (let i = 0; i < cells.cells.length; i++) mask[cells.cells[i]!] = 1;
  cells.mask = mask;
  return mask;
}

/**
 * The arc candidate of a label at step k (FR-221): among the arc shapes of the 006 list whose every tangent is within
 * `cp.angleLimit` (both roles, P18) and that fit with the centre in the disc of step k, at heights from
 * max(1, minHeight) up to `top` (undefined: only fit and arc existence bound it), the frame of the largest height; the
 * first shape in shape order; then the smallest exact squared centre distance, the smallest y and the smallest x (P14).
 * The search is the 006 `arcSearch`; undefined when there is none.
 */
export function arcCandidate(
  p: PieceIndex,
  pieces: readonly number[],
  aspect: number,
  margin: number,
  sp: ShapeParams,
  cp: CentreParams,
  k: number,
  c: CentredCache,
  minHeight: number,
  top: number | undefined,
): ArcFrame | undefined {
  checkInputs(aspect, margin);
  if (pieces.length === 0 || p.width === 0) return undefined;
  const axis = axisOf(p, pieces, sp, cp, margin, c);
  if (axis.arcs.length === 0) return undefined;
  const { box, sums } = c;
  const bound = box.xmax - box.xmin + 1 + (box.ymax - box.ymin + 1);
  const topH = Math.min(top ?? bound, bound, axis.heightBound);
  const lo = Math.max(1, minHeight);
  if (lo > topH) return undefined;
  const disc = discOf(c, cp, k);
  if (disc.cells.length === 0) return undefined;
  const mask = maskOf(c, disc);
  const { x0: wx, y0: wy, w: mw, h: mh } = c.map;
  const centre = (x: number, y: number): boolean => {
    const ix = x - wx;
    const iy = y - wy;
    return ix >= 0 && iy >= 0 && ix < mw && iy < mh && mask[iy * mw + ix]! === 1;
  };
  const winner = (xs: readonly number[], ys: readonly number[]): number =>
    nearestFrame(
      xs.length,
      (i) => {
        const dx = xs[i]! - c.mx;
        const dy = ys[i]! - c.my;
        return dx * dx + dy * dy;
      },
      (i) => unitDistance(sums, xs[i]!, ys[i]!),
      (i) => ys[i]!,
      (i) => xs[i]!,
    );
  let map = c.distance ? c.map : c.arcMap;
  if (map === undefined) {
    map = squaredDistanceMap(p, pieces);
    c.arcMap = map;
  }
  const frame = arcSearch(p, pieces, aspect, margin, axis.arcs, { extent: axis.extent, top: topH, minHeight: lo, limit: cp.angleLimit, centre, winner, map });
  return frame?.shape === 'arc' ? frame : undefined;
}

/** The in-land frame of a label after the FR-222 widening, the step it was chosen at, and the end step of its region. */
export interface InLandResult {
  frame: InLandFrame | undefined;
  /** The last step tried (1 when the first disc already gives a frame of `offLandHeight`). */
  k: number;
  kEnd: number;
}

/**
 * The in-land frame of a label set (FR-218 to FR-222, FR-230), from its pieces, text aspect and the parameters only
 * (FR-223): at step k = 1, 2, ... the centred candidate and the arc candidate (minimum height ceil(G x hC)), the FR-221
 * choice; the loop stops at the first step whose frame reaches `offLandHeight` of the role or at kEnd, and the frame of
 * the last step tried is kept (none if none fits even at kEnd). A faction label has the FR-230 cap on every shape.
 */
export function centredInLand(
  p: PieceIndex,
  pieces: readonly number[],
  aspect: number,
  role: LabelRole,
  params: LayoutParams,
  sp: ShapeParams,
  cp: CentreParams,
): InLandResult {
  checkInputs(aspect, params.margin);
  if (pieces.length === 0 || p.width === 0) return { frame: undefined, k: 0, kEnd: 0 };
  const margin = params.margin;
  const cache = centredCache(p, pieces, aspect, margin);
  const top = role === 'faction' ? factionHeightCap(cache.sums.n, aspect, cp.factionAreaShare) : undefined;
  const kEnd = endStep(cache.sums, cp, cache.box);
  const stopAt = sp.offLandHeight[role];
  let frame: InLandFrame | undefined;
  let k = 1;
  for (;;) {
    const centred = centredCandidate(p, pieces, aspect, margin, cp, k, cache, top);
    const arc = arcCandidate(p, pieces, aspect, margin, sp, cp, k, cache, arcMinHeight(centred === undefined ? undefined : frameHeight(centred), sp), top);
    frame = chooseInLand(arc, centred, sp);
    if ((frame !== undefined && frameHeight(frame) >= stopAt) || k >= kEnd) break;
    k++;
  }
  return { frame, k, kEnd };
}
