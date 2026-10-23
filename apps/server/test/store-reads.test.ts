import type { MatchEvent, PublicState } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { StoredPrediction } from '../src/core/predictions';
import type { CoreMatch } from '../src/core/view';
import { withFaults } from '../src/store/faults';
import { READ_SQL, openStore } from '../src/store/sqlite';
import type { NamespacePrediction, Store, StoredRecord } from '../src/store/store';

// The store reads of M3a (plan 18.1, T4). FR-279 (keyset): the match list ordered by (creation instant, match id), the
// records by round and the own predictions by (local player id, round with the winner as 0, kind), each read strictly
// after a keyset with a limit, so paging never repeats or skips a row that existed while rows are inserted between pages.
// FR-270 (namespace read): the predictions of one namespace (all its players, or one local id) and never another
// namespace's. FR-300 (host-token lookup): the stored digest of a match's host token, read alone. In-memory SQLite.

const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 20], [3, 30]] });
const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);

const matchOf = (matchId: string, createdAt: number, extra: Partial<CoreMatch> = {}): CoreMatch => ({
  matchId,
  mapId: 'dev',
  mapDigest: DIGEST('a'),
  totalRounds: 5,
  timing: 'manual',
  commitment: DIGEST('c'),
  stage: 'phase-1',
  appliedRounds: 0,
  state: state(0),
  stateDigest: DIGEST('d'),
  lastSeq: 1,
  createdAt,
  lastStepMs: createdAt,
  anchors: null,
  ...extra,
});

const schedule = (match: CoreMatch): MatchEvent => ({ type: 'schedule', seq: 1, stage: match.stage, reportedTime: match.createdAt });

const put = (store: Store, match: CoreMatch, hostTokenDigest = DIGEST('b')): void => {
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest });
    store.appendEvents(match.matchId, [schedule(match)]);
  });
};

const withStore = <T>(body: (store: Store) => T): T => {
  const store = openStore(':memory:');
  try {
    return body(store);
  } finally {
    store.close();
  }
};

const summaryOf = (m: CoreMatch) => ({ matchId: m.matchId, mapId: m.mapId, stage: m.stage, appliedRounds: m.appliedRounds, totalRounds: m.totalRounds, createdAt: m.createdAt });

/** Reads every page with `limit`, calling `between` after each page with the key it ended on. */
function pages<T, K>(read: (after: K | undefined) => T[], keyOf: (item: T) => K, between: (key: K, page: number) => void = () => {}): T[] {
  const out: T[] = [];
  let after: K | undefined;
  for (let page = 0; page < 100; page++) {
    const items = read(after);
    if (items.length === 0) return out;
    out.push(...items);
    after = keyOf(items[items.length - 1]!);
    between(after, page);
  }
  throw new Error('paging did not end');
}

describe('FR-279 (keyset) the match list', () => {
  const T = 1_700_000_000_000;
  const rows = [
    matchOf('BBBBBBBBBBBBBBBB', T + 100),
    matchOf('AAAAAAAAAAAAAAAA', T + 100, { stage: 'halted', haltReason: 'map-changed' }),
    matchOf('ZZZZZZZZZZZZZZZZ', T + 50),
    matchOf('CCCCCCCCCCCCCCCC', T + 200, { stage: 'finished', appliedRounds: 5, state: state(5), winner: 10 }),
    matchOf('aaaaaaaaaaaaaaaa', T + 100),
  ];
  // By creation instant, then match id by code unit (upper case before lower case).
  const ORDER = ['ZZZZZZZZZZZZZZZZ', 'AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB', 'aaaaaaaaaaaaaaaa', 'CCCCCCCCCCCCCCCC'];
  const byId = (id: string): CoreMatch => rows.find((m) => m.matchId === id)!;

  it('FR-279 (keyset) listMatches orders by creation instant then match id and returns exactly the summary fields', () => {
    withStore((store) => {
      rows.forEach((m) => put(store, m));
      const all = store.listMatches(undefined, 10);
      expect(all).toStrictEqual(ORDER.map((id) => summaryOf(byId(id))));
      for (const item of all) expect(Object.keys(item)).toStrictEqual(['matchId', 'mapId', 'stage', 'appliedRounds', 'totalRounds', 'createdAt']);
      expect(store.listMatches(undefined, 2).map((s) => s.matchId)).toStrictEqual(ORDER.slice(0, 2));
    });
  });

  it('FR-279 (keyset) listMatches starts strictly after the key, ties on the instant broken by the match id', () => {
    withStore((store) => {
      rows.forEach((m) => put(store, m));
      const ids = (after: readonly [number, string]): string[] => store.listMatches(after, 10).map((s) => s.matchId);
      expect(ids([T + 100, 'AAAAAAAAAAAAAAAA'])).toStrictEqual(ORDER.slice(2));
      expect(ids([T + 100, 'BBBBBBBBBBBBBBBB'])).toStrictEqual(ORDER.slice(3));
      expect(ids([T + 50, 'ZZZZZZZZZZZZZZZZ'])).toStrictEqual(ORDER.slice(1));
      // A key that names no stored match still starts at its place in the order.
      expect(ids([T + 100, 'AB'])).toStrictEqual(ORDER.slice(2));
      expect(ids([T + 99, 'zzzz'])).toStrictEqual(ORDER.slice(1));
      expect(ids([T + 200, 'CCCCCCCCCCCCCCCC'])).toStrictEqual([]);
    });
  });

  it('FR-279 (keyset) paging the match list by 1 neither repeats nor skips while matches are created between pages', () => {
    withStore((store) => {
      rows.forEach((m) => put(store, m));
      const seen = pages(
        (after: readonly [number, string] | undefined) => store.listMatches(after, 1),
        (s) => [s.createdAt, s.matchId] as const,
        (_key, page) => {
          // Ahead of the cursor (already passed: never seen) and behind it (still to come: seen once).
          if (page === 1) put(store, matchOf('AAAAAAAAAAAAAAA0', T + 10));
          if (page === 2) put(store, matchOf('DDDDDDDDDDDDDDDD', T + 300));
        },
      ).map((s) => s.matchId);
      expect(seen).toStrictEqual([...ORDER, 'DDDDDDDDDDDDDDDD']);
    });
  });

  it('FR-279 (keyset) the match list selects no secret, host-token digest, owners or state', () => {
    const text = READ_SQL.listMatches.toLowerCase();
    for (const banned of ['secret', 'host_token', 'owners', 'states', 'commitment', '*']) expect(text, banned).not.toContain(banned);
    // The scan can fail: the query of a whole match row names a banned part.
    expect(READ_SQL.hostTokenDigest.toLowerCase()).toContain('host_token');
  });
});

describe('FR-279 (keyset) the records of a match', () => {
  const ID = 'RRRRRRRRRRRRRRRR';
  const record = (round: number): StoredRecord => ({ round, eliminated: 20 + round, absorber: 10, transferred: [round, round + 7] });
  const applyRound = (store: Store, matchId: string, round: number): void => {
    store.transaction(() => {
      store.updateMatch(matchOf(matchId, 1_700_000_000_000, { appliedRounds: round, state: state(round), stateDigest: DIGEST(String(round % 10)) }));
      store.putRecord(matchId, record(round));
    });
  };

  it('FR-279 (keyset) recordsAfter returns the records after a round in round order, up to the limit, for that match only', () => {
    withStore((store) => {
      put(store, matchOf(ID, 1_700_000_000_000));
      put(store, matchOf('OOOOOOOOOOOOOOOO', 1_700_000_000_000));
      for (const r of [1, 2, 3]) applyRound(store, ID, r);
      applyRound(store, 'OOOOOOOOOOOOOOOO', 1);
      expect(store.recordsAfter(ID, 0, 10)).toStrictEqual([record(1), record(2), record(3)]);
      expect(store.recordsAfter(ID, 1, 10)).toStrictEqual([record(2), record(3)]);
      expect(store.recordsAfter(ID, 2, 1)).toStrictEqual([record(3)]);
      expect(store.recordsAfter(ID, 3, 10)).toStrictEqual([]);
      expect(store.recordsAfter(ID, 0, 2)).toStrictEqual([record(1), record(2)]);
      expect(store.recordsAfter('OOOOOOOOOOOOOOOO', 0, 10)).toStrictEqual([record(1)]);
      expect(store.recordsAfter('unknown', 0, 10)).toStrictEqual([]);
    });
  });

  it('FR-279 (keyset) paging the records by 1 neither repeats nor skips while rounds are applied between pages', () => {
    withStore((store) => {
      put(store, matchOf(ID, 1_700_000_000_000));
      for (const r of [1, 2]) applyRound(store, ID, r);
      const seen = pages(
        (after: number | undefined) => store.recordsAfter(ID, after ?? 0, 1),
        (r) => r.round,
        (_key, page) => {
          if (page < 2) applyRound(store, ID, page + 3);
        },
      );
      expect(seen).toStrictEqual([1, 2, 3, 4].map(record));
    });
  });
});

describe('FR-270 (namespace read) the predictions of a namespace', () => {
  const ID = 'PPPPPPPPPPPPPPPP';
  const OTHER = 'QQQQQQQQQQQQQQQQ';
  const pick = (kind: StoredPrediction['kind'], round: number, choice: number): StoredPrediction =>
    kind === 'winner' ? { kind, round: 0, choice, version: 1, storedMs: 1_700_000_001_000, winnerCandidates: 3 } : { kind, round, choice, version: 1, storedMs: 1_700_000_001_000 };
  const ROWS: [string, StoredPrediction][] = [
    ['web:a', pick('victim', 2, 21)],
    ['web:a', pick('absorber', 1, 11)],
    ['web:a', pick('victim', 1, 12)],
    ['web:a', pick('winner', 0, 30)],
    ['web:b', pick('victim', 1, 13)],
    ['web:a_b', pick('victim', 1, 14)],
    ['web:aXb', pick('victim', 1, 15)],
    ['web:A', pick('victim', 1, 16)],
    ['webx:a', pick('victim', 1, 17)],
    ['we:ba', pick('victim', 1, 18)],
    ['discord:a', pick('victim', 1, 19)],
  ];
  /** Local ids by code unit ('A' < 'a' < 'aXb' < 'a_b' < 'b'), then round (winner 0), then kind ('absorber' < 'victim'). */
  const WEB_ORDER: [string, number][] = [
    ['A', 16],
    ['a', 30],
    ['a', 11],
    ['a', 12],
    ['a', 21],
    ['aXb', 15],
    ['a_b', 14],
    ['b', 13],
  ];
  const fill = (store: Store): void => {
    put(store, matchOf(ID, 1_700_000_000_000));
    put(store, matchOf(OTHER, 1_700_000_000_000));
    store.transaction(() => {
      for (const [player, p] of ROWS) store.putPrediction(ID, player, p);
      store.putPrediction(OTHER, 'web:a', pick('victim', 1, 99));
    });
  };
  const brief = (rows: NamespacePrediction[]): [string, number][] => rows.map((r) => [r.localId, r.prediction.choice]);
  type Key = readonly [string, number, StoredPrediction['kind']];
  const keyOf = (r: NamespacePrediction): Key => [r.localId, r.prediction.round, r.prediction.kind];

  it('FR-270 (namespace read) FR-279 (keyset) every player of the namespace, ordered by local id, round (winner 0) and kind, with the stored rows', () => {
    withStore((store) => {
      fill(store);
      const all = store.predictionsInNamespace(ID, 'web', undefined, 100);
      expect(brief(all)).toStrictEqual(WEB_ORDER);
      expect(all[1]).toStrictEqual({ localId: 'a', prediction: pick('winner', 0, 30) });
      expect(all[2]).toStrictEqual({ localId: 'a', prediction: pick('absorber', 1, 11) });
      expect(brief(store.predictionsInNamespace(ID, 'web', undefined, 3))).toStrictEqual(WEB_ORDER.slice(0, 3));
      expect(brief(store.predictionsInNamespace(OTHER, 'web', undefined, 100))).toStrictEqual([['a', 99]]);
      expect(store.predictionsInNamespace('unknown', 'web', undefined, 100)).toStrictEqual([]);
    });
  });

  it('FR-270 (namespace read) namespaces never mix: web, webx, we and discord each read only their own players', () => {
    withStore((store) => {
      fill(store);
      expect(brief(store.predictionsInNamespace(ID, 'webx', undefined, 100))).toStrictEqual([['a', 17]]);
      expect(brief(store.predictionsInNamespace(ID, 'we', undefined, 100))).toStrictEqual([['ba', 18]]);
      expect(brief(store.predictionsInNamespace(ID, 'discord', undefined, 100))).toStrictEqual([['a', 19]]);
      expect(store.predictionsInNamespace(ID, 'w', undefined, 100)).toStrictEqual([]);
      expect(store.predictionsInNamespace(ID, 'bot', undefined, 100)).toStrictEqual([]);
    });
  });

  it('FR-270 (namespace read) one local id: exact and case-sensitive, `_` and `.` are not wildcards', () => {
    withStore((store) => {
      fill(store);
      expect(brief(store.predictionsInNamespace(ID, 'web', undefined, 100, 'a_b'))).toStrictEqual([['a_b', 14]]);
      expect(brief(store.predictionsInNamespace(ID, 'web', undefined, 100, 'a'))).toStrictEqual(WEB_ORDER.filter(([l]) => l === 'a'));
      expect(brief(store.predictionsInNamespace(ID, 'web', undefined, 100, 'A'))).toStrictEqual([['A', 16]]);
      expect(store.predictionsInNamespace(ID, 'web', undefined, 100, 'a.b')).toStrictEqual([]);
      expect(store.predictionsInNamespace(ID, 'discord', undefined, 100, 'b')).toStrictEqual([]);
      expect(brief(store.predictionsInNamespace(ID, 'web', ['a', 1, 'absorber'], 100, 'a'))).toStrictEqual([['a', 12], ['a', 21]]);
    });
  });

  it('FR-270 (namespace read) a namespace or local id outside its character set is refused, never used as a pattern', () => {
    withStore((store) => {
      fill(store);
      for (const ns of ['', 'web:', 'we%', 'web_', 'WEB', 'a'.repeat(17)]) expect(() => store.predictionsInNamespace(ID, ns, undefined, 10), ns).toThrow(RangeError);
      for (const local of ['', '%', 'a%', 'a:b', 'a'.repeat(65)]) expect(() => store.predictionsInNamespace(ID, 'web', undefined, 10, local), local).toThrow(RangeError);
      for (const limit of [0, -1, 1.5, Number.NaN]) expect(() => store.predictionsInNamespace(ID, 'web', undefined, limit)).toThrow(RangeError);
    });
  });

  it('FR-279 (keyset) the predictions start strictly after the key (local id, round, kind)', () => {
    withStore((store) => {
      fill(store);
      const after = (key: Key): [string, number][] => brief(store.predictionsInNamespace(ID, 'web', key, 100));
      expect(after(['a', 0, 'winner'])).toStrictEqual(WEB_ORDER.slice(2));
      expect(after(['a', 1, 'absorber'])).toStrictEqual(WEB_ORDER.slice(3));
      expect(after(['a', 1, 'victim'])).toStrictEqual(WEB_ORDER.slice(4));
      expect(after(['A', 1, 'victim'])).toStrictEqual(WEB_ORDER.slice(1));
      expect(after(['a', 2, 'victim'])).toStrictEqual(WEB_ORDER.slice(5));
      // A key between stored rows: ('a', 1, 'victim') < ('a', 2, 'absorber') < ('a', 2, 'victim').
      expect(after(['a', 2, 'absorber'])).toStrictEqual(WEB_ORDER.slice(4));
      expect(after(['b', 1, 'victim'])).toStrictEqual([]);
    });
  });

  it('FR-279 (keyset) paging the predictions by 1 neither repeats nor skips while predictions are stored between pages', () => {
    withStore((store) => {
      fill(store);
      const seen = pages(
        (after: Key | undefined) => store.predictionsInNamespace(ID, 'web', after, 1),
        keyOf,
        (_key, page) => {
          store.transaction(() => {
            // Ahead of the cursor (never seen) and behind it (seen once).
            if (page === 2) store.putPrediction(ID, 'web:A', pick('absorber', 3, 40));
            if (page === 3) store.putPrediction(ID, 'web:zz', pick('victim', 1, 41));
            if (page === 4) store.putPrediction(ID, 'web:a', pick('absorber', 1, 11));
          });
        },
      );
      expect(brief(seen)).toStrictEqual([...WEB_ORDER, ['zz', 41]]);
    });
  });
});

describe('FR-300 (host-token lookup)', () => {
  it('FR-300 (host-token lookup) hostTokenDigest reads the stored digest of one match and nothing for an unknown match', () => {
    withStore((store) => {
      put(store, matchOf('HHHHHHHHHHHHHHHH', 1_700_000_000_000), DIGEST('e'));
      put(store, matchOf('IIIIIIIIIIIIIIII', 1_700_000_000_000), DIGEST('f'));
      expect(store.hostTokenDigest('HHHHHHHHHHHHHHHH')).toBe(DIGEST('e'));
      expect(store.hostTokenDigest('IIIIIIIIIIIIIIII')).toBe(DIGEST('f'));
      expect(store.hostTokenDigest('unknown')).toBeUndefined();
      expect(READ_SQL.hostTokenDigest.toLowerCase()).not.toContain('secret');
    });
  });
});

describe('the fault seam forwards the reads', () => {
  it('FR-279 (keyset) FR-270 (namespace read) FR-300 (host-token lookup) the wrapped store reads what the store reads', () => {
    withStore((store) => {
      put(store, matchOf('SSSSSSSSSSSSSSSS', 1_700_000_000_000, { appliedRounds: 1, state: state(1) }), DIGEST('7'));
      store.transaction(() => {
        store.putRecord('SSSSSSSSSSSSSSSS', { round: 1, eliminated: 20, absorber: 10, transferred: [2] });
        store.putPrediction('SSSSSSSSSSSSSSSS', 'web:p', { kind: 'victim', round: 2, choice: 10, version: 1, storedMs: 1 });
      });
      const wrapped = withFaults(store, {});
      expect(wrapped.listMatches(undefined, 5)).toStrictEqual(store.listMatches(undefined, 5));
      expect(wrapped.listMatches(undefined, 5)).toHaveLength(1);
      expect(wrapped.recordsAfter('SSSSSSSSSSSSSSSS', 0, 5)).toStrictEqual(store.recordsAfter('SSSSSSSSSSSSSSSS', 0, 5));
      expect(wrapped.recordsAfter('SSSSSSSSSSSSSSSS', 0, 5)).toHaveLength(1);
      expect(wrapped.predictionsInNamespace('SSSSSSSSSSSSSSSS', 'web', undefined, 5, 'p')).toStrictEqual([{ localId: 'p', prediction: { kind: 'victim', round: 2, choice: 10, version: 1, storedMs: 1 } }]);
      expect(wrapped.hostTokenDigest('SSSSSSSSSSSSSSSS')).toBe(DIGEST('7'));
    });
  });
});
