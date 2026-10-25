import { describe, expect, expectTypeOf, it } from 'vitest';
import { absorptionCandidatesOf, getRounds, getState, livingFactions, totalRounds } from '@mbrg/sim';
import { fnv1a32, keyText } from '../src/core/tour-key';
import { drawStops, stopCount } from '../src/core/tour';
import type { StopsInput } from '../src/core/tour';
import { DEV_MAP } from './helpers/dev-map';
import { referenceStops } from './helpers/tour-reference';

/** The FR-322 properties of one tour, for a set of any size. */
function checkStops(stops: readonly number[], set: readonly number[], result: number, count: number): void {
  expect(stops).toHaveLength(count);
  expect(stops[count - 1]).toBe(result);
  for (const s of stops) expect(set).toContain(s);
  for (let i = 1; i < count; i++) expect(stops[i]).not.toBe(stops[i - 1]);
  expect(stops[count - 2]).not.toBe(result);
  // Read from the end: no faction repeats before every faction of the set has been shown.
  const seen = new Set<number>();
  for (let i = count - 1; i >= 0; i--) {
    const s = stops[i]!;
    if (seen.has(s)) {
      expect(seen.size).toBe(new Set(set).size);
      break;
    }
    seen.add(s);
  }
  // With at least H factions the result is shown once, at the end.
  if (new Set(set).size >= count) expect(stops.filter((s) => s === result)).toHaveLength(1);
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => 10 + i * 3);

describe('tour stops', () => {
  it('FR-321 the victim tour has 12 stops from three factions and 6 with two; the absorber tour has 6', () => {
    expect(stopCount('victim', 2)).toBe(6);
    for (const n of [3, 4, 11, 12, 13, 70]) expect(stopCount('victim', n)).toBe(12);
    for (const n of [2, 3, 5, 70]) expect(stopCount('absorber', n)).toBe(6);
    expect(() => stopCount('victim', 1)).toThrow(RangeError);
    expect(() => stopCount('absorber', 0)).toThrow(RangeError);
  });

  it('FR-321 the last stop is the result, and a result outside the set is refused', () => {
    for (const result of [10, 13, 16]) {
      const stops = drawStops({ kind: 'victim', result, set: [10, 13, 16, 19], sigma: 2718281829 });
      expect(stops.at(-1)).toBe(result);
    }
    expect(() => drawStops({ kind: 'victim', result: 99, set: [10, 13], sigma: 1 })).toThrow(RangeError);
    expect(() => drawStops({ kind: 'victim', result: 10, set: [10], sigma: 1 })).toThrow(RangeError);
  });

  it('FR-322 two factions alternate and end on the result (hand-derived)', () => {
    expect(drawStops({ kind: 'victim', result: 2, set: [1, 2], sigma: 4000000007 })).toStrictEqual([1, 2, 1, 2, 1, 2]);
    expect(drawStops({ kind: 'victim', result: 1, set: [2, 1], sigma: 17 })).toStrictEqual([2, 1, 2, 1, 2, 1]);
    expect(drawStops({ kind: 'absorber', result: 8, set: [5, 8], sigma: 9 })).toStrictEqual([5, 8, 5, 8, 5, 8]);
  });

  it('FR-322 the stops equal the independent backwards reference on varied sets and two sigma', () => {
    const sets = [[1, 2], [4, 9, 12], range(5), range(11), range(12), range(13), range(70)];
    for (const sigma of [1234567891, 3000000019]) {
      for (const set of sets) {
        for (const result of [set[0]!, set[set.length - 1]!]) {
          for (const kind of ['victim', 'absorber'] as const) {
            expect(drawStops({ kind, result, set, sigma })).toStrictEqual(referenceStops(kind, result, set, sigma));
          }
        }
      }
    }
  });

  it('FR-322 the properties hold on hand-made sets of 2, 3, 11, 12 and 70 factions', () => {
    for (const n of [2, 3, 11, 12, 70]) {
      const set = range(n);
      for (let sigma = 1; sigma <= 40; sigma++) {
        for (const result of [set[0]!, set[Math.floor(n / 2)]!, set[n - 1]!]) {
          checkStops(drawStops({ kind: 'victim', result, set, sigma: sigma * 104729 }), set, result, n === 2 ? 6 : 12);
        }
      }
    }
    for (const n of [2, 3, 6, 70]) {
      const set = range(n);
      for (let sigma = 1; sigma <= 40; sigma++) {
        checkStops(drawStops({ kind: 'absorber', result: set[1]!, set, sigma: sigma * 7919 }), set, set[1]!, 6);
      }
    }
  });

  it('FR-322 twelve factions show all twelve once and 70 factions show 11 decoys, none the result', () => {
    const twelve = range(12);
    const all = drawStops({ kind: 'victim', result: twelve[4]!, set: twelve, sigma: 123456791 });
    expect(new Set(all).size).toBe(12);
    const seventy = range(70);
    const many = drawStops({ kind: 'victim', result: seventy[33]!, set: seventy, sigma: 123456791 });
    expect(new Set(many).size).toBe(12);
    expect(many.slice(0, 11)).not.toContain(seventy[33]);
  });

  it('FR-322 over every round of the dev map for seeds 1 to 100 both tours keep the properties', () => {
    const rounds = totalRounds(DEV_MAP);
    if (!rounds.ok) throw new Error('dev map has no rounds');
    let victimTours = 0;
    let absorberTours = 0;
    for (let run = 1; run <= 100; run++) {
      const records = getRounds(DEV_MAP, run, rounds.value);
      if (!records.ok) throw new Error('rounds failed');
      for (let k = 1; k <= rounds.value; k++) {
        const state = getState(DEV_MAP, run, k - 1);
        if (!state.ok) throw new Error('state failed');
        const living = livingFactions(DEV_MAP, state.value);
        if (!living.ok) throw new Error('living failed');
        const record = records.value[k - 1]!;
        const sigma = fnv1a32(keyText('debug', k, 'victim'));
        const stops = drawStops({ kind: 'victim', result: record.eliminated, set: living.value, sigma });
        checkStops(stops, living.value, record.eliminated, living.value.length === 2 ? 6 : 12);
        expect(stops).toStrictEqual(referenceStops('victim', record.eliminated, living.value, sigma));
        victimTours++;
        const candidates = absorptionCandidatesOf(DEV_MAP, state.value, record.eliminated);
        if (!candidates.ok) throw new Error('candidates failed');
        expect(candidates.value).toContain(record.absorber);
        if (candidates.value.length >= 2) {
          const sigmaA = fnv1a32(keyText('debug', k, 'absorber'));
          const tour = drawStops({ kind: 'absorber', result: record.absorber, set: candidates.value, sigma: sigmaA });
          checkStops(tour, candidates.value, record.absorber, 6);
          absorberTours++;
        }
      }
    }
    expect(victimTours).toBe(100 * rounds.value);
    expect(absorberTours).toBeGreaterThan(0);
  });

  it('FR-318 the same sigma and set give the same stops in any input order, and another sigma gives others', () => {
    const set = range(9);
    const base = drawStops({ kind: 'victim', result: set[3]!, set, sigma: 1234567891 });
    const reversed = drawStops({ kind: 'victim', result: set[3]!, set: [...set].reverse(), sigma: 1234567891 });
    const rotated = drawStops({ kind: 'victim', result: set[3]!, set: [...set.slice(4), ...set.slice(0, 4)], sigma: 1234567891 });
    const doubled = drawStops({ kind: 'victim', result: set[3]!, set: [...set, ...set], sigma: 1234567891 });
    expect(reversed).toStrictEqual(base);
    expect(rotated).toStrictEqual(base);
    expect(doubled).toStrictEqual(base);
    const other = drawStops({ kind: 'victim', result: set[3]!, set, sigma: 3000000019 });
    expect(other).not.toStrictEqual(base);
    expect(other.at(-1)).toBe(base.at(-1));
  });

  it('FR-322 the input type holds only the kind, the result, the set and sigma', () => {
    expectTypeOf<keyof StopsInput>().toEqualTypeOf<'kind' | 'result' | 'set' | 'sigma'>();
    const input: StopsInput = { kind: 'victim', result: 13, set: [10, 13, 16], sigma: 5 };
    // @ts-expect-error the absorber, a record or a state cannot be passed
    const withExtras: StopsInput = { ...input, absorber: 16, record: {}, state: {}, round: 3 };
    expect(drawStops(withExtras)).toStrictEqual(drawStops(input));
  });
});
