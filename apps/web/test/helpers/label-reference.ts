/**
 * Reference definitions for the shaped-label tests (spec 006). Written from the spec text, independently of
 * `src`: the axis angle with high-precision BigInt constants, the memberships with trigonometry (tolerance
 * based, away from the edges). Test code: trigonometric functions are allowed here.
 */

const SCALE = 10n ** 80n;

/** floor(sqrt(n)) for a non-negative BigInt. */
export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

const R2 = isqrt(2n * SCALE * SCALE);
const R6 = isqrt(6n * SCALE * SCALE);
const COS15 = (R6 + R2) / 4n;
const SIN15 = (R6 - R2) / 4n;
const HALF_R2 = R2 / 2n;

/** cos and sin of the doubled-angle boundaries, scaled by 10^80. */
const BOUNDARY: Record<number, readonly [bigint, bigint]> = {
  15: [COS15, SIN15],
  45: [HALF_R2, HALF_R2],
  75: [SIN15, COS15],
  105: [-SIN15, COS15],
  135: [-HALF_R2, HALF_R2],
  165: [-COS15, SIN15],
};

/** Sign of B cos b - A sin b by 80-digit constants (0 only at the exact ties 45 and 135 with equal terms). */
export function refSide(boundary: number, a: bigint, b: bigint): number {
  const [c, s] = BOUNDARY[boundary]!;
  const v = b * c - a * s;
  return v > 0n ? 1 : v < 0n ? -1 : 0;
}

/** The sums-based moments A and B of the spec "Number reference", from whole unit coordinates. */
export function refMoments(units: ReadonlyArray<readonly [number, number]>): { a: bigint; b: bigint } {
  let n = 0n;
  let sx = 0n;
  let sy = 0n;
  let sxx = 0n;
  let syy = 0n;
  let sxy = 0n;
  for (const [x, y] of units) {
    const bx = BigInt(x);
    const by = BigInt(y);
    n++;
    sx += bx;
    sy += by;
    sxx += bx * bx;
    syy += by * by;
    sxy += bx * by;
  }
  return { a: n * sxx - sx * sx - (n * syy - sy * sy), b: -2n * (n * sxy - sx * sy) };
}

/** The axis angle by counting the passed boundaries with the 80-digit constants (independent of the p + q sqrt(3) table). */
export function refAxisAngleOf(a0: bigint, b0: bigint): number {
  if (a0 === 0n && b0 === 0n) return 0;
  const mirror = b0 < 0n;
  const b = mirror ? -b0 : b0;
  let m = 0;
  for (const boundary of [15, 45, 75, 105, 135, 165]) if (refSide(boundary, a0, b) > 0) m++;
  let theta = 15 * m;
  if (mirror) theta = -theta;
  if (theta === -90) theta = 90;
  return theta === 0 ? 0 : theta;
}

export function refAxisAngle(units: ReadonlyArray<readonly [number, number]>): number {
  const { a, b } = refMoments(units);
  return refAxisAngleOf(a, b);
}

/**
 * The axis angle by Math.atan2, or undefined when twice the angle is within 1e-6 degrees of a rounding
 * boundary (where doubles cannot be trusted). Sums are small in the tests that use it.
 */
export function atan2AxisAngle(a: bigint, b: bigint): number | undefined {
  if (a === 0n && b === 0n) return 0;
  const psi = (Math.atan2(Number(b), Number(a)) * 180) / Math.PI; // (-180, 180]
  const theta = psi / 2;
  const nearest = Math.round(theta / 15) * 15;
  const fromBoundary = Math.abs(Math.abs(theta - nearest) - 7.5);
  if (fromBoundary < 5e-7) return undefined;
  return nearest === -90 ? 90 : nearest === 0 ? 0 : nearest;
}

/** Geometric membership in a grown straight rectangle, or undefined when the point is within 1e-9 of an edge. */
export function geometricStraight(
  f: { cx: number; cy: number; angle: number; h: number; w: number },
  margin: number,
  px: number,
  py: number,
): boolean | undefined {
  const t = (f.angle * Math.PI) / 180;
  const dx = px - f.cx;
  const dy = py - f.cy;
  const u = dx * Math.cos(t) - dy * Math.sin(t);
  const v = dx * Math.sin(t) + dy * Math.cos(t);
  const lu = f.w / 2 + margin;
  const lv = f.h / 2 + margin;
  if (Math.abs(Math.abs(u) - lu) < 1e-9 || Math.abs(Math.abs(v) - lv) < 1e-9) return undefined;
  return Math.abs(u) < lu && Math.abs(v) < lv;
}

/** Geometric membership in a grown annular sector, or undefined near an edge. */
export function geometricArc(
  f: { cx: number; cy: number; angle: number; h: number; w: number; bend: number; radius: number },
  margin: number,
  px: number,
  py: number,
): boolean | undefined {
  const t = (f.angle * Math.PI) / 180;
  const sigma = f.bend > 0 ? 1 : -1;
  const ox = f.cx - sigma * (f.radius * Math.sin(t));
  const oy = f.cy - sigma * (f.radius * Math.cos(t));
  const vx = px - ox;
  const vy = py - oy;
  const r = Math.sqrt(vx * vx + vy * vy);
  const inner = f.radius - f.h / 2 - margin;
  const outer = f.radius + f.h / 2 + margin;
  const phi = (f.w + 2 * margin) / (2 * f.radius);
  // direction from the circle centre to the midpoint of the middle line
  const dirx = sigma * Math.sin(t);
  const diry = sigma * Math.cos(t);
  const angle = Math.acos(Math.max(-1, Math.min(1, (vx * dirx + vy * diry) / r)));
  if (Math.abs(r - inner) < 1e-9 || Math.abs(r - outer) < 1e-9 || Math.abs(angle - phi) < 1e-9) return undefined;
  return r > inner && r < outer && angle < phi;
}
