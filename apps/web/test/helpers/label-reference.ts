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

// ---------------------------------------------------------------------------------------------------------
// The shaped in-land search by its definition (spec 006 FR-195, FR-197, FR-198), with no prune at all: every h
// from Hmax down to 1, every shape in shape order, every centre, every non-set unit centre that can lie in the
// footprint. The memberships and the arc existence are the pinned formulas of `src` (tested on their own);
// the search, the order and the tie rule are written here from the spec text.
// ---------------------------------------------------------------------------------------------------------
import { arcExists, arcRadius, inArc, inStraight } from '../../src/core/label-shape';
import type { ArcFrame, ShapedFrame, StraightFrame } from '../../src/core/label-shape';
import type { LabelBox } from '../../src/core/label-layout';
import { cs } from '../../src/core/shape-params';
import type { ShapeParams } from '../../src/core/shape-params';

type RefUnit = readonly [number, number];
type RefShape = { shape: 'straight'; angle: number } | { shape: 'arc'; angle: number; bend: number };

const wrapped = (angle: number): number => {
  let a = angle;
  while (a <= -90) a += 180;
  while (a > 90) a -= 180;
  return a;
};

/** The extent: largest minus smallest projection t = (px * C) - (py * S) of the unit centres. */
export function refExtent(units: readonly RefUnit[], angle: number): number {
  const { c, s } = cs(angle);
  const ts = units.map(([x, y]) => (x + 0.5) * c - (y + 0.5) * s);
  return ts.length === 0 ? 0 : Math.max(...ts) - Math.min(...ts);
}

/** The shapes in shape order from the spec definition (arcs at theta* are listed even where none can exist). */
export function refShapes(theta: number, sp: ShapeParams): RefShape[] {
  const shapes: RefShape[] = [];
  for (const a of [theta, wrapped(theta - sp.angleStep), wrapped(theta + sp.angleStep)]) if (a !== 0) shapes.push({ shape: 'straight', angle: a });
  for (const b of [...sp.arcBends].sort((x, y) => x - y)) {
    shapes.push({ shape: 'arc', angle: theta, bend: b });
    shapes.push({ shape: 'arc', angle: theta, bend: -b });
  }
  return shapes;
}

export interface RefShaped {
  /** hS: the largest h with a fitting straight or arc frame, or undefined. */
  hS: number | undefined;
  /** The FR-197 winner (undefined when hS is). */
  frame: ShapedFrame | undefined;
  /** Every fitting frame of the winning shape and height, in row-major order of the centre. */
  fits: ShapedFrame[];
  /** The fits whose exact distance equals the smallest one (the centre tie). */
  tied: ShapedFrame[];
}

/**
 * The shaped candidate by brute force. `units` are the whole coordinates of the label set. Candidate centres are
 * the units of the set: a centre that is not in the set lies in its own footprint, so it cannot fit (tested apart).
 */
export function refShapedSearch(units: readonly RefUnit[], aspect: number, params: { margin: number; maxHeight: number }, sp: ShapeParams): RefShaped {
  const none: RefShaped = { hS: undefined, frame: undefined, fits: [], tied: [] };
  if (units.length === 0) return none;
  const margin = params.margin;
  const inSet = new Set(units.map(([x, y]) => `${x},${y}`));
  const theta = refAxisAngle(units);
  const extent = refExtent(units, theta);
  const shapes = refShapes(theta, sp);
  const sorted = [...units].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  // |p - c| <= (h / 2 + M) + (w / 2 + M) for every point of a grown footprint (a path along the middle line, then across)
  const reach = (h: number): number => Math.ceil(h / 2 + margin + (h * aspect) / 2 + margin) + 1;
  const offsetCache = new Map<number, Array<readonly [number, number]>>();
  const offsets = (d: number): Array<readonly [number, number]> => {
    let list = offsetCache.get(d);
    if (list === undefined) {
      list = [];
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) list.push([dx, dy] as const);
      list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
      offsetCache.set(d, list);
    }
    return list;
  };
  for (let h = params.maxHeight; h >= 1; h--) {
    const w = h * aspect;
    for (const shape of shapes) {
      let proto: ShapedFrame;
      if (shape.shape === 'straight') {
        proto = { shape: 'straight', cx: 0, cy: 0, angle: shape.angle, h, w };
      } else {
        const arc: ArcFrame = { shape: 'arc', cx: 0, cy: 0, angle: shape.angle, h, w, bend: shape.bend, radius: extent > 0 ? arcRadius(extent, shape.bend) : 0 };
        if (!arcExists(arc, extent, margin)) continue;
        proto = arc;
      }
      const fits: ShapedFrame[] = [];
      for (const [x, y] of sorted) {
        const frame: ShapedFrame = { ...proto, cx: x + 0.5, cy: y + 0.5 };
        let fit = true;
        for (const [dx, dy] of offsets(reach(h))) {
          if (inSet.has(`${x + dx},${y + dy}`)) continue;
          const px = x + dx + 0.5;
          const py = y + dy + 0.5;
          const inside = frame.shape === 'straight' ? inStraight(frame as StraightFrame, margin, px, py) : inArc(frame as ArcFrame, margin, px, py);
          if (inside) {
            fit = false;
            break;
          }
        }
        if (fit) fits.push(frame);
      }
      if (fits.length === 0) continue;
      const n = BigInt(fits.length);
      const sx = fits.reduce((acc, f) => acc + BigInt(f.cx - 0.5), 0n);
      const sy = fits.reduce((acc, f) => acc + BigInt(f.cy - 0.5), 0n);
      const dist = (f: ShapedFrame): bigint => {
        const a = n * BigInt(f.cx - 0.5) - sx;
        const b = n * BigInt(f.cy - 0.5) - sy;
        return a * a + b * b;
      };
      const best = fits.reduce((m, f) => (dist(f) < m ? dist(f) : m), dist(fits[0]!));
      const tied = fits.filter((f) => dist(f) === best);
      const frame = [...tied].sort((a, b) => a.cy - b.cy || a.cx - b.cx)[0]!;
      return { hS: h, frame, fits, tied };
    }
  }
  return none;
}

/** FR-198 by its text: the shaped candidate when hS is defined and (hH is undefined or hS >= G * hH). */
export function refInLand(
  units: readonly RefUnit[],
  aspect: number,
  params: { margin: number; maxHeight: number },
  sp: ShapeParams,
  horizontal: LabelBox | undefined,
): { shape: 'horizontal'; box: LabelBox } | ShapedFrame | undefined {
  const r = refShapedSearch(units, aspect, params, sp);
  if (r.hS !== undefined && (horizontal === undefined || r.hS >= sp.shapeGain * horizontal.h)) return r.frame;
  return horizontal === undefined ? undefined : { shape: 'horizontal', box: horizontal };
}

// ---------------------------------------------------------------------------------------------------------
// The off-land search by its definition (spec 006 FR-203 to FR-207, FR-215), with no prune and no raster: every
// whole (x0, y0) of the image, every lattice point of the grown box against every obstacle, every unit for the
// gap and the anchor. The memberships of the shaped obstacles are the pinned formulas of `src`.
// ---------------------------------------------------------------------------------------------------------
export type RefObstacle =
  | { shape: 'horizontal'; box: { x0: number; y0: number; h: number; w: number } }
  | { shape: 'off-land'; box: { x0: number; y0: number; h: number; w: number } }
  | StraightFrame
  | ArcFrame;

/** Membership of the unit centre (px, py) in the grown footprint of an obstacle. */
export function refInObstacle(o: RefObstacle, margin: number, px: number, py: number): boolean {
  if (o.shape === 'straight') return inStraight(o, margin, px, py);
  if (o.shape === 'arc') return inArc(o, margin, px, py);
  const b = o.box;
  return b.x0 - margin <= px && px <= b.x0 + b.w + margin && b.y0 - margin <= py && py <= b.y0 + b.h + margin;
}

export interface RefOffLand {
  box: { x0: number; y0: number; h: number; w: number };
  gap2: number;
  anchor: number;
  leader: { x1: number; y1: number; x2: number; y2: number } | undefined;
}

/** `units` are the whole coordinates of the label set. Returns the best acceptable off-land box, or undefined. */
export function refOffLand(
  units: readonly RefUnit[],
  width: number,
  height: number,
  aspect: number,
  h: number,
  obstacles: readonly RefObstacle[],
  margin: number,
  sp: ShapeParams,
): RefOffLand | undefined {
  if (units.length === 0) return undefined;
  const w = h * aspect;
  const n = units.length;
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of units) {
    sumX += x + 0.5;
    sumY += y + 0.5;
  }
  const mx = sumX / n;
  const my = sumY / n;
  const reach2 = sp.offLandReach * sp.offLandReach;
  const inSet = new Set(units.map(([x, y]) => `${x},${y}`));
  const rowMajor = [...units].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  let best: { key: [number, number, number, number]; value: RefOffLand } | undefined;
  for (let y0 = 0; y0 <= height; y0++) {
    for (let x0 = 0; x0 <= width; x0++) {
      if (!(x0 - margin >= 0 && x0 + w + margin <= width && y0 - margin >= 0 && y0 + h + margin <= height)) continue;
      let blocked = false;
      for (let j = Math.max(0, y0 - margin - 1); j <= Math.min(height - 1, y0 + h + margin + 1) && !blocked; j++) {
        for (let i = Math.max(0, x0 - margin - 1); i <= Math.min(width - 1, x0 + w + margin + 1); i++) {
          const px = i + 0.5;
          const py = j + 0.5;
          if (!(x0 - margin <= px && px <= x0 + w + margin && y0 - margin <= py && py <= y0 + h + margin)) continue;
          if (inSet.has(`${i},${j}`) || obstacles.some((o) => refInObstacle(o, margin, px, py))) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) continue;
      let gap2 = Infinity;
      let anchor = -1;
      for (const [x, y] of rowMajor) {
        const px = x + 0.5;
        const py = y + 0.5;
        const ex = Math.max(x0 - px, 0, px - (x0 + w));
        const ey = Math.max(y0 - py, 0, py - (y0 + h));
        const g = ex * ex + ey * ey;
        if (g < gap2) {
          gap2 = g;
          anchor = y * width + x;
        }
      }
      if (gap2 > reach2) continue;
      const dist = (x0 + w / 2 - mx) * (x0 + w / 2 - mx) + (y0 + h / 2 - my) * (y0 + h / 2 - my);
      const key: [number, number, number, number] = [gap2, dist, y0, x0];
      const better = best === undefined || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && (key[2] < best.key[2] || (key[2] === best.key[2] && key[3] < best.key[3])))));
      if (!better) continue;
      const px = (anchor % width) + 0.5;
      const py = (anchor - (anchor % width)) / width + 0.5;
      const leader = gap2 > sp.leaderGap * sp.leaderGap ? { x1: Math.min(Math.max(px, x0), x0 + w), y1: Math.min(Math.max(py, y0), y0 + h), x2: px, y2: py } : undefined;
      best = { key, value: { box: { x0, y0, h, w }, gap2, anchor, leader } };
    }
  }
  return best?.value;
}
