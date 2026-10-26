import { describe, expect, it } from 'vitest';
import { validateMap } from '@mbrg/shared';
import type { MapData } from '@mbrg/shared';
import * as api from '../src/index';
import { absorptionCandidatesOf, getState, livingFactions, playRoundWithSeed, totalRounds } from '../src/index';
import { absorptionCandidates } from '../src/candidates';
import { livingFactions as internalLivingFactions } from '../src/factions';
import { initialState, playRound } from '../src/internal';
import type { MatchState } from '../src/types';
import { gridMap, mapFrom, pairMap } from './helpers/maps';
import { denmarkMap, isleMap, japanMap, oceanMap } from './helpers/sea-maps';

/** The 8-territory hand map of golden.test.ts (chord 1-5, hub 4). */
const handMap = (): MapData =>
  mapFrom([1, 2, 3, 4, 5, 6, 7, 8], [[1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [5, 6], [6, 7], [7, 8], [1, 5], [4, 8]]);

const GOLDEN_MAPS: [string, () => MapData][] = [
  ['pair', pairMap],
  ['hand8', handMap],
  ['grid5x5', () => gridMap(5, 5)],
  ['isle', isleMap],
  ['denmark', denmarkMap],
  ['ocean', oceanMap],
  ['japan', japanMap],
];

const SEEDS = [0, 7, 4294967295];

function total(map: unknown): number {
  const t = totalRounds(map);
  if (!t.ok) throw new Error('unexpected failure');
  return t.value;
}
function stateAt(map: unknown, seed: number, round: number): MatchState {
  const s = getState(map, seed, round);
  if (!s.ok) throw new Error('unexpected failure');
  return s.value;
}
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
const mapErrors = (map: unknown) => {
  const v = validateMap(map);
  if (v.ok) throw new Error('expected an invalid map');
  return v.errors;
};

describe('FR-313 playRoundWithSeed errors', () => {
  const grid = gridMap(4, 4);

  it('FR-313 reports map errors, invalid-state and invalid-seed together, in that order', () => {
    expect(playRoundWithSeed(grid, 'x', 'y')).toStrictEqual({
      ok: false,
      errors: [{ kind: 'invalid-state' }, { kind: 'invalid-seed' }],
    });
    const bad = { territories: 'x' };
    expect(mapErrors(bad).length).toBeGreaterThan(0);
    // With an invalid map the state cannot be checked against it: map errors, then the seed error.
    expect(playRoundWithSeed(bad, 'x', -1)).toStrictEqual({
      ok: false,
      errors: [...mapErrors(bad), { kind: 'invalid-seed' }],
    });
    expect(playRoundWithSeed(bad, initialState(grid), 5)).toStrictEqual({ ok: false, errors: mapErrors(bad) });
  });

  it('FR-313 an invalid state alone gives one invalid-state; an invalid seed alone gives one invalid-seed', () => {
    const fresh = structuredClone(initialState(grid));
    expect(playRoundWithSeed(grid, { ...fresh, mode: 'x' }, 1)).toStrictEqual({ ok: false, errors: [{ kind: 'invalid-state' }] });
    for (const seed of [-1, 4294967296, 1.5, NaN, '1', null, undefined, 10n]) {
      expect(playRoundWithSeed(grid, fresh, seed), String(seed)).toStrictEqual({ ok: false, errors: [{ kind: 'invalid-seed' }] });
    }
  });

  it('FR-313 seeds 0, -0 and 2^32 - 1 are accepted and -0 equals 0', () => {
    const s0 = initialState(grid);
    expect(playRoundWithSeed(grid, s0, -0)).toStrictEqual(playRoundWithSeed(grid, s0, 0));
    expect(playRoundWithSeed(grid, s0, 4294967295).ok).toBe(true);
  });

  it('FR-313 at round T the step gives round-out-of-range with round T + 1 and total T', () => {
    for (const [name, make] of GOLDEN_MAPS) {
      const map = make();
      const t = total(map);
      expect(playRoundWithSeed(map, stateAt(map, 3, t), 3), name).toStrictEqual({
        ok: false,
        errors: [{ kind: 'round-out-of-range', round: t + 1, total: t }],
      });
    }
  });

  it('FR-313 a state with fewer than 2 living factions before round T gives round-out-of-range', () => {
    const owners = initialState(grid).owners.map(([t]): [number, number] => [t, 1]);
    const state: MatchState = { mode: 'classic', round: 3, owners };
    expect(playRoundWithSeed(grid, state, 9)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'round-out-of-range', round: 4, total: 15 }],
    });
  });

  it('FR-313 an invalid seed and a finished state are reported together, the range error last', () => {
    const done = stateAt(grid, 0, 15);
    expect(playRoundWithSeed(grid, done, 'x')).toStrictEqual({
      ok: false,
      errors: [{ kind: 'invalid-seed' }, { kind: 'round-out-of-range', round: 16, total: 15 }],
    });
  });

  it('FR-313 the lonely map of language.test.ts is a disconnected map: the wrapper reports its map error, never isolated-faction', () => {
    // isolated-faction needs a map that validateMap refuses (an unreachable faction), so through the
    // validated wrapper the map error comes first; the internal step still returns isolated-faction.
    const lonely = mapFrom([1, 2, 3], [[1, 2]]);
    let internalIsolated = 0;
    for (let seed = 0; seed < 50; seed++) {
      const r = playRoundWithSeed(lonely, initialState(lonely), seed);
      expect(r).toStrictEqual({ ok: false, errors: mapErrors(lonely) });
      expect(mapErrors(lonely).map((e) => e.kind)).toStrictEqual(['disconnected-map']);
      const internal = playRound(lonely, initialState(lonely), seed);
      if (!internal.ok && internal.errors[0]?.kind === 'isolated-faction') internalIsolated++;
    }
    expect(internalIsolated).toBeGreaterThan(0);
  });
});

describe('FR-313 playRoundWithSeed equals the internal step', () => {
  it('FR-313 equals playRound on 200 or more (state, seed) pairs of the golden maps', () => {
    let pairs = 0;
    for (const [name, make] of GOLDEN_MAPS) {
      const map = make();
      const t = total(map);
      for (const gameSeed of SEEDS) {
        for (let r = 0; r < t; r++) {
          const state = stateAt(map, gameSeed, r);
          for (const roundSeed of [0, 1, 99, 4294967295]) {
            const got = playRoundWithSeed(map, state, roundSeed);
            const want = playRound(validated(map), state, roundSeed);
            expect(got, `${name} r${r} s${roundSeed}`).toStrictEqual(want);
            pairs++;
          }
        }
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(200);
  });

  it('FR-313 does not mutate a deep-frozen input and does not alias it in the result', () => {
    const map = deepFreeze(gridMap(4, 4));
    const state = deepFreeze(structuredClone(stateAt(map, 0, 2)));
    const r = playRoundWithSeed(map, state, 12345);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.owners).not.toBe(state.owners);
    expect(r.value.state.round).toBe(3);
    expect(state).toStrictEqual(stateAt(map, 0, 2));
  });
});

function validated(map: unknown): MapData {
  const v = validateMap(map);
  if (!v.ok) throw new Error('unexpected failure');
  return v.value;
}

describe('FR-313 absorptionCandidatesOf', () => {
  it('FR-313 equals the internal candidates (factions only) for every living faction of every golden state', () => {
    let checked = 0;
    for (const [name, make] of GOLDEN_MAPS) {
      const map = make();
      const data = validated(map);
      const t = total(map);
      for (const seed of SEEDS) {
        for (let r = 0; r < t; r++) {
          const state = stateAt(map, seed, r);
          for (const f of internalLivingFactions(state)) {
            const got = absorptionCandidatesOf(map, state, f);
            expect(got, `${name} r${r} f${f}`).toStrictEqual({ ok: true, value: absorptionCandidates(data, state, f).factions });
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('FR-313 the value is the plain list of factions: no how field', () => {
    const map = gridMap(3, 3);
    const r = absorptionCandidatesOf(map, initialState(map), 5);
    expect(r).toStrictEqual({ ok: true, value: [2, 4, 6, 8] });
    if (!r.ok) return;
    expect(Array.isArray(r.value)).toBe(true);
    expect(Object.keys(r.value)).toStrictEqual(['0', '1', '2', '3']);
    expect('how' in r.value).toBe(false);
  });

  it('FR-313 a map faction that owns nothing gives an empty list and does not throw', () => {
    const map = gridMap(4, 4);
    const after = stateAt(map, 0, 1);
    const dead = initialState(map).owners.map(([, f]) => f).find((f) => !internalLivingFactions(after).includes(f));
    expect(dead).toBeDefined();
    expect(() => absorptionCandidatesOf(map, after, dead)).not.toThrow();
    expect(absorptionCandidatesOf(map, after, dead)).toStrictEqual({ ok: true, value: [] });
  });

  it('FR-313 a faction that is not a faction of the map gives invalid-faction', () => {
    const map = gridMap(4, 4);
    const state = initialState(map);
    for (const f of [0, 17, 99, 1.5, -1, NaN, '1', null, undefined, {}, 10n]) {
      expect(absorptionCandidatesOf(map, state, f), String(f)).toStrictEqual({ ok: false, errors: [{ kind: 'invalid-faction' }] });
    }
  });

  it('FR-313 reports map errors, invalid-state and invalid-faction together, in that order', () => {
    const map = gridMap(4, 4);
    expect(absorptionCandidatesOf(map, null, 'x')).toStrictEqual({
      ok: false,
      errors: [{ kind: 'invalid-state' }, { kind: 'invalid-faction' }],
    });
    const bad = { territories: 'x' };
    expect(absorptionCandidatesOf(bad, initialState(map), 1)).toStrictEqual({ ok: false, errors: mapErrors(bad) });
    expect(absorptionCandidatesOf(map, initialState(map), 1).ok).toBe(true);
  });

  it('FR-313 a state at round T is a valid state here and gives the candidates of its one faction', () => {
    const map = gridMap(3, 3);
    const done = stateAt(map, 5, 8);
    const [only] = internalLivingFactions(done);
    expect(absorptionCandidatesOf(map, done, only)).toStrictEqual({ ok: true, value: [] });
  });

  it('FR-313 does not mutate a deep-frozen input', () => {
    const map = deepFreeze(gridMap(3, 3));
    const state = deepFreeze(structuredClone(initialState(map)));
    expect(absorptionCandidatesOf(map, state, 1).ok).toBe(true);
    expect(state).toStrictEqual(initialState(gridMap(3, 3)));
  });
});

describe('FR-313 livingFactions', () => {
  it('FR-313 equals the internal function for every golden state', () => {
    for (const [name, make] of GOLDEN_MAPS) {
      const map = make();
      for (const seed of SEEDS) {
        for (let r = 0; r <= total(map); r++) {
          const state = stateAt(map, seed, r);
          expect(livingFactions(map, state), `${name} r${r}`).toStrictEqual({ ok: true, value: internalLivingFactions(state) });
        }
      }
    }
  });

  it('FR-313 an invalid state gives invalid-state; an invalid map gives its errors', () => {
    const map = gridMap(4, 4);
    expect(livingFactions(map, 5)).toStrictEqual({ ok: false, errors: [{ kind: 'invalid-state' }] });
    expect(livingFactions(map, { mode: 'classic', round: 0, owners: [] })).toStrictEqual({ ok: false, errors: [{ kind: 'invalid-state' }] });
    const bad = { territories: 'x' };
    expect(livingFactions(bad, initialState(map))).toStrictEqual({ ok: false, errors: mapErrors(bad) });
  });

  it('FR-313 returns a fresh list on every call', () => {
    const map = gridMap(3, 3);
    const a = livingFactions(map, initialState(map));
    const b = livingFactions(map, initialState(map));
    expect(a).toStrictEqual(b);
    if (a.ok && b.ok) expect(a.value).not.toBe(b.value);
  });
});

describe('NFR-55 the sim export list', () => {
  it('NFR-55 FR-313 the public exports are exactly the 8 names and absorptionCandidates stays internal', () => {
    expect(Object.keys(api).sort()).toStrictEqual([
      'MODE',
      'absorptionCandidatesOf',
      'getRounds',
      'getState',
      'livingFactions',
      'ownerOf',
      'playRoundWithSeed',
      'totalRounds',
    ]);
    expect(Object.keys(api)).not.toContain('absorptionCandidates');
  });
});

describe('NFR-51 the exports module is pure', () => {
  const files = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const source = files['../src/exports.ts'];
  const FORBIDDEN = /\b(Date|crypto|performance|process|globalThis|fetch|setTimeout|setInterval|require)\b|Math\s*\.\s*random|\bnode:/;
  const codeOf = (src: string): string => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('NFR-51 exports.ts is among the sim sources the purity scan reads, and it is clean', () => {
    expect(source).toBeDefined();
    expect(codeOf(source ?? '')).not.toMatch(FORBIDDEN);
  });

  it('NFR-51 the scan catches a clock, a random call or a Node import planted in a copy', () => {
    for (const planted of ['const t = Date.now();', 'const r = Math.random();', "import { x } from 'node:crypto';", 'const c = crypto;']) {
      expect(codeOf((source ?? '') + '\n' + planted)).toMatch(FORBIDDEN);
    }
    expect(codeOf('// Date.now()\n/* crypto */')).not.toMatch(FORBIDDEN);
  });
});
