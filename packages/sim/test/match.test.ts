import { describe, expect, it } from 'vitest';
import * as api from '../src/index';
import { getRounds, getState, ownerOf, totalRounds } from '../src/index';
import { initialState } from '../src/internal';
import type { MatchError } from '../src/index';
import { lineMap, mapFrom, pairMap, ringMap } from './helpers/maps';

type R<T = unknown> = { ok: true; value: T } | { ok: false; errors: MatchError[] };
const ok = <T, E>(r: { ok: true; value: T } | { ok: false; errors: E[] }): T => {
  if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r.errors));
  return r.value;
};
const errs = <T, E>(r: { ok: true; value: T } | { ok: false; errors: E[] }): E[] => {
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

describe('totalRounds', () => {
  it('FR-42 total rounds is factions minus one', () => {
    expect(ok(totalRounds(pairMap()))).toBe(1);
    expect(ok(totalRounds(lineMap()))).toBe(3);
    expect(ok(totalRounds(ringMap()))).toBe(5);
  });
  it('FR-42 invalid map returns validation errors', () => {
    expect(errs(totalRounds({ territories: 'x' }))).toEqual([{ kind: 'invalid-territories' }]);
    expect(errs(totalRounds(null))).toEqual([{ kind: 'invalid-map' }]);
  });
});

describe('seed checks', () => {
  it('FR-31 seeds 0, -0 and 4294967295 are valid; -0 equals 0', () => {
    const m = ringMap();
    expect(getState(m, 0, 0).ok).toBe(true);
    expect(getState(m, 4294967295, 2).ok).toBe(true);
    expect(getRounds(m, -0, 5)).toStrictEqual(getRounds(m, 0, 5));
    expect(getState(m, -0, 5)).toStrictEqual(getState(m, 0, 5));
  });
  it('FR-32 invalid seeds -> invalid-seed', () => {
    for (const s of [-1, 4294967296, 1.5, NaN, Infinity, -Infinity, '42', null, undefined, true, {}, [], 10n]) {
      expect(errs(getState(ringMap(), s, 1))).toEqual([{ kind: 'invalid-seed' }]);
      expect(errs(getRounds(ringMap(), s, 1))).toEqual([{ kind: 'invalid-seed' }]);
    }
  });
});

describe('round checks', () => {
  it('FR-45 -0 is a valid round (round 0)', () => {
    expect(ok(getState(ringMap(), 1, -0)).round).toBe(0);
    expect(Object.is(ok(getState(ringMap(), 1, -0)).round, 0)).toBe(true);
    expect(ok(getRounds(ringMap(), 1, -0))).toEqual([]);
  });
  it('FR-45 invalid rounds -> invalid-round', () => {
    for (const r of [1.5, NaN, Infinity, -Infinity, -1, '2', null, undefined, true, {}]) {
      expect(errs(getState(ringMap(), 1, r))).toEqual([{ kind: 'invalid-round' }]);
      expect(errs(getRounds(ringMap(), 1, r))).toEqual([{ kind: 'invalid-round' }]);
    }
  });
  it('FR-46 round above total -> round-out-of-range with round and total', () => {
    const e = [{ kind: 'round-out-of-range', round: 6, total: 5 }];
    expect(errs(getState(ringMap(), 1, 6))).toEqual(e);
    expect(errs(getRounds(ringMap(), 1, 6))).toEqual(e);
    expect(errs(getState(ringMap(), 1, 1e9))).toEqual([{ kind: 'round-out-of-range', round: 1e9, total: 5 }]);
    expect(getState(ringMap(), 1, 5).ok).toBe(true);
  });
  it('FR-47 combined invalid inputs: map errors, seed, round, never out-of-range', () => {
    const bad = { territories: 'x' };
    for (const f of [getState, getRounds] as ((m: unknown, s: unknown, r: unknown) => R)[]) {
      expect(errs(f(bad, -1, 1.5))).toEqual([
        { kind: 'invalid-territories' },
        { kind: 'invalid-seed' },
        { kind: 'invalid-round' },
      ]);
      expect(errs(f(bad, 1, 99))).toEqual([{ kind: 'invalid-territories' }]);
      expect(errs(f(ringMap(), -1, 'a'))).toEqual([{ kind: 'invalid-seed' }, { kind: 'invalid-round' }]);
      expect(errs(f(ringMap(), -1, 99))).toEqual([
        { kind: 'invalid-seed' },
        { kind: 'round-out-of-range', round: 99, total: 5 },
      ]);
    }
  });
  it('FR-29 a map that fails validation cannot start a match', () => {
    const oneFaction = mapFrom([1, 2], [[1, 2]]);
    oneFaction.territories[1]!.owner = 1;
    expect(errs(getState(oneFaction, 1, 0)).map((e) => e.kind)).toContain('multiple-initial-territories');
    expect(getRounds(null, 1, 0).ok).toBe(false);
  });
});

describe('results', () => {
  it('FR-43 round 0 is the initial state; FR-44 records are an empty list', () => {
    const m = lineMap();
    expect(ok(getState(m, 7, 0))).toStrictEqual(initialState(m));
    expect(ok(getRounds(m, 7, 0))).toStrictEqual([]);
  });
  it('FR-41 round T leaves a single owner and records stop at T', () => {
    const m = ringMap();
    const s = ok(getState(m, 3, 5));
    expect(new Set(s.owners.map(([, f]) => f)).size).toBe(1);
    expect(s.round).toBe(5);
    expect(ok(getRounds(m, 3, 5))).toHaveLength(5);
  });
  it('FR-48 only rounds 0..N are exposed, no seed', () => {
    const m = ringMap();
    const recs = ok(getRounds(m, 12345, 3));
    expect(recs.map((r) => r.round)).toEqual([1, 2, 3]);
    for (const r of recs) expect(Object.keys(r).sort()).toEqual(['absorber', 'eliminated', 'round', 'transferred']);
    const s = ok(getState(m, 12345, 3));
    expect(Object.keys(s).sort()).toEqual(['mode', 'owners', 'round']);
    expect(s.round).toBe(3);
    expect(JSON.stringify([s, recs])).not.toContain('12345');
  });
  it('FR-43 FR-44 getState and getRounds agree and rewind works', () => {
    const m = ringMap();
    const a = ok(getState(m, 9, 4));
    ok(getState(m, 9, 5));
    expect(ok(getState(m, 9, 4))).toStrictEqual(a);
    expect(ok(getRounds(m, 9, 5)).slice(0, 4)).toStrictEqual(ok(getRounds(m, 9, 4)));
  });
  it('FR-53 JSON round-trip keeps number ids', () => {
    const m = ringMap();
    const s = ok(getState(m, 5, 3));
    const r = ok(getRounds(m, 5, 3));
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
    expect(JSON.parse(JSON.stringify(r))).toStrictEqual(r);
    for (const [t, f] of s.owners) {
      expect(typeof t).toBe('number');
      expect(typeof f).toBe('number');
    }
  });
  it('FR-34 ownerOf looks up by territory id', () => {
    const s = ok(getState(pairMap(), 1, 0));
    expect(ownerOf(s, 1)).toBe(10);
    expect(ownerOf(s, 2)).toBe(20);
    expect(ownerOf(s, 99)).toBeUndefined();
  });
  it('FR-29 does not mutate the map', () => {
    const m = ringMap();
    const copy = structuredClone(m);
    getRounds(m, 1, 5);
    expect(m).toStrictEqual(copy);
  });
});

describe('public exports', () => {
  it('plan 6 export list is exact', () => {
    expect(Object.keys(api).sort()).toEqual(['MODE', 'getRounds', 'getState', 'ownerOf', 'totalRounds']);
  });
});

describe('input with empty slots', () => {
  // eslint-disable-next-line no-sparse-arrays
  const gap = { territories: [, { id: 2, owner: 2, neighbors: [] }] };
  it('FR-29 FR-14 getState and getRounds return errors and do not throw on a gap in territories', () => {
    expect(errs(getState(gap, 1, 0))).toEqual([{ kind: 'invalid-territory', position: 0 }]);
    expect(errs(getRounds(gap, 1, 0))).toEqual([{ kind: 'invalid-territory', position: 0 }]);
  });
});
