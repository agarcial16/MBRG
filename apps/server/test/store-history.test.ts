import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PublicState } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { compareHistory, type HistoryKey, type HistoryMatch } from '../src/core/history';
import type { CoreMatch } from '../src/core/view';
import { READ_SQL, openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { TOTAL_STEPS, openScript, runScript } from './helpers/results-script';
import { DIGEST, SECRET, T0, id, put, state } from './helpers/history-rows';
import type { Spec } from './helpers/history-rows';
import { START_MS } from './helpers/service-harness';

// Spec 024 store reads of the history: the finished matches of a community key and a namespace, in history order (finish
// instant descending, then match id ascending), keyset after a key and bounded by a head. Key and ids are planted literals.

// A settled bound that lists every finished match (the history reads of these tests ignore the settling; its own test is below).
const FAR = Number.MAX_SAFE_INTEGER;
const KEY_A = '7a11ce0d5eed7a11ce0d5eed7a11ce0d5eed7a11ce0d5eed7a11ce0d5eed7a11';
const KEY_B = '0b0e5ca1ab1e0b0e5ca1ab1e0b0e5ca1ab1e0b0e5ca1ab1e0b0e5ca1ab1e0b0e';

const ids = (rows: readonly HistoryKey[]): string[] => rows.map((r) => r.matchId);
const pos = (row: HistoryKey): HistoryKey => ({ finishedAt: row.finishedAt, matchId: row.matchId });

describe('FR-549 FR-561 (store part) the history reads of the store', () => {
  it('FR-561 (store part) only finished matches of the key and the namespace are read: lobby, expired, running and halted ones of the same key never', () => {
    const store = openStore(':memory:');
    put(store, { id: id('a'), community: KEY_A, namespace: 'discord' });
    for (const [n, stage] of (['lobby', 'expired', 'phase-1', 'phase-2', 'locked', 'halted'] as const).entries()) {
      put(store, { id: id('b', n), stage, community: KEY_A, namespace: 'discord' });
    }
    put(store, { id: id('c'), community: KEY_B, namespace: 'discord' });
    put(store, { id: id('d'), community: KEY_A, namespace: 'web' });
    put(store, { id: id('e') });
    put(store, { id: id('f'), namespace: 'discord' });
    expect(ids(store.historyAfter(KEY_A, 'discord', FAR, undefined, undefined, 50))).toStrictEqual([id('a')]);
    expect(store.historyCount(KEY_A, 'discord', FAR, undefined)).toBe(1);
    expect(ids(store.historyAfter(KEY_A, 'web', FAR, undefined, undefined, 50))).toStrictEqual([id('d')]);
    expect(ids(store.historyAfter(KEY_B, 'discord', FAR, undefined, undefined, 50))).toStrictEqual([id('c')]);
    expect(store.historyAfter(KEY_B, 'web', FAR, undefined, undefined, 50)).toStrictEqual([]);
    expect(store.historyAfter('f'.repeat(64), 'discord', FAR, undefined, undefined, 50)).toStrictEqual([]);
    expect(store.historyCount('f'.repeat(64), 'discord', FAR, undefined)).toBe(0);
    expect(store.historyCount(KEY_B, 'web', FAR, undefined)).toBe(0);
    store.close();
  });

  it('FR-549 (store part) a row holds the match id, the map id, the finish instant (the last step instant) and the winner, and nothing else', () => {
    const store = openStore(':memory:');
    put(store, { id: id('a'), community: KEY_A, namespace: 'discord', at: T0 + 7777, winner: 12, map: 'dev' });
    const rows = store.historyAfter(KEY_A, 'discord', FAR, undefined, undefined, 5);
    expect(rows).toStrictEqual([{ matchId: id('a'), mapId: 'dev', finishedAt: T0 + 7777, winner: 12 }]);
    expect(Object.keys(rows[0]!)).toStrictEqual(['matchId', 'mapId', 'finishedAt', 'winner']);
    store.close();
  });

  it('FR-549 (store part) rows come in history order: finish instant descending, then match id ascending by code unit', () => {
    const store = openStore(':memory:');
    const specs: [string, number][] = [['m-b', 30], ['m-a', 30], ['M-z', 30], ['m-c', 20], ['m-a2', 40], ['m-a1', 10]];
    for (const [matchId, at] of specs) put(store, { id: matchId, at: T0 + at, community: KEY_A, namespace: 'discord' });
    const all = store.historyAfter(KEY_A, 'discord', FAR, undefined, undefined, 100);
    expect(ids(all)).toStrictEqual(['m-a2', 'M-z', 'm-a', 'm-b', 'm-c', 'm-a1']);
    expect([...all].sort(compareHistory)).toStrictEqual(all);
    expect(store.historyCount(KEY_A, 'discord', FAR, undefined)).toBe(6);
    store.close();
  });

  it('FR-549 (store part) a keyset read starts strictly after a key and a page of the walk never repeats or skips, ties included', () => {
    const store = openStore(':memory:');
    for (let i = 0; i < 11; i += 1) put(store, { id: `w-${String(i).padStart(2, '0')}`, at: T0 + Math.floor(i / 3) * 10, community: KEY_A, namespace: 'discord' });
    const all = store.historyAfter(KEY_A, 'discord', FAR, undefined, undefined, 100);
    expect(all).toHaveLength(11);
    for (const size of [1, 2, 3, 4, 10, 11, 12]) {
      const seen: HistoryMatch[] = [];
      let after: HistoryKey | undefined;
      for (let guard = 0; guard < 20; guard += 1) {
        const page = store.historyAfter(KEY_A, 'discord', FAR, undefined, after, size);
        expect(page.length).toBeLessThanOrEqual(size);
        if (page.length === 0) break;
        seen.push(...page);
        after = pos(page[page.length - 1]!);
      }
      expect(seen, `page size ${size}`).toStrictEqual(all);
    }
    // After the very last key: nothing; after a key that is not a match (between two instants): the rest from there.
    expect(store.historyAfter(KEY_A, 'discord', FAR, undefined, pos(all[10]!), 5)).toStrictEqual([]);
    expect(ids(store.historyAfter(KEY_A, 'discord', FAR, undefined, { finishedAt: T0 + 15, matchId: 'zzz' }, 50))).toStrictEqual(ids(all.filter((r) => r.finishedAt < T0 + 15)));
    store.close();
  });

  it('FR-549 (store part) the head bounds both reads: a match newer than the head is neither listed nor counted, the head itself is', () => {
    const store = openStore(':memory:');
    for (const [matchId, at] of [['h-1', 50], ['h-2', 40], ['h-3', 40], ['h-4', 30], ['h-5', 20]] as const) put(store, { id: matchId, at: T0 + at, community: KEY_A, namespace: 'discord' });
    const head = { finishedAt: T0 + 40, matchId: 'h-2' };
    expect(ids(store.historyAfter(KEY_A, 'discord', FAR, head, undefined, 50))).toStrictEqual(['h-2', 'h-3', 'h-4', 'h-5']);
    expect(store.historyCount(KEY_A, 'discord', FAR, head)).toBe(4);
    // Same instant as the head but a lower match id sorts before it: outside the snapshot.
    const tie = { finishedAt: T0 + 40, matchId: 'h-3' };
    expect(ids(store.historyAfter(KEY_A, 'discord', FAR, tie, undefined, 50))).toStrictEqual(['h-3', 'h-4', 'h-5']);
    expect(store.historyCount(KEY_A, 'discord', FAR, tie)).toBe(3);
    // The head and a cursor together: the rest of the snapshot after the key.
    expect(ids(store.historyAfter(KEY_A, 'discord', FAR, head, { finishedAt: T0 + 40, matchId: 'h-3' }, 50))).toStrictEqual(['h-4', 'h-5']);
    // A head older than every match leaves nothing; no head leaves everything.
    expect(store.historyCount(KEY_A, 'discord', FAR, { finishedAt: T0, matchId: 'a' })).toBe(0);
    expect(store.historyCount(KEY_A, 'discord', FAR, undefined)).toBe(5);
    store.close();
  });

  it('FR-561 (store part) a match that finishes after the snapshot is outside it, and a match that is not finished stays out after any step', () => {
    const store = openStore(':memory:');
    put(store, { id: 'k-1', at: T0 + 10, community: KEY_A, namespace: 'discord' });
    put(store, { id: 'k-2', stage: 'phase-2', at: T0 + 50, community: KEY_A, namespace: 'discord' });
    const head = pos(store.historyAfter(KEY_A, 'discord', FAR, undefined, undefined, 1)[0]!);
    expect(head).toStrictEqual({ finishedAt: T0 + 10, matchId: 'k-1' });
    // k-2 finishes later than the head: a read bounded by the head neither lists nor counts it; an unbounded read does.
    const running = store.getMatch('k-2')!;
    store.transaction(() =>
      store.updateMatch({ ...running.match, stage: 'finished', appliedRounds: 5, state: state(5), stateDigest: DIGEST('e'), lastStepMs: T0 + 60, winner: 10 }),
    );
    expect(ids(store.historyAfter(KEY_A, 'discord', FAR, head, undefined, 10))).toStrictEqual(['k-1']);
    expect(store.historyCount(KEY_A, 'discord', FAR, head)).toBe(1);
    expect(ids(store.historyAfter(KEY_A, 'discord', FAR, undefined, undefined, 10))).toStrictEqual(['k-2', 'k-1']);
    store.close();
  });

  it('FR-549 (store part) only SETTLED matches are read: a finish instant at or above the bound is neither listed nor counted, in the read and in the count', () => {
    const store = openStore(':memory:');
    for (const [n, at] of [10, 20, 30, 40].entries()) put(store, { id: id('s', n), at: T0 + at, community: KEY_A, namespace: 'discord' });
    const listed = (bound: number): string[] => ids(store.historyAfter(KEY_A, 'discord', bound, undefined, undefined, 10));
    expect(listed(T0 + 41)).toStrictEqual([id('s', 3), id('s', 2), id('s', 1), id('s', 0)]);
    // Strictly below the bound: an instant equal to it is not settled.
    expect(listed(T0 + 40)).toStrictEqual([id('s', 2), id('s', 1), id('s', 0)]);
    expect(listed(T0 + 21)).toStrictEqual([id('s', 1), id('s', 0)]);
    expect(listed(T0 + 10)).toStrictEqual([]);
    for (const [bound, count] of [[T0 + 41, 4], [T0 + 40, 3], [T0 + 21, 2], [T0 + 10, 0]] as const) {
      expect(store.historyCount(KEY_A, 'discord', bound, undefined), `count below ${bound}`).toBe(count);
    }
    // With a head the bound still applies: a head at the newest unsettled position counts only the settled ones at or after it.
    expect(store.historyCount(KEY_A, 'discord', T0 + 21, { finishedAt: T0 + 20, matchId: id('s', 1) })).toBe(2);
    expect(ids(store.historyAfter(KEY_A, 'discord', T0 + 21, { finishedAt: T0 + 30, matchId: id('s', 2) }, undefined, 10))).toStrictEqual([id('s', 1), id('s', 0)]);
    // A bound that is not a whole instant is refused.
    for (const bound of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => store.historyAfter(KEY_A, 'discord', bound, undefined, undefined, 5), String(bound)).toThrow(RangeError);
      expect(() => store.historyCount(KEY_A, 'discord', bound, undefined), String(bound)).toThrow(RangeError);
    }
    store.close();
  });

  it('FR-549 (store part) a key, a namespace, a position or a limit of the wrong shape is a RangeError, whatever is stored', () => {
    const store = openStore(':memory:');
    const bad = (read: () => unknown): void => expect(read).toThrow(RangeError);
    for (const key of ['', 'a', KEY_A.toUpperCase(), KEY_A.slice(1), `${KEY_A}0`, ' '.repeat(64)]) {
      bad(() => store.historyAfter(key, 'discord', FAR, undefined, undefined, 5));
      bad(() => store.historyCount(key, 'discord', FAR, undefined));
    }
    for (const namespace of ['', 'Discord', 'a:b', 'x'.repeat(17)]) {
      bad(() => store.historyAfter(KEY_A, namespace, FAR, undefined, undefined, 5));
      bad(() => store.historyCount(KEY_A, namespace, FAR, undefined));
    }
    for (const limit of [0, -1, 1.5, Number.NaN, 502, 1000]) bad(() => store.historyAfter(KEY_A, 'discord', FAR, undefined, undefined, limit));
    for (const position of [{ finishedAt: -1, matchId: 'a' }, { finishedAt: 1.5, matchId: 'a' }, { finishedAt: 1, matchId: '' }, { finishedAt: 1 }, null] as never[]) {
      bad(() => store.historyAfter(KEY_A, 'discord', FAR, position, undefined, 5));
      bad(() => store.historyAfter(KEY_A, 'discord', FAR, undefined, position, 5));
      bad(() => store.historyCount(KEY_A, 'discord', FAR, position));
    }
    // 501 is allowed: a page of 500 and the row that tells whether more follow.
    expect(store.historyAfter(KEY_A, 'discord', FAR, undefined, undefined, 501)).toStrictEqual([]);
    store.close();
  });

  it('FR-550 (finish instant) the last step instant of a finished match is the instant of its last application step, and the read gives it', () => {
    const r = openScript();
    // The clock moves 1,000 ms before every step, so each step has an instant of its own.
    for (let done = 1; done <= TOTAL_STEPS; done += 1) {
      r.h.clock.advance(1000);
      runScript(r, done);
    }
    const match = r.h.store.getMatch(r.id)!.match;
    expect(match.stage).toBe('finished');
    const applications = r.h.store.steps(r.id).filter((s) => s.kind === 'application');
    expect(applications).toHaveLength(4);
    const last = applications[applications.length - 1]!;
    expect(last.round).toBe(4);
    expect(new Set(r.h.store.steps(r.id).map((s) => s.instant)).size).toBe(TOTAL_STEPS);
    expect(last.instant).toBe(START_MS + 12_000);
    // No step follows the last application, and the match row carries its instant.
    expect(r.h.store.steps(r.id).at(-1)).toStrictEqual(last);
    expect(match.lastStepMs).toBe(last.instant);
    r.h.store.transaction(() => {
      r.h.store.insertClientMatch(r.id, 'discord');
      r.h.store.insertCommunity(r.id, KEY_A);
    });
    expect(r.h.store.historyAfter(KEY_A, 'discord', FAR, undefined, undefined, 5)).toStrictEqual([
      { matchId: r.id, mapId: 'dev', finishedAt: last.instant, winner: match.winner },
    ]);
    r.h.close();
  });

  it('NFR-121 (store part) the two statements reach matches, results and communities through indexes: no scan of those tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrg-history-plan-'));
    try {
      const file = join(dir, 'h.sqlite');
      openStore(file).close();
      const db = new DatabaseSync(file);
      try {
        const after = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL.historyAfter}`).all(KEY_A, 'discord', FAR, null, null, null, null, null, null, null, null, 5).map((r) => String(r.detail));
        const count = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL.historyCount}`).all(KEY_A, 'discord', FAR, null, null, null, null).map((r) => String(r.detail));
        for (const plan of [after, count]) {
          const text = plan.join(' | ');
          expect(plan.filter((d) => /\bSCAN\b/.test(d)), text).toStrictEqual([]);
          expect(plan.some((d) => /SEARCH .*communities/.test(d)), text).toBe(true);
          expect(plan.some((d) => /SEARCH .*matches/.test(d)), text).toBe(true);
          expect(plan.some((d) => /\bresults\b/.test(d)), text).toBe(false);
        }
        // Probes with a head and an after key plan the same.
        const withKeys = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL.historyAfter}`).all(KEY_A, 'discord', FAR, 5, 5, 5, 'x', 5, 5, 5, 'x', 5).map((r) => String(r.detail));
        expect(withKeys.filter((d) => /\bSCAN\b/.test(d)), withKeys.join(' | ')).toStrictEqual([]);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
