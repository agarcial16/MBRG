import { describe, expect, it } from 'vitest';
import { getRounds } from '../src/index';
import { absorptionCandidates } from '../src/candidates';
import { initialState } from '../src/internal';
import { land, sea, seaMapFrom } from './helpers/sea-maps';

// Plan section 8: E(1) touches L(2) by land, S(3) only through two shared zones, B(4) both ways.
const E = 1;
const L = 2;
const S = 3;
const B = 4;
const map = seaMapFrom(
  [land(1, E), land(2, L), land(3, S), land(4, B), sea(5), sea(6)],
  [[1, 2], [1, 4], [1, 5], [1, 6], [3, 5], [3, 6], [4, 5]],
);
const SEEDS = 10_000;

describe('NFR-10 fairness through the sea over seeds 0..9,999 (deterministic: fixed seed range)', () => {
  it('NFR-10 round 0: the candidates of E are direct and exactly L, S and B in faction order', () => {
    expect(absorptionCandidates(map, initialState(map), E)).toStrictEqual({ how: 'direct', factions: [L, S, B] });
  });

  it('NFR-10 round 1: the absorber is uniform over the 3 candidates within 5 pp, no double counting of B', () => {
    const absorbers: number[] = [];
    for (let seed = 0; seed < SEEDS; seed++) {
      const r = getRounds(map, seed, 1);
      if (!r.ok) throw new Error('unexpected failure');
      if (r.value[0]!.eliminated === E) absorbers.push(r.value[0]!.absorber);
    }
    expect(absorbers.length).toBeGreaterThan(2000);
    for (const f of [L, S, B]) {
      const share = (absorbers.filter((a) => a === f).length / absorbers.length) * 100;
      expect(Math.abs(share - 100 / 3), `faction ${f} share ${share}`).toBeLessThanOrEqual(5);
    }
    expect(absorbers.every((a) => [L, S, B].includes(a))).toBe(true);
  });
});
