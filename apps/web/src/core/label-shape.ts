// Shaped label frames: membership of unit centres in the grown footprints, the shaped candidate and the in-land
// frame choice (spec 006 FR-195, FR-197, FR-198, FR-199, NFR-38, NFR-39; plan sections 5 and 6).
// Pure. Every formula is the spec "Number reference" in the written order, in IEEE-754 doubles, with only
// + - * / Math.sqrt Math.abs Math.min Math.max Math.floor Math.ceil Math.PI. Squares are products x * x.
import { axisAngle, axisExtent, shapesOf } from './label-axis';
import type { Shape } from './label-axis';
import type { LabelBox, LayoutParams } from './label-layout';
import type { PieceIndex } from './regions';
import { cs } from './shape-params';
import type { ShapeParams } from './shape-params';

/** A straight frame: a rectangle of length w along the reading direction `angle` (degrees) and height h across it. */
export interface StraightFrame {
  shape: 'straight';
  cx: number;
  cy: number;
  angle: number;
  h: number;
  w: number;
}

/**
 * An arc frame: the middle line is a circular arc of length w and radius R whose midpoint is (cx, cy) and whose
 * tangent there has the screen angle `angle`; `bend` is the signed turn over the axis extent L, R = L / |bend|.
 */
export interface ArcFrame {
  shape: 'arc';
  cx: number;
  cy: number;
  angle: number;
  h: number;
  w: number;
  bend: number;
  radius: number;
}

export type ShapedFrame = StraightFrame | ArcFrame;

/** The in-land frame of a label: the 005 box (horizontal) or a shaped frame (FR-198). */
export type InLandFrame = { shape: 'horizontal'; box: LabelBox } | ShapedFrame;

/**
 * Spec: "dx = px - cx, dy = py - cy; u = (dx * C) - (dy * S); v = (dx * S) + (dy * C); inside the grown rectangle
 * iff Math.abs(u) <= ((h * a) / 2) + M and Math.abs(v) <= (h / 2) + M". `f.w` is h * a.
 */
export function inStraight(f: StraightFrame, margin: number, px: number, py: number): boolean {
  const { c, s } = cs(f.angle);
  const dx = px - f.cx;
  const dy = py - f.cy;
  const u = dx * c - dy * s;
  const v = dx * s + dy * c;
  return Math.abs(u) <= f.w / 2 + margin && Math.abs(v) <= f.h / 2 + margin;
}

/** Spec: "R = L / b" with "b = (|bend| * Math.PI) / 180". */
export function arcRadius(extent: number, bend: number): number {
  const b = (Math.abs(bend) * Math.PI) / 180;
  return extent / b;
}

/**
 * Spec: an arc frame exists iff "R - (h / 2) - M > 0" and, with "alpha = ((h * a) * |bend|) / (2 * L)" (degrees),
 * "theta - alpha > -90" and "theta + alpha <= 90". No arc frame exists when L = 0.
 */
export function arcExists(f: ArcFrame, extent: number, margin: number): boolean {
  if (!(extent > 0)) return false;
  if (!(f.radius - f.h / 2 - margin > 0)) return false;
  const alpha = (f.w * Math.abs(f.bend)) / (2 * extent);
  return f.angle - alpha > -90 && f.angle + alpha <= 90;
}

/**
 * The cosine polynomial K(phi) = 1 - (z / 2) * (1 - (z / 12) * (1 - (z / 30) * (... * (1 - z / 552)))), z = phi * phi,
 * the denominators (2k - 1)(2k) for k = 1 to 12, evaluated from the innermost bracket outwards.
 */
export function cosK(phi: number): number {
  const z = phi * phi;
  let t = 1 - z / 552;
  for (let k = 11; k >= 1; k--) t = 1 - (z / ((2 * k - 1) * (2 * k))) * t;
  return t;
}

/**
 * Spec: circle centre "Ox = cx - sigma * (R * S), Oy = cy - sigma * (R * C)"; with "vx = px - Ox, vy = py - Oy,
 * r2 = (vx * vx) + (vy * vy)": radial "(R - (h / 2) - M)^2 <= r2 <= (R + (h / 2) + M)^2", angular
 * "sigma * ((vx * S) + (vy * C)) >= K(phi) * sqrt(r2)" with "phi = ((h * a) + (2 * M)) / (2 * R)".
 */
export function inArc(f: ArcFrame, margin: number, px: number, py: number): boolean {
  const { c, s } = cs(f.angle);
  const sigma = f.bend > 0 ? 1 : -1;
  const r = f.radius;
  const ox = f.cx - sigma * (r * s);
  const oy = f.cy - sigma * (r * c);
  const vx = px - ox;
  const vy = py - oy;
  const r2 = vx * vx + vy * vy;
  const inner = r - f.h / 2 - margin;
  const outer = r + f.h / 2 + margin;
  if (!(inner * inner <= r2 && r2 <= outer * outer)) return false;
  const phi = (f.w + 2 * margin) / (2 * r);
  return sigma * (vx * s + vy * c) >= cosK(phi) * Math.sqrt(r2);
}

// ---------------------------------------------------------------------------------------------------------
// The shaped candidate and the in-land frame choice (plan D2 and section 6; FR-195, FR-197, FR-198, NFR-38).
// The search is the definition (every height from Hmax down, every shape in shape order, every centre) with two
// exact prunes: a centre must be a unit of the set whose exact squared distance to the nearest non-set unit
// centre is at least (rho - EPS)^2, rho the radius of a disc proved to lie in the grown footprint; and heights
// below ceil(G * hH) are not searched (a lower shaped frame cannot win FR-198).
// ---------------------------------------------------------------------------------------------------------

/** EPS of the disc filter, in map units: far above any rounding of the pinned formulas for coordinates below 2^12. */
export const DISC_EPS = 1e-6;

/** Slack of the bounding boxes scanned for a frame (a superset only; the pinned formulas decide membership). */
const BOX_PAD = 1e-3;

/** True when a centre whose nearest non-set unit centre is at squared distance `edt2` can still fit: edt2 >= (rho - EPS)^2. */
export function discAllows(edt2: number, rho: number): boolean {
  const r = rho - DISC_EPS;
  return !(r > 0) || edt2 >= r * r;
}

/** The exact squared distance of every unit of a set to the nearest non-set unit centre, over the set's box plus a one-unit ring. */
export interface DistanceMap {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Row-major over the window; 0 for a cell that is not in the set (the ring included), at least 1 for a set unit. */
  d2: Int32Array;
}

/**
 * The squared distance map of a set of pieces (units outside the image count as non-set). Exact whole numbers:
 * a vertical pass gives the distance to the nearest non-set cell in the column, then the integer lower-envelope
 * pass of Meijster, Roerdink and Hesselink gives the squared distance in every row.
 */
export function squaredDistanceMap(p: PieceIndex, pieces: readonly number[]): DistanceMap {
  let bx0 = p.width;
  let by0 = p.height;
  let bx1 = -1;
  let by1 = -1;
  for (const piece of pieces) {
    bx0 = Math.min(bx0, p.box[4 * piece]!);
    by0 = Math.min(by0, p.box[4 * piece + 1]!);
    bx1 = Math.max(bx1, p.box[4 * piece + 2]!);
    by1 = Math.max(by1, p.box[4 * piece + 3]!);
  }
  const x0 = bx0 - 1;
  const y0 = by0 - 1;
  const w = bx1 - bx0 + 3;
  const h = by1 - by0 + 3;
  const g = new Int32Array(w * h); // vertical distance to the nearest non-set cell; 0 = not in the set
  for (const piece of pieces) {
    for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
      const u = p.units[k]!;
      const x = u % p.width;
      const y = (u - x) / p.width;
      g[(y - y0) * w + (x - x0)] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 1; y < h; y++) if (g[y * w + x]! !== 0) g[y * w + x] = g[(y - 1) * w + x]! + 1;
  }
  for (let x = 0; x < w; x++) {
    for (let y = h - 2; y >= 0; y--) {
      const below = g[(y + 1) * w + x]! + 1;
      if (g[y * w + x]! > below) g[y * w + x] = below;
    }
  }
  // After the passes the top and bottom rows are 0 (ring), so every column holds a non-set cell: g is finite.
  const d2 = new Int32Array(w * h);
  const s = new Int32Array(w);
  const t = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const f = (x: number, i: number): number => (x - i) * (x - i) + g[row + i]! * g[row + i]!;
    const sep = (i: number, u: number): number => Math.floor((u * u - i * i + g[row + u]! * g[row + u]! - g[row + i]! * g[row + i]!) / (2 * (u - i)));
    let q = 0;
    s[0] = 0;
    t[0] = 0;
    for (let u = 1; u < w; u++) {
      while (q >= 0 && f(t[q]!, s[q]!) > f(t[q]!, u)) q--;
      if (q < 0) {
        q = 0;
        s[0] = u;
      } else {
        const w1 = 1 + sep(s[q]!, u);
        if (w1 < w) {
          q++;
          s[q] = u;
          t[q] = w1;
        }
      }
    }
    for (let u = w - 1; u >= 0; u--) {
      d2[row + u] = g[row + u]! === 0 ? 0 : f(u, s[q]!);
      if (u === t[q]!) q--;
    }
  }
  return { x0, y0, w, h, d2 };
}

function checkInputs(aspect: number, params: LayoutParams): void {
  if (!(typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0)) throw new RangeError(`label aspect must be a positive finite number, got ${String(aspect)}`);
  if (!Number.isInteger(params.margin) || params.margin < 1) throw new RangeError(`label margin must be a whole number >= 1, got ${String(params.margin)}`);
  if (!Number.isInteger(params.maxHeight) || params.maxHeight < 1) {
    throw new RangeError(`label maximum height must be a whole number >= 1, got ${String(params.maxHeight)}`);
  }
}

/**
 * The index of the centre that wins FR-197: the smallest squared distance to the mean of the centres, decided
 * exactly ("(n * x - Sx)^2 + (n * y - Sy)^2" in whole numbers), then the smallest y, then the smallest x.
 */
function centreWinner(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const approx = (i: number): number => {
    const dx = n * xs[i]! - sx;
    const dy = n * ys[i]! - sy;
    return dx * dx + dy * dy; // only a prefilter: the exact BigInt comparison below decides
  };
  let dmin = Infinity;
  for (let i = 0; i < n; i++) dmin = Math.min(dmin, approx(i));
  const limit = dmin * (1 + 1e-9) + 1;
  const bigN = BigInt(n);
  const bigSx = BigInt(sx);
  const bigSy = BigInt(sy);
  let best = -1;
  let bestD = 0n;
  for (let i = 0; i < n; i++) {
    if (approx(i) > limit) continue;
    const dx = bigN * BigInt(xs[i]!) - bigSx;
    const dy = bigN * BigInt(ys[i]!) - bigSy;
    const d = dx * dx + dy * dy;
    if (best < 0 || d < bestD || (d === bestD && (ys[i]! < ys[best]! || (ys[i]! === ys[best]! && xs[i]! < xs[best]!)))) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/**
 * The footprint of a frame as integer offsets (dx, dy) from its centre, in maximal horizontal runs of unit centres
 * that are inside it: `rows[3 * i .. 3 * i + 2]` = dy, first dx, run length. A unit centre is p = c + (dx, dy) with
 * whole dx and dy (the centre is a unit centre). Straight frames: the pinned test depends only on the offset, so the
 * runs are exact. Arc frames: the pinned test depends on the centre only by rounding, so cells farther than
 * `EDGE_SLACK` from every edge are classified here and the cells within it are kept in `border` and decided by the
 * pinned formulas for each centre. The runs are ordered extreme rows first, so that a failing centre fails early.
 */
export interface Footprint {
  rows: Int32Array;
  border: readonly (readonly [number, number])[];
}

/** Distance from an edge below which an arc cell is decided per centre by the pinned formulas. */
const EDGE_SLACK = 1e-6;

function orderedRuns(runs: number[][]): Int32Array {
  // runs: [dy, dx, length]; extremes first (smallest dy, largest dy), then the rest by distance from the middle
  const sorted = runs.slice().sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  if (sorted.length === 0) return new Int32Array(0);
  const first = sorted[0]![0]!;
  const last = sorted[sorted.length - 1]![0]!;
  const mid = (first + last) / 2;
  const rank = (r: number[]): number => (r[0] === first || r[0] === last ? -1 : Math.abs(r[0]! - mid));
  sorted.sort((a, b) => rank(a) - rank(b) || a[0]! - b[0]! || a[1]! - b[1]!);
  const out = new Int32Array(3 * sorted.length);
  sorted.forEach((r, i) => {
    out[3 * i] = r[0]!;
    out[3 * i + 1] = r[1]!;
    out[3 * i + 2] = r[2]!;
  });
  return out;
}

/** The footprint of a straight frame of angle `angle`, length w and height h (rows analytic, ends decided exactly). */
export function straightFootprint(angle: number, w: number, h: number, margin: number): Footprint {
  const { c, s } = cs(angle);
  const f: StraightFrame = { shape: 'straight', cx: 0.5, cy: 0.5, angle, h, w };
  const lu = w / 2 + margin;
  const lv = h / 2 + margin;
  const ey = lu * Math.abs(s) + lv * Math.abs(c);
  const inside = (dx: number, dy: number): boolean => inStraight(f, margin, dx + 0.5, dy + 0.5);
  const runs: number[][] = [];
  for (let dy = Math.ceil(-ey - BOX_PAD); dy <= Math.floor(ey + BOX_PAD); dy++) {
    let lo = -Infinity;
    let hi = Infinity;
    if (c > 0) {
      lo = Math.max(lo, (-lu + dy * s) / c);
      hi = Math.min(hi, (lu + dy * s) / c);
    }
    if (s > 0) {
      lo = Math.max(lo, (-lv - dy * c) / s);
      hi = Math.min(hi, (lv - dy * c) / s);
    } else if (s < 0) {
      lo = Math.max(lo, (lv - dy * c) / s);
      hi = Math.min(hi, (-lv - dy * c) / s);
    }
    const a = Math.ceil(lo - BOX_PAD);
    const b = Math.floor(hi + BOX_PAD);
    if (!(a <= b)) continue;
    // Exact decisions at the ends (three cells beyond the analytic ends); the cells between are far from every edge.
    const m = Math.floor((a + b) / 2);
    if (!inside(m, dy)) continue;
    let first = m;
    for (let dx = a - 3; dx <= m; dx++) {
      if (inside(dx, dy)) {
        first = dx;
        break;
      }
    }
    let last = m;
    for (let dx = b + 3; dx >= m; dx--) {
      if (inside(dx, dy)) {
        last = dx;
        break;
      }
    }
    runs.push([dy, first, last - first + 1]);
  }
  return { rows: orderedRuns(runs), border: [] };
}

/** The footprint of an arc frame (see `Footprint`): the sector's cells away from its edges, and the cells near them. */
export function arcFootprint(frame: ArcFrame, margin: number): Footprint {
  const { c, s } = cs(frame.angle);
  const sigma = frame.bend > 0 ? 1 : -1;
  const r = frame.radius;
  const ox = -sigma * (r * s); // circle centre relative to the frame centre
  const oy = -sigma * (r * c);
  const dirx = sigma * s;
  const diry = sigma * c;
  const phi = (frame.w + 2 * margin) / (2 * r);
  const k = cosK(phi);
  const sinPhi = Math.sqrt(Math.max(0, 1 - k * k));
  const inner = r - frame.h / 2 - margin;
  const outer = r + frame.h / 2 + margin;
  let lx = Infinity;
  let hx = -Infinity;
  let ly = Infinity;
  let hy = -Infinity;
  const add = (x: number, y: number): void => {
    lx = Math.min(lx, x);
    hx = Math.max(hx, x);
    ly = Math.min(ly, y);
    hy = Math.max(hy, y);
  };
  for (const turn of [1, -1]) {
    const rx = dirx * k - turn * (diry * sinPhi);
    const ry = diry * k + turn * (dirx * sinPhi);
    add(ox + inner * rx, oy + inner * ry);
    add(ox + outer * rx, oy + outer * ry);
  }
  for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (ax * dirx + ay * diry >= k - 1e-9) add(ox + outer * ax, oy + outer * ay);
  }
  const runs: number[][] = [];
  const border: Array<readonly [number, number]> = [];
  for (let dy = Math.ceil(ly - BOX_PAD); dy <= Math.floor(hy + BOX_PAD); dy++) {
    let start = 0;
    let open = false;
    const vy = dy - oy;
    for (let dx = Math.ceil(lx - BOX_PAD); dx <= Math.floor(hx + BOX_PAD) + 1; dx++) {
      let state = 0; // 0 outside, 1 inside, 2 near an edge
      if (dx <= Math.floor(hx + BOX_PAD)) {
        const vx = dx - ox;
        const a = Math.sqrt(vx * vx + vy * vy);
        const slack = sigma * (vx * s + vy * c) - k * a;
        const dIn = a - inner;
        const dOut = outer - a;
        if (dIn < -EDGE_SLACK || dOut < -EDGE_SLACK || slack < -EDGE_SLACK) state = 0;
        else if (dIn > EDGE_SLACK && dOut > EDGE_SLACK && slack > EDGE_SLACK) state = 1;
        else state = 2;
      }
      if (state === 2) border.push([dx, dy]);
      if (state === 1 && !open) {
        open = true;
        start = dx;
      } else if (state !== 1 && open) {
        open = false;
        runs.push([dy, start, dx - start]);
      }
    }
  }
  return { rows: orderedRuns(runs), border };
}

/**
 * The shaped candidate (FR-197): the frame of the largest height h >= max(1, minHeight) for which some shape of the
 * set has a fitting frame; the first shape in shape order at that height; the centre by the FR-197 rule.
 * Undefined when there is none. `minHeight` = ceil(G * hH) is the exact prune of NFR-38.
 */
export function shapedCandidate(
  p: PieceIndex,
  pieces: readonly number[],
  aspect: number,
  params: LayoutParams,
  sp: ShapeParams,
  minHeight: number,
): ShapedFrame | undefined {
  checkInputs(aspect, params);
  const margin = params.margin;
  const lo = Math.max(1, minHeight);
  if (pieces.length === 0 || lo > params.maxHeight) return undefined;
  const theta = axisAngle(p, pieces);
  const extent = axisExtent(p, pieces, theta);
  const shapes = shapesOf(theta, extent, sp);
  if (shapes.length === 0) return undefined;

  const map = squaredDistanceMap(p, pieces);
  const { x0, y0, w: mw, h: mh, d2 } = map;
  const size = mw * mh;
  let count = 0;
  for (let i = 0; i < size; i++) if (d2[i]! > 0) count++;
  const keys = new Float64Array(count); // d2 * size + cell: ascending order is ascending distance
  count = 0;
  for (let i = 0; i < size; i++) if (d2[i]! > 0) keys[count++] = d2[i]! * size + i;
  keys.sort();
  // right[cell] = number of consecutive set cells from the cell to the right (0 for a cell outside the set).
  const right = new Int32Array(size);
  for (let y = 0; y < mh; y++) {
    for (let x = mw - 1; x >= 0; x--) {
      const cell = y * mw + x;
      if (d2[cell]! > 0) right[cell] = (x + 1 < mw ? right[cell + 1]! : 0) + 1;
    }
  }
  const inSet = (ix: number, iy: number): boolean => {
    const x = ix - x0;
    const y = iy - y0;
    return x >= 0 && y >= 0 && x < mw && y < mh && d2[y * mw + x]! > 0;
  };
  /**
   * True when every unit centre of the footprint, placed at the whole unit (x, y), belongs to the set. With `exact`
   * false the cells near an arc's edges (decided per centre by the pinned formulas) are not required: a weaker test.
   */
  const fits = (fp: Footprint, frame: ShapedFrame, x: number, y: number, exact: boolean): boolean => {
    const rows = fp.rows;
    for (let i = 0; i < rows.length; i += 3) {
      const ix = x + rows[i + 1]! - x0;
      const iy = y + rows[i]! - y0;
      if (ix < 0 || iy < 0 || ix >= mw || iy >= mh || right[iy * mw + ix]! < rows[i + 2]!) return false;
    }
    if (exact && fp.border.length > 0) {
      const at: ArcFrame = { ...(frame as ArcFrame), cx: x + 0.5, cy: y + 0.5 };
      for (const [dx, dy] of fp.border) {
        if (!inSet(x + dx, y + dy) && inArc(at, margin, x + dx + 0.5, y + dy + 0.5)) return false;
      }
    }
    return true;
  };

  /** The frame of a shape at height h with the radius of an inscribed disc, or undefined when the arc does not exist. */
  const protoAt = (shape: Shape, h: number): { proto: ShapedFrame; rho: number } | undefined => {
    const w = h * aspect;
    if (shape.shape === 'straight') {
      return { proto: { shape: 'straight', cx: 0, cy: 0, angle: shape.angle, h, w }, rho: Math.min(w, h) / 2 + margin };
    }
    const radius = arcRadius(extent, shape.bend);
    const arc: ArcFrame = { shape: 'arc', cx: 0, cy: 0, angle: shape.angle, h, w, bend: shape.bend, radius };
    if (!arcExists(arc, extent, margin)) return undefined;
    const phi = (w + 2 * margin) / (2 * radius);
    return { proto: arc, rho: Math.max(0, Math.min(h / 2 + margin, radius * (phi - (phi * phi * phi) / 6))) };
  };

  // Exact search order (NFR-38 prune). For one shape and centre the footprint only grows with h (R does not depend
  // on h; every limit of the pinned formulas grows with h), so "some centre has a footprint inside the set" cannot
  // return from false to true as h falls. That is applied to the weaker test (arc edge cells not required, disc
  // radius suffix-minimum so that it grows with h): a binary search gives for each shape a height ub that no
  // fitting frame of the shape exceeds; the exact scan below then starts at the largest ub and tries a shape only
  // at heights up to its ub. Straight shapes have no edge cells, so for them ub is exact.
  const top = params.maxHeight;
  const rhoMin: Float64Array[] = shapes.map((shape) => {
    const out = new Float64Array(top + 2).fill(Infinity);
    for (let h = top; h >= lo; h--) out[h] = Math.min(out[h + 1]!, protoAt(shape, h)?.rho ?? Infinity);
    return out;
  });
  const maybeFits = (index: number, h: number): boolean => {
    const at = protoAt(shapes[index]!, h);
    if (at === undefined) return false;
    const rho = rhoMin[index]![h]!;
    let footprint: Footprint | undefined;
    for (let k = keys.length - 1; k >= 0; k--) {
      const key = keys[k]!;
      const cell = key % size;
      if (!discAllows((key - cell) / size, rho)) break;
      footprint ??= at.proto.shape === 'straight' ? straightFootprint(at.proto.angle, at.proto.w, h, margin) : arcFootprint(at.proto, margin);
      if (fits(footprint, at.proto, x0 + (cell % mw), y0 + (cell - (cell % mw)) / mw, false)) return true;
    }
    return false;
  };
  const upper = shapes.map((_, index) => {
    if (!maybeFits(index, lo)) return lo - 1;
    let a = lo;
    let b = top;
    while (a < b) {
      const m = Math.ceil((a + b) / 2);
      if (maybeFits(index, m)) a = m;
      else b = m - 1;
    }
    return a;
  });
  const start = Math.max(...upper);

  for (let h = start; h >= lo; h--) {
    for (let index = 0; index < shapes.length; index++) {
      if (upper[index]! < h) continue;
      const at = protoAt(shapes[index]!, h);
      if (at === undefined) continue;
      const { proto, rho } = at;
      let footprint: Footprint | undefined;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let k = keys.length - 1; k >= 0; k--) {
        const key = keys[k]!;
        const cell = key % size;
        if (!discAllows((key - cell) / size, rho)) break;
        footprint ??= proto.shape === 'straight' ? straightFootprint(proto.angle, proto.w, h, margin) : arcFootprint(proto, margin);
        const x = x0 + (cell % mw);
        const y = y0 + (cell - (cell % mw)) / mw;
        if (fits(footprint, proto, x, y, true)) {
          xs.push(x);
          ys.push(y);
        }
      }
      if (xs.length === 0) continue;
      const win = centreWinner(xs, ys);
      return { ...proto, cx: xs[win]! + 0.5, cy: ys[win]! + 0.5 };
    }
  }
  return undefined;
}

/** hS: the largest height of a shaped frame of the set, with no FR-198 prune (tests and the review set), or undefined. */
export function shapedHeight(p: PieceIndex, pieces: readonly number[], aspect: number, params: LayoutParams, sp: ShapeParams): number | undefined {
  return shapedCandidate(p, pieces, aspect, params, sp, 1)?.h;
}

/**
 * The in-land frame of a label (FR-198): the shaped candidate when hS is defined and (hH is undefined or
 * hS >= G * hH), else the horizontal candidate (the 005 box object itself, FR-195), else none. Only heights
 * from ceil(G * hH) up are searched, and nothing when that exceeds Hmax (a horizontal box of height Hmax is kept).
 */
export function inLandFrame(
  p: PieceIndex,
  pieces: readonly number[],
  aspect: number,
  horizontal: LabelBox | undefined,
  params: LayoutParams,
  sp: ShapeParams,
): InLandFrame | undefined {
  checkInputs(aspect, params);
  const bound = horizontal === undefined ? 1 : Math.ceil(sp.shapeGain * horizontal.h);
  if (bound <= params.maxHeight) {
    const shaped = shapedCandidate(p, pieces, aspect, params, sp, bound);
    if (shaped !== undefined) return shaped;
  }
  return horizontal === undefined ? undefined : { shape: 'horizontal', box: horizontal };
}
