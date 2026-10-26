// Exact centre arithmetic of the centred labels (spec 007 FR-218, FR-222, FR-228, FR-230; plan 007 sections 5 and 9).
// Pure. Every decision here (centre of mass, centre disc, per-row intervals, end step, centre keys, size cap) is
// made with BigInt and whole numbers: no double comparison decides anything. The only doubles are the heights,
// coordinates and widths that arrive as parameters (a width h * aspect is first written exactly as W / 2^E).
// No `**` on doubles, no `Math.pow`, `Math.hypot` or trigonometric function; BigInt powers are written as products
// or shifts.
import type { CentreParams, Ratio } from './centre-params';
import type { PieceIndex } from './regions';

/** The whole-number sums of a region at whole unit coordinates: n units, Sx = sum of x, Sy = sum of y. */
export interface CentreSums {
  n: bigint;
  sx: bigint;
  sy: bigint;
}

/** An exact rational with a positive denominator. */
export interface Frac {
  num: bigint;
  den: bigint;
}

/** A squared centre distance, or a centre coordinate, as an exact rational. */
export type CentreKey = Frac;

/** The unit squares of a region: [xmin, xmax + 1] x [ymin, ymax + 1]. */
export interface RegionBox {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

/** The sums of a set of pieces. A piece sum is exact in a double (at most 2^24 units x 2^12), the total is BigInt. */
export function centreSums(p: PieceIndex, pieces: readonly number[]): CentreSums {
  let n = 0n;
  let sx = 0n;
  let sy = 0n;
  for (const piece of pieces) {
    let count = 0;
    let px = 0;
    let py = 0;
    for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
      const u = p.units[k]!;
      const x = u % p.width;
      count++;
      px += x;
      py += (u - x) / p.width;
    }
    n += BigInt(count);
    sx += BigInt(px);
    sy += BigInt(py);
  }
  return { n, sx, sy };
}

/** The bounding box (inclusive unit coordinates) of a non-empty set of pieces. */
export function regionBox(p: PieceIndex, pieces: readonly number[]): RegionBox {
  if (pieces.length === 0) throw new RangeError('a region needs at least one piece');
  let xmin = p.width;
  let ymin = p.height;
  let xmax = -1;
  let ymax = -1;
  for (const piece of pieces) {
    xmin = Math.min(xmin, p.box[4 * piece]!);
    ymin = Math.min(ymin, p.box[4 * piece + 1]!);
    xmax = Math.max(xmax, p.box[4 * piece + 2]!);
    ymax = Math.max(ymax, p.box[4 * piece + 3]!);
  }
  return { xmin, xmax, ymin, ymax };
}

/** floor(v) for a whole v >= 0 : the largest r with r * r <= v. Newton from above, then a fix-up by one. */
export function isqrt(v: bigint): bigint {
  if (v < 0n) throw new RangeError('isqrt needs a value >= 0');
  if (v < 2n) return v;
  let x = 1n << BigInt((v.toString(2).length + 1) >> 1); // 2^ceil(bits / 2) is at least sqrt(v)
  for (;;) {
    const y = (x + v / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  while (x * x > v) x -= 1n;
  while ((x + 1n) * (x + 1n) <= v) x += 1n;
  return x;
}

/** w = W / 2^E exactly, with the smallest whole E >= 0: doubling a double by 2 is exact until it is whole. */
export function dyadic(w: number): { W: bigint; E: number } {
  if (!Number.isFinite(w) || w < 0) throw new RangeError(`width must be a finite number >= 0, got ${String(w)}`);
  let v = w;
  let e = 0;
  while (v !== Math.floor(v)) {
    v *= 2;
    e++;
  }
  return { W: BigInt(v), E: e };
}

const floorDiv = (a: bigint, b: bigint): bigint => {
  // b > 0
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
};
const ceilDiv = (a: bigint, b: bigint): bigint => -floorDiv(-a, b);

function need(s: CentreSums, k: number): void {
  if (s.n <= 0n) throw new RangeError('the region is empty');
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`widening step must be a whole number >= 1, got ${String(k)}`);
}

/** num^2 k^2 n^3: the right-hand side of the unit-centre inequality (before the 2^(2E+2) of boxes). */
function discLimit(s: CentreSums, cp: CentreParams, k: number): bigint {
  const num = BigInt(cp.centreFraction.num);
  const kk = BigInt(k);
  return num * num * kk * kk * s.n * s.n * s.n;
}

const denSquared = (cp: CentreParams): bigint => BigInt(cp.centreFraction.den) * BigInt(cp.centreFraction.den);

/** Spec: den^2 ((n cx - Sx)^2 + (n cy - Sy)^2) <= num^2 k^2 n^3, the centre (cx + 0.5, cy + 0.5) in the disc of step k. */
export function inDiscUnit(s: CentreSums, cp: CentreParams, k: number, cx: number, cy: number): boolean {
  need(s, k);
  const u = s.n * BigInt(cx) - s.sx;
  const v = s.n * BigInt(cy) - s.sy;
  return denSquared(cp) * (u * u + v * v) <= discLimit(s, cp, k);
}

/** The exact pieces of a box (x0, y0, h, w = W / 2^E) in the disc inequality: X = a x0 + b and Y. */
function boxTerms(s: CentreSums, y0: number, h: number, w: number): { a: bigint; b: bigint; y: bigint; e: bigint } {
  const { W, E } = dyadic(w);
  const e = BigInt(E);
  const two = 1n << (e + 1n); // 2^(E+1)
  return {
    a: two * s.n,
    b: -two * s.sx + s.n * W - (1n << e) * s.n,
    y: (1n << e) * (2n * (s.n * BigInt(y0) - s.sy) + s.n * BigInt(h) - s.n),
    e,
  };
}

/** Spec: den^2 (X^2 + Y^2) <= num^2 k^2 n^3 2^(2E+2), the box (x0, y0, h, w) with its centre in the disc of step k. */
export function inDiscBox(s: CentreSums, cp: CentreParams, k: number, x0: number, y0: number, h: number, w: number): boolean {
  need(s, k);
  const t = boxTerms(s, y0, h, w);
  const x = t.a * BigInt(x0) + t.b;
  return denSquared(cp) * (x * x + t.y * t.y) <= discLimit(s, cp, k) << (2n * t.e + 2n);
}

/**
 * The whole cx whose unit centre (cx + 0.5, cy + 0.5) is in the disc of step k, for the row cy, as the inclusive
 * interval [lo, hi] (none: undefined). With Y = n cy - Sy and R = num^2 k^2 n^3 - den^2 Y^2 the row holds exactly
 * the cx with |n cx - Sx| <= isqrt(floor(R / den^2)).
 */
export function unitRowInterval(s: CentreSums, cp: CentreParams, k: number, cy: number): [number, number] | undefined {
  need(s, k);
  const y = s.n * BigInt(cy) - s.sy;
  const r = discLimit(s, cp, k) - denSquared(cp) * y * y;
  if (r < 0n) return undefined;
  const t = isqrt(r / denSquared(cp));
  const lo = ceilDiv(s.sx - t, s.n);
  const hi = floorDiv(s.sx + t, s.n);
  return lo > hi ? undefined : [Number(lo), Number(hi)];
}

/**
 * The whole x0 for which the box (x0, y0, h, w) has its centre in the disc of step k, for the row y0, as the
 * inclusive interval [lo, hi] (none: undefined). X is linear in x0 (X = a x0 + b), so the row is |a x0 + b| <= T.
 */
export function boxRowInterval(s: CentreSums, cp: CentreParams, k: number, y0: number, h: number, w: number): [number, number] | undefined {
  need(s, k);
  const t = boxTerms(s, y0, h, w);
  const r = (discLimit(s, cp, k) << (2n * t.e + 2n)) - denSquared(cp) * t.y * t.y;
  if (r < 0n) return undefined;
  const reach = isqrt(r / denSquared(cp));
  const lo = ceilDiv(-reach - t.b, t.a);
  const hi = floorDiv(reach - t.b, t.a);
  return lo > hi ? undefined : [Number(lo), Number(hi)];
}

/**
 * kEnd: the smallest k >= 1 whose disc holds the four corners of [xmin, xmax + 1] x [ymin, ymax + 1]. With
 * a = 2 n X - 2 Sx - n and b = 2 n Y - 2 Sy - n for a corner (X, Y), the corner is in the disc of step k iff
 * den^2 (a^2 + b^2) <= 4 num^2 k^2 n^3; D is the largest a^2 + b^2 over the corners.
 */
export function endStep(s: CentreSums, cp: CentreParams, box: RegionBox): number {
  need(s, 1);
  let d = 0n;
  for (const x of [box.xmin, box.xmax + 1]) {
    for (const y of [box.ymin, box.ymax + 1]) {
      const a = 2n * s.n * BigInt(x) - 2n * s.sx - s.n;
      const b = 2n * s.n * BigInt(y) - 2n * s.sy - s.n;
      d = a * a + b * b > d ? a * a + b * b : d;
    }
  }
  const num = BigInt(cp.centreFraction.num);
  const m = ceilDiv(denSquared(cp) * d, 4n * num * num * s.n * s.n * s.n);
  let k = isqrt(m);
  if (k * k < m) k += 1n;
  return k < 1n ? 1 : Number(k);
}

/** Squared distance from C to the centre (cx + 0.5, cy + 0.5): ((n cx - Sx)^2 + (n cy - Sy)^2) / n^2, exact. */
export function unitDistance(s: CentreSums, cx: number, cy: number): CentreKey {
  const u = s.n * BigInt(cx) - s.sx;
  const v = s.n * BigInt(cy) - s.sy;
  return { num: u * u + v * v, den: s.n * s.n };
}

/** Squared distance from C to the centre of the box (x0, y0, h, w): (X^2 + Y^2) / (2^(E+1) n)^2, exact. */
export function boxDistance(s: CentreSums, x0: number, y0: number, h: number, w: number): CentreKey {
  const t = boxTerms(s, y0, h, w);
  const x = t.a * BigInt(x0) + t.b;
  return { num: x * x + t.y * t.y, den: t.a * t.a };
}

/** Exact order of two rationals with positive denominators: -1, 0 or 1. */
export function compareKeys(a: CentreKey, b: CentreKey): number {
  const d = a.num * b.den - b.num * a.den;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

/** The coordinate cx + 0.5 of a unit centre, as (2 cx + 1) / 2. */
export function unitCentre(c: number): Frac {
  return { num: 2n * BigInt(c) + 1n, den: 2n };
}

/** The centre x of a box: x0 + w / 2 = (2^(E+1) x0 + W) / 2^(E+1). */
export function boxCentreX(x0: number, w: number): Frac {
  const { W, E } = dyadic(w);
  const two = 1n << BigInt(E + 1);
  return { num: two * BigInt(x0) + W, den: two };
}

/** The centre y of a box: y0 + h / 2 = (2 y0 + h) / 2. */
export function boxCentreY(y0: number, h: number): Frac {
  return { num: 2n * BigInt(y0) + BigInt(h), den: 2n };
}

/**
 * FR-230: the largest whole height h >= 0 with den * h * w <= num * n for w = h * aspect as the double the drawn
 * frame uses (frame area at most num / den of the region). The test is monotone in h (the product of doubles is
 * monotone), so the largest height comes from a doubling and a binary search, each step decided exactly.
 */
export function factionHeightCap(n: bigint, aspect: number, share: Ratio): number {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError(`aspect must be a positive finite number, got ${String(aspect)}`);
  const num = BigInt(share.num);
  const den = BigInt(share.den);
  const fits = (h: number): boolean => {
    const { W, E } = dyadic(h * aspect);
    return den * BigInt(h) * W <= (num * n) << BigInt(E);
  };
  let lo = 0;
  let hi = 1;
  while (fits(hi)) {
    lo = hi;
    hi *= 2;
  }
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
