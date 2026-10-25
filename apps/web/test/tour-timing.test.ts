import { describe, expect, it } from 'vitest';
import { buildTour, dimAt } from '../src/core/tour';
import type { TourSpec } from '../src/core/tour';

const SET = [10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46];
const victim = (extra: Partial<TourSpec> = {}): TourSpec => ({
  kind: 'victim',
  result: 22,
  set: SET,
  sigma: 1234567891,
  ...extra,
});
const absorber = (extra: Partial<TourSpec> = {}): TourSpec => ({
  kind: 'absorber',
  result: 13,
  victim: 7,
  set: [10, 13, 16, 19],
  sigma: 3000000019,
  ...extra,
});
const gaps = (at: readonly number[]): number[] => at.slice(1).map((v, i) => v - at[i]!);

// Dwells worked by hand from d_i = dmin + floor((dmax - dmin) (i - 1)^2 / (H - 2)^2).
const DWELLS_12 = [120, 125, 143, 172, 212, 265, 328, 404, 491, 589, 700];
const DWELLS_6 = [120, 156, 265, 446, 700];
const DWELLS_ABSORBER = [120, 143, 215, 333, 500];

describe('tour timing', () => {
  it('FR-323 the dwells of 12 stops follow the quadratic slow-down and sum to 3,549 ms', () => {
    const tour = buildTour(victim());
    expect(tour.stops).toHaveLength(12);
    expect(gaps(tour.at)).toStrictEqual(DWELLS_12);
    expect(tour.at[0]).toBe(0);
    expect(tour.at[11]).toBe(3549);
  });

  it('FR-323 the dwells of 6 stops sum to 1,687 ms', () => {
    const tour = buildTour(victim({ set: [10, 22] }));
    expect(tour.stops).toHaveLength(6);
    expect(gaps(tour.at)).toStrictEqual(DWELLS_6);
    expect(tour.at[5]).toBe(1687);
  });

  it('FR-323 the integer dwell formula equals the real formula for H = 6 and H = 12, every i', () => {
    for (const [set, count] of [[SET, 12], [[10, 22], 6]] as const) {
      const tour = buildTour(victim({ set }));
      const real = Array.from({ length: count - 1 }, (_, k) => Math.floor(120 + 580 * (k / (count - 2)) ** 2));
      expect(gaps(tour.at)).toStrictEqual(real);
    }
  });

  it('FR-324 the victim tour holds 1,500 ms and fades 300 ms: D = 5,349 ms for 12 stops and 3,487 ms for 6', () => {
    const twelve = buildTour(victim());
    expect([twelve.hold, twelve.fade, twelve.end]).toStrictEqual([1500, 300, 5349]);
    const six = buildTour(victim({ set: [10, 22] }));
    expect([six.hold, six.fade, six.end]).toStrictEqual([1500, 300, 3487]);
  });

  it('FR-324 a nominal victim tour lasts between 3,000 and 6,000 ms for any number of participants', () => {
    for (const n of [3, 5, 12, 70]) {
      const set = Array.from({ length: n }, (_, i) => 5 + 2 * i);
      const { end } = buildTour(victim({ result: set[1]!, set }));
      expect(end).toBeGreaterThanOrEqual(3000);
      expect(end).toBeLessThanOrEqual(6000);
    }
    expect(buildTour(victim({ set: [10, 22] })).end).toBeGreaterThanOrEqual(3000);
  });

  it('FR-346 the absorber tour has 6 stops, dwells 120 to 500, hold 800 and fade 300: the last stop at 1,311 and D = 2,411', () => {
    const tour = buildTour(absorber());
    expect(tour.stops).toHaveLength(6);
    expect(gaps(tour.at)).toStrictEqual(DWELLS_ABSORBER);
    expect(tour.at[5]).toBe(1311);
    expect([tour.hold, tour.fade, tour.end]).toStrictEqual([800, 300, 2411]);
    expect(tour.stops.at(-1)).toBe(13);
  });

  it('FR-346 an absorber tour without its victim is refused', () => {
    expect(() => buildTour({ kind: 'absorber', result: 13, set: [10, 13], sigma: 1 })).toThrow(RangeError);
    expect(() => buildTour({ kind: 'absorber', result: 13, set: [10, 13], sigma: 1, boxes: new Map() })).toThrow(RangeError);
  });

  it('FR-346 the absorber tour with two candidates alternates and ends on the absorber', () => {
    const tour = buildTour(absorber({ set: [13, 40], result: 40 }));
    expect(tour.stops).toStrictEqual([13, 40, 13, 40, 13, 40]);
    expect(tour.end).toBe(2411);
  });

  it('FR-325 the dim ramps up with a smoothstep over the fade, holds, and fades out (0.65 at most)', () => {
    const tour = buildTour(victim()); // last stop at 3,549, hold to 5,049, end 5,349
    expect(dimAt(tour, 0)).toBe(0);
    expect(dimAt(tour, 150)).toBeCloseTo(0.325, 12);
    expect(dimAt(tour, 299)).toBeCloseTo(0.65 * (1 - 3 / 300 ** 2 + 2 / 300 ** 3), 12);
    expect(dimAt(tour, 299)).toBeCloseTo(0.649978, 6);
    expect(dimAt(tour, 300)).toBe(0.65);
    expect(dimAt(tour, 3549)).toBe(0.65);
    expect(dimAt(tour, 5048)).toBe(0.65);
    expect(dimAt(tour, 5049)).toBe(0.65);
    expect(dimAt(tour, 5199)).toBeCloseTo(0.325, 12);
    expect(dimAt(tour, 5348)).toBeCloseTo(0.65 * (3 / 300 ** 2 - 2 / 300 ** 3), 12);
    expect(dimAt(tour, 5348)).toBeCloseTo(0.0000216, 7);
    expect(dimAt(tour, 5349)).toBe(0);
    expect(dimAt(tour, 9000)).toBe(0);
    expect(dimAt(tour, -5)).toBe(0);
  });

  it('FR-325 the dim of the absorber tour holds for 800 ms and ends at D = 2,411', () => {
    const tour = buildTour(absorber());
    expect(dimAt(tour, 1311 + 799)).toBe(0.65);
    expect(dimAt(tour, 1311 + 800 + 150)).toBeCloseTo(0.325, 12);
    expect(dimAt(tour, 2410)).toBeGreaterThan(0);
    expect(dimAt(tour, 2411)).toBe(0);
  });

  it('FR-325 the dim never leaves 0 to 0.65 over a whole tour', () => {
    const tour = buildTour(victim());
    for (let t = -10; t <= 5400; t++) {
      expect(dimAt(tour, t)).toBeGreaterThanOrEqual(0);
      expect(dimAt(tour, t)).toBeLessThanOrEqual(0.65);
    }
  });

  it('FR-323 a budget of 4,013 ms floors each duration and takes D from the scaled values (worked by hand)', () => {
    // floor(x x 4013 / 5349) for every dwell, the hold and the fade; D is the sum of the floors, not floor(5349 x c).
    const tour = buildTour(victim({ budget: 4013 }));
    expect(gaps(tour.at)).toStrictEqual([90, 93, 107, 129, 159, 198, 246, 303, 368, 441, 525]);
    expect(tour.at).toStrictEqual([0, 90, 183, 290, 419, 578, 776, 1022, 1325, 1693, 2134, 2659]);
    expect([tour.hold, tour.fade, tour.end]).toStrictEqual([1125, 225, 4009]);
  });

  it('FR-324 a budget of 2,700 ms scales the same way and ends at 2,694 ms', () => {
    const tour = buildTour(victim({ budget: 2700 }));
    expect(gaps(tour.at)).toStrictEqual([60, 63, 72, 86, 107, 133, 165, 203, 247, 297, 353]);
    expect(tour.at[11]).toBe(1786);
    expect([tour.hold, tour.fade, tour.end]).toStrictEqual([757, 151, 2694]);
  });

  it('FR-325 the dim of a scaled tour ramps over the scaled fade and ends at the scaled D', () => {
    const tour = buildTour(victim({ budget: 2700 }));
    // u = 75 / 151: 0.65 x (3u^2 - 2u^3) = 0.65 x 0.4950332 by hand.
    expect(dimAt(tour, 75)).toBeCloseTo(0.3217716, 6);
    expect(dimAt(tour, 151)).toBe(0.65);
    expect(dimAt(tour, 1786 + 757 - 1)).toBe(0.65);
    expect(dimAt(tour, 2693)).toBeGreaterThan(0);
    expect(dimAt(tour, 2694)).toBe(0);
  });

  it('FR-323 the scale boundary c = 0.5 is exact: 2,675 ms of 5,349 plays, 2,674 ms is refused', () => {
    expect(buildTour(victim({ budget: 2675 })).end).toBeLessThanOrEqual(2675);
    expect(() => buildTour(victim({ budget: 2674 }))).toThrow(RangeError);
    expect(() => buildTour(victim({ budget: 0 }))).toThrow(RangeError);
  });

  it('FR-323 a budget at or above the nominal D leaves the tour unchanged', () => {
    const nominal = buildTour(victim());
    expect(buildTour(victim({ budget: 5349 }))).toStrictEqual(nominal);
    expect(buildTour(victim({ budget: 9999 }))).toStrictEqual(nominal);
  });

  it('FR-346 the absorber tour scales with the same rule (budget 1,500 ms)', () => {
    const tour = buildTour(absorber({ budget: 1500 }));
    expect(tour.at).toStrictEqual([0, 74, 162, 295, 502, 813]);
    expect([tour.hold, tour.fade, tour.end]).toStrictEqual([497, 186, 1496]);
  });

  it('FR-343 (still tour) shows one stop, the victim, from 0 to D = 1,800 ms with no dwells', () => {
    const tour = buildTour(victim({ still: true }));
    expect(tour.stops).toStrictEqual([22]);
    expect(tour.at).toStrictEqual([0]);
    expect([tour.hold, tour.fade, tour.end]).toStrictEqual([1500, 300, 1800]);
  });

  it('FR-343 (still tour) fades in from 0, holds, and fades out to the final state', () => {
    const tour = buildTour(victim({ still: true }));
    expect(dimAt(tour, 0)).toBe(0);
    expect(dimAt(tour, 150)).toBeCloseTo(0.325, 12);
    expect(dimAt(tour, 300)).toBe(0.65);
    expect(dimAt(tour, 1499)).toBe(0.65);
    expect(dimAt(tour, 1650)).toBeCloseTo(0.325, 12);
    expect(dimAt(tour, 1799)).toBeGreaterThan(0);
    expect(dimAt(tour, 1800)).toBe(0);
  });

  it('FR-343 (still tour) is scaled by the same rule: 1,000 ms gives 833 + 166 and 900 ms is the limit', () => {
    const scaled = buildTour(victim({ still: true, budget: 1000 }));
    expect([scaled.hold, scaled.fade, scaled.end]).toStrictEqual([833, 166, 999]);
    expect(buildTour(victim({ still: true, budget: 900 })).end).toBe(900);
    expect(() => buildTour(victim({ still: true, budget: 899 }))).toThrow(RangeError);
  });
});
