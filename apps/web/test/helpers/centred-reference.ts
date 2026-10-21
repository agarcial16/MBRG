/**
 * Brute-force definitions of the centred candidate (spec 007 FR-219, FR-220, FR-222, FR-228; plan 007 sections 6 and
 * 13), written from the spec text and independent of `src/core/label-centre.ts` and `label-centred.ts`: it applies the
 * spec inequalities directly (BigInt, no intervals), the 005 box fit as "every unit whose centre lies in the rectangle
 * belongs to the set", the 006 pinned straight membership formula (`inStraight`) and the FR-220 order. Test code:
 * doubles are fine here, but no decision of the result comes from a double comparison except the pinned 006 formula.
 */
import type { CentreParams } from '../../src/core/centre-params';
import { inStraight } from '../../src/core/label-shape';
import type { StraightFrame } from '../../src/core/label-shape';
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
