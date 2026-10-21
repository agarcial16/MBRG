import { describe, expect, it } from 'vitest';
import { CENTRE_PARAMS } from '../src/core/centre-params';
import {
  boxCentreX,
  boxCentreY,
  boxDistance,
  boxRowInterval,
  centreSums,
  compareKeys,
  dyadic,
  endStep,
  factionHeightCap,
  inDiscBox,
  inDiscUnit,
  isqrt,
  regionBox,
  unitCentre,
  unitDistance,
  unitRowInterval,
} from '../src/core/label-centre';
import type { CentreSums } from '../src/core/label-centre';
import { setSums } from '../src/core/label-axis';
import { LABEL_PARAMS } from '../src/core/label-params';
import { SHAPE_PARAMS } from '../src/core/shape-params';
import { handRegions, randomRegions } from './helpers/centred-grids';
import type { TestRegion } from './helpers/centred-grids';
import { devRun } from './helpers/label-digest-run';
import { rng } from './helpers/label-grids';
import { MEASURED_ASPECTS } from './helpers/measured-aspects';

describe('centre parameters (spec 007)', () => {
  it('FR-219 FR-221 FR-230 CENTRE_PARAMS holds the decided values', () => {
    expect(CENTRE_PARAMS).toStrictEqual({
      centreFraction: { num: 7, den: 50 },
      angleLimit: 45,
      straightAngles: [15, -15, 30, -30, 45, -45],
      factionAreaShare: { num: 1, den: 10 },
    });
  });

  it('FR-219 the centre fraction and the area share are whole-number ratios', () => {
    for (const r of [CENTRE_PARAMS.centreFraction, CENTRE_PARAMS.factionAreaShare]) {
      expect(Number.isInteger(r.num)).toBe(true);
      expect(Number.isInteger(r.den)).toBe(true);
      expect(r.num).toBeGreaterThan(0);
      expect(r.den).toBeGreaterThan(r.num);
    }
  });

  it('FR-219 the straight angles are in the FR-220 order, all multiples of 15 within the limit', () => {
    const a = CENTRE_PARAMS.straightAngles;
    expect(a).toHaveLength(6);
    expect(new Set(a).size).toBe(6);
    for (const t of a) {
      expect(Math.abs(t) % 15).toBe(0);
      expect(Math.abs(t)).toBeLessThanOrEqual(CENTRE_PARAMS.angleLimit);
      expect(t).not.toBe(0);
    }
    // Increasing |theta|, the positive angle before the negative one.
    expect(a.map(Math.abs)).toStrictEqual([15, 15, 30, 30, 45, 45]);
    expect(a.filter((_, i) => i % 2 === 0).every((t) => t > 0)).toBe(true);
  });

  it('FR-221 the arc tangent limit is 45 degrees', () => {
    expect(CENTRE_PARAMS.angleLimit).toBe(45);
  });

  it('FR-230 a faction label may cover at most one tenth of the region area', () => {
    expect(CENTRE_PARAMS.factionAreaShare).toStrictEqual({ num: 1, den: 10 });
  });

  it('FR-219 the 005 and 006 parameters keep their pinned values', () => {
    expect(LABEL_PARAMS).toStrictEqual({
      font: { weight: 600, families: ['"Segoe UI"', '"Helvetica Neue"', 'Arial', 'sans-serif'] },
      margin: 2,
      maxHeight: 120,
      minPx: 9,
      fadeStart: 1.5,
      fadeFull: 2,
      durationMs: 1500,
    });
    expect(SHAPE_PARAMS).toStrictEqual({
      angleStep: 15,
      shapeGain: 1.25,
      arcBends: [30, 60],
      offLandHeight: { faction: 18, territory: 3 },
      offLandReach: 24,
      leaderGap: 6,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Exact centre arithmetic (T2). The references below are written from the spec text (Definitions, 7/50 as the
// literals 49 and 2500) and share no code with src: sums by plain loops, one inequality per candidate in BigInt,
// doubles only to choose the scan windows.
// ---------------------------------------------------------------------------------------------------------------
type Unit = readonly [number, number];

const refSums = (units: readonly Unit[]): CentreSums => ({
  n: BigInt(units.length),
  sx: units.reduce((a, u) => a + BigInt(u[0]), 0n),
  sy: units.reduce((a, u) => a + BigInt(u[1]), 0n),
});

/** w = W / 2^E with the smallest whole E >= 0, read from the IEEE-754 bits (no code shared with src). */
function decompose(w: number): { W: bigint; E: number } {
  const bits = new BigUint64Array(new Float64Array([w]).buffer)[0]!;
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m = exp === 0 ? frac : frac | (1n << 52n);
  let e = (exp === 0 ? 1 : exp) - 1075;
  if (m === 0n) return { W: 0n, E: 0 };
  while ((m & 1n) === 0n && e < 0) {
    m >>= 1n;
    e++;
  }
  return e >= 0 ? { W: m << BigInt(e), E: 0 } : { W: m, E: -e };
}

/** The unit-centre inequality of the spec: 2500 ((n cx - Sx)^2 + (n cy - Sy)^2) <= 49 k^2 n^3. */
function refUnitIn(s: CentreSums, k: number, cx: number, cy: number): boolean {
  const u = s.n * BigInt(cx) - s.sx;
  const v = s.n * BigInt(cy) - s.sy;
  return 2500n * (u * u + v * v) <= 49n * BigInt(k * k) * s.n ** 3n;
}

/** The horizontal-frame inequality of the spec with X, Y and the factor 2^(2E+2). */
function refBoxIn(s: CentreSums, k: number, x0: number, y0: number, h: number, w: number): boolean {
  const { W, E } = decompose(w);
  const e = BigInt(E);
  const X = 2n ** (e + 1n) * (s.n * BigInt(x0) - s.sx) + s.n * W - 2n ** e * s.n;
  const Y = 2n ** e * (2n * (s.n * BigInt(y0) - s.sy) + s.n * BigInt(h) - s.n);
  return 2500n * (X * X + Y * Y) <= 49n * BigInt(k * k) * s.n ** 3n * 2n ** (2n * e + 2n);
}

/** Whether the point (X, Y) of the map is in the disc of step k: the corner form used for kEnd. */
function refPointIn(s: CentreSums, k: number, X: number, Y: number): boolean {
  const a = 2n * s.n * BigInt(X) - 2n * s.sx - s.n;
  const b = 2n * s.n * BigInt(Y) - 2n * s.sy - s.n;
  return 2500n * (a * a + b * b) <= 4n * 49n * BigInt(k * k) * s.n ** 3n;
}

/** Window helpers in doubles: only used to choose which candidates to scan. */
function windowOf(s: CentreSums, k: number): { mx: number; my: number; reach: number } {
  const n = Number(s.n);
  return { mx: Number(s.sx) / n, my: Number(s.sy) / n, reach: k * 0.14 * Math.sqrt(n) + 2 };
}

const bboxOf = (units: readonly Unit[]) => ({
  xmin: Math.min(...units.map((u) => u[0])),
  xmax: Math.max(...units.map((u) => u[0])),
  ymin: Math.min(...units.map((u) => u[1])),
  ymax: Math.max(...units.map((u) => u[1])),
});

const allRegions = (random: number): TestRegion[] => [...handRegions(), ...randomRegions(random)];

describe('exact centre of mass and sums (spec 007 FR-218, FR-228)', () => {
  it('FR-218 FR-228 centreSums equals the direct sums of hand and random regions, as BigInt', () => {
    for (const r of allRegions(60)) {
      const s = centreSums(r.p, r.pieces);
      expect(s, r.name).toStrictEqual(refSums(r.units));
      const d = setSums(r.p, r.pieces); // the 006 double sums are exact at this size
      expect([s.n, s.sx, s.sy], r.name).toStrictEqual([BigInt(d.n), BigInt(d.sx), BigInt(d.sy)]);
    }
  });

  it('FR-218 FR-228 centreSums of a subset of pieces counts only those pieces', () => {
    const r = handRegions().find((h) => h.name === 'two lobes')!;
    const first = [r.pieces[0]!];
    const s = centreSums(r.p, first);
    const direct = setSums(r.p, first);
    expect(s.n).toBe(BigInt(direct.n));
    expect(centreSums(r.p, [])).toStrictEqual({ n: 0n, sx: 0n, sy: 0n });
  });

  it('FR-218 FR-228 the sums of every dev-map label (rounds 0..4) equal the 006 sums, and Francia at round 4 has n and C of the spec', async () => {
    const run = await devRun();
    let biggest = 0n;
    let francia: CentreSums | undefined;
    for (const layout of run.factions) {
      for (const label of layout.boxes.labels.values()) {
        const s = centreSums(run.p, label.pieces);
        const d = setSums(run.p, label.pieces);
        expect([s.n, s.sx, s.sy]).toStrictEqual([BigInt(d.n), BigInt(d.sx), BigInt(d.sy)]);
        if (s.n > biggest) {
          biggest = s.n;
          francia = s;
        }
      }
    }
    expect(francia!.n).toBe(1165291n);
    // C = (Sx / n + 0.5, Sy / n + 0.5) = (932, 1056) as the spec states it (to within one unit)
    expect(Math.abs(Number(francia!.sx) / Number(francia!.n) + 0.5 - 932)).toBeLessThan(1);
    expect(Math.abs(Number(francia!.sy) / Number(francia!.n) + 0.5 - 1056)).toBeLessThan(1);
    // rho^2 = 49 n / 2500 = 22840.4...: rho is 151 to the unit, never a rounded input of a decision
    expect(isqrt((49n * francia!.n) / 2500n)).toBe(151n);
  });
});

describe('exact integer square root and dyadic split (spec 007 FR-228)', () => {
  it('FR-228 isqrt is the floor of the square root on 10^5 values and at squares +-1', () => {
    const next = rng(20260421);
    const bigRandom = (): bigint => {
      const words = 1 + Math.floor(next() * 4);
      let v = 0n;
      for (let i = 0; i < words; i++) v = (v << 30n) | BigInt(Math.floor(next() * 2 ** 30));
      return v;
    };
    for (let i = 0; i < 100000; i++) {
      const v = bigRandom();
      const r = isqrt(v);
      if (!(r * r <= v && v < (r + 1n) * (r + 1n))) throw new Error(`isqrt wrong for ${v}`);
    }
    for (const r of [0n, 1n, 2n, 3n, 15n, 16n, 1000n, 2n ** 26n, 2n ** 26n + 1n, 2n ** 27n - 1n, 2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, 2n ** 64n, 2n ** 100n - 1n, 2n ** 100n]) {
      expect(isqrt(r * r), `${r}^2`).toBe(r);
      if (r > 0n) expect(isqrt(r * r - 1n), `${r}^2-1`).toBe(r - 1n);
      if (r > 0n) expect(isqrt(r * r + 1n), `${r}^2+1`).toBe(r);
      expect(isqrt(r * r + 2n * r), `${r}^2+2r`).toBe(r);
      expect(isqrt(r * r + 2n * r + 1n), `(${r}+1)^2`).toBe(r + 1n);
    }
    expect(() => isqrt(-1n)).toThrow(RangeError);
  });

  it('FR-228 dyadic writes every height x aspect product exactly as W / 2^E with the smallest E', () => {
    const aspects = [...Object.values(MEASURED_ASPECTS), 0.6, 1, 4, 3, 0.1, 1e-3, 123.456];
    let checked = 0;
    for (const a of aspects) {
      for (let h = 1; h <= 400; h++) {
        const w = h * a;
        const { W, E } = dyadic(w);
        expect(Number.isInteger(E) && E >= 0).toBe(true);
        expect(Number(W) / 2 ** E, `${h} x ${a}`).toBe(w);
        if (E > 0) expect(W % 2n, `${h} x ${a} smallest E`).toBe(1n);
        expect({ W, E }).toStrictEqual(decompose(w));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(dyadic(0)).toStrictEqual({ W: 0n, E: 0 });
    expect(dyadic(12)).toStrictEqual({ W: 12n, E: 0 });
    expect(dyadic(0.5)).toStrictEqual({ W: 1n, E: 1 });
    expect(dyadic(2.75)).toStrictEqual({ W: 11n, E: 2 });
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => dyadic(bad), String(bad)).toThrow(RangeError);
  });
});

describe('centre disc: tests and row intervals (spec 007 FR-218, FR-222, FR-228)', () => {
  it('FR-218 FR-228 inDiscUnit and inDiscBox equal the spec inequality', () => {
    for (const r of allRegions(20)) {
      const s = centreSums(r.p, r.pieces);
      const { mx, my, reach } = windowOf(s, 3);
      for (let cy = Math.floor(my - reach); cy <= Math.ceil(my + reach); cy += 2) {
        for (let cx = Math.floor(mx - reach); cx <= Math.ceil(mx + reach); cx += 2) {
          for (const k of [1, 3]) {
            if (inDiscUnit(s, CENTRE_PARAMS, k, cx, cy) !== refUnitIn(s, k, cx, cy)) throw new Error(`${r.name} unit ${cx},${cy} k${k}`);
            const h = 1 + ((cx + cy) & 3);
            const w = h * r.aspect;
            if (inDiscBox(s, CENTRE_PARAMS, k, cx, cy, h, w) !== refBoxIn(s, k, cx, cy, h, w)) throw new Error(`${r.name} box ${cx},${cy} k${k}`);
          }
        }
      }
    }
  });

  it('FR-218 FR-228 the unit row interval equals the set of whole cx that satisfy the inequality, on 200 random and the hand regions', () => {
    for (const r of allRegions(200)) {
      const s = centreSums(r.p, r.pieces);
      const kEnd = endStep(s, CENTRE_PARAMS, bboxOf(r.units));
      const ks = new Set([1, 2, 3, kEnd - 1, kEnd].filter((k) => k >= 1 && k <= kEnd));
      for (const k of ks) {
        const { mx, my, reach } = windowOf(s, k);
        for (let cy = Math.floor(my - reach); cy <= Math.ceil(my + reach); cy++) {
          const cxs: number[] = [];
          for (let cx = Math.floor(mx - reach); cx <= Math.ceil(mx + reach); cx++) if (refUnitIn(s, k, cx, cy)) cxs.push(cx);
          const got = unitRowInterval(s, CENTRE_PARAMS, k, cy);
          if (cxs.length === 0) {
            if (got !== undefined) throw new Error(`${r.name} k${k} row ${cy}: expected none, got ${String(got)}`);
          } else {
            const last = cxs[cxs.length - 1]!;
            if (cxs.length !== last - cxs[0]! + 1) throw new Error(`${r.name} k${k} row ${cy}: not an interval`);
            if (got === undefined || got[0] !== cxs[0] || got[1] !== last) throw new Error(`${r.name} k${k} row ${cy}: expected ${cxs[0]}..${last}, got ${String(got)}`);
          }
        }
      }
    }
  }, 120000);

  it('FR-218 FR-222 FR-228 the unit row interval is right for every k = 1..kEnd on 30 small regions', () => {
    for (const r of allRegions(30)) {
      const s = centreSums(r.p, r.pieces);
      const kEnd = endStep(s, CENTRE_PARAMS, bboxOf(r.units));
      for (let k = 1; k <= kEnd; k++) {
        const { mx, my, reach } = windowOf(s, k);
        for (let cy = Math.floor(my - reach); cy <= Math.ceil(my + reach); cy++) {
          const cxs: number[] = [];
          for (let cx = Math.floor(mx - reach); cx <= Math.ceil(mx + reach); cx++) if (refUnitIn(s, k, cx, cy)) cxs.push(cx);
          const got = unitRowInterval(s, CENTRE_PARAMS, k, cy);
          const want = cxs.length === 0 ? undefined : [cxs[0]!, cxs[cxs.length - 1]!];
          if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${r.name} k${k} row ${cy}: expected ${String(want)}, got ${String(got)}`);
        }
      }
    }
  }, 120000);

  it('FR-218 FR-228 the box row interval equals the set of whole x0 that satisfy the inequality, for aspects above and below 1', () => {
    for (const r of allRegions(100)) {
      const s = centreSums(r.p, r.pieces);
      const kEnd = endStep(s, CENTRE_PARAMS, bboxOf(r.units));
      const ks = new Set([1, 2, kEnd].filter((k) => k >= 1 && k <= kEnd));
      for (const k of ks) {
        const { mx, my, reach } = windowOf(s, k);
        for (const h of [1, 4, 9]) {
          const w = h * r.aspect;
          const slack = Math.ceil(w) + h + 2;
          for (let y0 = Math.floor(my - reach - h); y0 <= Math.ceil(my + reach); y0++) {
            const xs: number[] = [];
            for (let x0 = Math.floor(mx - reach - slack); x0 <= Math.ceil(mx + reach); x0++) if (refBoxIn(s, k, x0, y0, h, w)) xs.push(x0);
            const got = boxRowInterval(s, CENTRE_PARAMS, k, y0, h, w);
            if (xs.length === 0) {
              if (got !== undefined) throw new Error(`${r.name} k${k} h${h} row ${y0}: expected none, got ${String(got)}`);
            } else {
              const last = xs[xs.length - 1]!;
              if (xs.length !== last - xs[0]! + 1) throw new Error(`${r.name} k${k} h${h} row ${y0}: not an interval`);
              if (got === undefined || got[0] !== xs[0] || got[1] !== last) throw new Error(`${r.name} k${k} h${h} row ${y0}: expected ${xs[0]}..${last}, got ${String(got)}`);
            }
          }
        }
      }
    }
  }, 120000);

  it('FR-228 a frame exactly on the circle is in the disc (<=, not <): n 25, k 2, distance 1.4 = 2 rho', () => {
    // n = 25: rho = 0.7, so at k = 2 the circle has radius 1.4. C = (3.1, 3.5).
    const s: CentreSums = { n: 25n, sx: 65n, sy: 75n };
    expect(inDiscUnit(s, CENTRE_PARAMS, 2, 4, 3)).toBe(true); // centre (4.5, 3.5): distance 1.4 exactly
    expect(inDiscUnit(s, CENTRE_PARAMS, 1, 4, 3)).toBe(false);
    expect(unitRowInterval(s, CENTRE_PARAMS, 2, 3)).toStrictEqual([2, 4]); // 25 cx - 65 in [-35, 35]
    expect(inDiscBox(s, CENTRE_PARAMS, 2, 4, 3, 1, 1)).toBe(true); // 1 x 1 box, same centre
    expect(inDiscBox(s, CENTRE_PARAMS, 2, 5, 3, 1, 1)).toBe(false);
    expect(boxRowInterval(s, CENTRE_PARAMS, 2, 3, 1, 1)).toStrictEqual([2, 4]);
    // a 3-4-5 point: u = 28, v = 21 gives 35 = 1.4 x 25
    const t: CentreSums = { n: 25n, sx: 72n, sy: 54n };
    expect(inDiscUnit(t, CENTRE_PARAMS, 2, 4, 3)).toBe(true);
    expect(unitRowInterval(t, CENTRE_PARAMS, 2, 3)).toStrictEqual([2, 4]);
    expect(unitRowInterval(t, CENTRE_PARAMS, 2, 2)).toStrictEqual([2, 4]);
    // the rows above and below are past the circle
    expect(unitRowInterval(t, CENTRE_PARAMS, 2, 4)).toBeUndefined();
    expect(inDiscUnit(t, CENTRE_PARAMS, 2, 4, 5)).toBe(false);
  });

  it('FR-218 FR-228 a region of 51 units has rho below 1 and one of 52 units has rho above 1; the disc may be empty', () => {
    // C is one unit left of the unit centre (cx, cy): distance exactly 1.
    const at = (n: bigint): CentreSums => ({ n, sx: n * 4n - n, sy: n * 6n });
    expect(inDiscUnit(at(51n), CENTRE_PARAMS, 1, 4, 6)).toBe(false); // rho^2 = 0.9996
    expect(inDiscUnit(at(52n), CENTRE_PARAMS, 1, 4, 6)).toBe(true); // rho^2 = 1.0192
    expect(unitRowInterval(at(51n), CENTRE_PARAMS, 1, 6)).toStrictEqual([3, 3]); // |51 cx - 153| <= 50
    expect(unitRowInterval(at(52n), CENTRE_PARAMS, 1, 6)).toStrictEqual([2, 4]); // |52 cx - 156| <= 52
    // the 2 x 2 block: C is the corner shared by four unit centres, 0.707 away; rho = 0.28
    const block = { n: 4n, sx: 10n, sy: 10n }; // units (2,2) (3,2) (2,3) (3,3)
    for (let cy = 0; cy <= 5; cy++) expect(unitRowInterval(block, CENTRE_PARAMS, 1, cy), `row ${cy}`).toBeUndefined();
    expect(unitRowInterval(block, CENTRE_PARAMS, 2, 2)).toBeUndefined(); // 0.56 < 0.707
    expect(unitRowInterval(block, CENTRE_PARAMS, 3, 2)).toStrictEqual([2, 3]); // 0.84 >= 0.707
  });

  it('FR-218 FR-228 the disc of Francia at round 4 holds as many unit centres as the direct count, about 72 700', () => {
    const s: CentreSums = { n: 1165291n, sx: 1165291n * 931n + 400000n, sy: 1165291n * 1055n + 250000n };
    const { mx, my } = windowOf(s, 1);
    let sum = 0;
    for (let cy = Math.floor(my - 160); cy <= Math.ceil(my + 160); cy++) {
      const iv = unitRowInterval(s, CENTRE_PARAMS, 1, cy);
      if (iv !== undefined) sum += iv[1] - iv[0] + 1;
    }
    let direct = 0;
    for (let cy = Math.floor(my - 160); cy <= Math.ceil(my + 160); cy++) {
      for (let cx = Math.floor(mx - 160); cx <= Math.ceil(mx + 160); cx++) if (refUnitIn(s, 1, cx, cy)) direct++;
    }
    expect(sum).toBe(direct);
    expect(direct).toBeGreaterThan(70000);
    expect(direct).toBeLessThan(74000);
  });
});

describe('end step kEnd (spec 007 FR-222, FR-228)', () => {
  it('FR-222 FR-228 regionBox is the bounding box of the pieces', () => {
    for (const r of allRegions(30)) expect(regionBox(r.p, r.pieces), r.name).toStrictEqual(bboxOf(r.units));
  });

  it('FR-222 FR-228 the disc at kEnd contains the four corners and the whole region, and at kEnd - 1 it does not', () => {
    for (const r of allRegions(200)) {
      const s = centreSums(r.p, r.pieces);
      const b = bboxOf(r.units);
      const kEnd = endStep(s, CENTRE_PARAMS, b);
      expect(Number.isInteger(kEnd) && kEnd >= 1, r.name).toBe(true);
      const corners: Unit[] = [[b.xmin, b.ymin], [b.xmax + 1, b.ymin], [b.xmin, b.ymax + 1], [b.xmax + 1, b.ymax + 1]];
      if (!corners.every(([X, Y]) => refPointIn(s, kEnd, X, Y))) throw new Error(`${r.name}: a corner is outside at kEnd ${kEnd}`);
      if (kEnd > 1 && corners.every(([X, Y]) => refPointIn(s, kEnd - 1, X, Y))) throw new Error(`${r.name}: kEnd ${kEnd} is not the smallest`);
      if (!r.units.every(([x, y]) => refUnitIn(s, kEnd, x, y))) throw new Error(`${r.name}: a unit centre is outside at kEnd`);
    }
  });

  it('FR-222 FR-228 kEnd of one unit is 6 (corner at 0.707, rho 0.14): 5 gives 0.7, 6 gives 0.84', () => {
    const one = handRegions().find((h) => h.name === 'one unit')!;
    const s = centreSums(one.p, one.pieces);
    expect(endStep(s, CENTRE_PARAMS, regionBox(one.p, one.pieces))).toBe(6);
  });

  it('FR-222 FR-228 kEnd is exact when the farthest corner lies exactly on the circle of step 1', () => {
    // n = 50, C = (9.3, 9.3) (Sx = Sy = 440). The box [9, 9] x [9, 9] has corners X, Y in {9, 10}; the farthest corner
    // (10, 10) has offsets a = b = 70 (2 n X - 2 Sx - n), D = 9800 and 2500 D = 4 x 49 x n^3: exactly the circle.
    const s: CentreSums = { n: 50n, sx: 440n, sy: 440n };
    expect(refPointIn(s, 1, 10, 10)).toBe(true);
    expect(endStep(s, CENTRE_PARAMS, { xmin: 9, xmax: 9, ymin: 9, ymax: 9 })).toBe(1);
    // one unit further out is beyond step 1
    expect(endStep(s, CENTRE_PARAMS, { xmin: 9, xmax: 10, ymin: 9, ymax: 9 })).toBeGreaterThan(1);
  });
});

describe('exact keys and centre coordinates (spec 007 FR-228)', () => {
  const frac = (f: { num: bigint; den: bigint }): number => Number(f.num) / Number(f.den);

  it('FR-228 unitDistance and boxDistance are the squared centre distance as an exact rational', () => {
    for (const r of allRegions(40)) {
      const s = centreSums(r.p, r.pieces);
      const { mx, my, reach } = windowOf(s, 2);
      for (let cy = Math.floor(my - reach); cy <= Math.ceil(my + reach); cy += 3) {
        for (let cx = Math.floor(mx - reach); cx <= Math.ceil(mx + reach); cx += 3) {
          const d = (cx - mx) ** 2 + (cy - my) ** 2;
          expect(frac(unitDistance(s, cx, cy)), `${r.name} ${cx},${cy}`).toBeCloseTo(d, 8);
          const h = 1 + ((cx * 7 + cy) & 3);
          const w = h * r.aspect;
          const bx = cx + w / 2 - (mx + 0.5);
          const by = cy + h / 2 - (my + 0.5);
          expect(frac(boxDistance(s, cx, cy, h, w)), `${r.name} box ${cx},${cy}`).toBeCloseTo(bx * bx + by * by, 8);
        }
      }
    }
  });

  it('FR-228 compareKeys is exact: mirrored positions tie, a unit equals the 1 x 1 box with the same centre, closer is smaller', () => {
    const s: CentreSums = { n: 25n, sx: 50n, sy: 50n }; // the 5 x 5 square: C = (2.5, 2.5)
    expect(compareKeys(unitDistance(s, 1, 2), unitDistance(s, 3, 2))).toBe(0); // mirror in x
    expect(compareKeys(unitDistance(s, 2, 1), unitDistance(s, 2, 3))).toBe(0); // mirror in y
    expect(compareKeys(unitDistance(s, 1, 2), unitDistance(s, 2, 1))).toBe(0); // diagonal mirror
    expect(compareKeys(unitDistance(s, 2, 2), unitDistance(s, 1, 2))).toBeLessThan(0);
    expect(compareKeys(unitDistance(s, 4, 2), unitDistance(s, 1, 2))).toBeGreaterThan(0);
    expect(compareKeys(unitDistance(s, 2, 2), boxDistance(s, 2, 2, 1, 1))).toBe(0);
    expect(compareKeys(unitDistance(s, 1, 3), boxDistance(s, 1, 3, 1, 1))).toBe(0);
    // a 1.5 x 1 box and a 1 x 1 box in the same place differ by exactly the half width
    expect(compareKeys(boxDistance(s, 2, 2, 1, 1.5), boxDistance(s, 2, 2, 1, 1))).toBeGreaterThan(0);
    // two values that differ by 1 part in 10^18 are ordered correctly (no double can see it)
    const big: CentreSums = { n: 1165291n, sx: 1165291n * 931n, sy: 1165291n * 1055n };
    const a = unitDistance(big, 1000, 1000);
    const b = { num: a.num + 1n, den: a.den };
    expect(compareKeys(a, b)).toBeLessThan(0);
    expect(compareKeys(b, a)).toBeGreaterThan(0);
    expect(compareKeys(a, { num: a.num * 3n, den: a.den * 3n })).toBe(0);
  });

  it('FR-228 centre coordinates are exact rationals and compare equal across units and boxes', () => {
    expect(unitCentre(4)).toStrictEqual({ num: 9n, den: 2n });
    expect(compareKeys(unitCentre(4), boxCentreY(4, 1))).toBe(0); // box y0 4, h 1: centre 4.5
    expect(compareKeys(unitCentre(4), boxCentreX(4, 1))).toBe(0); // w 1
    expect(compareKeys(boxCentreX(3, 3), unitCentre(4))).toBe(0); // 3 + 1.5 = 4.5
    expect(compareKeys(boxCentreX(3, 2.5), unitCentre(4))).toBeLessThan(0); // 4.25 < 4.5
    expect(compareKeys(boxCentreX(3, 3.0000000000000004), unitCentre(4))).toBeGreaterThan(0); // not rounded
    expect(compareKeys(boxCentreY(3, 3), unitCentre(4))).toBe(0); // 3 + 1.5
    expect(compareKeys(boxCentreY(2, 5), unitCentre(4))).toBe(0); // 2 + 2.5
  });
});

describe('guards (spec 007 FR-228)', () => {
  it('FR-228 an empty region or a step below 1 is refused instead of giving a wrong interval', () => {
    const empty: CentreSums = { n: 0n, sx: 0n, sy: 0n };
    const one: CentreSums = { n: 1n, sx: 3n, sy: 3n };
    expect(() => unitRowInterval(empty, CENTRE_PARAMS, 1, 0)).toThrow(RangeError);
    expect(() => endStep(empty, CENTRE_PARAMS, { xmin: 0, xmax: 0, ymin: 0, ymax: 0 })).toThrow(RangeError);
    for (const k of [0, -1, 1.5, Number.NaN]) {
      expect(() => unitRowInterval(one, CENTRE_PARAMS, k, 3), String(k)).toThrow(RangeError);
      expect(() => boxRowInterval(one, CENTRE_PARAMS, k, 3, 1, 1), String(k)).toThrow(RangeError);
    }
    expect(() => regionBox({ width: 4, height: 4 } as never, [])).toThrow(RangeError);
  });
});

describe('faction size cap (spec 007 FR-230)', () => {
  /** The largest h with 10 h w <= n, w = h x a as the double the drawn box uses, by a linear scan. */
  function scan(n: bigint, a: number): number {
    let h = 0;
    for (;;) {
      const { W, E } = decompose((h + 1) * a);
      if (10n * BigInt(h + 1) * W > n * 2n ** BigInt(E)) return h;
      h++;
    }
  }

  it('FR-230 factionHeightCap equals a linear scan for every aspect and many region sizes', () => {
    const aspects = [0.6, 1, 2.5, 3, 4, 8.53271484375, 17.19580078125, ...Object.values(MEASURED_ASPECTS)];
    const sizes = [1n, 9n, 10n, 40n, 51n, 52n, 1000n, 28900n, 29241n, 123457n, 1165291n];
    for (const a of aspects) {
      for (const n of sizes) {
        const got = factionHeightCap(n, a, CENTRE_PARAMS.factionAreaShare);
        if (got !== scan(n, a)) throw new Error(`cap n ${n} a ${a}: ${got} vs ${scan(n, a)}`);
      }
    }
  });

  it('FR-230 the cap of Francia at round 4 with aspect 4 is 170 (170 x 680 x 10 <= n < 171 x 684 x 10)', () => {
    expect(factionHeightCap(1165291n, 4, CENTRE_PARAMS.factionAreaShare)).toBe(170);
    expect(10 * 170 * 680).toBeLessThanOrEqual(1165291);
    expect(10 * 171 * 684).toBeGreaterThan(1165291);
  });

  it('FR-230 the cap is 0 when even a frame of height 1 covers more than a tenth, and an exact tenth is allowed', () => {
    expect(factionHeightCap(39n, 4, CENTRE_PARAMS.factionAreaShare)).toBe(0); // 10 x 1 x 4 = 40 > 39
    expect(factionHeightCap(40n, 4, CENTRE_PARAMS.factionAreaShare)).toBe(1); // 40 <= 40
    expect(factionHeightCap(160n, 4, CENTRE_PARAMS.factionAreaShare)).toBe(2); // 10 x 2 x 8 = 160
    expect(factionHeightCap(159n, 4, CENTRE_PARAMS.factionAreaShare)).toBe(1);
  });

  it('FR-230 a rounded product at the boundary is decided on the exact double w, not on 10 h w in doubles', () => {
    // 0.1 is not exact: the decision uses the stored double h x 0.1, as a scan on the IEEE bits does
    const a = 0.1;
    for (let n = 1n; n <= 400n; n++) {
      if (factionHeightCap(n, a, CENTRE_PARAMS.factionAreaShare) !== scan(n, a)) throw new Error(`n ${n}`);
    }
  });

  it('FR-230 an invalid aspect is refused', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => factionHeightCap(100n, bad, CENTRE_PARAMS.factionAreaShare), String(bad)).toThrow(RangeError);
    }
  });
});
