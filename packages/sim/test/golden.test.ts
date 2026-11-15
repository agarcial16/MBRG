import { describe, expect, it } from 'vitest';
import type { MapData } from '@mbrg/shared';
import { getRounds, getState, totalRounds } from '../src/index';
import { initialState } from '../src/internal';
import type { MatchState, RoundRecord } from '../src/types';
import { gridMap, mapFrom, pairMap } from './helpers/maps';

/** 8 territories, one faction each, irregular adjacency with a chord (1-5) and a hub (4). */
const handMap = (): MapData =>
  mapFrom(
    [1, 2, 3, 4, 5, 6, 7, 8],
    [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [4, 6],
      [5, 6],
      [6, 7],
      [7, 8],
      [1, 5],
      [4, 8],
    ],
  );

const REFERENCE_SEED = 42;

function rounds(map: unknown, seed: number, n: number): RoundRecord[] {
  const r = getRounds(map, seed, n);
  if (!r.ok) throw new Error('unexpected failure');
  return r.value;
}

function state(map: unknown, seed: number, n: number): MatchState {
  const r = getState(map, seed, n);
  if (!r.ok) throw new Error('unexpected failure');
  return r.value;
}

function total(map: unknown): number {
  const r = totalRounds(map);
  if (!r.ok) throw new Error('unexpected failure');
  return r.value;
}

const pretty = (x: unknown): string => JSON.stringify(x, null, 2) + '\n';

describe('golden matches (NFR-2, FR-51)', () => {
  // Reproducibility holds only for the same engine version (spec FR-51 / plan §9).
  // Regenerate on purpose with `npx vitest -u` and review the diff.
  it('FR-51 NFR-2 2-faction pair, seed 0 matches the golden file', async () => {
    const map = pairMap();
    const records = rounds(map, 0, total(map));
    await expect(pretty(records)).toMatchFileSnapshot('./golden/pair-seed0.json');
  });

  it('FR-51 2-faction pair also matches a hand-written outcome', () => {
    const records = rounds(pairMap(), 0, 1);
    expect(records).toHaveLength(1);
    const [rec] = records;
    expect(rec!.round).toBe(1);
    expect([10, 20]).toContain(rec!.eliminated);
    expect(rec!.absorber).toBe(rec!.eliminated === 10 ? 20 : 10);
    expect(rec!.transferred).toEqual([rec!.eliminated === 10 ? 1 : 2]);
  });

  it('FR-51 NFR-2 8-territory hand map, seed 42 matches the golden file', async () => {
    const map = handMap();
    const records = rounds(map, REFERENCE_SEED, total(map));
    await expect(pretty(records)).toMatchFileSnapshot('./golden/hand8-seed42.json');
  });

  it('FR-51 NFR-2 5x5 grid, seed 4294967295 matches the golden file', async () => {
    const map = gridMap(5, 5);
    const records = rounds(map, 4294967295, total(map));
    await expect(pretty(records)).toMatchFileSnapshot('./golden/grid5x5-seed4294967295.json');
  });
});

describe('determinism', () => {
  it('FR-54 getState(N) equals the initial state plus records 1..N for every N', () => {
    const map = handMap();
    const t = total(map);
    const all = rounds(map, REFERENCE_SEED, t);
    expect(all).toHaveLength(t);
    for (let n = 0; n <= t; n++) {
      const owners = new Map(initialState(map).owners);
      for (const rec of all.slice(0, n)) {
        for (const id of rec.transferred) owners.set(id, rec.absorber);
      }
      // keep map order: rebuild from the initial pair order
      const expected = initialState(map).owners.map(([id]) => [id, owners.get(id)!]);
      const got = state(map, REFERENCE_SEED, n);
      expect(got).toStrictEqual({ mode: 'classic', round: n, owners: expected });
      // records of N rounds are a prefix of the full list
      expect(rounds(map, REFERENCE_SEED, n)).toStrictEqual(all.slice(0, n));
    }
  });

  it('FR-50 requests 5, 2, 5 and a shuffled order equal fresh requests', () => {
    const map = gridMap(5, 5);
    const seed = 7;
    const fresh = (n: number) => ({
      s: structuredClone(state(map, seed, n)),
      r: structuredClone(rounds(map, seed, n)),
    });
    const expected = new Map<number, ReturnType<typeof fresh>>();
    for (const n of [5, 2, 5, 0, 24, 13, 1, 24, 5]) {
      const again = { s: state(map, seed, n), r: rounds(map, seed, n) };
      const first = expected.get(n);
      if (first) expect(again).toStrictEqual(first);
      else expected.set(n, again);
    }
    // each value also equals a fresh computation made after all the others
    for (const [n, v] of expected) expect(v).toStrictEqual(fresh(n));
    // rewind: every N from the end down to 0 and back up
    const t = total(map);
    for (let n = t; n >= 0; n--) expect(state(map, seed, n)).toStrictEqual(fresh(n).s);
    for (let n = 0; n <= t; n++) expect(rounds(map, seed, n)).toStrictEqual(fresh(n).r);
  });

  it('FR-53 JSON round trip keeps number ids in states and records', () => {
    const map = handMap();
    const t = total(map);
    const s = state(map, REFERENCE_SEED, t);
    const r = rounds(map, REFERENCE_SEED, t);
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
    expect(JSON.parse(JSON.stringify(r))).toStrictEqual(r);
    for (const [id, owner] of s.owners) {
      expect(typeof id).toBe('number');
      expect(typeof owner).toBe('number');
    }
    expect(JSON.stringify(s)).not.toContain('seed');
    expect(JSON.stringify(r)).not.toContain('seed');
  });

  it('FR-7 the match depends on map order: a reordered map differs for some seed', () => {
    // Documented behaviour, not a bug: reordering territories or neighbor lists
    // may change the match, so we assert a difference, never invariance.
    const original = handMap();
    const reordered: MapData = {
      territories: [...original.territories].reverse().map((t) => ({
        ...t,
        neighbors: [...t.neighbors].reverse(),
      })),
    };
    let differing = 0;
    for (let seed = 0; seed < 100; seed++) {
      const a = rounds(original, seed, total(original));
      const b = rounds(reordered, seed, total(reordered));
      if (JSON.stringify(a) !== JSON.stringify(b)) differing++;
    }
    expect(differing).toBeGreaterThan(0);
  });
});
