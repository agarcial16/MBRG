// Axis angle, axis extent and shapes of a label set (spec 006 FR-196, FR-199, NFR-39; plan D1 and section 5).
// Pure. The axis angle is decided with whole numbers only (BigInt where a value can pass 2^53); every other
// number is the pinned double formula of the spec "Number reference". No `**`, `Math.pow`, `Math.hypot` or
// trigonometric function on doubles here.
import type { PieceIndex } from './regions';
import { cs } from './shape-params';
import type { ShapeParams } from './shape-params';

/** The straight shape (angle in degrees, -90 < angle <= 90) or the arc shape (tangent angle and signed bend). */
export type Shape = { shape: 'straight'; angle: number } | { shape: 'arc'; angle: number; bend: number };

/** Whole-number sums over the units of a set, taken at whole coordinates (the 0.5 offset of the centres cancels). */
export interface SetSums {
  n: number;
  sx: number;
  sy: number;
  sxx: number;
  syy: number;
  sxy: number;
}

/** The sums of a set of pieces. Exact in doubles: every sum stays far below 2^53 for an image of 4096 x 4096. */
export function setSums(p: PieceIndex, pieces: readonly number[]): SetSums {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const piece of pieces) {
    for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
      const u = p.units[k]!;
      const x = u % p.width;
      const y = (u - x) / p.width;
      n++;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
  }
  return { n, sx, sy, sxx, syy, sxy };
}

const sign = (v: bigint): number => (v > 0n ? 1 : v < 0n ? -1 : 0);

/** Sign of p + q * sqrt(3) for whole p and q, exactly (plan section 5). */
function signRoot3(p: bigint, q: bigint): number {
  if (q === 0n) return sign(p);
  if (p === 0n) return sign(q);
  if (p > 0n === q > 0n) return sign(p);
  const pp = p * p;
  const qq = 3n * q * q;
  // pp = qq is impossible for whole numbers that are not both zero (3 is not a square)
  return pp > qq ? sign(p) : sign(q);
}

/**
 * The sign of B cos b - A sin b for the doubled-angle boundary b, a positive multiple of p + q sqrt(3);
 * positive when the direction (A, B) lies past b. The table is derived from the exact cosines and sines of
 * 15, 45, 75, 105, 135 and 165 degrees.
 */
export function boundaryPassed(boundary: number, a: bigint, b: bigint): boolean {
  switch (boundary) {
    case 15:
      return signRoot3(a + b, b - a) > 0;
    case 45:
      return signRoot3(b - a, 0n) > 0;
    case 75:
      return signRoot3(-(a + b), b - a) > 0;
    case 105:
      return signRoot3(b - a, -(a + b)) > 0;
    case 135:
      return signRoot3(-(a + b), 0n) > 0;
    default:
      return signRoot3(a - b, -(a + b)) > 0;
  }
}

const BOUNDARIES = [15, 45, 75, 105, 135, 165] as const;

/**
 * The axis angle theta* of a set of pieces, in degrees: the major axis of the second-moment ellipse rounded to a
 * multiple of 15, an exact half step towards 0, wrapped into (-90, 90]; 0 when Sxx = Syy and Sxy = 0.
 * A = n^2 (Sxx - Syy) and B = 2 n^2 Sxy in the screen convention (y grows downwards), so twice the angle is
 * the direction of (A, B); for B < 0 the set is mirrored and the result negated (plan D1).
 */
export function axisAngle(p: PieceIndex, pieces: readonly number[]): number {
  const s = setSums(p, pieces);
  const n = BigInt(s.n);
  const sx = BigInt(s.sx);
  const sy = BigInt(s.sy);
  const a = n * BigInt(s.sxx) - sx * sx - (n * BigInt(s.syy) - sy * sy);
  let b = -2n * (n * BigInt(s.sxy) - sx * sy);
  if (a === 0n && b === 0n) return 0;
  const mirror = b < 0n;
  if (mirror) b = -b;
  let count = 0;
  for (const boundary of BOUNDARIES) if (boundaryPassed(boundary, a, b)) count++;
  const theta = 15 * count;
  if (theta === 0) return 0;
  if (!mirror) return theta;
  return theta === 90 ? 90 : -theta;
}

/**
 * The axis extent L: the largest minus the smallest projection of the unit centres on the direction `angle`
 * (t = px * C - py * S). `angle` is a whole multiple of 15 from -75 to 90. 0 for an empty set.
 */
export function axisExtent(p: PieceIndex, pieces: readonly number[], angle: number): number {
  const { c, s } = cs(angle);
  let lo = Infinity;
  let hi = -Infinity;
  for (const piece of pieces) {
    for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
      const u = p.units[k]!;
      const x = u % p.width;
      const y = (u - x) / p.width;
      const t = (x + 0.5) * c - (y + 0.5) * s;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
  }
  return hi === -Infinity ? 0 : hi - lo;
}

/** An angle wrapped into (-90, 90] by whole half turns. */
export function wrapAngle(angle: number): number {
  let a = angle;
  while (a <= -90) a += 180;
  while (a > 90) a -= 180;
  return a;
}

/**
 * The shapes of a set in shape order: straight at theta*, theta* - step and theta* + step (wrapped, 0 left out),
 * then arcs at tangent angle theta* with each bend of `arcBends` (smaller magnitude first, positive first).
 * No arc is listed when the extent is 0 or theta* = 90 (an arc frame cannot exist there: one end would turn
 * past +90), which does not change any result because such a frame never exists.
 */
export function shapesOf(angle: number, extent: number, sp: ShapeParams): Shape[] {
  const shapes: Shape[] = [];
  for (const a of [angle, wrapAngle(angle - sp.angleStep), wrapAngle(angle + sp.angleStep)]) {
    if (a !== 0) shapes.push({ shape: 'straight', angle: a });
  }
  if (extent > 0 && angle !== 90) {
    for (const bend of [...sp.arcBends].sort((x, y) => x - y)) {
      shapes.push({ shape: 'arc', angle, bend });
      shapes.push({ shape: 'arc', angle, bend: -bend });
    }
  }
  return shapes;
}
