// Spec 013 FR-435, FR-436: a forced round (a short phase 2) still shows the victim reveal, and a single candidate gets a short absorption.
import { describe, expect, it } from 'vitest';
import { buildTour, nominalEnd } from '../src/core/tour';
import { BEAT_MS } from '../src/core/finalised-beat';
import { absorberTourDecision, victimTourDecision, viewChoice } from '../src/core/tour-plan';
import type { AbsorberInput, VictimInput } from '../src/core/tour-plan';
import { planTours } from '../src/core/tour-session';

const STILL = 1800;
// The real forced round: phase 1 closes at C1, the beat holds the reveal for 2 s, phase 2 lasts 5 s (DEFAULT_FORCED_PHASE_SECONDS).
const C1 = 100_000;
const REVEAL = C1 + BEAT_MS;
const C2 = C1 + 5000;
const BOX = (x: number) => ({ x0: x, y0: 0, x1: x + 10, y1: 10 });

const victimInput = (extra: Partial<VictimInput> = {}): VictimInput => ({
  source: 'event',
  halted: false,
  round: 2,
  displayed: 1,
  estimate: REVEAL,
  revealedAt: C1,
  living: [3, 5, 8, 13],
  displayedLiving: [3, 5, 8, 13],
  victim: 8,
  timing: { i: 30, l1: 10, l2: 5 },
  c2: C2,
  ...extra,
});

describe('FR-435 a forced round plays the victim reveal compressed', () => {
  it('FR-435 the real window leaves 2,000 ms: the classic and the bell tours were skipped as too short', () => {
    expect(victimTourDecision(victimInput())).toStrictEqual({ play: true, budget: 2000 });
    for (const pace of ['classic', 'bell'] as const) {
      expect(nominalEnd('victim', 4, false, pace) / 2).toBeGreaterThan(2000);
      expect(viewChoice('victim', false, 4, 2000, pace)).toStrictEqual({ play: false, reason: 'too-short' });
    }
  });

  it('FR-435 the decision carries the forced mark and the same budget', () => {
    expect(victimTourDecision(victimInput({ forced: true }))).toStrictEqual({ play: true, budget: 2000, forced: true });
    expect(victimTourDecision(victimInput({ forced: false }))).toStrictEqual({ play: true, budget: 2000 });
    expect(victimTourDecision(victimInput({ forced: true, halted: true }))).toStrictEqual({ play: false, reason: 'not-fresh' });
    expect(victimTourDecision(victimInput({ forced: true, victim: 99 }))).toStrictEqual({ play: false, reason: 'mismatch' });
  });

  it('FR-435 a forced tour plays in the time left, never below the still length, never skipped as too short', () => {
    for (const pace of ['classic', 'bell'] as const) {
      expect(viewChoice('victim', false, 4, 2000, pace, true)).toStrictEqual({ play: true, budget: 2000, squeeze: true });
      expect(viewChoice('victim', false, 4, 1000, pace, true)).toStrictEqual({ play: true, budget: STILL, squeeze: true });
      expect(viewChoice('victim', false, 4, -300, pace, true)).toStrictEqual({ play: true, budget: STILL, squeeze: true });
      expect(viewChoice('victim', false, 4, 60_000, pace, true)).toStrictEqual({ play: true });
      expect(viewChoice('victim', false, 4, undefined, pace, true)).toStrictEqual({ play: true });
    }
  });

  it('FR-435 a budget that holds half of the tour is scaled exactly as for any round (no squeeze mark)', () => {
    expect(viewChoice('victim', false, 4, 4013, 'classic', true)).toStrictEqual({ play: true, budget: 4013 });
  });

  it('FR-435 under reduced motion the still tour plays whatever the budget', () => {
    expect(viewChoice('victim', true, 4, 100, 'classic', true)).toStrictEqual({ play: true, still: true });
    expect(viewChoice('victim', true, 4, 100, 'classic', false)).toStrictEqual({ play: false, reason: 'too-short' });
  });

  it('FR-435 a non-forced round with the same budget is still skipped (nothing else changes)', () => {
    expect(viewChoice('victim', false, 4, 2000, 'bell', false)).toStrictEqual({ play: false, reason: 'too-short' });
    expect(viewChoice('victim', false, 4, 2000)).toStrictEqual({ play: false, reason: 'too-short' });
  });

  it('FR-435 the plan builds a full 12-stop tour that ends within the budget', () => {
    for (const pace of ['classic', 'bell'] as const) {
      const request = { kind: 'victim' as const, result: 2, set: [0, 1, 2, 3], sigma: 7, budget: 2000, forced: true as const, pace };
      const plan = planTours([request], false, () => new Map());
      expect(plan.tours).toHaveLength(1);
      const tour = plan.tours[0]!;
      expect(tour.stops).toHaveLength(12);
      expect(tour.stops[11]).toBe(2);
      expect(tour.end).toBeLessThanOrEqual(2000);
      expect(tour.end).toBeGreaterThan(1500);
      const tight = planTours([{ ...request, budget: 300 }], false, () => new Map()).tours[0]!;
      expect(tight.end).toBeLessThanOrEqual(STILL);
      expect(planTours([{ kind: 'victim', result: 2, set: [0, 1, 2, 3], sigma: 7, budget: 2000, pace }], false, () => new Map()).tours).toHaveLength(0);
    }
  });

  it('FR-435 the same figures for the Normal pace (60/30/15 s): a forced window is 5 s whatever the timing', () => {
    expect(victimTourDecision(victimInput({ forced: true, timing: { i: 60, l1: 30, l2: 15 } }))).toStrictEqual({ play: true, budget: 2000, forced: true });
    expect(victimTourDecision(victimInput({ forced: true, timing: 'manual', c2: null }))).toStrictEqual({ play: true, forced: true });
  });
});

const absorberInput = (extra: Partial<AbsorberInput> = {}): AbsorberInput => ({
  halted: false,
  round: 2,
  totalRounds: 5,
  displayed: 1,
  estimate: 200_000,
  appliedAt: 200_000,
  candidates: [13],
  absorber: 13,
  timing: { i: 30, l1: 10, l2: 5 },
  ...extra,
});

describe('FR-436 a single candidate gets a short absorption', () => {
  it('FR-436 the tour of one candidate lasts about 2 s with one stop: the absorber', () => {
    expect(nominalEnd('absorber', 1)).toBe(2000);
    const boxes = new Map([[8, BOX(0)], [13, BOX(20)]]);
    const tour = buildTour({ kind: 'absorber', result: 13, set: [13], victim: 8, sigma: 5, boxes });
    expect(tour.stops).toStrictEqual([13]);
    expect(tour.end).toBe(2000);
    expect(tour.legs).toHaveLength(2);
    expect(tour.legs[0]?.to).toStrictEqual([8, 13]);
    expect(tour.legs[1]?.to).toBe('overview');
  });

  it('FR-436 a victim tour still needs two factions', () => {
    expect(() => nominalEnd('victim', 1)).toThrow(RangeError);
    expect(() => nominalEnd('absorber', 0)).toThrow(RangeError);
  });

  it('FR-436 the decision plays for one candidate (it skipped with no-candidates before)', () => {
    // I - L1 - L2 = 15 s after the application, less 1,000 ms of margin and 1,500 ms of label step.
    expect(absorberTourDecision(absorberInput())).toStrictEqual({ play: true, budget: 12_500 });
  });

  it('FR-436 the other skips stay: no candidates held, the absorber not among them, stale, halted', () => {
    expect(absorberTourDecision(absorberInput({ candidates: undefined }))).toStrictEqual({ play: false, reason: 'no-candidates' });
    expect(absorberTourDecision(absorberInput({ candidates: [] }))).toStrictEqual({ play: false, reason: 'no-candidates' });
    expect(absorberTourDecision(absorberInput({ absorber: 5 }))).toStrictEqual({ play: false, reason: 'not-a-candidate' });
    expect(absorberTourDecision(absorberInput({ estimate: 205_001 }))).toStrictEqual({ play: false, reason: 'not-fresh' });
    expect(absorberTourDecision(absorberInput({ halted: true }))).toStrictEqual({ play: false, reason: 'not-fresh' });
  });

  it('FR-436 the last round has no budget; manual timing has none', () => {
    expect(absorberTourDecision(absorberInput({ round: 5, displayed: 4 }))).toStrictEqual({ play: true });
    expect(absorberTourDecision(absorberInput({ timing: 'manual' }))).toStrictEqual({ play: true });
  });

  it('FR-436 a short gap after the application skips it as too short (2 s needs 1 s)', () => {
    // I - L1 - L2 = 3 s: 3,000 - 2,500 = 500 < 1,000.
    expect(absorberTourDecision(absorberInput({ timing: { i: 10, l1: 5, l2: 2 } }))).toStrictEqual({ play: false, reason: 'too-short' });
    // I - L1 - L2 = 4 s: 1,500 left, scaled.
    expect(absorberTourDecision(absorberInput({ timing: { i: 11, l1: 5, l2: 2 } }))).toStrictEqual({ play: true, budget: 1500 });
  });

  it('FR-436 the view plays it, scaled by the budget like any tour, and shows the result at once under reduced motion', () => {
    expect(viewChoice('absorber', false, 1, undefined)).toStrictEqual({ play: true });
    expect(viewChoice('absorber', false, 1, 1000)).toStrictEqual({ play: true, budget: 1000 });
    expect(viewChoice('absorber', false, 1, 999)).toStrictEqual({ play: false, reason: 'too-short' });
    expect(viewChoice('absorber', true, 1, undefined)).toStrictEqual({ play: false, reason: 'reduced-motion' });
    const boxes = new Map([[8, BOX(0)], [13, BOX(20)]]);
    const request = { kind: 'absorber' as const, result: 13, victim: 8, set: [13], sigma: 3 };
    expect(planTours([request], false, () => boxes).tours[0]?.end).toBe(2000);
    expect(planTours([request], true, () => boxes).tours).toHaveLength(0);
  });
});
