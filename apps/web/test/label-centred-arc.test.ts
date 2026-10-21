import { describe, expect, it } from 'vitest';
import { CENTRE_PARAMS } from '../src/core/centre-params';
import { centreSums, endStep, factionHeightCap, inDiscUnit, regionBox } from '../src/core/label-centre';
import { axisAngle, axisExtent, shapesOf } from '../src/core/label-axis';
import { arcCandidate, arcMinHeight, centredCache, centredCandidate, centredInLand, chooseInLand } from '../src/core/label-centred';
import { arcExists, arcSearch, arcWithinLimit, inArc, shapedCandidate } from '../src/core/label-shape';
import type { ArcFrame, InLandFrame } from '../src/core/label-shape';
import { LABEL_PARAMS } from '../src/core/label-params';
import { SHAPE_PARAMS } from '../src/core/shape-params';
import type { ShapeParams } from '../src/core/shape-params';
import { arcRegions, handRegions, randomRegions, smallArcRegions } from './helpers/centred-grids';
import type { TestRegion } from './helpers/centred-grids';
import { refArc, refEndStep, refFactionCap, refInLand } from './helpers/centred-reference';
import { shapedCandidateDigest } from './helpers/shaped-candidate-digest';
import { arcBandUnits, bandUnits, rectUnits, setOfUnits } from './helpers/shaped-grids';
import type { Unit } from './helpers/shaped-grids';

// Spec 007 FR-221, FR-222, FR-230: the arc candidate (disc, tangent limit, uncapped top, P14 winner), the FR-221
// choice with the G rule, the FR-222 widening loop and the faction size cap, against the brute-force definitions of
// `helpers/centred-reference.ts`; and the guard of the `arcSearch` extraction (plan 007 PD6, U5).
const M = LABEL_PARAMS.margin;
const SP = SHAPE_PARAMS;
/** Off-land heights nobody reaches: the loop always ends at kEnd. */
const SP_NEVER: ShapeParams = { ...SHAPE_PARAMS, offLandHeight: { faction: 1e9, territory: 1e9 } };

function region(name: string, units: readonly Unit[], aspect: number): TestRegion {
  const { p, pieces } = setOfUnits(units);
  return { name, units, p, pieces, aspect };
}

/** Steps worth testing for a region: 1, 2, 3 and the end step (the end step only for regions of up to 700 units). */
function stepsOf(r: TestRegion): number[] {
  const end = endStep(centreSums(r.p, r.pieces), CENTRE_PARAMS, regionBox(r.p, r.pieces));
  const ks = [1, 2, 3];
  if (r.units.length <= 700) ks.push(end);
  return [...new Set(ks)].sort((a, b) => a - b);
}

const heightOf = (f: InLandFrame | undefined): number => (f === undefined ? 0 : f.shape === 'horizontal' ? f.box.h : f.h);

const hand = handRegions();
const random = randomRegions(200);
const small = smallArcRegions();
const bands = arcRegions();

function arcAt(r: TestRegion, k: number, minHeight: number, top: number | undefined, distance = false): ArcFrame | undefined {
  const cache = centredCache(r.p, r.pieces, r.aspect, M, distance);
  return arcCandidate(r.p, r.pieces, r.aspect, M, SP, CENTRE_PARAMS, k, cache, minHeight, top);
}

describe('FR-221 the tangent limit (pinned formula)', () => {
  const frame = (angle: number, bend: number, w: number): ArcFrame => ({ shape: 'arc', cx: 0, cy: 0, angle, h: 1, w, bend, radius: 100 });

  it('FR-221 theta + alpha <= limit and theta - alpha >= -limit, both ends inclusive (alpha = w |bend| / (2 L))', () => {
    // L = 1, |bend| = 30, w = 1: alpha = 15 exactly
    expect(arcWithinLimit(frame(30, 30, 1), 1, 45)).toBe(true); // 30 + 15 = 45
    expect(arcWithinLimit(frame(30, 30, 1.0000001), 1, 45)).toBe(false);
    expect(arcWithinLimit(frame(-30, 30, 1), 1, 45)).toBe(true); // -30 - 15 = -45
    expect(arcWithinLimit(frame(-30, 30, 1.0000001), 1, 45)).toBe(false);
    expect(arcWithinLimit(frame(-30, -30, 1), 1, 45)).toBe(true); // the sign of the bend does not matter
    expect(arcWithinLimit(frame(0, 60, 1.5), 1, 45)).toBe(true); // alpha = 45
    expect(arcWithinLimit(frame(0, 60, 1.6), 1, 45)).toBe(false);
  });

  it('FR-221 the limit is a parameter: the 006 range (-90, 90] is the limit 90', () => {
    expect(arcWithinLimit(frame(60, 60, 1), 1, 45)).toBe(false); // 60 + 30
    expect(arcWithinLimit(frame(60, 60, 1), 1, 90)).toBe(true);
    expect(arcWithinLimit(frame(60, 60, 1.1), 1, 90)).toBe(false); // 60 + 33 > 90
  });

  it('FR-221 an arc candidate never has a tangent beyond 45 degrees, for either role (same rule)', () => {
    let seen = 0;
    for (const r of [...small, ...bands.slice(0, 6), ...random.slice(0, 60)]) {
      const cache = centredCache(r.p, r.pieces, r.aspect, M);
      for (const k of [1, 3]) {
        const a = arcCandidate(r.p, r.pieces, r.aspect, M, SP, CENTRE_PARAMS, k, cache, 1, undefined);
        if (a === undefined) continue;
        seen++;
        const extent = axisExtent(r.p, r.pieces, axisAngle(r.p, r.pieces));
        expect(arcExists(a, extent, M), r.name).toBe(true);
        expect(arcWithinLimit(a, extent, CENTRE_PARAMS.angleLimit), r.name).toBe(true);
        expect(Math.abs(a.angle)).toBeLessThanOrEqual(45);
      }
    }
    expect(seen).toBeGreaterThan(10);
  }, 240000);
});

describe('FR-221 the arc candidate equals the reference definitions', () => {
  function compare(regions: readonly TestRegion[], top: number | undefined, steps: (r: TestRegion) => number[]): { cases: number; defined: number } {
    let cases = 0;
    let defined = 0;
    for (const r of regions) {
      for (const k of steps(r)) {
        const ref = refArc(r.units, r.p, r.pieces, r.aspect, M, CENTRE_PARAMS, SP, k, top);
        expect(arcAt(r, k, 1, top), `${r.name} aspect ${String(r.aspect)} k ${String(k)}`).toStrictEqual(ref);
        expect(arcAt(r, k, 1, top, true), `distance map: ${r.name} aspect ${String(r.aspect)} k ${String(k)}`).toStrictEqual(ref);
        cases++;
        if (ref !== undefined) defined++;
      }
    }
    return { cases, defined };
  }

  it('FR-221 FR-228 the small circular bands and the hand grids at steps 1, 2, 3 and the end step', () => {
    const out = compare([...small, ...hand], undefined, stepsOf);
    expect(out.cases).toBeGreaterThan(40);
    expect(out.defined).toBeGreaterThan(15);
  }, 240000);

  it('FR-221 FR-228 200 fixed-seed random grids at steps 1, 2 and the end step', () => {
    const out = compare(random, undefined, (r) => stepsOf(r).filter((k) => k !== 3));
    expect(out.cases).toBeGreaterThan(400);
    expect(out.defined).toBeGreaterThan(5);
  }, 240000);

  it('FR-221 the large circular bands at step 1', () => {
    const out = compare(bands, undefined, () => [1]);
    expect(out.cases).toBe(bands.length);
    expect(out.defined).toBeGreaterThan(3);
  }, 240000);

  it('FR-221 FR-230 a height cap bounds the arc candidate and the result equals the capped reference', () => {
    for (const top of [1, 2, 5]) {
      const out = compare([...small, ...bands.slice(0, 4)], top, () => [1, 2]);
      expect(out.cases).toBeGreaterThan(10);
    }
    let capped = 0;
    for (const r of [...small, ...bands.slice(0, 6)]) {
      const free = arcAt(r, 3, 1, undefined);
      if (free === undefined || free.h <= 3) continue;
      const cap = arcAt(r, 3, 1, 3);
      expect(cap?.h, r.name).toBe(3);
      capped++;
    }
    expect(capped).toBeGreaterThan(0);
  }, 240000);

  it('FR-221 the tangent limit changes the result in some grid, and the result equals the reference with and without it', () => {
    let changed = 0;
    for (const r of [...small, ...bands, ...random.slice(0, 100)]) {
      for (const k of [1, 2]) {
        const limited = refArc(r.units, r.p, r.pieces, r.aspect, M, CENTRE_PARAMS, SP, k, undefined);
        const free = refArc(r.units, r.p, r.pieces, r.aspect, M, CENTRE_PARAMS, SP, k, undefined, Infinity);
        if (JSON.stringify(limited) !== JSON.stringify(free)) {
          changed++;
          expect(arcAt(r, k, 1, undefined), `${r.name} k ${String(k)}`).toStrictEqual(limited);
        }
      }
    }
    expect(changed).toBeGreaterThan(0);
  }, 240000);

  it('FR-221 minHeight: the candidate is returned when its height reaches it and is undefined above it', () => {
    let seen = 0;
    for (const r of [...small, ...hand]) {
      const ref = refArc(r.units, r.p, r.pieces, r.aspect, M, CENTRE_PARAMS, SP, 2, undefined);
      if (ref === undefined) continue;
      seen++;
      expect(arcAt(r, 2, ref.h, undefined), r.name).toStrictEqual(ref);
      expect(arcAt(r, 2, ref.h + 1, undefined), r.name).toBeUndefined();
    }
    expect(seen).toBeGreaterThan(3);
  }, 240000);

  it('FR-221 FR-220 P14: the first shape at the winning height, then the nearest centre, then the smallest y, then the smallest x', () => {
    // A symmetric cup: the mirror-image arcs tie on height and distance and differ in x; the smaller x wins.
    const cup = region('symmetric cup', bandUnits(0, 120, 12, (x) => 0.005 * (x - 59.5) * (x - 59.5)), 2.5);
    for (const k of [1, 2, 3, refEndStep(cup.units, CENTRE_PARAMS)]) {
      const ref = refArc(cup.units, cup.p, cup.pieces, cup.aspect, M, CENTRE_PARAMS, SP, k, undefined);
      expect(arcAt(cup, k, 1, undefined), `k ${String(k)}`).toStrictEqual(ref);
    }
  }, 240000);

  it('FR-221 FR-219 an arc taller than 120 is reached (the top is not Hmax) and fits and lies in the disc', () => {
    // a clipped annulus around (100, 20): radii 70 to 215 (thick 145) within 70 degrees of the vertical
    const units: Unit[] = [];
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 200; x++) {
        const dx = x + 0.5 - 100;
        const dy = y + 0.5 - 20;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (dy > 0 && r >= 70 && r <= 215 && (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI <= 70) units.push([x, y] as const);
      }
    }
    const big = region('thick circular band', units, 1);
    const cache = centredCache(big.p, big.pieces, big.aspect, M);
    const s = centreSums(big.p, big.pieces);
    const a = arcCandidate(big.p, big.pieces, big.aspect, M, SP, CENTRE_PARAMS, 4, cache, 1, undefined);
    expect(a).toBeDefined();
    expect(a!.h).toBeGreaterThan(LABEL_PARAMS.maxHeight);
    expect(inDiscUnit(s, CENTRE_PARAMS, 4, a!.cx - 0.5, a!.cy - 0.5)).toBe(true);
    // every unit centre of the grown arc belongs to the region
    const set = new Set(units.map(([x, y]) => `${String(x)},${String(y)}`));
    const ext = Math.ceil(a!.w / 2 + a!.h / 2 + 2 * M) + 3;
    for (let y = Math.floor(a!.cy) - ext; y <= Math.floor(a!.cy) + ext; y++) {
      for (let x = Math.floor(a!.cx) - ext; x <= Math.floor(a!.cx) + ext; x++) {
        if (inArc(a!, M, x + 0.5, y + 0.5)) expect(set.has(`${String(x)},${String(y)}`), `${String(x)},${String(y)}`).toBe(true);
      }
    }
  }, 240000);
});

describe('FR-221 the G rule: the arc is used iff its height is at least G times the centred height', () => {
  it('FR-221 arcMinHeight(hC) = ceil(1.25 hC) and the minimum is 1 without a centred candidate', () => {
    expect(arcMinHeight(undefined, SP)).toBe(1);
    for (let h = 1; h <= 300; h++) expect(arcMinHeight(h, SP), String(h)).toBe(Math.ceil((5 * h) / 4));
  });

  it('FR-221 an arc of height ceil(1.25 hC) - 1 loses and one of height ceil(1.25 hC) wins, for every hC', () => {
    // the choice function of the widening loop, on synthetic frames
    const arcOf = (h: number): ArcFrame => ({ shape: 'arc', cx: 0, cy: 0, angle: 0, h, w: h, bend: 30, radius: 100 });
    for (let hC = 1; hC <= 200; hC++) {
      const need = Math.ceil((5 * hC) / 4);
      expect(chooseInLand(arcOf(need - 1), { shape: 'horizontal', box: { x0: 0, y0: 0, h: hC, w: hC } }, SP)?.shape, `hC ${String(hC)} h ${String(need - 1)}`).toBe('horizontal');
      expect(chooseInLand(arcOf(need), { shape: 'horizontal', box: { x0: 0, y0: 0, h: hC, w: hC } }, SP)?.shape, `hC ${String(hC)} h ${String(need)}`).toBe('arc');
    }
    // no centred candidate: any arc wins; no arc: the centred candidate
    expect(chooseInLand(arcOf(1), undefined, SP)?.shape).toBe('arc');
    expect(chooseInLand(undefined, { shape: 'horizontal', box: { x0: 0, y0: 0, h: 5, w: 5 } }, SP)?.shape).toBe('horizontal');
    expect(chooseInLand(undefined, undefined, SP)).toBeUndefined();
  });

  it('FR-221 on real grids the choice follows the gain: G just below and just above the arc to centred ratio', () => {
    let seen = 0;
    for (const r of [...small, ...hand, ...random.slice(0, 60)]) {
      for (const k of [1, 2]) {
        const cache = centredCache(r.p, r.pieces, r.aspect, M);
        const c = centredCandidate(r.p, r.pieces, r.aspect, M, CENTRE_PARAMS, k, cache, undefined);
        const hC = c === undefined ? 0 : c.shape === 'horizontal' ? c.box.h : c.h;
        const a = arcCandidate(r.p, r.pieces, r.aspect, M, SP, CENTRE_PARAMS, k, cache, 1, undefined);
        if (c === undefined || a === undefined) continue;
        seen++;
        const arcWins: ShapeParams = { ...SP, shapeGain: (a.h - 0.5) / hC, offLandHeight: { faction: 1, territory: 1 } };
        const arcLoses: ShapeParams = { ...SP, shapeGain: (a.h + 0.5) / hC, offLandHeight: { faction: 1, territory: 1 } };
        // with offLandHeight 1 the loop stops at the first step that has a frame; step k is the first only for k = 1
        if (k !== 1) continue;
        const win = centredInLand(r.p, r.pieces, r.aspect, 'territory', LABEL_PARAMS, arcWins, CENTRE_PARAMS);
        const lose = centredInLand(r.p, r.pieces, r.aspect, 'territory', LABEL_PARAMS, arcLoses, CENTRE_PARAMS);
        expect(win.frame?.shape, `${r.name} wins`).toBe('arc');
        expect(win.frame).toStrictEqual(a);
        expect(lose.frame, `${r.name} loses`).toStrictEqual(c);
      }
    }
    expect(seen).toBeGreaterThan(2);
  }, 240000);
});


/** A thin circular band (a cup or a cap) and a text aspect: long labels make arcs beat straight frames (G = 1.25). */
function thin(radius: number, thick: number, halfAngle: number, sign: 1 | -1, aspect: number): TestRegion {
  return region(`thin r${String(radius)} t${String(thick)} a${String(halfAngle)} s${String(sign)} asp${String(aspect)}`, arcBandUnits(radius, thick, halfAngle, sign), aspect);
}

const thinBands = [thin(50, 10, 40, 1, 5), thin(50, 8, 60, 1, 8.53271484375), thin(50, 12, 60, 1, 8.53271484375), thin(60, 10, 60, 1, 5)];
/** Off-land heights low enough that the loop stops in the middle of the corpus grids. */
const SP_LOW: ShapeParams = { ...SHAPE_PARAMS, offLandHeight: { faction: 6, territory: 4 } };
const SPS: ReadonlyArray<readonly [string, ShapeParams]> = [['real', SHAPE_PARAMS], ['low', SP_LOW]];
const ROLES = ['territory', 'faction'] as const;

/** Regions cheap enough for the brute-force widening reference (it goes through every step up to kEnd). */
const lite = [...hand.filter((r) => r.units.length <= 600), ...small.filter((r) => r.units.length <= 700), ...thinBands, ...random.slice(0, 40)];

const refMemo = new Map<string, ReturnType<typeof refInLand>>();

/** The reference in-land frame of a region (computed once: several tests read it). */
function refIn(r: TestRegion, role: 'faction' | 'territory', name: string, sp: ShapeParams): ReturnType<typeof refInLand> {
  const id = `${r.name}|${String(r.aspect)}|${role}|${name}`;
  let out = refMemo.get(id);
  if (out === undefined) {
    out = refInLand(r.units, r.p, r.pieces, r.aspect, role, M, CENTRE_PARAMS, sp);
    refMemo.set(id, out);
  }
  return out;
}

describe('FR-222 the widening loop equals the reference', () => {
  it('FR-221 FR-222 FR-230 both roles with the real off-land heights and with low ones', () => {
    let cases = 0;
    let widened = 0;
    for (const r of lite) {
      for (const role of ROLES) {
        for (const [name, sp] of SPS) {
          const ref = refIn(r, role, name, sp);
          const got = centredInLand(r.p, r.pieces, r.aspect, role, LABEL_PARAMS, sp, CENTRE_PARAMS);
          expect({ frame: got.frame, k: got.k, kEnd: got.kEnd }, `${r.name} ${role} ${name}`).toStrictEqual({ frame: ref.frame, k: ref.k, kEnd: ref.kEnd });
          cases++;
          if (got.k > 1 && got.k < got.kEnd) widened++;
        }
      }
    }
    expect(cases).toBe(lite.length * 4);
    expect(widened).toBeGreaterThan(5);
  }, 600000);

  it('FR-222 the loop stops at the first step that reaches offLandHeight: earlier steps are below it', () => {
    let stopped = 0;
    for (const r of lite) {
      for (const role of ROLES) {
        for (const [name, sp] of SPS) {
          const got = centredInLand(r.p, r.pieces, r.aspect, role, LABEL_PARAMS, sp, CENTRE_PARAMS);
          if (got.k === 1 || heightOf(got.frame) < sp.offLandHeight[role]) continue;
          stopped++;
          for (const step of refIn(r, role, name, sp).steps.slice(0, -1)) {
            expect(heightOf(step.chosen), `${r.name} ${role} ${name} k ${String(step.k)}`).toBeLessThan(sp.offLandHeight[role]);
          }
        }
      }
    }
    expect(stopped).toBeGreaterThan(5);
  }, 600000);

  it('FR-222 the loop ends at kEnd with the unrestricted tallest frame when nothing reaches offLandHeight', () => {
    let ended = 0;
    for (const r of lite.filter((x) => x.units.length <= 300)) {
      for (const role of ROLES) {
        const got = centredInLand(r.p, r.pieces, r.aspect, role, LABEL_PARAMS, SP_NEVER, CENTRE_PARAMS);
        const kEnd = endStep(centreSums(r.p, r.pieces), CENTRE_PARAMS, regionBox(r.p, r.pieces));
        expect(got.k, `${r.name} ${role}`).toBe(kEnd);
        expect(got.kEnd).toBe(kEnd);
        const ref = refIn(r, role, 'never', SP_NEVER);
        expect({ frame: got.frame, k: got.k }, `${r.name} ${role}`).toStrictEqual({ frame: ref.frame, k: ref.k });
        // at kEnd the disc holds the whole region: no disc restriction is left, so the tallest frame of the region is chosen
        const cache = centredCache(r.p, r.pieces, r.aspect, M);
        const top = role === 'faction' ? factionHeightCap(cache.sums.n, r.aspect, CENTRE_PARAMS.factionAreaShare) : undefined;
        const unrestricted = centredCandidate(r.p, r.pieces, r.aspect, M, CENTRE_PARAMS, kEnd + 3, cache, top);
        if (unrestricted !== undefined) expect(heightOf(got.frame), `${r.name} ${role}`).toBeGreaterThanOrEqual(heightOf(unrestricted));
        if (got.frame !== undefined) ended++;
      }
    }
    expect(ended).toBeGreaterThan(8);
  }, 600000);

  it('FR-222 a tiny arc does not stop the widening while the chosen frame is below offLandHeight', () => {
    let skipped = 0;
    for (const r of lite) {
      for (const role of ROLES) {
        for (const [name, sp] of SPS) {
          const ref = refIn(r, role, name, sp);
          const tiny = ref.steps.find((s) => s.chosen?.shape === 'arc' && heightOf(s.chosen) < sp.offLandHeight[role] && s.k < ref.kEnd);
          if (tiny === undefined) continue;
          skipped++;
          const got = centredInLand(r.p, r.pieces, r.aspect, role, LABEL_PARAMS, sp, CENTRE_PARAMS);
          expect(got.k, `${r.name} ${role} ${name}`).toBeGreaterThan(tiny.k);
        }
      }
    }
    expect(skipped).toBeGreaterThan(0);
  }, 600000);

  it('FR-222 a region where nothing fits gives no frame after kEnd steps', () => {
    for (const r of hand.filter((h) => h.name === 'one unit' || h.name === 'four units')) {
      const got = centredInLand(r.p, r.pieces, r.aspect, 'territory', LABEL_PARAMS, SP, CENTRE_PARAMS);
      expect(got.frame, r.name).toBeUndefined();
      expect(got.k, r.name).toBe(refEndStep(r.units, CENTRE_PARAMS));
    }
  });

  it('FR-222 an empty label set gives no frame', () => {
    const r = hand[0]!;
    expect(centredInLand(r.p, [], r.aspect, 'territory', LABEL_PARAMS, SP, CENTRE_PARAMS).frame).toBeUndefined();
  });
});

describe('FR-230 the faction size cap bounds all three shapes', () => {
  it('FR-230 horizontal: a large block is held to the cap, exactly at the largest height with 10 h w <= n', () => {
    const block = region('large block', rectUnits(0, 0, 220, 150), 1);
    const n = 220n * 150n;
    const cap = refFactionCap(n, 1, CENTRE_PARAMS);
    expect(cap).toBe(57); // 10 x 57 x 57 = 32,490 <= 33,000 < 10 x 58 x 58
    const faction = centredInLand(block.p, block.pieces, 1, 'faction', LABEL_PARAMS, SP, CENTRE_PARAMS);
    expect(faction.frame?.shape).toBe('horizontal');
    expect(heightOf(faction.frame)).toBe(cap);
    const territory = centredInLand(block.p, block.pieces, 1, 'territory', LABEL_PARAMS, SP, CENTRE_PARAMS);
    expect(heightOf(territory.frame)).toBeGreaterThan(cap);
    expect(factionHeightCap(n, 1, CENTRE_PARAMS.factionAreaShare)).toBe(cap);
  }, 240000);

  it('FR-230 straight: a long diagonal band holds a straight frame at the cap, taller without it', () => {
    const band = region('long diagonal band', bandUnits(0, 1000, 85, (x) => x), 8);
    const cap = refFactionCap(BigInt(band.units.length), 8, CENTRE_PARAMS);
    const faction = centredInLand(band.p, band.pieces, 8, 'faction', LABEL_PARAMS, SP, CENTRE_PARAMS);
    expect(faction.frame?.shape).toBe('straight');
    expect(heightOf(faction.frame)).toBe(cap);
    const territory = centredInLand(band.p, band.pieces, 8, 'territory', LABEL_PARAMS, SP, CENTRE_PARAMS);
    expect(heightOf(territory.frame)).toBeGreaterThan(cap);
  }, 240000);

  it('FR-230 arc: thin circular bands hold the arc candidate at the cap, taller without it, and the loop result equals the reference', () => {
    let capped = 0;
    let arcsChosen = 0;
    const capSp: ShapeParams = { ...SHAPE_PARAMS, offLandHeight: { faction: 3, territory: 3 } };
    for (const band of thinBands) {
      const cap = refFactionCap(BigInt(band.units.length), band.aspect, CENTRE_PARAMS);
      for (const k of [1, 2, 3]) {
        const free = arcAt(band, k, 1, undefined);
        if (free === undefined || free.h <= cap) continue;
        const held = arcAt(band, k, 1, cap);
        expect(held?.h, `${band.name} k ${String(k)}`).toBe(cap);
        expect(held, `${band.name} k ${String(k)}`).toStrictEqual(refArc(band.units, band.p, band.pieces, band.aspect, M, CENTRE_PARAMS, SP, k, cap));
        capped++;
      }
      const got = centredInLand(band.p, band.pieces, band.aspect, 'faction', LABEL_PARAMS, capSp, CENTRE_PARAMS);
      const ref = refIn(band, 'faction', 'cap', capSp);
      expect({ frame: got.frame, k: got.k }, band.name).toStrictEqual({ frame: ref.frame, k: ref.k });
      expect(heightOf(got.frame), band.name).toBeLessThanOrEqual(cap);
      if (got.frame?.shape === 'arc') arcsChosen++;
    }
    expect(capped).toBeGreaterThan(0);
    expect(arcsChosen).toBeGreaterThan(0);
  }, 600000);

  it('FR-230 every faction frame of every corpus grid covers at most a tenth of the region', () => {
    for (const r of lite) {
      const got = centredInLand(r.p, r.pieces, r.aspect, 'faction', LABEL_PARAMS, SP, CENTRE_PARAMS);
      if (got.frame === undefined) continue;
      const w = got.frame.shape === 'horizontal' ? got.frame.box.w : got.frame.w;
      expect(10 * heightOf(got.frame) * w, r.name).toBeLessThanOrEqual(r.units.length);
    }
  }, 600000);
});

describe('FR-221 the 006 shape search is bit-identical after the arcSearch extraction (plan 007 PD6, U5)', () => {
  it('FR-221 the digest of shapedCandidate on the hand, circular-band and 200 random grids was taken before the extraction', () => {
    const d = shapedCandidateDigest(200);
    expect(d.cases).toBe(1280);
    expect(d.defined).toBe(540);
    expect(d.arcs).toBe(75);
    expect(d.straights).toBe(465);
    expect(d.digest).toBe('f8efcdfda2a05c86');
  }, 240000);

  it('FR-221 arcSearch options: the 006 call is shapedCandidate; an all-true centre filter and an infinite limit change nothing; top and filter restrict', () => {
    let arcs = 0;
    for (const r of [...hand, ...bands.slice(0, 6), ...random.slice(0, 40)]) {
      const theta = axisAngle(r.p, r.pieces);
      const extent = axisExtent(r.p, r.pieces, theta);
      const shapes = shapesOf(theta, extent, SP);
      const base = { extent, top: LABEL_PARAMS.maxHeight, minHeight: 1 };
      const old = shapedCandidate(r.p, r.pieces, r.aspect, LABEL_PARAMS, SP, 1);
      expect(arcSearch(r.p, r.pieces, r.aspect, M, shapes, base), r.name).toStrictEqual(old);
      expect(arcSearch(r.p, r.pieces, r.aspect, M, shapes, { ...base, centre: () => true, limit: Infinity }), r.name).toStrictEqual(old);
      expect(arcSearch(r.p, r.pieces, r.aspect, M, shapes, { ...base, centre: () => false }), r.name).toBeUndefined();
      expect(arcSearch(r.p, r.pieces, r.aspect, M, shapes, { ...base, top: 0 }), r.name).toBeUndefined();
      expect(arcSearch(r.p, r.pieces, r.aspect, M, [], base), r.name).toBeUndefined();
      if (old !== undefined) {
        expect(arcSearch(r.p, r.pieces, r.aspect, M, shapes, { ...base, minHeight: old.h + 1 })?.h ?? 0, r.name).toBeLessThanOrEqual(old.h);
        expect(arcSearch(r.p, r.pieces, r.aspect, M, shapes, { ...base, top: old.h - 1 })?.h ?? 0, r.name).toBeLessThan(old.h);
        const picked = arcSearch(r.p, r.pieces, r.aspect, M, shapes, { ...base, winner: () => 0 });
        expect(picked?.h, r.name).toBe(old.h);
      }
      if (old?.shape === 'arc') arcs++;
    }
    expect(arcs).toBeGreaterThan(0);
  }, 240000);
});
