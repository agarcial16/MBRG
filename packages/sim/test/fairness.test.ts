import { describe, expect, it } from 'vitest';
import { getRounds, getState } from '../src/index';
import type { RoundRecord } from '../src/types';
import { mapFrom } from './helpers/maps';

// 6-ring plus one chord (1-4): factions 1 and 4 have 3 neighbor factions, the rest 2.
const EDGES: [number, number][] = [
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 1],
  [1, 4],
];
const map = mapFrom([1, 2, 3, 4, 5, 6], EDGES);
const SEEDS = 10_000;

function neighborsOf(f: number): number[] {
  const out: number[] = [];
  for (const [a, b] of EDGES) {
    if (a === f) out.push(b);
    if (b === f) out.push(a);
  }
  return out;
}

function rounds(seed: number, n: number): RoundRecord[] {
  const r = getRounds(map, seed, n);
  if (!r.ok) throw new Error('unexpected failure');
  return r.value;
}

describe('NFR-5 fairness over seeds 0..9,999 (deterministic: fixed seed range)', () => {
  const records = Array.from({ length: SEEDS }, (_, seed) => rounds(seed, 2));

  it('NFR-5 (a) round 1: eliminated position among living factions is uniform within 3 pp', () => {
    const counts = new Array<number>(6).fill(0);
    for (const rec of records) counts[rec[0]!.eliminated - 1]!++; // round 1: position = faction - 1
    for (const c of counts) expect(Math.abs((c / SEEDS) * 100 - 100 / 6)).toBeLessThanOrEqual(3);
  });

  it('NFR-5 (a) round 2: eliminated position among living factions is uniform within 3 pp', () => {
    const counts = new Array<number>(5).fill(0);
    for (let seed = 0; seed < SEEDS; seed++) {
      const s = getState(map, seed, 1);
      if (!s.ok) throw new Error('unexpected failure');
      const living: number[] = [];
      for (const [, f] of s.value.owners) if (!living.includes(f)) living.push(f);
      expect(living).toHaveLength(5);
      counts[living.indexOf(records[seed]![1]!.eliminated)]!++;
    }
    for (const c of counts) expect(Math.abs((c / SEEDS) * 100 - 20)).toBeLessThanOrEqual(3);
  });

  it('NFR-5 (b) round 1: absorber is uniform over neighbor factions within 5 pp, conditioned on the eliminated faction', () => {
    for (let f = 1; f <= 6; f++) {
      const neighbors = neighborsOf(f);
      expect(neighbors.length).toBeGreaterThanOrEqual(2);
      const hits = records.filter((r) => r[0]!.eliminated === f);
      expect(hits.length).toBeGreaterThan(0);
      const counts = new Map<number, number>(neighbors.map((n) => [n, 0]));
      for (const r of hits) {
        expect(counts.has(r[0]!.absorber)).toBe(true);
        counts.set(r[0]!.absorber, counts.get(r[0]!.absorber)! + 1);
      }
      for (const c of counts.values()) {
        expect(Math.abs((c / hits.length) * 100 - 100 / neighbors.length)).toBeLessThanOrEqual(5);
      }
    }
  });
});
