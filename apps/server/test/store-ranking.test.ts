import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PublicState } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { HistoryKey } from '../src/core/history';
import type { CoreMatch } from '../src/core/view';
import type { ResultRow } from '../src/core/scoring';
import { READ_SQL, openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';

// Spec 025 store reads of the ranking: the per (match, player) aggregates of the counted matches of a community key and a
// namespace (points, correct, scored), and the names those matches stored, bounded by the snapshot head. Key and ids are
// planted literals no other text of the repository holds.

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
const T0 = 1_700_000_000_000;
const KEY_R = '3a51ed0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const KEY_S = '6b0e5ca1ab1e6b0e5ca1ab1e6b0e5ca1ab1e6b0e5ca1ab1e6b0e5ca1ab1e6b0e';
const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 10], [3, 10]] });
const id = (c: string, n = 1): string => `${c.repeat(15)}${String(n)}`;

interface Spec {
  readonly id: string;
  readonly stage?: CoreMatch['stage'];
  readonly at?: number;
  readonly community?: string;
  readonly namespace?: string;
}

/** One stored match as the creation (client row, community row) and the steps leave it, in any stage. */
const put = (store: Store, spec: Spec): void => {
  const stage = spec.stage ?? 'finished';
  const finished = stage === 'finished';
  const applied = finished ? 5 : stage === 'halted' || stage === 'phase-1' || stage === 'phase-2' || stage === 'locked' ? 2 : 0;
  const at = spec.at ?? T0 + 1000;
  const match: CoreMatch = {
    matchId: spec.id,
    mapId: 'dev',
    mapDigest: DIGEST('a'),
    totalRounds: 5,
    timing: { i: 120, l1: 30, l2: 10 },
    commitment: DIGEST('c'),
    stage,
    appliedRounds: applied,
    state: state(applied),
    stateDigest: DIGEST('d'),
    lastSeq: 1,
    createdAt: T0,
    lastStepMs: at,
    anchors: null,
    ...(finished ? { winner: 10 } : {}),
    ...(stage === 'halted' ? { haltReason: 'map-changed' as const } : {}),
  };
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    if (spec.namespace !== undefined) store.insertClientMatch(spec.id, spec.namespace);
    if (spec.community !== undefined) store.insertCommunity(spec.id, spec.community);
  });
};

/** The scored results of one match, in one transaction. */
const putResults = (store: Store, matchId: string, rows: readonly ResultRow[]): void => {
  store.transaction(() => store.putResults(matchId, rows));
};

/** A stored 022 name of one match, in one transaction. */
const putName = (store: Store, matchId: string, playerId: string, name: string): void => {
  store.transaction(() => store.putClientName(matchId, playerId, name));
};

const victim = (playerId: string, round: number, correct: boolean, points: number): ResultRow => ({ playerId, kind: 'victim', round, choice: 3, correct, points });
const absorber = (playerId: string, round: number, correct: boolean, points: number): ResultRow => ({ playerId, kind: 'absorber', round, choice: 2, correct, points });
const winner = (playerId: string, correct: boolean, points: number): ResultRow => ({ playerId, kind: 'winner', round: 0, choice: 4, correct, points });

describe('FR-564 (read part) the ranking reads of the store', () => {
  it('FR-564 (read part) the results read aggregates per match and player: the sum of points, the correct rows and the scored rows', () => {
    const store = openStore(':memory:');
    put(store, { id: id('a'), community: KEY_R, namespace: 'discord', at: T0 + 1000 });
    put(store, { id: id('b'), community: KEY_R, namespace: 'discord', at: T0 + 2000 });
    putResults(store, id('a'), [
      victim('discord:u1', 1, true, 3),
      absorber('discord:u1', 2, false, 0),
      victim('discord:u2', 1, false, 0),
      absorber('discord:u2', 2, true, 2),
    ]);
    putResults(store, id('b'), [
      victim('discord:u1', 1, true, 3),
      winner('discord:u3', true, 4),
    ]);
    const rows = store.rankingResults(KEY_R, 'discord', undefined);
    const byKey = (a: { matchId: string; playerId: string }, b: { matchId: string; playerId: string }): number =>
      a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
    expect([...rows].sort(byKey)).toStrictEqual([
      { matchId: id('a'), finishedAt: T0 + 1000, playerId: 'discord:u1', points: 3, correct: 1, scored: 2 },
      { matchId: id('a'), finishedAt: T0 + 1000, playerId: 'discord:u2', points: 2, correct: 1, scored: 2 },
      { matchId: id('b'), finishedAt: T0 + 2000, playerId: 'discord:u1', points: 3, correct: 1, scored: 1 },
      { matchId: id('b'), finishedAt: T0 + 2000, playerId: 'discord:u3', points: 4, correct: 1, scored: 1 },
    ]);
    // A counted match with no scored result contributes no row.
    put(store, { id: id('c'), community: KEY_R, namespace: 'discord', at: T0 + 3000 });
    expect(store.rankingResults(KEY_R, 'discord', undefined)).toHaveLength(4);
    store.close();
  });

  it('FR-561 (applied) only finished matches of the key and the namespace are read: lobby, expired, running and halted ones of the same key never', () => {
    const store = openStore(':memory:');
    put(store, { id: id('a'), community: KEY_R, namespace: 'discord' });
    putResults(store, id('a'), [victim('discord:u1', 1, true, 3)]);
    putName(store, id('a'), 'discord:u1', 'Ana');
    for (const [n, stage] of (['lobby', 'expired', 'phase-1', 'phase-2', 'locked', 'halted'] as const).entries()) {
      put(store, { id: id('b', n), stage, community: KEY_R, namespace: 'discord' });
      // A lobby or expired match holds no round, so no result row can exist for it; the running and halted ones can.
      if (stage !== 'lobby' && stage !== 'expired') putResults(store, id('b', n), [victim('discord:u1', 1, true, 3)]);
      putName(store, id('b', n), 'discord:u1', 'Never');
    }
    put(store, { id: id('c'), community: KEY_S, namespace: 'discord' });
    put(store, { id: id('d'), community: KEY_R, namespace: 'web' });
    // The cross-namespace match holds rows and a name of its own: nothing of it may appear in the discord reads.
    putResults(store, id('d'), [victim('web:w1', 1, true, 5)]);
    putName(store, id('d'), 'web:w1', 'Webby');
    put(store, { id: id('e') });
    put(store, { id: id('f'), namespace: 'discord' });
    put(store, { id: id('g'), community: KEY_R });
    expect(store.rankingResults(KEY_R, 'discord', undefined).map((r) => r.matchId)).toStrictEqual([id('a')]);
    expect(store.rankingNames(KEY_R, 'discord', undefined)).toStrictEqual([
      { matchId: id('a'), finishedAt: T0 + 1000, playerId: 'discord:u1', name: 'Ana' },
    ]);
    store.close();
  });

  it('FR-564 (read part) the head bounds both reads at or after it in history order: no newer match, ties by match id', () => {
    const store = openStore(':memory:');
    put(store, { id: id('a'), community: KEY_R, namespace: 'discord', at: T0 + 1000 });
    // At the head instant, with an id that sorts before the head's id: more recent than the head, so the head drops it.
    put(store, { id: id('a', 2), community: KEY_R, namespace: 'discord', at: T0 + 2000 });
    put(store, { id: id('b'), community: KEY_R, namespace: 'discord', at: T0 + 2000 });
    put(store, { id: id('c'), community: KEY_R, namespace: 'discord', at: T0 + 2000 });
    for (const matchId of [id('a'), id('a', 2), id('b'), id('c')]) {
      putResults(store, matchId, [victim('discord:u1', 1, true, 3)]);
      putName(store, matchId, 'discord:u1', 'Ana');
    }
    const head = (finishedAt: number, matchId: string): HistoryKey => ({ finishedAt, matchId });
    // At the instant of b, with b's id: b and c stay (c's id sorts after b's at the same instant), and so does the older a;
    // the tie with the smaller id (a, 2) is newer than the head and never appears.
    const atB: HistoryKey = head(T0 + 2000, id('b'));
    expect(store.rankingResults(KEY_R, 'discord', atB).map((r) => r.matchId)).toStrictEqual([id('b'), id('c'), id('a')]);
    expect(store.rankingNames(KEY_R, 'discord', atB).map((r) => r.matchId)).toStrictEqual([id('b'), id('c'), id('a')]);
    const atC: HistoryKey = head(T0 + 2000, id('c'));
    expect(store.rankingResults(KEY_R, 'discord', atC).map((r) => r.matchId)).toStrictEqual([id('c'), id('a')]);
    const middle: HistoryKey = head(T0 + 1500, id('b'));
    expect(store.rankingResults(KEY_R, 'discord', middle).map((r) => r.matchId)).toStrictEqual([id('a')]);
    expect(store.rankingNames(KEY_R, 'discord', middle).map((r) => r.matchId)).toStrictEqual([id('a')]);
    store.close();
  });

  it('FR-563 (name source part) the names read returns every name the counted matches stored, and no name of another stage', () => {
    const store = openStore(':memory:');
    put(store, { id: id('a'), community: KEY_R, namespace: 'discord', at: T0 + 1000 });
    put(store, { id: id('b'), community: KEY_R, namespace: 'discord', at: T0 + 2000 });
    put(store, { id: id('x'), stage: 'phase-1', community: KEY_R, namespace: 'discord', at: T0 + 3000 });
    putResults(store, id('a'), [victim('discord:u1', 1, true, 3)]);
    putResults(store, id('b'), [victim('discord:u1', 1, true, 3), winner('discord:u2', false, 0)]);
    putName(store, id('a'), 'discord:u1', 'Old');
    putName(store, id('b'), 'discord:u1', 'New');
    putName(store, id('b'), 'discord:u2', 'Bea');
    putName(store, id('x'), 'discord:u1', 'Running');
    const rows = store.rankingNames(KEY_R, 'discord', undefined);
    const byKey = (a: { matchId: string; playerId: string }, b: { matchId: string; playerId: string }): number =>
      a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
    expect([...rows].sort(byKey)).toStrictEqual([
      { matchId: id('a'), finishedAt: T0 + 1000, playerId: 'discord:u1', name: 'Old' },
      { matchId: id('b'), finishedAt: T0 + 2000, playerId: 'discord:u1', name: 'New' },
      { matchId: id('b'), finishedAt: T0 + 2000, playerId: 'discord:u2', name: 'Bea' },
    ]);
    store.close();
  });

  it('FR-564 (read part) the arguments are checked: the community key, the namespace and the head', () => {
    const store = openStore(':memory:');
    for (const community of [KEY_R.toUpperCase(), KEY_R.slice(1), 5, null, '']) {
      expect(() => store.rankingResults(community as string, 'discord', undefined), String(community)).toThrow(RangeError);
    }
    for (const namespace of ['Player', 'discord x', '', 5, null]) {
      expect(() => store.rankingResults(KEY_R, namespace as string, undefined), String(namespace)).toThrow(RangeError);
      expect(() => store.rankingNames(KEY_R, namespace as string, undefined), String(namespace)).toThrow(RangeError);
    }
    for (const head of [5, null, { finishedAt: -1, matchId: id('a') }, { finishedAt: 5, matchId: 'bad id' }, { finishedAt: 5 }] as never[]) {
      expect(() => store.rankingResults(KEY_R, 'discord', head), JSON.stringify(head)).toThrow(RangeError);
      expect(() => store.rankingNames(KEY_R, 'discord', head), JSON.stringify(head)).toThrow(RangeError);
    }
    store.close();
  });

  it('NFR-125 (store part) both statements reach communities, matches, results and client_names through indexes: no scan of any table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrg-ranking-plan-'));
    try {
      const file = join(dir, 'r.sqlite');
      openStore(file).close();
      const db = new DatabaseSync(file);
      try {
        const results = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL.rankingResults}`).all(KEY_R, 'discord', null, null, null, null).map((r) => String(r.detail));
        const names = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL.rankingNames}`).all(KEY_R, 'discord', null, null, null, null).map((r) => String(r.detail));
        for (const plan of [results, names]) {
          const text = plan.join(' | ');
          expect(plan.filter((d) => /\bSCAN\b/.test(d)), text).toStrictEqual([]);
          expect(plan.some((d) => /SEARCH .*communities/.test(d)), text).toBe(true);
          expect(plan.some((d) => /SEARCH .*matches/.test(d)), text).toBe(true);
        }
        expect(results.some((d) => /SEARCH .*results/.test(d)), results.join(' | ')).toBe(true);
        expect(results.some((d) => /\bclient_names\b/.test(d)), results.join(' | ')).toBe(false);
        expect(names.some((d) => /SEARCH .*client_names/.test(d)), names.join(' | ')).toBe(true);
        expect(names.some((d) => /\bresults\b/.test(d)), names.join(' | ')).toBe(false);
        // Probes with a head plan the same.
        const withHead = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL.rankingResults}`).all(KEY_R, 'discord', 5, 5, 5, 'x').map((r) => String(r.detail));
        expect(withHead.filter((d) => /\bSCAN\b/.test(d)), withHead.join(' | ')).toStrictEqual([]);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('NFR-125 (store part) the two reads are one statement each, with 10 and with 1,000 counted matches', () => {
    const store = openStore(':memory:');
    for (const count of [10, 1000]) {
      // A second in-memory store per count: the reads see only that count's matches.
      const one = openStore(':memory:');
      for (let i = 0; i < count; i++) {
        put(one, { id: `m${String(i).padStart(4, '0')}`.padEnd(16, 'y'), community: KEY_R, namespace: 'discord', at: T0 + i });
        putResults(one, `m${String(i).padStart(4, '0')}`.padEnd(16, 'y'), [
          victim('discord:u1', 1, true, 3),
          absorber('discord:u1', 2, false, 0),
          winner('discord:u2', false, 0),
        ]);
      }
      let calls = 0;
      const counting: Store = { ...one, rankingResults: (...a) => (calls++, one.rankingResults(...a)), rankingNames: (...a) => (calls++, one.rankingNames(...a)) };
      expect(counting.rankingResults(KEY_R, 'discord', undefined)).toHaveLength(2 * count);
      expect(counting.rankingNames(KEY_R, 'discord', undefined)).toStrictEqual([]);
      expect(calls).toBe(2);
      one.close();
    }
    store.close();
  });
});
