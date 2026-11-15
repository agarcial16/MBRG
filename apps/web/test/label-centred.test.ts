import { beforeAll, describe, expect, it } from 'vitest';
import { CENTRE_PARAMS } from '../src/core/centre-params';
import { centreSums, dyadic, endStep, factionHeightCap, inDiscUnit, regionBox } from '../src/core/label-centre';
import { boxFits, centredCache, centredCandidate, distanceThreshold, nearestFrame } from '../src/core/label-centred';
import type { CentredFrame, CentredOptions } from '../src/core/label-centred';
import { LABEL_PARAMS } from '../src/core/label-params';
import { mainPieces } from '../src/core/regions';
import { handRegions, randomRegions, TEST_ASPECTS } from './helpers/centred-grids';
import type { TestRegion } from './helpers/centred-grids';
import { refCentred } from './helpers/centred-reference';
import type { RefInfo } from './helpers/centred-reference';
import { rng } from './helpers/label-grids';
import { measuredRun } from './helpers/shaped-hits';
import type { MeasuredRun } from './helpers/shaped-hits';
import { bandUnits, rectUnits, setOfUnits } from './helpers/shaped-grids';
import type { Unit } from './helpers/shaped-grids';

// Spec 007 FR-219, FR-220, FR-228, NFR-43: the centred candidate (horizontal and straight frames in the centre disc,
// uncapped, FR-220 order, exact prunes) against the brute-force definitions of `helpers/centred-reference.ts`.
const M = LABEL_PARAMS.margin;

function region(name: string, units: readonly Unit[], aspect: number): TestRegion {
  const { p, pieces } = setOfUnits(units);
  return { name, units, p, pieces, aspect };
}

const refMemo = new Map<string, ReturnType<typeof refCentred>>();

/** The reference result of a region at step k (computed once: several tests read it). */
function refOf(r: TestRegion, k: number, top: number | undefined): ReturnType<typeof refCentred> {
  const id = `${r.name}|${String(r.aspect)}|${String(k)}|${String(top)}`;
  let out = refMemo.get(id);
  if (out === undefined) {
    out = refCentred(r.units, r.aspect, M, CENTRE_PARAMS, k, top);
    refMemo.set(id, out);
  }
  return out;
}

function solve(r: TestRegion, k: number, top?: number, options?: CentredOptions, distance = false): CentredFrame | undefined {
  const cache = centredCache(r.p, r.pieces, r.aspect, M, distance);
  return centredCandidate(r.p, r.pieces, r.aspect, M, CENTRE_PARAMS, k, cache, top, options);
}

/** Steps worth testing for a region: 1, 2, 3 and the end step (the end step only for regions of up to 700 units). */
function stepsOf(r: TestRegion): number[] {
  const s = centreSums(r.p, r.pieces);
  const end = endStep(s, CENTRE_PARAMS, regionBox(r.p, r.pieces));
  const ks = [1, 2, 3];
  if (r.units.length <= 700) ks.push(end);
  return [...new Set(ks)].sort((a, b) => a - b);
}

/** All (region, step) cases checked against the reference, with the reference results. */
function compareAll(regions: readonly TestRegion[], top?: number): { cases: number; defined: number; infos: RefInfo[] } {
  let cases = 0;
  let defined = 0;
  const infos: RefInfo[] = [];
  for (const r of regions) {
    for (const k of stepsOf(r)) {
      const ref = refOf(r, k, top);
      const got = solve(r, k, top);
      expect(got, `${r.name} aspect ${String(r.aspect)} k ${String(k)}`).toStrictEqual(ref.frame);
      // the exact distance map and the prune built on it give the same frame
      expect(solve(r, k, top, undefined, true), `distance map: ${r.name} aspect ${String(r.aspect)} k ${String(k)}`).toStrictEqual(ref.frame);
      cases++;
      if (ref.frame !== undefined) {
        defined++;
        infos.push(ref.info!);
      }
    }
  }
  return { cases, defined, infos };
}

const hand = handRegions();
const random = randomRegions(200);

describe('FR-219 FR-220 FR-228 the centred candidate equals the reference definitions', () => {
  it('FR-219 FR-220 FR-228 hand grids at steps 1, 2, 3 and the end step', () => {
    const out = compareAll(hand);
    expect(out.cases).toBeGreaterThan(20);
    expect(out.defined).toBeGreaterThan(10);
  }, 240000);

  it('FR-219 FR-220 FR-228 200 fixed-seed random grids at steps 1, 2, 3 and the end step', () => {
    const out = compareAll(random);
    expect(out.cases).toBeGreaterThan(500);
    expect(out.defined).toBeGreaterThan(250);
  }, 240000);

  it('FR-219 the grids cover a text aspect below 1, short, long and the Castilla-La Mancha one', () => {
    const aspects = new Set([...hand, ...random].map((r) => r.aspect));
    for (const a of TEST_ASPECTS) expect(aspects.has(a), String(a)).toBe(true);
    expect(Math.min(...aspects)).toBeLessThan(1);
    expect(Math.max(...aspects)).toBeGreaterThan(8.5);
  });

  it('FR-219 FR-220 a height cap (the faction cap of FR-230) bounds every frame and the result equals the capped reference', () => {
    for (const top of [1, 3, 7]) {
      const out = compareAll([...hand.slice(0, 5), ...random.slice(0, 20)], top);
      expect(out.cases).toBeGreaterThan(10);
    }
    const cap = solve(hand[1]!, 2, 5)!;
    expect(cap.shape === 'horizontal' ? cap.box.h : cap.h).toBe(5);
  }, 240000);

  it('FR-220 the steps of the order each decide in some grid (coverage of the tie rules)', () => {
    const { infos } = compareAll([...hand, ...random]);
    expect(infos.some((i) => i.horizontalAndStraight)).toBe(true); // step 2
    expect(infos.some((i) => i.absAngles > 1)).toBe(true); // step 3
    expect(infos.some((i) => i.bothSigns)).toBe(true); // step 4
    expect(infos.some((i) => i.group > 1)).toBe(true); // step 5
  }, 240000);
});

describe('FR-220 the tie order, one step at a time', () => {
  it('FR-220 step 2: at equal height a horizontal frame wins over a straight one', () => {
    // Search the corpora for a case where both kinds reach the winning height; the answer must then be horizontal.
    let seen = 0;
    for (const r of [...hand, ...random]) {
      for (const k of stepsOf(r)) {
        const ref = refOf(r, k, undefined);
        if (ref.info?.horizontalAndStraight !== true) continue;
        seen++;
        expect(solve(r, k)!.shape, `${r.name} k ${String(k)}`).toBe('horizontal');
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 240000);

  it('FR-220 steps 3 and 4: two mirrored diagonal bands give equal heights at +45 and -45 degrees and the positive angle wins', () => {
    // Band A along the main diagonal and its mirror image B about the vertical line x = 84.5 (units 169 - x).
    const units: Unit[] = [];
    for (let y = 0; y < 70; y++) {
      for (let x = 0; x < 70; x++) {
        if (Math.abs(x - y) <= 15) units.push([x, y], [169 - x, y]);
      }
    }
    units.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const bands = region('mirrored bands', units, 1);
    const s = centreSums(bands.p, bands.pieces);
    const end = endStep(s, CENTRE_PARAMS, regionBox(bands.p, bands.pieces));
    const ref = refCentred(bands.units, 1, M, CENTRE_PARAMS, end, undefined);
    expect(ref.info!.bothSigns).toBe(true);
    expect(ref.info!.atMinimalKeyAndY).toBeGreaterThan(1); // the mirror frames also tie on distance and y: step 7 decides
    const got = solve(bands, end)!;
    expect(got).toStrictEqual(ref.frame);
    expect(got.shape).toBe('straight');
    if (got.shape === 'straight') {
      expect(got.angle).toBe(45);
      expect(got.cx).toBeLessThan(84.5); // the left band
    }
  }, 240000);

  it('FR-220 step 3: the smaller |theta| wins when two multiples of 15 reach the same height', () => {
    let seen = 0;
    for (const r of [...hand, ...random]) {
      for (const k of stepsOf(r)) {
        const ref = refOf(r, k, undefined);
        if (ref.info === undefined || ref.info.absAngles < 2 || ref.info.horizontalAndStraight || ref.frame?.shape !== 'straight') continue;
        seen++;
        const first = CENTRE_PARAMS.straightAngles.map(Math.abs).sort((a, b) => a - b)[0]!;
        const got = solve(r, k)!;
        expect(got.shape === 'straight' && Math.abs(got.angle) >= first).toBe(true);
        expect(got).toStrictEqual(ref.frame);
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 240000);

  it('FR-220 steps 5, 6 and 7: equal distances go to the smaller centre y, then the smaller centre x (two lobes)', () => {
    const left = rectUnits(0, 0, 20, 12);
    const right = rectUnits(40, 0, 20, 12);
    const side = region('lobes side by side', [...left, ...right], 1);
    const s = centreSums(side.p, side.pieces);
    const end = endStep(s, CENTRE_PARAMS, regionBox(side.p, side.pieces));
    const refSide = refCentred(side.units, 1, M, CENTRE_PARAMS, end, undefined);
    expect(refSide.info!.atMinimalKey).toBeGreaterThan(1);
    expect(refSide.info!.atMinimalKeyAndY).toBeGreaterThan(1); // same y: step 7 decides
    const gotSide = solve(side, end)!;
    expect(gotSide).toStrictEqual(refSide.frame);
    const cx = gotSide.shape === 'horizontal' ? gotSide.box.x0 + gotSide.box.w / 2 : gotSide.cx;
    expect(cx).toBeLessThan(30); // the left lobe

    const top = rectUnits(0, 0, 12, 20);
    const bottom = rectUnits(0, 40, 12, 20);
    const stacked = region('lobes stacked', [...top, ...bottom], 1);
    const s2 = centreSums(stacked.p, stacked.pieces);
    const end2 = endStep(s2, CENTRE_PARAMS, regionBox(stacked.p, stacked.pieces));
    const refStacked = refCentred(stacked.units, 1, M, CENTRE_PARAMS, end2, undefined);
    expect(refStacked.info!.atMinimalKey).toBeGreaterThan(1);
    expect(refStacked.info!.atMinimalKeyAndY).toBe(1); // different y: step 6 decides
    const gotStacked = solve(stacked, end2)!;
    expect(gotStacked).toStrictEqual(refStacked.frame);
    const cy = gotStacked.shape === 'horizontal' ? gotStacked.box.y0 + gotStacked.box.h / 2 : gotStacked.cy;
    expect(cy).toBeLessThan(30); // the upper lobe
  }, 240000);
});

describe('FR-219 heights are not capped', () => {
  const block = region('large block', rectUnits(0, 0, 220, 150), 1);

  it('FR-219 a compact region gives a horizontal frame taller than the old Hmax of 120', () => {
    const got = solve(block, 1)!;
    expect(got.shape).toBe('horizontal');
    if (got.shape === 'horizontal') {
      expect(got.box.h).toBeGreaterThan(LABEL_PARAMS.maxHeight);
      expect(got.box.h).toBe(150 - 2 * M); // the rows y0 - M .. y0 + h + M - 1 fill the 150 rows
    }
  }, 240000);

  it('FR-219 a straight frame taller than 120 is reached when it is the tallest', () => {
    // A band along the 45 degree diagonal, about 150 units thick: only a straight frame fits tall.
    const units = bandUnits(0, 400, 200, (x) => x);
    const band = region('thick diagonal band', units, 1);
    const got = solve(band, 1)!;
    expect(got.shape).toBe('straight');
    if (got.shape === 'straight') expect(got.h).toBeGreaterThan(LABEL_PARAMS.maxHeight);
  }, 240000);
});

describe('NFR-43 FR-228 the exact prunes change nothing', () => {
  it('NFR-43 the pruned search equals the plain definition on the hand and random grids', () => {
    for (const r of [...hand, ...random.slice(0, 30)]) {
      for (const k of stepsOf(r)) {
        expect(solve(r, k, undefined, { prune: true }, true), `${r.name} k ${String(k)}`).toStrictEqual(solve(r, k, undefined, { prune: false }, true));
      }
    }
  }, 240000);

  it('NFR-43 the pruned search equals the plain definition on a large block and a thick band', () => {
    for (const r of [region('large block', rectUnits(0, 0, 220, 150), 1), region('thick diagonal band', bandUnits(0, 400, 200, (x) => x), 1)]) {
      expect(solve(r, 1, undefined, { prune: true }, true), r.name).toStrictEqual(solve(r, 1, undefined, { prune: false }, true));
    }
  }, 240000);

  it('NFR-43 FR-228 the distance threshold is the smallest squared distance not skipped, decided exactly', () => {
    const next = rng(77);
    for (let i = 0; i < 600; i++) {
      const h = 1 + Math.floor(next() * 300);
      const aspect = TEST_ASPECTS[Math.floor(next() * TEST_ASPECTS.length)]! * (i % 3 === 0 ? 1 : 0.7 + next());
      const w = h * aspect;
      const m = Math.min(h, w);
      const extra = i % 2 === 0 ? 0 : 2;
      const thr = distanceThreshold(m, M, extra);
      // Direct: skipped iff Q > 0 and 4 d2 < Q^2, Q = m + 2M - extra - 1/512 (exact rationals).
      const { W, E } = dyadic(m);
      const skipped = (d2: number): boolean => {
        const q = 512n * W + (512n * BigInt(2 * M - extra) - 1n) * (1n << BigInt(E)); // Q * 512 * 2^E
        if (q <= 0n) return false;
        return 4n * BigInt(d2) * 512n * 512n * (1n << BigInt(2 * E)) < q * q;
      };
      expect(skipped(thr), `h ${String(h)} aspect ${String(aspect)}`).toBe(false);
      if (thr > 0) expect(skipped(thr - 1), `h ${String(h)} aspect ${String(aspect)}`).toBe(true);
    }
  });

  it('NFR-43 a skipped frame is always rejected by the pinned fit: the threshold never exceeds the inscribed disc', () => {
    // d2 below the threshold means d < (m + 2M - extra) / 2 - eps: every non-set unit centre that close lies in the grown rectangle.
    for (const h of [1, 2, 7, 31, 120, 250]) {
      for (const aspect of [0.6, 1, 2.5, 4, 8.53271484375]) {
        const w = h * aspect;
        const m = Math.min(h, w);
        const radius = m / 2 + M; // radius of the disc inside the grown rectangle
        const thr = distanceThreshold(m, M, 0);
        expect(Math.sqrt(thr)).toBeGreaterThanOrEqual(radius - 1 / 1024 - 1e-9);
        expect(Math.sqrt(Math.max(0, thr - 1))).toBeLessThan(radius);
      }
    }
  });
});

describe('NFR-43 a planted edge grid: the slack of the prune for the unit that holds a box centre', () => {
  it('NFR-43 FR-219 an exact-fit rectangle keeps its horizontal frame with the distance map, the prune and the relaxed bound', () => {
    // 10 columns x 11 rows: the only horizontal frame of aspect 0.9 is h 7 (w 6.3, 10 columns, 11 rows) at (2, 2). The unit that
    // holds its centre is 5.0 from the nearest non-set unit centre, below the inscribed radius 5.15: a prune without the
    // 2 units of slack would skip the frame.
    const r = region('exact-fit rectangle', rectUnits(0, 0, 10, 11), 0.9);
    const s = centreSums(r.p, r.pieces);
    const end = endStep(s, CENTRE_PARAMS, regionBox(r.p, r.pieces));
    const ref = refCentred(r.units, r.aspect, M, CENTRE_PARAMS, end, undefined);
    expect(ref.frame).toStrictEqual({ shape: 'horizontal', box: { x0: 2, y0: 2, h: 7, w: 7 * 0.9 } });
    expect(solve(r, end, undefined, { prune: true }, true)).toStrictEqual(ref.frame);
    expect(solve(r, end, undefined, { prune: false }, true)).toStrictEqual(ref.frame);
    expect(solve(r, end)).toStrictEqual(ref.frame);
  });
});

describe('FR-220 FR-228 the nearest frame is decided by the exact key', () => {
  const key = (v: number): { num: bigint; den: bigint } => ({ num: BigInt(v), den: 1n });

  it('FR-220 FR-228 candidates with the same estimate are ordered by the exact squared distance', () => {
    expect(nearestFrame(3, () => 5, (i) => key([3, 1, 2][i]!), () => 0, () => 0)).toBe(1);
    expect(nearestFrame(3, () => 5, (i) => key([1, 2, 3][i]!), () => 0, () => 0)).toBe(0);
    // a candidate whose estimate is far above the smallest one cannot win even when its exact key is smaller (estimates are only a filter)
    expect(nearestFrame(2, (i) => [1, 1000][i]!, (i) => key([5, 1][i]!), () => 0, () => 0)).toBe(0);
  });

  it('FR-220 steps 6 and 7: equal keys go to the smaller y, then the smaller x', () => {
    expect(nearestFrame(4, () => 5, () => key(4), (i) => [3, 2, 2, 2][i]!, (i) => [0, 9, 5, 7][i]!)).toBe(2);
    expect(nearestFrame(3, () => 5, () => key(4), () => 1, (i) => [8, 3, 6][i]!)).toBe(1);
    expect(nearestFrame(3, () => 5, (i) => key([4, 4, 4][i]!), (i) => [5, 4, 4][i]!, (i) => [1, 2, 1][i]!)).toBe(2);
  });
});

describe('FR-219 FR-228 boxFits is the 005 fit', () => {
  it('FR-219 FR-228 boxFits equals the direct membership rule for every box of the hand grids', () => {
    for (const r of hand.slice(0, 5)) {
      const cache = centredCache(r.p, r.pieces, r.aspect, M);
      const set = new Set(r.units.map(([x, y]) => `${String(x)},${String(y)}`));
      const box = regionBox(r.p, r.pieces);
      for (const h of [1, 2, 3, 5, 9]) {
        const w = h * r.aspect;
        for (let y0 = box.ymin - 3; y0 <= box.ymax + 3; y0 += 2) {
          for (let x0 = box.xmin - 3; x0 <= box.xmax + 3; x0 += 2) {
            let direct = true;
            for (let y = y0 - M - 2; y <= y0 + h + M + 2 && direct; y++) {
              for (let x = x0 - M - 2; x <= x0 + w + M + 2 && direct; x++) {
                const inside = x + 0.5 >= x0 - M && x + 0.5 <= x0 + w + M && y + 0.5 >= y0 - M && y + 0.5 <= y0 + h + M;
                if (inside && !set.has(`${String(x)},${String(y)}`)) direct = false;
              }
            }
            expect(boxFits(cache, x0, y0, h, w), `${r.name} ${String(x0)},${String(y0)} h${String(h)}`).toBe(direct);
          }
        }
      }
    }
  });
});

describe('FR-219 FR-220 NFR-43 NFR-46 the dev map (seed 1, measured aspects)', () => {
  let run: MeasuredRun;
  beforeAll(async () => {
    run = await measuredRun();
  }, 120000);

  /** The dev-map Francia label at round T. */
  const francia = (): { pieces: readonly number[]; aspect: number; name: string } => {
    for (const [faction, label] of run.factions[run.rounds]!.boxes.labels) {
      const name = run.texts.factions.get(faction)!;
      if (name === 'Francia') return { pieces: label.pieces, aspect: label.aspect, name };
    }
    throw new Error('no Francia label at round T');
  };

  it('FR-219 FR-220 NFR-46 U4: Francia at round 4 has a straight frame with its centre in the disc of step 1, for the measured aspect and for aspect 4', () => {
    const f = francia();
    expect(run.rounds).toBe(4);
    const s = centreSums(run.p, f.pieces);
    expect(s.n).toBe(1165291n);
    for (const aspect of [f.aspect, 4]) {
      const cap = factionHeightCap(s.n, aspect, CENTRE_PARAMS.factionAreaShare);
      const cache = centredCache(run.p, f.pieces, aspect, M);
      const report = { hStraight: 0, angleStraight: 0, hHorizontal: 0, horizontalBound: 0 };
      const got = centredCandidate(run.p, f.pieces, aspect, M, CENTRE_PARAMS, 1, cache, cap, { report })!;
      expect(got.shape, String(aspect)).toBe('straight');
      if (got.shape !== 'straight') continue;
      expect(inDiscUnit(s, CENTRE_PARAMS, 1, got.cx - 0.5, got.cy - 0.5)).toBe(true);
      expect(got.h).toBeGreaterThan(LABEL_PARAMS.maxHeight);
      expect(got.h).toBeLessThanOrEqual(cap);
      expect(report.hStraight).toBe(got.h);
      // the frame is taller than every old Hmax frame and its angle is one of the straight set
      expect(CENTRE_PARAMS.straightAngles).toContain(got.angle);
    }
  }, 240000);

  it('NFR-43 the pruned search with the exact distance map equals the plain definition for Francia at round 4', () => {
    const f = francia();
    const s = centreSums(run.p, f.pieces);
    for (const aspect of [f.aspect, 4]) {
      const cap = factionHeightCap(s.n, aspect, CENTRE_PARAMS.factionAreaShare);
      const withMap = centredCache(run.p, f.pieces, aspect, M, true);
      const plain = centredCandidate(run.p, f.pieces, aspect, M, CENTRE_PARAMS, 1, withMap, cap, { prune: false });
      const pruned = centredCandidate(run.p, f.pieces, aspect, M, CENTRE_PARAMS, 1, withMap, cap, { prune: true });
      const light = centredCandidate(run.p, f.pieces, aspect, M, CENTRE_PARAMS, 1, centredCache(run.p, f.pieces, aspect, M), cap);
      expect(pruned, String(aspect)).toStrictEqual(plain);
      expect(light, String(aspect)).toStrictEqual(plain);
    }
  }, 240000);

  it('NFR-43 the pruned search equals the plain definition for every territory label at step 1 (uncapped)', () => {
    const main = mainPieces(run.p);
    let labels = 0;
    for (let e = 1; e < run.p.entries; e++) {
      if (run.territories.eligible[e] !== 1) continue;
      const aspect = run.territoryAspects[e]!;
      const cache = centredCache(run.p, [main[e]!], aspect, M, true);
      const plain = centredCandidate(run.p, [main[e]!], aspect, M, CENTRE_PARAMS, 1, cache, undefined, { prune: false });
      expect(centredCandidate(run.p, [main[e]!], aspect, M, CENTRE_PARAMS, 1, cache, undefined, { prune: true }), run.texts.territories[e]).toStrictEqual(plain);
      expect(centredCandidate(run.p, [main[e]!], aspect, M, CENTRE_PARAMS, 1, centredCache(run.p, [main[e]!], aspect, M), undefined), run.texts.territories[e]).toStrictEqual(plain);
      labels++;
    }
    expect(labels).toBe(70);
  }, 240000);
});
