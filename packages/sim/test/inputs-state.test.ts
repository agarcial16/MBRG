import { describe, expect, it } from 'vitest';
import type { MapData } from '@mbrg/shared';
import { getState, totalRounds } from '../src/index';
import { checkFaction, checkState } from '../src/inputs';
import { initialState } from '../src/internal';
import type { MatchState } from '../src/types';
import { gridMap, mapFrom, pairMap } from './helpers/maps';
import { denmarkMap, isleMap, japanMap, oceanMap } from './helpers/sea-maps';

/** The 8-territory hand map of golden.test.ts (chord 1-5, hub 4). */
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

const GOLDEN_MAPS: [string, () => MapData][] = [
  ['pair', pairMap],
  ['hand8', handMap],
  ['grid5x5', () => gridMap(5, 5)],
  ['isle', isleMap],
  ['denmark', denmarkMap],
  ['ocean', oceanMap],
  ['japan', japanMap],
];

const INVALID_STATE = { ok: false, errors: [{ kind: 'invalid-state' }] };
const INVALID_FACTION = { ok: false, errors: [{ kind: 'invalid-faction' }] };

/** A fresh, mutable round-0 state of the 4x4 grid (factions 1..16, T = 15). */
const grid = gridMap(4, 4);
const fresh = (): MatchState => structuredClone(initialState(grid));
const bad = (state: unknown, map: MapData = grid) => checkState(map, state);

describe('FR-313 checkState accepts the valid states', () => {
  it.each(GOLDEN_MAPS)('FR-313 accepts getState(map, seed, r).value for every round of the %s map', (_name, make) => {
    const map = make();
    const t = totalRounds(map);
    if (!t.ok) throw new Error('unexpected failure');
    for (const seed of [0, 7, 4294967295]) {
      for (let r = 0; r <= t.value; r++) {
        const s = getState(map, seed, r);
        if (!s.ok) throw new Error('unexpected failure');
        const checked = checkState(map, s.value);
        expect(checked).toStrictEqual({ ok: true, value: s.value });
      }
    }
  });

  it('FR-313 accepts -0 as the round and normalises it to 0', () => {
    const r = checkState(grid, { ...fresh(), round: -0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.is(r.value.round, 0)).toBe(true);
  });

  it('FR-313 accepts round T and rejects T + 1 (T = 15 on the 4x4 grid)', () => {
    expect(checkState(grid, { ...fresh(), round: 15 }).ok).toBe(true);
    expect(bad({ ...fresh(), round: 16 })).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 the checked value is a copy: changing it never changes the input', () => {
    const input = fresh();
    const before = structuredClone(input);
    const r = checkState(grid, input);
    if (!r.ok) throw new Error('unexpected failure');
    expect(r.value).not.toBe(input);
    expect(r.value.owners).not.toBe(input.owners);
    expect(r.value.owners[0]).not.toBe(input.owners[0]);
    r.value.owners[0]![1] = 99;
    r.value.round = 5;
    expect(input).toStrictEqual(before);
  });

  it('FR-313 a deep-frozen valid state is accepted and left untouched', () => {
    const input = fresh();
    for (const pair of input.owners) Object.freeze(pair);
    Object.freeze(input.owners);
    Object.freeze(input);
    expect(checkState(grid, input).ok).toBe(true);
  });
});

describe('FR-313 checkState rejects with one invalid-state error', () => {
  it('FR-313 rejects a missing own key, one at a time', () => {
    for (const key of ['mode', 'round', 'owners'] as const) {
      const s: Record<string, unknown> = { ...fresh() };
      delete s[key];
      expect(bad(s), key).toStrictEqual(INVALID_STATE);
    }
  });

  it('FR-313 rejects an extra own key (enumerable, non-enumerable and symbol)', () => {
    expect(bad({ ...fresh(), seed: 1 })).toStrictEqual(INVALID_STATE);
    const hidden = fresh();
    Object.defineProperty(hidden, 'hidden', { value: 1, enumerable: false });
    expect(bad(hidden)).toStrictEqual(INVALID_STATE);
    const sym = fresh() as unknown as Record<symbol, unknown>;
    sym[Symbol('x')] = 1;
    expect(bad(sym)).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 own-property rule: keys that are only inherited do not count', () => {
    const proto = fresh();
    const inheritedAll = Object.create(proto) as unknown;
    expect(bad(inheritedAll)).toStrictEqual(INVALID_STATE);
    const ownTwoInheritOne = Object.create({ owners: proto.owners });
    ownTwoInheritOne.mode = 'classic';
    ownTwoInheritOne.round = 0;
    expect(bad(ownTwoInheritOne)).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 own-property rule: a getter is not a data property', () => {
    const s = fresh();
    const withGetter = {
      mode: 'classic',
      get round() {
        return 0;
      },
      owners: s.owners,
    };
    expect(bad(withGetter)).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 own-property rule: an owners array with an inherited or missing pair is rejected', () => {
    const s = fresh();
    const sparse = [...s.owners] as unknown[];
    delete sparse[3]; // a hole, not an own element
    expect(bad({ ...s, owners: sparse })).toStrictEqual(INVALID_STATE);
    const holePair = [1] as unknown[];
    holePair.length = 2; // [1, <hole>]
    expect(bad({ ...s, owners: [holePair, ...s.owners.slice(1)] })).toStrictEqual(INVALID_STATE);
  });

  it.each([null, undefined, 0, 'classic', true, [], [fresh()], () => fresh()])(
    'FR-313 rejects the non-object state %s',
    (value) => {
      expect(bad(value)).toStrictEqual(INVALID_STATE);
    },
  );

  it.each(['Classic', 'CLASSIC', 'Clásico', '', 'classic ', 'x', 1, null, undefined, ['classic']])(
    'FR-313 rejects the mode %s',
    (mode) => {
      expect(bad({ ...fresh(), mode })).toStrictEqual(INVALID_STATE);
    },
  );

  it.each([-1, -0.5, 1.5, 0.1, '0', '1', '', NaN, Infinity, -Infinity, 16, 17, 2 ** 53, null, undefined, [], {}, true])(
    'FR-313 rejects the round %s',
    (round) => {
      expect(bad({ ...fresh(), round })).toStrictEqual(INVALID_STATE);
    },
  );

  it.each([null, undefined, {}, 'owners', 16, { length: 16 }])('FR-313 rejects owners that is not an array: %s', (owners) => {
    expect(bad({ ...fresh(), owners })).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 rejects owners in another order (two pairs swapped, reversed, rotated)', () => {
    const s = fresh();
    const swapped = structuredClone(s.owners);
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(bad({ ...s, owners: swapped })).toStrictEqual(INVALID_STATE);
    expect(bad({ ...s, owners: [...s.owners].reverse() })).toStrictEqual(INVALID_STATE);
    expect(bad({ ...s, owners: [...s.owners.slice(1), s.owners[0]] })).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 rejects a missing territory and an extra territory (same count rules)', () => {
    const s = fresh();
    expect(bad({ ...s, owners: s.owners.slice(1) })).toStrictEqual(INVALID_STATE);
    expect(bad({ ...s, owners: s.owners.slice(0, -1) })).toStrictEqual(INVALID_STATE);
    expect(bad({ ...s, owners: [] })).toStrictEqual(INVALID_STATE);
    expect(bad({ ...s, owners: [...s.owners, [17, 1]] })).toStrictEqual(INVALID_STATE);
    expect(bad({ ...s, owners: [...s.owners, s.owners[0]] })).toStrictEqual(INVALID_STATE);
    const dup = structuredClone(s.owners);
    dup[5]![0] = dup[4]![0]; // right length, a territory twice and one missing
    expect(bad({ ...s, owners: dup })).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 rejects a sea zone listed in the owners, and a state without its land territory', () => {
    const map = isleMap();
    const ok = initialState(map);
    expect(checkState(map, ok).ok).toBe(true);
    const withSea = { ...structuredClone(ok), owners: [...structuredClone(ok.owners), [101, 10]] };
    expect(bad(withSea, map)).toStrictEqual(INVALID_STATE);
    const swapLandForSea = structuredClone(ok);
    swapLandForSea.owners[5] = [101, 10];
    expect(bad(swapLandForSea, map)).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 rejects a pair of length 1 or 3 and a pair that is not an array', () => {
    const s = fresh();
    const set = (i: number, pair: unknown) => {
      const owners: unknown[] = structuredClone(s.owners);
      owners[i] = pair;
      return { ...s, owners };
    };
    expect(bad(set(0, [1]))).toStrictEqual(INVALID_STATE);
    expect(bad(set(0, [1, 1, 1]))).toStrictEqual(INVALID_STATE);
    expect(bad(set(0, []))).toStrictEqual(INVALID_STATE);
    expect(bad(set(15, [16, 16, 16]))).toStrictEqual(INVALID_STATE);
    expect(bad(set(0, { 0: 1, 1: 1, length: 2 }))).toStrictEqual(INVALID_STATE);
    expect(bad(set(0, null))).toStrictEqual(INVALID_STATE);
    expect(bad(set(0, '11'))).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 rejects a territory id or a faction that is text, fractional or negative', () => {
    const s = fresh();
    const set = (i: number, pair: unknown[]) => {
      const owners: unknown[] = structuredClone(s.owners);
      owners[i] = pair;
      return { ...s, owners };
    };
    expect(bad(set(0, ['1', 1]))).toStrictEqual(INVALID_STATE);
    expect(bad(set(0, [1, '1']))).toStrictEqual(INVALID_STATE);
    expect(bad(set(0, [1, 1.5]))).toStrictEqual(INVALID_STATE);
    expect(bad(set(0, [1, -1]))).toStrictEqual(INVALID_STATE);
    expect(bad(set(0, [1, NaN]))).toStrictEqual(INVALID_STATE);
    expect(bad(set(0, [1, null]))).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 rejects an unknown faction (an id that is not a faction of the map)', () => {
    const s = fresh();
    for (const id of [0, 17, 999, 16777215]) {
      const owners = structuredClone(s.owners);
      owners[7]![1] = id;
      expect(bad({ ...s, owners }), String(id)).toStrictEqual(INVALID_STATE);
    }
    // a faction id that is a territory id of a sea zone, never a faction
    const map = isleMap();
    const st = structuredClone(initialState(map));
    st.owners[0]![1] = 101;
    expect(bad(st, map)).toStrictEqual(INVALID_STATE);
  });

  it('FR-313 a faction of the map that owns nothing in the state is still valid', () => {
    const s = fresh();
    const owners = structuredClone(s.owners);
    owners[0]![1] = 2; // faction 1 owns no territory now
    expect(checkState(grid, { ...s, owners, round: 1 }).ok).toBe(true);
  });
});

describe('FR-313 checkFaction', () => {
  it.each(GOLDEN_MAPS)('FR-313 accepts every faction of the %s map and returns it', (_name, make) => {
    const map = make();
    const factions = [...new Set(initialState(map).owners.map(([, f]) => f))];
    expect(factions.length).toBeGreaterThanOrEqual(2);
    for (const f of factions) expect(checkFaction(map, f)).toStrictEqual({ ok: true, value: f });
  });

  it.each([0, -0, 1.5, -1, NaN, Infinity, '1', '', null, undefined, [1], { valueOf: () => 1 }, true, 17, 999, 16777216])(
    'FR-313 rejects the faction %s with one invalid-faction error',
    (value) => {
      expect(checkFaction(grid, value)).toStrictEqual(INVALID_FACTION);
    },
  );

  it('FR-313 rejects a territory id that is not a faction id, and a sea zone id', () => {
    const map = japanMap(); // factions 20, 30, 40, 10; territories 1..6; zones 101..103
    expect(checkFaction(map, 1)).toStrictEqual(INVALID_FACTION);
    expect(checkFaction(map, 101)).toStrictEqual(INVALID_FACTION);
    expect(checkFaction(map, 10)).toStrictEqual({ ok: true, value: 10 });
  });
});

describe('FR-313 the two new error kinds', () => {
  it('FR-313 the kinds are the English kebab-case identifiers invalid-state and invalid-faction', () => {
    const state = checkState(grid, null);
    const faction = checkFaction(grid, null);
    if (state.ok || faction.ok) throw new Error('expected failures');
    expect(state.errors.map((e) => e.kind)).toStrictEqual(['invalid-state']);
    expect(faction.errors.map((e) => e.kind)).toStrictEqual(['invalid-faction']);
    for (const e of [...state.errors, ...faction.errors]) expect(e.kind).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(Object.keys(state.errors[0]!)).toStrictEqual(['kind']);
    expect(Object.keys(faction.errors[0]!)).toStrictEqual(['kind']);
  });
});
