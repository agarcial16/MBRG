import { describe, expect, it } from 'vitest';
import { buildTour, nominalEnd } from '../src/core/tour';
import type { TourSpec } from '../src/core/tour';
import { viewChoice } from '../src/core/tour-plan';
import type { Box } from '../src/core/tour-camera';
import { pacedFor } from '../src/core/live-view';
import { planTours } from '../src/core/tour-session';

const SET = [10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46];
const victim = (extra: Partial<TourSpec> = {}): TourSpec => ({ kind: 'victim', result: 22, set: SET, sigma: 1234567891, ...extra });
const absorber = (extra: Partial<TourSpec> = {}): TourSpec => ({ kind: 'absorber', result: 13, victim: 7, set: [10, 13, 16, 19], sigma: 3000000019, ...extra });
const gaps = (at: readonly number[]): number[] => at.slice(1).map((v, i) => v - at[i]!);

describe('tour pace (bell)', () => {
  it('FR-411 the classic pace is the default and is untouched', () => {
    expect(buildTour(victim()).end).toBe(5349);
    expect(buildTour(victim({ pace: 'classic' }))).toStrictEqual(buildTour(victim()));
    expect(nominalEnd('victim', 13)).toBe(5349);
    expect(nominalEnd('victim', 13, false, 'classic')).toBe(5349);
  });

  it('FR-411 the bell tour is 30 to 40 % longer than the classic one for every kind and size', () => {
    const cases: Array<[string, number, number]> = [
      ['victim 12 stops', buildTour(victim({ pace: 'bell' })).end, 5349],
      ['victim 6 stops', buildTour(victim({ set: [10, 22], pace: 'bell' })).end, 3487],
      ['absorber', buildTour(absorber({ pace: 'bell' })).end, 2411],
    ];
    for (const [, bell, classic] of cases) {
      expect(bell).toBeGreaterThanOrEqual(classic * 1.3);
      expect(bell).toBeLessThanOrEqual(classic * 1.4);
    }
  });

  it('FR-411 the dwells are slow, fast, slow: symmetric, longest at both ends, shortest in the middle', () => {
    for (const spec of [victim({ pace: 'bell' }), victim({ set: [10, 22], pace: 'bell' }), absorber({ pace: 'bell' })]) {
      const g = gaps(buildTour(spec).at);
      expect(g).toStrictEqual([...g].reverse());
      const shortest = Math.min(...g);
      const longest = Math.max(...g);
      expect(g[0]).toBe(longest);
      expect(g[Math.floor(g.length / 2)]).toBe(shortest);
      expect(longest).toBeGreaterThan(shortest);
    }
  });

  it('FR-411 nominalEnd with the bell pace is the end of the tour built with it', () => {
    expect(nominalEnd('victim', 13, false, 'bell')).toBe(buildTour(victim({ pace: 'bell' })).end);
    expect(nominalEnd('victim', 2, false, 'bell')).toBe(buildTour(victim({ set: [10, 22], pace: 'bell' })).end);
    expect(nominalEnd('absorber', 4, false, 'bell')).toBe(buildTour(absorber({ pace: 'bell' })).end);
  });

  it('FR-411 the still tour of reduced motion does not change with the pace', () => {
    expect(nominalEnd('victim', 13, true, 'bell')).toBe(1800);
  });

  it('FR-411 the budget rule uses the bell end: a budget between the classic end and the bell end compresses', () => {
    const bell = nominalEnd('victim', 13, false, 'bell');
    expect(viewChoice('victim', false, 13, 5400)).toStrictEqual({ play: true });
    expect(viewChoice('victim', false, 13, 5400, 'bell')).toStrictEqual({ play: true, budget: 5400 });
    expect(viewChoice('victim', false, 13, bell, 'bell')).toStrictEqual({ play: true });
    expect(viewChoice('victim', false, 13, Math.floor(bell / 2) - 1, 'bell')).toStrictEqual({ play: false, reason: 'too-short' });
  });

  it('FR-411 a request with the bell pace builds a bell tour, one without keeps the classic pace', () => {
    const boxesOf = (): ReadonlyMap<number, Box> => new Map();
    const base = { kind: 'victim' as const, result: 22, set: SET, sigma: 5 };
    const classic = planTours([base], false, boxesOf).tours[0]!;
    const bell = planTours([{ ...base, pace: 'bell' }], false, boxesOf).tours[0]!;
    expect(classic.end).toBe(5349);
    expect(bell.end).toBe(nominalEnd('victim', 13, false, 'bell'));
  });

  it('FR-411 a request is bell paced only when a player is present; without one it stays classic', () => {
    const request = { kind: 'victim' as const, result: 1, set: [1, 2], sigma: 3 };
    expect(pacedFor(request, true)).toStrictEqual({ ...request, pace: 'bell' });
    expect(pacedFor(request, false)).toBe(request);
    expect(pacedFor(undefined, true)).toBeUndefined();
  });
});
