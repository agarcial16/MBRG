import { describe, expect, it } from 'vitest';
import type { MapData } from '@mbrg/shared';
import { validateMap } from '@mbrg/shared';
import { initialState, livingFactions, neighborFactions, ownerOf, playRound } from '../src/internal';
import type { MatchState } from '../src/types';
import { MODE } from '../src/types';
import { gridMap, lineMap, mapFrom, pairMap, ringMap } from './helpers/maps';

const stateOf = (round: number, owners: [number, number][]): MatchState => ({
  mode: 'classic',
  round,
  owners,
});

function play(map: MapData, state: MatchState, seed: number) {
  const r = playRound(map, state, seed);
  if (!r.ok) throw new Error('unexpected error ' + JSON.stringify(r.errors));
  return r.value;
}

describe('round engine', () => {
  it('FR-30 the mode identifier is classic', () => {
    expect(MODE).toBe('classic');
  });

  it('FR-33 initialState is round 0 with the initial owners in map order', () => {
    const map = mapFrom([7, 8, 7 + 0, 9], [[1, 2]]);
    expect(initialState(map)).toStrictEqual({
      mode: 'classic',
      round: 0,
      owners: [
        [1, 7],
        [2, 8],
        [3, 7],
        [4, 9],
      ],
    });
  });

  it('FR-34 ownerOf finds the owner by territory id; unknown id is undefined', () => {
    const s = stateOf(0, [
      [5, 100],
      [9, 200],
    ]);
    expect(ownerOf(s, 9)).toBe(200);
    expect(ownerOf(s, 5)).toBe(100);
    expect(ownerOf(s, 6)).toBeUndefined();
  });

  it('FR-34 state has no per-faction territory list', () => {
    expect(Object.keys(initialState(lineMap())).sort()).toStrictEqual(['mode', 'owners', 'round']);
  });

  it('FR-35 FR-37 FR-40 two-faction map has one possible outcome whatever the seed', () => {
    const map = pairMap();
    const outcomes = new Set<string>();
    for (const seed of [0, 1, 2, 3, 99, 4294967295]) {
      const { state, record } = play(map, initialState(map), seed);
      expect(state.owners.map(([, f]) => f)).toStrictEqual([state.owners[0]![1], state.owners[0]![1]]);
      expect(state.round).toBe(1);
      expect(record.round).toBe(1);
      expect(record.transferred).toHaveLength(1);
      outcomes.add(`${record.eliminated}>${record.absorber}`);
      expect([record.eliminated, record.absorber].sort()).toStrictEqual([10, 20]);
    }
    expect(outcomes.size).toBeGreaterThan(0);
    expect(outcomes.size).toBeLessThanOrEqual(2);
  });

  it('FR-35 the same (map, state, seed) gives the same result', () => {
    const map = gridMap(4, 4);
    const a = play(map, initialState(map), 123);
    const b = play(map, initialState(map), 123);
    expect(b).toStrictEqual(a);
  });

  it('FR-35 eliminated faction is a living one and every living faction can be chosen', () => {
    const map = ringMap();
    const seen = new Set<number>();
    for (let seed = 0; seed < 300; seed++) {
      const { record } = play(map, initialState(map), seed);
      expect([1, 2, 3, 4, 5, 6]).toContain(record.eliminated);
      seen.add(record.eliminated);
    }
    expect(seen.size).toBe(6);
  });

  it('FR-36 absorber is always a living neighbor faction of the eliminated one', () => {
    const map = gridMap(4, 4);
    for (let seed = 0; seed < 200; seed++) {
      const { record } = play(map, initialState(map), seed);
      const nbrs = neighborFactions(map, initialState(map), record.eliminated);
      expect(nbrs).toContain(record.absorber);
      expect(record.absorber).not.toBe(record.eliminated);
    }
  });

  it('FR-36 neighbor factions are the union over all territories of the faction, in faction order', () => {
    // Line 1-2-3-4. Faction 1 owns {1,4}: neighbors 2 (via 1) and 3 (via 4).
    const map = lineMap();
    const s = stateOf(0, [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 1],
    ]);
    expect(neighborFactions(map, s, 1)).toStrictEqual([2, 3]);
    // Faction 2 touches 1 (owner 1) and 3 (owner 3).
    expect(neighborFactions(map, s, 2)).toStrictEqual([1, 3]);
  });

  it('FR-36 neighbor order follows faction order in the current state, not initial order', () => {
    // Territories 1..4, owners [A=1,B=2,C=3,D=4]; ring-ish via edges.
    // Faction 3 owns {1,3}: first territory is 1, so it comes before faction 2.
    const map = mapFrom(
      [1, 2, 3, 4],
      [
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 1],
      ],
    );
    const s = stateOf(1, [
      [1, 3],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(livingFactions(s)).toStrictEqual([3, 2, 4]);
    expect(neighborFactions(map, s, 4)).toStrictEqual([3]);
    expect(neighborFactions(map, s, 2)).toStrictEqual([3]);
  });

  it('FR-36 the neighbor relation counts mutual links only', () => {
    // 1 lists 2, but 2 does not list 1: not a neighbor.
    const map: MapData = {
      territories: [
        { id: 1, owner: 1, neighbors: [2] },
        { id: 2, owner: 2, neighbors: [] },
      ],
    };
    expect(neighborFactions(map, initialState(map), 1)).toStrictEqual([]);
  });

  it('FR-37 FR-40 only the eliminated territories change owner; transferred is in map order', () => {
    const map = lineMap();
    const s = stateOf(1, [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 1],
    ]);
    for (let seed = 0; seed < 50; seed++) {
      const { state, record } = play(map, s, seed);
      const expected = s.owners
        .filter(([, f]) => f === record.eliminated)
        .map(([t]) => t);
      expect(record.transferred).toStrictEqual(expected);
      for (const [i, [t, f]] of s.owners.entries()) {
        const [t2, f2] = state.owners[i]!;
        expect(t2).toBe(t);
        expect(f2).toBe(expected.includes(t) ? record.absorber : f);
      }
      expect(state.round).toBe(2);
      expect(record.round).toBe(2);
      expect(livingFactions(state)).toHaveLength(2);
    }
  });

  it('FR-37 accumulated territories move together when an absorber is later eliminated', () => {
    // Faction 2 already absorbed territory 1 (round 1): it owns {1, 2}.
    const map = lineMap();
    const s = stateOf(1, [
      [1, 2],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    let sawAccumulated = false;
    for (let seed = 0; seed < 60; seed++) {
      const { state, record } = play(map, s, seed);
      if (record.eliminated === 2) {
        sawAccumulated = true;
        expect(record.transferred).toStrictEqual([1, 2]);
        expect(record.absorber).toBe(3);
        expect(ownerOf(state, 1)).toBe(3);
        expect(ownerOf(state, 2)).toBe(3);
      }
    }
    expect(sawAccumulated).toBe(true);
  });

  it('FR-38 isolated faction -> error with faction and round, no partial state', () => {
    // Two disconnected pairs: only error is disconnected-map.
    const map = mapFrom(
      [1, 2, 3, 4],
      [
        [1, 2],
        [3, 4],
      ],
    );
    const v = validateMap(map);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.map((e) => e.kind)).toStrictEqual(['disconnected-map']);
    // Hand-built state: factions 1 and 2 merged into 1 (isolated from 3,4 group)... make faction 1 own {1,2}.
    const s = stateOf(4, [
      [1, 1],
      [2, 1],
      [3, 3],
      [4, 4],
    ]);
    const results = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const r = playRound(map, s, seed);
      if (!r.ok) {
        expect(r.errors).toHaveLength(1);
        const e = r.errors[0]!;
        expect(e.kind).toBe('isolated-faction');
        if (e.kind === 'isolated-faction') {
          expect(e.round).toBe(5);
          expect(e.faction).toBe(1);
        }
        expect('value' in r).toBe(false);
        results.add('err');
      } else {
        results.add('ok');
      }
    }
    expect(results.has('err')).toBe(true);
    expect(s.round).toBe(4);
  });

  it('FR-39 playRound does not mutate its inputs', () => {
    const map = gridMap(3, 3);
    const s = initialState(map);
    const mapCopy = structuredClone(map);
    const sCopy = structuredClone(s);
    play(map, s, 9);
    expect(map).toStrictEqual(mapCopy);
    expect(s).toStrictEqual(sCopy);
  });

  it('FR-39 playRound rejects a state with fewer than 2 living factions', () => {
    const map = pairMap();
    const s = stateOf(1, [
      [1, 10],
      [2, 10],
    ]);
    expect(() => playRound(map, s, 0)).toThrow();
  });

  it('FR-49 neither state nor record contains the seed', () => {
    const map = gridMap(3, 3);
    const seed = 987654321;
    const { state, record } = play(map, initialState(map), seed);
    for (const x of [state, record, initialState(map)]) {
      expect(Object.keys(x)).not.toContain('seed');
      expect(JSON.stringify(x)).not.toContain(String(seed));
    }
    expect(Object.keys(record).sort()).toStrictEqual(['absorber', 'eliminated', 'round', 'transferred']);
  });
});
