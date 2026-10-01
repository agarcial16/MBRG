import type { MatchState, Ownership } from '@mbrg/shared';
import { buildAdjacency } from '@mbrg/shared';
import { describe, expect, it } from 'vitest';

import { createInitialMatch, forkMatch, simulate, step } from '../src/engine.js';
import { aeMap, chainMap, islandMap } from './fixtures/maps.js';

function runToEnd(map: typeof aeMap, state: MatchState): MatchState {
  let current = state;
  let guard = 0;
  while (!current.done) {
    current = step(map, current);
    if (++guard > 100) throw new Error('runToEnd exceeded guard');
  }
  return current;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Crafted state: BIG owns 5 provinces, S1 and S2 one each (chain T1..T7). */
function warState(): MatchState {
  return {
    seed: 0,
    weighting: 'uniform',
    rngState: 0,
    owners: { T1: 'BIG', T2: 'BIG', T3: 'BIG', T4: 'BIG', T5: 'BIG', T6: 'S1', T7: 'S2' },
    factions: [
      { id: 'BIG', provinces: ['T1', 'T2', 'T3', 'T4', 'T5'] },
      { id: 'S1', provinces: ['T6'] },
      { id: 'S2', provinces: ['T7'] },
    ],
    round: 0,
    log: [],
    done: false,
    winner: null,
  };
}

describe('createInitialMatch', () => {
  it('gives every territory its own faction', () => {
    const state = createInitialMatch(aeMap, { seed: 1 });
    expect(state.factions).toHaveLength(aeMap.territories.length);
    expect(state.owners).toEqual({
      A: 'A', B: 'B', C: 'C', D: 'D', E: 'E',
    });
    expect(state.round).toBe(0);
    expect(state.done).toBe(false);
    expect(state.winner).toBeNull();
    expect(state.log).toEqual([]);
  });

  it('finishes immediately with a single-territory map', () => {
    const solo = {
      version: 1 as const,
      name: 'solo',
      territories: [{ id: 'X', neighbors: [] as string[], polygons: [[[0, 0], [1, 0], [1, 1]]] }],
    };
    const state = createInitialMatch(solo, { seed: 1 });
    expect(state.done).toBe(true);
    expect(state.winner).toBe('X');
  });

  it('rejects invalid maps and non-integer seeds', () => {
    const asymmetric = {
      version: 1 as const,
      name: 'bad',
      territories: [
        { id: 'A', neighbors: ['B'], polygons: [[[0, 0]], [1, 0], [1, 1]] },
        { id: 'B', neighbors: [] as string[], polygons: [[[2, 0]], [3, 0], [3, 1]] },
      ],
    };
    expect(() => createInitialMatch(asymmetric, { seed: 1 })).toThrow(/Invalid map/);
    expect(() => createInitialMatch(aeMap, { seed: 1.5 })).toThrow(/integer/);
  });
});

describe('simulate (mode Clásico)', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    const a = simulate(aeMap, { seed: 123 });
    const b = simulate(aeMap, { seed: 123 });
    const c = simulate(aeMap, { seed: 999 });
    expect(b).toEqual(a);
    expect(c.log).not.toEqual(a.log);
  });

  it('runs exactly territories - 1 rounds and ends with one winner', () => {
    const final = simulate(aeMap, { seed: 42 });
    expect(final.log).toHaveLength(aeMap.territories.length - 1);
    expect(final.done).toBe(true);
    expect(final.factions).toHaveLength(1);
    expect(final.winner).toBe(final.factions[0].id);

    const owned = final.factions[0].provinces;
    expect([...owned].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('never loses provinces and drops the eliminated faction', () => {
    const total = aeMap.territories.length;
    const final = simulate(aeMap, { seed: 7 });
    let before: Ownership = Object.fromEntries(aeMap.territories.map((t) => [t.id, t.id]));

    for (const event of final.log) {
      expect(Object.keys(event.owners)).toHaveLength(total);

      const counts = new Map<string, number>();
      for (const faction of Object.values(event.owners)) {
        counts.set(faction, (counts.get(faction) ?? 0) + 1);
      }
      expect(counts.has(event.eliminated)).toBe(false);

      const beforeAnnexer = Object.values(before).filter((f) => f === event.annexer).length;
      const afterAnnexer = counts.get(event.annexer) ?? 0;
      expect(afterAnnexer).toBe(beforeAnnexer + event.gained.length);

      before = event.owners;
    }
  });

  it('only annexes through real borders', () => {
    const adjacency = buildAdjacency(aeMap);
    const final = simulate(aeMap, { seed: 7 });
    let owners: Ownership = Object.fromEntries(aeMap.territories.map((t) => [t.id, t.id]));

    for (const event of final.log) {
      const dyingProvinces = Object.entries(owners)
        .filter(([, faction]) => faction === event.eliminated)
        .map(([id]) => id);
      const neighborOwners = new Set<string>();
      for (const province of dyingProvinces) {
        for (const neighbor of adjacency.get(province) ?? []) {
          const owner = owners[neighbor];
          if (owner && owner !== event.eliminated) neighborOwners.add(owner);
        }
      }
      expect(neighborOwners.has(event.annexer)).toBe(true);
      owners = event.owners;
    }
  });
});

describe('step purity', () => {
  it('never mutates the input state (works on frozen objects)', () => {
    const state = deepFreeze(createInitialMatch(aeMap, { seed: 5 }));
    const next = step(aeMap, state);
    expect(next).not.toBe(state);
    expect(state.round).toBe(0);
    expect(state.log).toHaveLength(0);
    expect(next.round).toBe(1);
    expect(next.log).toHaveLength(1);
  });

  it('throws when stepping a finished match', () => {
    const final = simulate(aeMap, { seed: 3 });
    expect(() => step(aeMap, final)).toThrow(/already finished/);
  });
});

describe('islands', () => {
  it('keeps the island safe while it is isolated and still finishes', () => {
    const final = simulate(islandMap, { seed: 11 });
    expect(final.log).toHaveLength(2); // 3 territories → 2 rounds
    expect(final.log[0].eliminated).not.toBe('ISLE');
    expect(final.done).toBe(true);

    // Last round is the maritime fallback: ISLE is one of the two survivors.
    const last = final.log[1];
    expect([last.eliminated, last.annexer]).toContain('ISLE');
  });

  it('una provincia con mainland e isla es una sola y se conquista de golpe', () => {
    // A split province used to be reported as two, which let a faction be
    // annexed halfway — from wherever the enemy happened to be standing.
    const map: MapFormatV1 = {
      version: 1,
      name: 'mainland-plus-island',
      territories: [
        {
          id: 'A',
          neighbors: ['B'],
          polygons: [
            [
              [0, 0],
              [40, 0],
              [40, 40],
              [0, 40],
            ],
            [
              [400, 0],
              [404, 0],
              [404, 4],
              [400, 4],
            ],
          ],
        },
        {
          id: 'B',
          neighbors: ['A'],
          polygons: [
            [
              [40, 0],
              [80, 0],
              [80, 40],
              [40, 40],
            ],
          ],
        },
      ],
    };
    const final = simulate(map, { seed: 4 });
    expect(final.log).toHaveLength(1); // 2 provinces → 1 round, not 2
    expect(final.log[0].gained).toHaveLength(1);
    expect(final.winner).toBe(final.log[0].annexer);
  });
});

describe('weighting', () => {
  it("'provinces' makes big factions fall more often than 'uniform'", () => {
    const N = 80;
    let uniformBig = 0;
    let weightedBig = 0;
    for (let seed = 1; seed <= N; seed++) {
      const base = warState();
      const uniform = step(chainMap, { ...base, rngState: seed, weighting: 'uniform' });
      const weighted = step(chainMap, { ...base, rngState: seed, weighting: 'provinces' });
      if (uniform.log[0].eliminated === 'BIG') uniformBig++;
      if (weighted.log[0].eliminated === 'BIG') weightedBig++;
    }
    // Expected: ~1/3 (~27) vs ~5/7 (~57) of N.
    expect(uniformBig).toBeLessThan(45);
    expect(weightedBig).toBeGreaterThan(45);
    expect(weightedBig).toBeGreaterThan(uniformBig);
  });
});

describe('forkMatch', () => {
  it('keeps the past and re-rolls the future', () => {
    let state = createInitialMatch(aeMap, { seed: 1000 });
    state = step(aeMap, state);
    state = step(aeMap, state);
    expect(state.log).toHaveLength(2);

    const originalEnd = runToEnd(aeMap, state);
    const forkedEnd = runToEnd(aeMap, forkMatch(state, 999));

    expect(forkedEnd.seed).toBe(999);
    expect(forkedEnd.log.slice(0, 2)).toEqual(state.log);
    expect(originalEnd.log.slice(0, 2)).toEqual(state.log);
    expect(forkedEnd.log).not.toEqual(originalEnd.log);

    // Both inputs stayed untouched.
    expect(state.log).toHaveLength(2);
    expect(state.done).toBe(false);
  });

  it('rejects forking a finished match or a non-integer seed', () => {
    const final = simulate(aeMap, { seed: 1 });
    expect(() => forkMatch(final, 2)).toThrow(/finished/);
    const open = createInitialMatch(aeMap, { seed: 1 });
    expect(() => forkMatch(open, 1.5)).toThrow(/integer/);
  });
});
