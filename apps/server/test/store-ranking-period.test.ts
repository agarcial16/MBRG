import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PublicState } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { HistoryKey } from '../src/core/history';
import type { ResultRow } from '../src/core/scoring';
import type { CoreMatch } from '../src/core/view';
import { withFaults } from '../src/store/faults';
import { READ_SQL, openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';

// Spec 027 (M1, store part): the floor, the lower instant of a period, as an optional LAST parameter of the two ranking reads of
// spec 025. A counted match finished at or after the floor is in; one finished 1 ms before is out; with no floor the reads are
// 025's. Key and ids are planted literals no other text of the repository holds.

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 11) % 256);
const T0 = 1_700_000_000_000;
const KEY_P = '27c3f10123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 10], [3, 10]] });
const id = (c: string, n = 1): string => `${c.repeat(15)}${String(n)}`;

interface Spec {
  readonly id: string;
  readonly stage?: CoreMatch['stage'];
  readonly at: number;
  readonly community?: string;
  readonly namespace?: string;
}

/** One stored match as the creation (client row, community row) and the steps leave it, in any stage. */
const put = (store: Store, spec: Spec): void => {
  const stage = spec.stage ?? 'finished';
  const finished = stage === 'finished';
  const match: CoreMatch = {
    matchId: spec.id,
    mapId: 'dev',
    mapDigest: DIGEST('a'),
    totalRounds: 5,
    timing: { i: 120, l1: 30, l2: 10 },
    commitment: DIGEST('c'),
    stage,
    appliedRounds: finished ? 5 : 2,
    state: state(finished ? 5 : 2),
    stateDigest: DIGEST('d'),
    lastSeq: 1,
    createdAt: T0,
    lastStepMs: spec.at,
    anchors: null,
    ...(finished ? { winner: 10 } : {}),
  };
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    store.insertClientMatch(spec.id, spec.namespace ?? 'discord');
    store.insertCommunity(spec.id, spec.community ?? KEY_P);
  });
};

const victim = (playerId: string, round: number, correct: boolean, points: number): ResultRow => ({ playerId, kind: 'victim', round, choice: 3, correct, points });
const scoreOne = (store: Store, matchId: string, playerId: string, points = 3): void => {
  store.transaction(() => store.putResults(matchId, [victim(playerId, 1, true, points)]));
};
const nameOne = (store: Store, matchId: string, playerId: string, name: string): void => {
  store.transaction(() => store.putClientName(matchId, playerId, name));
};

/** Three counted matches 1 ms apart around the floor FLOOR, each with one scored row and one name of its own. */
const FLOOR = T0 + 5000;
const seeded = (): Store => {
  const store = openStore(':memory:');
  put(store, { id: id('a'), at: FLOOR - 1 }); // one millisecond before the floor: out
  put(store, { id: id('b'), at: FLOOR }); // exactly at the floor: in
  put(store, { id: id('c'), at: FLOOR + 1 }); // after: in
  for (const [m, p, n] of [[id('a'), 'discord:old1', 'OldName'], [id('b'), 'discord:edge1', 'EdgeName'], [id('c'), 'discord:new1', 'NewName']] as const) {
    scoreOne(store, m, p);
    nameOne(store, m, p, n);
  }
  return store;
};

describe('FR-577 (store part) the floor bound of the two ranking reads', () => {
  it('FR-577 (store part) a match finished exactly at the floor is in, one finished 1 ms before is out, in both reads', () => {
    const store = seeded();
    expect(store.rankingResults(KEY_P, 'discord', undefined, FLOOR).map((r) => r.matchId)).toStrictEqual([id('c'), id('b')]);
    expect(store.rankingNames(KEY_P, 'discord', undefined, FLOOR).map((r) => r.matchId)).toStrictEqual([id('c'), id('b')]);
    // One millisecond later the edge match falls out; one millisecond earlier the old match comes in.
    expect(store.rankingResults(KEY_P, 'discord', undefined, FLOOR + 1).map((r) => r.matchId)).toStrictEqual([id('c')]);
    expect(store.rankingNames(KEY_P, 'discord', undefined, FLOOR + 1).map((r) => r.matchId)).toStrictEqual([id('c')]);
    expect(store.rankingResults(KEY_P, 'discord', undefined, FLOOR - 1).map((r) => r.matchId)).toStrictEqual([id('c'), id('b'), id('a')]);
    expect(store.rankingNames(KEY_P, 'discord', undefined, FLOOR - 1).map((r) => r.matchId)).toStrictEqual([id('c'), id('b'), id('a')]);
    // A floor after every match reads nothing.
    expect(store.rankingResults(KEY_P, 'discord', undefined, FLOOR + 2)).toStrictEqual([]);
    expect(store.rankingNames(KEY_P, 'discord', undefined, FLOOR + 2)).toStrictEqual([]);
    store.close();
  });

  it('FR-577 (store part) with no floor the rows are those of a floor below every instant, zero and negative included, and the 025 call is unchanged', () => {
    const store = seeded();
    const none = store.rankingResults(KEY_P, 'discord', undefined);
    const noneNames = store.rankingNames(KEY_P, 'discord', undefined);
    expect(none.map((r) => r.matchId)).toStrictEqual([id('c'), id('b'), id('a')]);
    for (const floor of [0, -1, T0, -9_007_199_254_740_991]) {
      expect(store.rankingResults(KEY_P, 'discord', undefined, floor), String(floor)).toStrictEqual(none);
      expect(store.rankingNames(KEY_P, 'discord', undefined, floor), String(floor)).toStrictEqual(noneNames);
    }
    // An explicit undefined is no floor; the largest safe floor is accepted and reads nothing.
    expect(store.rankingResults(KEY_P, 'discord', undefined, undefined)).toStrictEqual(none);
    expect(store.rankingNames(KEY_P, 'discord', undefined, undefined)).toStrictEqual(noneNames);
    expect(store.rankingResults(KEY_P, 'discord', undefined, 9_007_199_254_740_991)).toStrictEqual([]);
    store.close();
  });

  it('FR-577 (store part) the floor and the head bound together: a head older than the floor gives nothing from both reads', () => {
    const store = seeded();
    const head = (finishedAt: number, matchId: string): HistoryKey => ({ finishedAt, matchId });
    // The head is the oldest match (a counted match is at or after the head when it is the head or older) and the floor is later
    // than it: the head's match and the older ones are all before the floor, so nothing is in both.
    expect(store.rankingResults(KEY_P, 'discord', head(FLOOR - 1, id('a')), FLOOR)).toStrictEqual([]);
    expect(store.rankingNames(KEY_P, 'discord', head(FLOOR - 1, id('a')), FLOOR)).toStrictEqual([]);
    // The head at the floor keeps exactly the head match; the head at the edge's own id keeps it alone from the floor up.
    expect(store.rankingResults(KEY_P, 'discord', head(FLOOR, id('b')), FLOOR).map((r) => r.matchId)).toStrictEqual([id('b')]);
    expect(store.rankingNames(KEY_P, 'discord', head(FLOOR, id('b')), FLOOR).map((r) => r.matchId)).toStrictEqual([id('b')]);
    // The head older than the floor by a margin, with newer matches inside the floor, is still empty (the head is not moved by the floor).
    expect(store.rankingResults(KEY_P, 'discord', head(FLOOR - 1, id('a')), FLOOR + 1)).toStrictEqual([]);
    store.close();
  });

  it('FR-577 (store part) a name stored only in a match before the floor is never returned, and a name of a match at the floor is', () => {
    const store = seeded();
    const names = store.rankingNames(KEY_P, 'discord', undefined, FLOOR);
    expect(names.map((n) => n.name).sort()).toStrictEqual(['EdgeName', 'NewName']);
    expect(names.some((n) => n.name === 'OldName' || n.playerId === 'discord:old1')).toBe(false);
    // The same player named in an old match and a new one: only the in-period name is read.
    nameOne(store, id('a'), 'discord:edge1', 'OldSpelling');
    scoreOne(store, id('a'), 'discord:edge1');
    const again = store.rankingNames(KEY_P, 'discord', undefined, FLOOR);
    expect(again.filter((n) => n.playerId === 'discord:edge1').map((n) => n.name)).toStrictEqual(['EdgeName']);
    expect(store.rankingResults(KEY_P, 'discord', undefined, FLOOR).some((r) => r.matchId === id('a'))).toBe(false);
    store.close();
  });

  it('FR-577 (store part) the floor never admits another stage, another namespace or another key', () => {
    const store = seeded();
    put(store, { id: id('d'), stage: 'phase-1', at: FLOOR + 10 });
    put(store, { id: id('e'), at: FLOOR + 11, namespace: 'web' });
    put(store, { id: id('f'), at: FLOOR + 12, community: '27c3f20123456789abcdef0123456789abcdef0123456789abcdef0123456789' });
    for (const m of [id('d'), id('e'), id('f')]) {
      scoreOne(store, m, 'discord:other1');
      nameOne(store, m, 'discord:other1', 'OtherName');
    }
    expect(store.rankingResults(KEY_P, 'discord', undefined, FLOOR).map((r) => r.matchId)).toStrictEqual([id('c'), id('b')]);
    expect(store.rankingNames(KEY_P, 'discord', undefined, FLOOR).map((r) => r.matchId)).toStrictEqual([id('c'), id('b')]);
    store.close();
  });

  it('FR-577 (store part) the floor is checked: only a whole number (any sign) or none; anything else is a RangeError', () => {
    const store = seeded();
    for (const floor of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 9_007_199_254_740_992, -9_007_199_254_740_992, '5', null, true, {}, [], 10n]) {
      expect(() => store.rankingResults(KEY_P, 'discord', undefined, floor as never), String(floor)).toThrow(RangeError);
      expect(() => store.rankingNames(KEY_P, 'discord', undefined, floor as never), String(floor)).toThrow(RangeError);
    }
    // The other arguments are still checked first-class with a floor given.
    expect(() => store.rankingResults(KEY_P.toUpperCase(), 'discord', undefined, FLOOR)).toThrow(RangeError);
    expect(() => store.rankingNames(KEY_P, 'Player', undefined, FLOOR)).toThrow(RangeError);
    expect(() => store.rankingResults(KEY_P, 'discord', { finishedAt: -1, matchId: id('a') }, FLOOR)).toThrow(RangeError);
    store.close();
  });

  it('FR-577 (store part) the fault-injection wrapper passes the floor through', () => {
    const store = seeded();
    const wrapped = withFaults(store, {});
    expect(wrapped.rankingResults(KEY_P, 'discord', undefined, FLOOR + 1).map((r) => r.matchId)).toStrictEqual([id('c')]);
    expect(wrapped.rankingNames(KEY_P, 'discord', undefined, FLOOR + 1).map((r) => r.matchId)).toStrictEqual([id('c')]);
    expect(wrapped.rankingResults(KEY_P, 'discord', undefined)).toHaveLength(3);
    store.close();
  });
});

describe('NFR-130 (store part) the floor adds no statement and no scan', () => {
  it('NFR-130 (store part) EXPLAIN QUERY PLAN of both statements with a floor shows no SCAN of matches, results, communities or client_names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrg-ranking-period-plan-'));
    try {
      const file = join(dir, 'p.sqlite');
      openStore(file).close();
      const db = new DatabaseSync(file);
      try {
        // Parameters in the order the adapter binds: key, namespace, head (4), floor (2); with and without a head.
        const probes: unknown[][] = [
          [KEY_P, 'discord', null, null, null, null, FLOOR, FLOOR],
          [KEY_P, 'discord', 5, 5, 5, 'x', FLOOR, FLOOR],
          [KEY_P, 'discord', null, null, null, null, -5, -5],
          [KEY_P, 'discord', null, null, null, null, null, null],
        ];
        for (const [name, sql] of [['results', READ_SQL.rankingResults], ['names', READ_SQL.rankingNames]] as const) {
          for (const probe of probes) {
            const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(probe as never[])).map((r) => String(r.detail));
            const text = `${name}: ${plan.join(' | ')}`;
            expect(plan.filter((d) => /\bSCAN\b/.test(d)), text).toStrictEqual([]);
            expect(plan.some((d) => /SEARCH .*communities/.test(d)), text).toBe(true);
            expect(plan.some((d) => /SEARCH .*matches/.test(d)), text).toBe(true);
            expect(plan.some((d) => (name === 'results' ? /SEARCH .*results/ : /SEARCH .*client_names/).test(d)), text).toBe(true);
          }
        }
        // The floor is a bound in the SQL (not applied after the read): the statement text carries it for both reads.
        expect(READ_SQL.rankingResults).toMatch(/m\.last_step_ms >= \?/);
        expect(READ_SQL.rankingNames).toMatch(/m\.last_step_ms >= \?/);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('NFR-130 (store part) the two reads prepare the same 2 statements with and without a floor, whatever the stored matches', () => {
    const countPrepares = (run: () => void): number => {
      let n = 0;
      const proto = DatabaseSync.prototype as unknown as Record<string, unknown>;
      const original = proto.prepare as (...args: unknown[]) => unknown;
      proto.prepare = function (this: unknown, ...args: unknown[]) {
        n += 1;
        return original.apply(this, args);
      };
      try {
        run();
      } finally {
        proto.prepare = original;
      }
      return n;
    };
    for (const count of [10, 200]) {
      const store = openStore(':memory:');
      for (let i = 0; i < count; i++) {
        const matchId = `p${String(i).padStart(4, '0')}`.padEnd(16, 'y');
        put(store, { id: matchId, at: T0 + i * 1000 });
        scoreOne(store, matchId, 'discord:u1');
        nameOne(store, matchId, 'discord:u1', 'Nm');
      }
      const middle = T0 + Math.floor(count / 2) * 1000;
      const without = countPrepares(() => {
        store.rankingResults(KEY_P, 'discord', undefined);
        store.rankingNames(KEY_P, 'discord', undefined);
      });
      const withFloor = countPrepares(() => {
        expect(store.rankingResults(KEY_P, 'discord', undefined, middle)).toHaveLength(count - Math.floor(count / 2));
        expect(store.rankingNames(KEY_P, 'discord', undefined, middle)).toHaveLength(count - Math.floor(count / 2));
      });
      expect(without, String(count)).toBe(2);
      expect(withFloor, String(count)).toBe(2);
      store.close();
    }
  });
});
