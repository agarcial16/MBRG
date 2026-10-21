/**
 * Brute-force definitions of the centred candidate (spec 007 FR-219, FR-220, FR-222, FR-228; plan 007 sections 6 and
 * 13), written from the spec text and independent of `src/core/label-centre.ts` and `label-centred.ts`: it applies the
 * spec inequalities directly (BigInt, no intervals), the 005 box fit as "every unit whose centre lies in the rectangle
 * belongs to the set", the 006 pinned straight membership formula (`inStraight`) and the FR-220 order. Test code:
 * doubles are fine here, but no decision of the result comes from a double comparison except the pinned 006 formula.
 */
import type { CentreParams } from '../../src/core/centre-params';
import { axisAngle, axisExtent, shapesOf } from '../../src/core/label-axis';
import { arcExists, arcRadius, inArc, inStraight } from '../../src/core/label-shape';
import type { ArcFrame, InLandFrame, StraightFrame } from '../../src/core/label-shape';
import type { PieceIndex } from '../../src/core/regions';
import type { ShapeParams } from '../../src/core/shape-params';
import type { Unit } from './shaped-grids';

export type RefFrame = { shape: 'horizontal'; box: { x0: number; y0: number; h: number; w: number } } | StraightFrame;

/** Which steps of the FR-220 order had to decide (for the coverage checks of the tie tests). */
export interface RefInfo {
  /** Both a horizontal and a straight frame exist at the winning height (step 2 decides). */
  horizontalAndStraight: boolean;
  /** Number of straight angles with a frame at the winning height (steps 3 and 4 decide when above 1). */
  angles: number;
  /** Distinct |theta| among those angles (step 3 decides when above 1). */
  absAngles: number;
  /** Both signs of the same |theta| have frames at the winning height (step 4 decides). */
  bothSigns: boolean;
  /** Frames of the winning group (step 5 decides when above 1). */
  group: number;
  /** Frames of the group at the minimal distance (step 6 decides when above 1). */
  atMinimalKey: number;
  /** Frames at the minimal distance and the minimal centre y (step 7 decides when above 1). */
  atMinimalKeyAndY: number;
}

export interface RefResult {
  frame: RefFrame | undefined;
  info: RefInfo | undefined;
}

const setKey = (x: number, y: number): number => (y + 1000) * 100000 + (x + 1000);

/** The spec's w = W / 2^E, smallest E, by doubling. */
function exactDyadic(w: number): { W: bigint; E: bigint } {
  let v = w;
  let e = 0n;
  while (v !== Math.floor(v)) {
    v *= 2;
    e += 1n;
  }
  return { W: BigInt(v), E: e };
}

/** The reference of `centredCandidate`: the frame of FR-220 at step k, or undefined. `top` is a height cap (undefined: none). */
export function refCentred(units: readonly Unit[], aspect: number, margin: number, cp: CentreParams, k: number, top: number | undefined): RefResult {
  const set = new Set<number>(units.map(([x, y]) => setKey(x, y)));
  const inSet = (x: number, y: number): boolean => set.has(setKey(x, y));
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  let n = 0n;
  let sx = 0n;
  let sy = 0n;
  for (const [x, y] of units) {
    xmin = Math.min(xmin, x);
    xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
    n += 1n;
    sx += BigInt(x);
    sy += BigInt(y);
  }
  if (n === 0n) return { frame: undefined, info: undefined };
  const num = BigInt(cp.centreFraction.num);
  const den = BigInt(cp.centreFraction.den);
  const kk = BigInt(k);
  const limit = num * num * kk * kk * n * n * n;
  const cxd = Number(sx) / Number(n) + 0.5;
  const cyd = Number(sy) / Number(n) + 0.5;
  const reach = k * ((Number(num) / Number(den)) * Math.sqrt(Number(n))) + 2; // a superset radius for the prefilter only

  const discUnit = (cx: number, cy: number): boolean => {
    const u = n * BigInt(cx) - sx;
    const v = n * BigInt(cy) - sy;
    return den * den * (u * u + v * v) <= limit;
  };
  const discBox = (x0: number, y0: number, h: number, w: number): boolean => {
    const { W, E } = exactDyadic(w);
    const x = 2n ** (E + 1n) * (n * BigInt(x0) - sx) + n * W - 2n ** E * n;
    const y = 2n ** E * (2n * (n * BigInt(y0) - sy) + n * BigInt(h) - n);
    return den * den * (x * x + y * y) <= limit * 2n ** (2n * E + 2n);
  };
  // Exact squared distance to C as a fraction (num, den).
  const unitKey = (cx: number, cy: number): [bigint, bigint] => {
    const u = n * BigInt(cx) - sx;
    const v = n * BigInt(cy) - sy;
    return [u * u + v * v, n * n];
  };
  const boxKey = (x0: number, y0: number, h: number, w: number): [bigint, bigint] => {
    const { W, E } = exactDyadic(w);
    const x = 2n ** (E + 1n) * (n * BigInt(x0) - sx) + n * W - 2n ** E * n;
    const y = 2n ** E * (2n * (n * BigInt(y0) - sy) + n * BigInt(h) - n);
    const d = 2n ** (E + 1n) * n;
    return [x * x + y * y, d * d];
  };
  const cmp = (a: [bigint, bigint], b: [bigint, bigint]): number => {
    const d = a[0] * b[1] - b[0] * a[1];
    return d < 0n ? -1 : d > 0n ? 1 : 0;
  };

  /** The 005 fit: every unit whose centre lies in [x0 - M, x0 + w + M] x [y0 - M, y0 + h + M] is in the set. */
  const boxFitsDirect = (x0: number, y0: number, h: number, w: number): boolean => {
    for (let y = y0 - margin - 1; y <= y0 + h + margin + 1; y++) {
      if (!(y + 0.5 >= y0 - margin && y + 0.5 <= y0 + h + margin)) continue;
      for (let x = x0 - margin - 1; x <= Math.ceil(x0 + w + margin) + 1; x++) {
        if (!(x + 0.5 >= x0 - margin && x + 0.5 <= x0 + w + margin)) continue;
        if (!inSet(x, y)) return false;
      }
    }
    return true;
  };
  /** The 006 pinned fit: every unit centre inside the grown rectangle is in the set. */
  const straightFitsDirect = (cx: number, cy: number, angle: number, h: number, w: number): boolean => {
    const f: StraightFrame = { shape: 'straight', cx: cx + 0.5, cy: cy + 0.5, angle, h, w };
    const ext = Math.ceil(w / 2 + h / 2 + 2 * margin) + 2;
    for (let y = cy - ext; y <= cy + ext; y++) {
      for (let x = cx - ext; x <= cx + ext; x++) {
        if (inStraight(f, margin, x + 0.5, y + 0.5) && !inSet(x, y)) return false;
      }
    }
    return true;
  };

  const bound = xmax - xmin + 1 + (ymax - ymin + 1);
  const hTop = Math.min(top ?? bound, bound);

  // Horizontal frames: every height (the centre moves with h, so no monotone shortcut).
  const horizontalAt = new Map<number, Array<{ x0: number; y0: number }>>();
  let hHorizontal = 0;
  for (let h = 1; h <= hTop; h++) {
    const w = h * aspect;
    const found: Array<{ x0: number; y0: number }> = [];
    for (let y0 = ymin - 1; y0 <= ymax + 1; y0++) {
      for (let x0 = xmin - 1; x0 <= xmax + 1; x0++) {
        const dx = x0 + w / 2 - cxd;
        const dy = y0 + h / 2 - cyd;
        if (dx * dx + dy * dy > reach * reach) continue; // prefilter only: a superset of the disc
        if (!discBox(x0, y0, h, w)) continue;
        if (boxFitsDirect(x0, y0, h, w)) found.push({ x0, y0 });
      }
    }
    if (found.length > 0) {
      horizontalAt.set(h, found);
      hHorizontal = h;
    }
  }

  // Straight frames: a candidate that fails at a height fails at every larger one (the grown rectangle only grows),
  // so each candidate is followed from height 1 up to its last fitting height.
  const discCells: Array<[number, number]> = [];
  for (let cy = ymin; cy <= ymax; cy++) {
    for (let cx = xmin; cx <= xmax; cx++) {
      if (inSet(cx, cy) && discUnit(cx, cy)) discCells.push([cx, cy]);
    }
  }
  const straightBest = new Map<number, { h: number; cells: Array<[number, number]> }>();
  for (const angle of cp.straightAngles) {
    let alive = discCells;
    let best = 0;
    let last = alive;
    for (let h = 1; h <= hTop && alive.length > 0; h++) {
      const w = h * aspect;
      const next = alive.filter(([cx, cy]) => straightFitsDirect(cx, cy, angle, h, w));
      if (next.length === 0) break;
      alive = next;
      best = h;
      last = next;
    }
    if (best > 0) straightBest.set(angle, { h: best, cells: last });
  }

  let hStraight = 0;
  for (const v of straightBest.values()) hStraight = Math.max(hStraight, v.h);
  const hC = Math.max(hHorizontal, hStraight);
  if (hC === 0) return { frame: undefined, info: undefined };

  const w = hC * aspect;
  const horizontals = horizontalAt.get(hC) ?? [];
  const straightsAtC = cp.straightAngles.filter((a) => straightBest.get(a)?.h === hC);
  const info: RefInfo = {
    horizontalAndStraight: horizontals.length > 0 && straightsAtC.length > 0,
    angles: straightsAtC.length,
    absAngles: new Set(straightsAtC.map((a) => Math.abs(a))).size,
    bothSigns: straightsAtC.some((a) => straightsAtC.includes(-a)),
    group: 0,
    atMinimalKey: 0,
    atMinimalKeyAndY: 0,
  };
  if (horizontals.length > 0) {
    info.group = horizontals.length;
    let best = horizontals[0]!;
    for (const c of horizontals) {
      const d = cmp(boxKey(c.x0, c.y0, hC, w), boxKey(best.x0, best.y0, hC, w));
      if (d < 0 || (d === 0 && (c.y0 < best.y0 || (c.y0 === best.y0 && c.x0 < best.x0)))) best = c;
    }
    const bk = boxKey(best.x0, best.y0, hC, w);
    const sameKey = horizontals.filter((c) => cmp(boxKey(c.x0, c.y0, hC, w), bk) === 0);
    info.atMinimalKey = sameKey.length;
    info.atMinimalKeyAndY = sameKey.filter((c) => c.y0 === best.y0).length;
    return { frame: { shape: 'horizontal', box: { x0: best.x0, y0: best.y0, h: hC, w } }, info };
  }
  // FR-220 steps 3 and 4 are the order of the angle list: the first angle with a frame at the winning height.
  const angle = straightsAtC[0]!;
  const cells = straightBest.get(angle)!.cells;
  info.group = cells.length;
  let best = cells[0]!;
  for (const c of cells) {
    const d = cmp(unitKey(c[0], c[1]), unitKey(best[0], best[1]));
    if (d < 0 || (d === 0 && (c[1] < best[1] || (c[1] === best[1] && c[0] < best[0])))) best = c;
  }
  const bk = unitKey(best[0], best[1]);
  const sameKey = cells.filter((c) => cmp(unitKey(c[0], c[1]), bk) === 0);
  info.atMinimalKey = sameKey.length;
  info.atMinimalKeyAndY = sameKey.filter((c) => c[1] === best[1]).length;
  return { frame: { shape: 'straight', cx: best[0] + 0.5, cy: best[1] + 0.5, angle, h: hC, w }, info };
}

// ---------------------------------------------------------------------------------------------------------
// Arcs, the faction cap, the end step and the widening loop (spec 007 FR-221, FR-222, FR-230; plan 007 T4).
// ---------------------------------------------------------------------------------------------------------

/** The sums and exact tests of a unit list (BigInt, direct from the spec inequalities). */
function factsOf(units: readonly Unit[], cp: CentreParams): {
  n: bigint;
  box: { xmin: number; xmax: number; ymin: number; ymax: number };
  inSet: (x: number, y: number) => boolean;
  discUnit: (k: number, cx: number, cy: number) => boolean;
  discPoint: (k: number, px: number, py: number) => boolean;
  unitKey: (cx: number, cy: number) => [bigint, bigint];
} {
  const set = new Set<number>(units.map(([x, y]) => setKey(x, y)));
  let n = 0n;
  let sx = 0n;
  let sy = 0n;
  const box = { xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity };
  for (const [x, y] of units) {
    box.xmin = Math.min(box.xmin, x);
    box.xmax = Math.max(box.xmax, x);
    box.ymin = Math.min(box.ymin, y);
    box.ymax = Math.max(box.ymax, y);
    n += 1n;
    sx += BigInt(x);
    sy += BigInt(y);
  }
  const num = BigInt(cp.centreFraction.num);
  const den = BigInt(cp.centreFraction.den);
  return {
    n,
    box,
    inSet: (x, y) => set.has(setKey(x, y)),
    discUnit: (k, cx, cy) => {
      const u = n * BigInt(cx) - sx;
      const v = n * BigInt(cy) - sy;
      return den * den * (u * u + v * v) <= num * num * BigInt(k) * BigInt(k) * n * n * n;
    },
    // a point (px, py) with whole coordinates: (p - C)^2 <= k^2 rho^2, scaled by 2n
    discPoint: (k, px, py) => {
      const u = 2n * n * BigInt(px) - 2n * sx - n;
      const v = 2n * n * BigInt(py) - 2n * sy - n;
      return den * den * (u * u + v * v) <= 4n * num * num * BigInt(k) * BigInt(k) * n * n * n;
    },
    unitKey: (cx, cy) => {
      const u = n * BigInt(cx) - sx;
      const v = n * BigInt(cy) - sy;
      return [u * u + v * v, n * n];
    },
  };
}

/** FR-230: the largest whole h with 10 h w <= n, w = h * aspect as a double (share den * h * W <= num * n * 2^E). */
export function refFactionCap(n: bigint, aspect: number, cp: CentreParams): number {
  const num = BigInt(cp.factionAreaShare.num);
  const den = BigInt(cp.factionAreaShare.den);
  let best = 0;
  for (let h = 1; h <= 100000; h++) {
    const { W, E } = exactDyadic(h * aspect);
    if (den * BigInt(h) * W <= (num * n) * 2n ** E) best = h;
    else break;
  }
  return best;
}

/** The end step kEnd: the smallest k whose disc holds the four corners of [xmin, xmax + 1] x [ymin, ymax + 1]. */
export function refEndStep(units: readonly Unit[], cp: CentreParams): number {
  const f = factsOf(units, cp);
  for (let k = 1; ; k++) {
    const { xmin, xmax, ymin, ymax } = f.box;
    if (f.discPoint(k, xmin, ymin) && f.discPoint(k, xmax + 1, ymin) && f.discPoint(k, xmin, ymax + 1) && f.discPoint(k, xmax + 1, ymax + 1)) return k;
  }
}

/**
 * The arc candidate of FR-221 at step k: the arc shapes of the 006 shape list (tangent theta* at the midpoint, bends
 * +-30 and +-60), every whole height from 1 up to `top` (undefined: the size of the region), the unit centres in the disc,
 * every unit centre of the pinned grown arc in the set, every tangent within `limit` degrees (Infinity: no limit); the
 * largest height, the first shape in shape order, then the smallest exact distance to C, the smallest y and the smallest x.
 * A candidate that fails at a height fails at every larger one (the grown arc only grows), as in 006.
 */
export function refArc(
  units: readonly Unit[],
  p: PieceIndex,
  pieces: readonly number[],
  aspect: number,
  margin: number,
  cp: CentreParams,
  sp: ShapeParams,
  k: number,
  top: number | undefined,
  limit: number = cp.angleLimit,
): ArcFrame | undefined {
  if (units.length === 0) return undefined;
  const f = factsOf(units, cp);
  const theta = axisAngle(p, pieces);
  const extent = axisExtent(p, pieces, theta);
  const shapes = shapesOf(theta, extent, sp).filter((s) => s.shape === 'arc');
  const bound = f.box.xmax - f.box.xmin + 1 + (f.box.ymax - f.box.ymin + 1);
  const hTop = Math.min(top ?? bound, bound);
  const discCells: Array<[number, number]> = [];
  for (let cy = f.box.ymin; cy <= f.box.ymax; cy++) {
    for (let cx = f.box.xmin; cx <= f.box.xmax; cx++) if (f.inSet(cx, cy) && f.discUnit(k, cx, cy)) discCells.push([cx, cy]);
  }
  const fitsDirect = (frame: ArcFrame, cx: number, cy: number): boolean => {
    const at: ArcFrame = { ...frame, cx: cx + 0.5, cy: cy + 0.5 };
    const ext = Math.ceil(frame.w / 2 + frame.h / 2 + 2 * margin) + 3;
    for (let y = cy - ext; y <= cy + ext; y++) {
      for (let x = cx - ext; x <= cx + ext; x++) {
        if (inArc(at, margin, x + 0.5, y + 0.5) && !f.inSet(x, y)) return false;
      }
    }
    return true;
  };
  let bestH = 0;
  let bestShape: ArcFrame | undefined;
  let bestCells: Array<[number, number]> = [];
  for (const shape of shapes) {
    if (shape.shape !== 'arc') continue;
    const radius = arcRadius(extent, shape.bend);
    let alive = discCells;
    let best = 0;
    let last = alive;
    let lastProto: ArcFrame | undefined;
    for (let h = 1; h <= hTop && alive.length > 0; h++) {
      const w = h * aspect;
      const proto: ArcFrame = { shape: 'arc', cx: 0, cy: 0, angle: shape.angle, h, w, bend: shape.bend, radius };
      if (!arcExists(proto, extent, margin)) break;
      const alpha = (w * Math.abs(shape.bend)) / (2 * extent);
      if (!(shape.angle - alpha >= -limit && shape.angle + alpha <= limit)) break;
      const next = alive.filter(([cx, cy]) => fitsDirect(proto, cx, cy));
      if (next.length === 0) break;
      alive = next;
      best = h;
      last = next;
      lastProto = proto;
    }
    if (best > bestH) {
      bestH = best;
      bestShape = lastProto;
      bestCells = last;
    }
  }
  if (bestShape === undefined) return undefined;
  let win = bestCells[0]!;
  for (const c of bestCells) {
    const a = f.unitKey(c[0], c[1]);
    const b = f.unitKey(win[0], win[1]);
    const d = a[0] * b[1] - b[0] * a[1];
    if (d < 0n || (d === 0n && (c[1] < win[1] || (c[1] === win[1] && c[0] < win[0])))) win = c;
  }
  return { ...bestShape, cx: win[0] + 0.5, cy: win[1] + 0.5 };
}

/** One widening step of the reference: the centred and arc candidates, the FR-221 choice. */
export interface RefStep {
  k: number;
  centred: RefFrame | undefined;
  arc: ArcFrame | undefined;
  chosen: InLandFrame | undefined;
}

export interface RefInLand {
  frame: InLandFrame | undefined;
  k: number;
  kEnd: number;
  steps: RefStep[];
}

const heightOf = (f: InLandFrame | undefined): number => (f === undefined ? 0 : f.shape === 'horizontal' ? f.box.h : f.h);

const centredMemo = new WeakMap<readonly Unit[], Map<string, RefFrame | undefined>>();

/** `refCentred` frames memoized per region (the widening reference calls it for every step). */
function centredAt(units: readonly Unit[], aspect: number, margin: number, cp: CentreParams, k: number, top: number | undefined): RefFrame | undefined {
  let memo = centredMemo.get(units);
  if (memo === undefined) {
    memo = new Map();
    centredMemo.set(units, memo);
  }
  const id = `${String(aspect)}|${String(k)}|${String(top)}`;
  if (memo.has(id)) return memo.get(id);
  const out = refCentred(units, aspect, margin, cp, k, top).frame;
  memo.set(id, out);
  return out;
}

/**
 * The in-land frame of FR-221 and FR-222 by the definitions: at each step k = 1, 2, ... the centred candidate, the arc
 * candidate, the arc when it exists and its height is at least G x the centred height, else the centred candidate;
 * the loop ends at the first step whose frame reaches `offLandHeight` of the role or at kEnd (the last step is kept).
 * A faction label has the FR-230 cap on every shape.
 */
export function refInLand(
  units: readonly Unit[],
  p: PieceIndex,
  pieces: readonly number[],
  aspect: number,
  role: 'faction' | 'territory',
  margin: number,
  cp: CentreParams,
  sp: ShapeParams,
): RefInLand {
  const f = factsOf(units, cp);
  const cap = role === 'faction' ? refFactionCap(f.n, aspect, cp) : undefined;
  const kEnd = refEndStep(units, cp);
  const steps: RefStep[] = [];
  for (let k = 1; k <= kEnd; k++) {
    const centred = cap === 0 ? undefined : centredAt(units, aspect, margin, cp, k, cap);
    const arc = cap === 0 ? undefined : refArc(units, p, pieces, aspect, margin, cp, sp, k, cap);
    const useArc = arc !== undefined && (centred === undefined || arc.h >= sp.shapeGain * heightOf(centred));
    const chosen: InLandFrame | undefined = useArc ? arc : centred;
    steps.push({ k, centred, arc, chosen });
    if (chosen !== undefined && heightOf(chosen) >= sp.offLandHeight[role]) return { frame: chosen, k, kEnd, steps };
  }
  return { frame: steps[steps.length - 1]?.chosen, k: kEnd, kEnd, steps };
}
