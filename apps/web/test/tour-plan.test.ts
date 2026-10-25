import { describe, expect, it } from 'vitest';
import { buildTour, nominalEnd } from '../src/core/tour';
import {
  absorberTourDecision,
  scaleFor,
  victimTourDecision,
  viewChoice,
  type AbsorberInput,
  type VictimInput,
} from '../src/core/tour-plan';

// Hand-derived nominal ends (plan 4.3): 5,349 (12 stops), 3,487 (6 stops), 2,411 (absorber), 1,800 (still).
const CLOCK = { i: 40, l1: 20, l2: 5 } as const;

const victimInput = (extra: Partial<VictimInput> = {}): VictimInput => ({
  source: 'event',
  halted: false,
  round: 4,
  displayed: 3,
  estimate: 119001,
  revealedAt: 119001,
  living: [3, 5, 8, 13, 21],
  displayedLiving: [3, 5, 8, 13, 21],
  victim: 8,
  timing: CLOCK,
  c2: 123457,
  ...extra,
});

const absorberInput = (extra: Partial<AbsorberInput> = {}): AbsorberInput => ({
  halted: false,
  round: 4,
  totalRounds: 9,
  displayed: 3,
  estimate: 200000,
  appliedAt: 200000,
  candidates: [5, 13, 21],
  absorber: 13,
  timing: { i: 9, l1: 3, l2: 2 },
  ...extra,
});

describe('tour nominal ends', () => {
  it('FR-316 the nominal end of each tour equals the end buildTour gives', () => {
    expect(nominalEnd('victim', 5)).toBe(5349);
    expect(nominalEnd('victim', 3)).toBe(5349);
    expect(nominalEnd('victim', 2)).toBe(3487);
    expect(nominalEnd('absorber', 2)).toBe(2411);
    expect(nominalEnd('absorber', 4)).toBe(2411);
    expect(nominalEnd('victim', 5, true)).toBe(1800);
    const set = [10, 13, 16, 19];
    expect(buildTour({ kind: 'victim', result: 13, set, sigma: 9 }).end).toBe(nominalEnd('victim', 4));
    expect(buildTour({ kind: 'victim', result: 13, set: [10, 13], sigma: 9 }).end).toBe(nominalEnd('victim', 2));
    expect(buildTour({ kind: 'absorber', result: 13, victim: 7, set, sigma: 9 }).end).toBe(nominalEnd('absorber', 4));
    expect(buildTour({ kind: 'victim', result: 13, set, sigma: 9, still: true }).end).toBe(nominalEnd('victim', 4, true));
  });

  it('FR-316 a set of fewer than two factions has no tour', () => {
    expect(() => nominalEnd('victim', 1)).toThrow(RangeError);
  });
});

describe('victim tour decision', () => {
  it('FR-316 FR-319 a fresh event plays at age 0 and at 5,000 ms, not at 5,001 ms', () => {
    expect(victimTourDecision(victimInput({ estimate: 119001, revealedAt: 119001 })).play).toBe(true);
    expect(victimTourDecision(victimInput({ estimate: 124001, revealedAt: 119001, c2: 200000 })).play).toBe(true);
    const old = victimTourDecision(victimInput({ estimate: 124002, revealedAt: 119001, c2: 200000 }));
    expect(old).toStrictEqual({ play: false, reason: 'not-fresh' });
  });

  it('FR-319 a reveal read from the public data never plays, also the kept victim fields of a halted match', () => {
    expect(victimTourDecision(victimInput({ source: 'public' }))).toStrictEqual({ play: false, reason: 'not-fresh' });
    expect(victimTourDecision(victimInput({ source: 'public', halted: true }))).toStrictEqual({ play: false, reason: 'not-fresh' });
    expect(victimTourDecision(victimInput({ halted: true }))).toStrictEqual({ play: false, reason: 'not-fresh' });
  });

  it('FR-319 a reveal arriving while the displayed round is not k - 1 plays no tour', () => {
    for (const displayed of [undefined, 0, 2, 4, 5]) {
      expect(victimTourDecision(victimInput({ displayed })), String(displayed)).toStrictEqual({ play: false, reason: 'not-fresh' });
    }
    expect(victimTourDecision(victimInput({ round: 1, displayed: 0 })).play).toBe(true);
  });

  it('FR-319 an estimate below the reveal instant gives age 0, never negative', () => {
    expect(victimTourDecision(victimInput({ estimate: 118000, revealedAt: 119001, c2: 130000 })).play).toBe(true);
    // 9,001 ms before the instant would be an age of -9,001: still fresh (and a budget from the estimate).
    const d = victimTourDecision(victimInput({ estimate: 110000, revealedAt: 119001, c2: 130000 }));
    expect(d).toStrictEqual({ play: true, budget: 19000 });
  });

  it('FR-320 participants that differ from the held owners, a victim outside them or n below 2 give mismatch', () => {
    const mismatch = { play: false, reason: 'mismatch' };
    expect(victimTourDecision(victimInput({ displayedLiving: [3, 5, 8, 13] }))).toStrictEqual(mismatch);
    expect(victimTourDecision(victimInput({ displayedLiving: [3, 5, 8, 13, 21, 34] }))).toStrictEqual(mismatch);
    expect(victimTourDecision(victimInput({ living: [3, 5, 8, 13, 22] }))).toStrictEqual(mismatch);
    expect(victimTourDecision(victimInput({ victim: 9 }))).toStrictEqual(mismatch);
    expect(victimTourDecision(victimInput({ living: [8], displayedLiving: [8] }))).toStrictEqual(mismatch);
    expect(victimTourDecision(victimInput({ living: [], displayedLiving: [], victim: 8 }))).toStrictEqual(mismatch);
    // Two participants are enough; the order of the lists does not matter.
    expect(victimTourDecision(victimInput({ living: [8, 3], displayedLiving: [3, 8] })).play).toBe(true);
  });

  it('FR-320 a stale reveal is reported as not fresh, not as a mismatch', () => {
    const d = victimTourDecision(victimInput({ source: 'public', displayedLiving: [1, 2] }));
    expect(d).toStrictEqual({ play: false, reason: 'not-fresh' });
  });

  it('FR-336 the budget is C2 minus the estimate minus 1,000 ms', () => {
    expect(victimTourDecision(victimInput({ estimate: 119001, c2: 123457 }))).toStrictEqual({ play: true, budget: 3456 });
    expect(victimTourDecision(victimInput({ estimate: 119001, c2: 120001 }))).toStrictEqual({ play: true, budget: 0 });
    expect(victimTourDecision(victimInput({ estimate: 119001, c2: 119500 }))).toStrictEqual({ play: true, budget: -501 });
  });

  it('FR-338 manual timing, or a null C2, plays at nominal duration with no budget', () => {
    expect(victimTourDecision(victimInput({ timing: 'manual', c2: null }))).toStrictEqual({ play: true });
    expect(victimTourDecision(victimInput({ timing: 'manual', c2: 119500 }))).toStrictEqual({ play: true });
    expect(victimTourDecision(victimInput({ timing: CLOCK, c2: null }))).toStrictEqual({ play: true });
  });
});

describe('tour scale', () => {
  it('FR-336 FR-349 a budget at or above D plays at nominal duration, a smaller one is the scale', () => {
    expect(scaleFor(5349, undefined)).toStrictEqual({ play: true });
    expect(scaleFor(5349, 5349)).toStrictEqual({ play: true });
    expect(scaleFor(5349, 6000)).toStrictEqual({ play: true });
    expect(scaleFor(5349, 5348)).toStrictEqual({ play: true, budget: 5348 });
    expect(scaleFor(5349, 4013)).toStrictEqual({ play: true, budget: 4013 });
  });

  it('FR-336 a ratio of exactly 0.5 plays compressed, below it the tour is skipped', () => {
    expect(scaleFor(1800, 900)).toStrictEqual({ play: true, budget: 900 });
    expect(scaleFor(1800, 899)).toStrictEqual({ play: false });
    expect(scaleFor(5349, 2675)).toStrictEqual({ play: true, budget: 2675 });
    expect(scaleFor(5349, 2674)).toStrictEqual({ play: false });
    expect(scaleFor(2411, 1206)).toStrictEqual({ play: true, budget: 1206 });
    expect(scaleFor(2411, 1205)).toStrictEqual({ play: false });
  });

  it('FR-336 a zero or negative budget skips', () => {
    expect(scaleFor(5349, 0)).toStrictEqual({ play: false });
    expect(scaleFor(5349, -3000)).toStrictEqual({ play: false });
  });
});

describe('reduced motion and the view choice', () => {
  it('FR-343 under reduced motion the victim plays the still tour with D = 1,800 ms', () => {
    expect(viewChoice('victim', true, 5, undefined)).toStrictEqual({ play: true, still: true });
    expect(viewChoice('victim', true, 2, 1800)).toStrictEqual({ play: true, still: true });
    expect(viewChoice('victim', true, 5, 1799)).toStrictEqual({ play: true, still: true, budget: 1799 });
  });

  it('FR-336 under reduced motion the budget rule uses D = 1,800 ms (compressed from 900, skipped below)', () => {
    expect(viewChoice('victim', true, 5, 900)).toStrictEqual({ play: true, still: true, budget: 900 });
    expect(viewChoice('victim', true, 5, 899)).toStrictEqual({ play: false, reason: 'too-short' });
    // The same budget skips the full tour (5,349 / 2) and still plays the still tour.
    expect(viewChoice('victim', false, 5, 899)).toStrictEqual({ play: false, reason: 'too-short' });
    expect(viewChoice('victim', false, 5, 2674)).toStrictEqual({ play: false, reason: 'too-short' });
    expect(viewChoice('victim', true, 5, 2674)).toStrictEqual({ play: true, still: true });
  });

  it('FR-336 without reduced motion the full tour is scaled by its own D (12 stops, 6 stops)', () => {
    expect(viewChoice('victim', false, 5, undefined)).toStrictEqual({ play: true });
    expect(viewChoice('victim', false, 5, 4013)).toStrictEqual({ play: true, budget: 4013 });
    expect(viewChoice('victim', false, 2, 1744)).toStrictEqual({ play: true, budget: 1744 });
    expect(viewChoice('victim', false, 2, 1743)).toStrictEqual({ play: false, reason: 'too-short' });
    expect(viewChoice('victim', false, 3, 1743)).toStrictEqual({ play: false, reason: 'too-short' });
  });

  it('under reduced motion there is no absorber tour', () => {
    expect(viewChoice('absorber', true, 3, undefined)).toStrictEqual({ play: false, reason: 'reduced-motion' });
    expect(viewChoice('absorber', true, 3, 9999)).toStrictEqual({ play: false, reason: 'reduced-motion' });
    expect(viewChoice('absorber', false, 3, undefined)).toStrictEqual({ play: true });
    expect(viewChoice('absorber', false, 3, 1500)).toStrictEqual({ play: true, budget: 1500 });
    expect(viewChoice('absorber', false, 3, 1205)).toStrictEqual({ play: false, reason: 'too-short' });
  });
});

describe('absorber tour decision', () => {
  it('FR-319 a fresh application plays at age 0 and 5,000 ms, not at 5,001 ms (the age runs from appliedAt)', () => {
    const k = { round: 4, totalRounds: 4 };
    expect(absorberTourDecision(absorberInput({ ...k, estimate: 200000, appliedAt: 200000 })).play).toBe(true);
    expect(absorberTourDecision(absorberInput({ ...k, estimate: 205000, appliedAt: 200000 })).play).toBe(true);
    expect(absorberTourDecision(absorberInput({ ...k, estimate: 205001, appliedAt: 200000 }))).toStrictEqual({ play: false, reason: 'not-fresh' });
    // An estimate below the application instant is an age of 0.
    expect(absorberTourDecision(absorberInput({ ...k, estimate: 190000, appliedAt: 200000 })).play).toBe(true);
  });

  it('FR-319 no absorber tour when halted or when the displayed round is not k - 1', () => {
    expect(absorberTourDecision(absorberInput({ halted: true }))).toStrictEqual({ play: false, reason: 'not-fresh' });
    for (const displayed of [undefined, 0, 2, 4]) {
      expect(absorberTourDecision(absorberInput({ displayed })), String(displayed)).toStrictEqual({ play: false, reason: 'not-fresh' });
    }
  });

  it('no absorber tour when the candidates are not held, d is 1, or the absorber is not among them', () => {
    expect(absorberTourDecision(absorberInput({ candidates: undefined }))).toStrictEqual({ play: false, reason: 'no-candidates' });
    expect(absorberTourDecision(absorberInput({ candidates: [] }))).toStrictEqual({ play: false, reason: 'no-candidates' });
    expect(absorberTourDecision(absorberInput({ candidates: [13] }))).toStrictEqual({ play: false, reason: 'no-candidates' });
    expect(absorberTourDecision(absorberInput({ candidates: [5, 13, 21], absorber: 8 }))).toStrictEqual({ play: false, reason: 'not-a-candidate' });
    expect(absorberTourDecision(absorberInput({ candidates: [5, 13], absorber: 13 })).play).toBe(true);
  });

  it('FR-349 the budget is appliedAt + (I - L1 - L2) x 1,000 - estimate - 1,000 - Dt', () => {
    // Window of 4 s after the application: 4,000 - 1,000 - 1,500 - age.
    const timing = { i: 9, l1: 3, l2: 2 } as const;
    expect(absorberTourDecision(absorberInput({ timing, estimate: 200000, appliedAt: 200000 }))).toStrictEqual({ play: true, budget: 1500 });
    expect(absorberTourDecision(absorberInput({ timing, estimate: 200137, appliedAt: 200000 }))).toStrictEqual({ play: true, budget: 1363 });
  });

  it('FR-349 the edge-case figures: no tour below 2,206 ms + Dt, compressed below 3,411 ms + Dt', () => {
    // I - L1 - L2 = 4 s: the budget is 1,500 - age; the tour needs 1,206 (a ratio of 0.5 of 2,411).
    const t4 = { i: 8, l1: 2, l2: 2 } as const;
    expect(absorberTourDecision(absorberInput({ timing: t4, estimate: 200294, appliedAt: 200000 }))).toStrictEqual({ play: true, budget: 1206 });
    expect(absorberTourDecision(absorberInput({ timing: t4, estimate: 200295, appliedAt: 200000 }))).toStrictEqual({ play: false, reason: 'too-short' });
    // 3 s: 500 left, skipped. 5 s: 2,500 - age, nominal from 2,411.
    const t3 = { i: 7, l1: 2, l2: 2 } as const;
    expect(absorberTourDecision(absorberInput({ timing: t3, estimate: 200000, appliedAt: 200000 }))).toStrictEqual({ play: false, reason: 'too-short' });
    const t5 = { i: 9, l1: 2, l2: 2 } as const;
    expect(absorberTourDecision(absorberInput({ timing: t5, estimate: 200089, appliedAt: 200000 }))).toStrictEqual({ play: true, budget: 2411 });
    expect(absorberTourDecision(absorberInput({ timing: t5, estimate: 200090, appliedAt: 200000 }))).toStrictEqual({ play: true, budget: 2410 });
  });

  it('FR-349 the last round plays at nominal duration with no budget, whatever the gap', () => {
    const last = { round: 9, totalRounds: 9, displayed: 8 };
    expect(absorberTourDecision(absorberInput({ ...last, timing: { i: 4, l1: 2, l2: 2 } }))).toStrictEqual({ play: true });
    expect(absorberTourDecision(absorberInput({ ...last, timing: { i: 4, l1: 2, l2: 2 }, estimate: 204000 }))).toStrictEqual({ play: true });
  });

  it('FR-338 manual timing plays the absorber tour at nominal duration with no budget', () => {
    expect(absorberTourDecision(absorberInput({ timing: 'manual' }))).toStrictEqual({ play: true });
  });

  it('FR-349 the decision needs no schedule: its inputs hold none', () => {
    const input = absorberInput();
    expect(Object.keys(input).sort()).toStrictEqual(
      ['absorber', 'appliedAt', 'candidates', 'displayed', 'estimate', 'halted', 'round', 'timing', 'totalRounds'],
    );
  });
});
