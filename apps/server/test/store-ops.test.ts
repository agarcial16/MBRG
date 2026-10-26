import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MatchEvent, PublicState, PublicVictim } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { MEMO_RETENTION_MS } from '../src/core/memo';
import type { StoredPrediction } from '../src/core/predictions';
import { CORE_MATCH_KEYS, type CoreMatch } from '../src/core/view';
import { StoreError, type Store, type StoredMatch, type StoredStep } from '../src/store/store';
import { withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { TABLES } from '../src/store/schema';
import {
  absorberColumnsOutsideRecords,
  credentialTextColumns,
  listColumns,
  pendingStateColumns,
  rowsBeyondApplied,
  scanValues,
  withRawDb,
} from './helpers/db-scan';

// FR-293: the recovery data of a match, its step rows and the plain secret column (D14).
// FR-270 (storage): the stored predictions of one player id, read back per player.
// FR-240 (storage): the step rows of one decision are written in one transaction, in order.
// FR-267 (persistence): the prediction row is upserted by (match, player, kind, round) with its version.
// Every file database lives in a unique temporary directory removed in `finally`.

const withTempDir = <T>(body: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-ops-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const withStore = <T>(body: (store: Store) => T): T => {
  const store = openStore(':memory:');
  try {
    return body(store);
  } finally {
    store.close();
  }
};

const state = (round: number, owners: [number, number][] = [[1, 10], [2, 20], [3, 30]]): PublicState => ({ mode: 'classic', round, owners });
const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
const HOST_DIGEST = DIGEST('b');

const victim: PublicVictim = { round: 2, victim: 20, candidates: [10, 30], living: [10, 20, 30], revealedAt: 1_700_000_061_234, c2: 1_700_000_090_000, a: 1_700_000_100_000, seq: 4 };
const revealed = (v: PublicVictim): MatchEvent => ({ type: 'victim-revealed', ...v, reportedTime: v.revealedAt });

const base: CoreMatch = {
  matchId: 'AAAAAAAAAAAAAAAA',
  mapId: 'dev',
  mapDigest: DIGEST('a'),
  totalRounds: 5,
  timing: { i: 120, l1: 30, l2: 10 },
  commitment: DIGEST('c'),
  stage: 'phase-1',
  appliedRounds: 0,
  state: state(0),
  stateDigest: DIGEST('d'),
  lastSeq: 1,
  createdAt: 1_700_000_000_123,
  lastStepMs: 1_700_000_000_123,
  anchors: { t0: 1_700_000_000_123, c1: 1_700_000_080_123, c2: 1_700_000_110_123, a: 1_700_000_120_123 },
};

const created = (match: CoreMatch = base): StoredMatch => ({ match, secret: SECRET, hostTokenDigest: HOST_DIGEST });
const schedule = (match: CoreMatch, seq = 1): MatchEvent => ({ type: 'schedule', seq, stage: match.stage, reportedTime: match.createdAt });

/** Stores a match and its first event the way the service will: one transaction. */
const put = (store: Store, match: CoreMatch = base): void => {
  store.transaction(() => {
    store.insertMatch(created(match));
    store.appendEvents(match.matchId, [schedule(match)]);
  });
};

const step = (round: number, kind: StoredStep['kind'], instant: number, firstSeq: number, lastSeq = firstSeq, cause: StoredStep['cause'] = 'clock'): StoredStep => ({
  round,
  kind,
  instant,
  cause,
  firstSeq,
  lastSeq,
});

const codeOf = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    if (error instanceof StoreError) return error.code;
    throw error;
  }
  return 'no error';
};

describe('matches', () => {
  it('FR-293 a stored match round-trips through every CORE_MATCH_KEYS field with its plain secret and host-token digest', () => {
    withStore((store) => {
      put(store);
      const back = store.getMatch(base.matchId);
      expect(back?.match).toStrictEqual(base);
      expect(Object.keys(back?.match ?? {}).sort()).toStrictEqual([...CORE_MATCH_KEYS].filter((k) => k in base).sort());
      expect(back?.secret).toStrictEqual(SECRET);
      expect(back?.hostTokenDigest).toBe(HOST_DIGEST);
      expect(store.getMatch('unknown')).toBeUndefined();
    });
  });

  it('FR-293 every stage round-trips: anchors null and set, victim fields, winner and halt reason', () => {
    const phase2: CoreMatch = {
      ...base,
      stage: 'phase-2',
      appliedRounds: 1,
      state: state(1, [[1, 10], [2, 10], [3, 30]]),
      stateDigest: DIGEST('e'),
      lastSeq: 4,
      lastStepMs: victim.revealedAt,
      anchors: { t0: base.createdAt, c1: 1_700_000_190_123, c2: victim.c2 ?? 0, a: victim.a ?? 0 },
      victim,
    };
    const cases: CoreMatch[] = [
      base,
      { ...base, timing: 'manual', anchors: null },
      phase2,
      { ...phase2, stage: 'locked' },
      { ...phase2, stage: 'halted', haltReason: 'victim-mismatch', anchors: null },
      { ...base, stage: 'halted', haltReason: 'isolated-faction', anchors: null },
      { ...base, stage: 'halted', haltReason: 'map-changed' },
      { ...base, stage: 'finished', appliedRounds: 5, state: state(5, [[1, 10], [2, 10], [3, 10]]), winner: 10, anchors: null, lastSeq: 9 },
    ];
    for (const match of cases) {
      withStore((store) => {
        store.transaction(() => {
          store.insertMatch(created(match));
          // The revealed victim fields are public events too: the first events fill the numbers up to lastSeq.
          const events: MatchEvent[] = [];
          for (let seq = 1; seq <= match.lastSeq; seq++) events.push(match.victim !== undefined && seq === match.victim.seq ? revealed(match.victim) : schedule(match, seq));
          store.appendEvents(match.matchId, events);
        });
        expect(store.getMatch(match.matchId)?.match, `${match.stage} ${JSON.stringify(match.anchors)}`).toStrictEqual(match);
      });
    }
  });

  it('FR-293 an update stores the new stage, N, anchors, last step instant, victim and state, and keeps the rest', () => {
    withStore((store) => {
      put(store);
      const next: CoreMatch = {
        ...base,
        stage: 'phase-2',
        lastSeq: 3,
        lastStepMs: 1_700_000_061_234,
        anchors: { t0: base.createdAt, c1: base.anchors?.c1 ?? 0, c2: 1_700_000_090_000, a: 1_700_000_100_000 },
        victim: { ...victim, round: 1, seq: 3 },
      };
      store.transaction(() => {
        store.appendEvents(base.matchId, [{ type: 'phase-closed', seq: 2, round: 1, phase: 1, at: next.lastStepMs }, revealed({ ...victim, round: 1, seq: 3 })]);
        store.updateMatch(next);
      });
      expect(store.getMatch(base.matchId)?.match).toStrictEqual(next);
      expect(store.getMatch(base.matchId)?.secret).toStrictEqual(SECRET);
      expect(store.getMatch(base.matchId)?.hostTokenDigest).toBe(HOST_DIGEST);
      const { victim: _gone, ...rest } = next;
      const withoutVictim: CoreMatch = { ...rest, stage: 'phase-1', appliedRounds: 1, state: state(1, [[1, 10], [2, 10], [3, 30]]), stateDigest: DIGEST('f') };
      store.transaction(() => store.updateMatch(withoutVictim));
      expect(store.getMatch(base.matchId)?.match).toStrictEqual(withoutVictim);
      expect(store.getState(base.matchId, 0)).toStrictEqual({ state: base.state, stateDigest: base.stateDigest });
      expect(store.getState(base.matchId, 1)).toStrictEqual({ state: withoutVictim.state, stateDigest: withoutVictim.stateDigest });
      expect(store.getState(base.matchId, 2)).toBeUndefined();
    });
  });

  it('FR-293 timing, map, commitment, creation instant and T never change, and N never decreases', () => {
    withStore((store) => {
      put(store);
      const attempts: CoreMatch[] = [
        { ...base, timing: 'manual', anchors: null },
        { ...base, mapDigest: DIGEST('0') },
        { ...base, mapId: 'other' },
        { ...base, commitment: DIGEST('1') },
        { ...base, createdAt: base.createdAt + 1 },
        { ...base, totalRounds: 6 },
      ];
      for (const attempt of attempts) expect(codeOf(() => store.transaction(() => store.updateMatch(attempt)))).toBe('invalid-write');
      store.transaction(() => store.updateMatch({ ...base, appliedRounds: 1, state: state(1) }));
      expect(codeOf(() => store.transaction(() => store.updateMatch(base)))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.updateMatch({ ...base, matchId: 'missing' })))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.insertMatch(created())))).toBe('invalid-write');
    });
  });

  it('FR-293 the secret is exactly 32 bytes, the state round equals N and the host token arrives as a digest', () => {
    withStore((store) => {
      expect(codeOf(() => store.transaction(() => store.insertMatch({ ...created(), secret: new Uint8Array(31) })))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.insertMatch({ ...created({ ...base, state: state(1) }) })))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.insertMatch({ ...created(), hostTokenDigest: 'a-host-token-in-plain-text' })))).toBe('invalid-write');
      expect(store.getMatch(base.matchId)).toBeUndefined();
    });
  });

  it('FR-293 reopening a file database reads back the match, the secret and the events', () => {
    withTempDir((dir) => {
      const file = join(dir, 'a.sqlite');
      const first = openStore(file);
      put(first);
      first.close();
      const second = openStore(file);
      try {
        expect(second.getMatch(base.matchId)).toStrictEqual(created());
        expect(second.eventsAfter(base.matchId, 0)).toStrictEqual([schedule(base)]);
      } finally {
        second.close();
      }
    });
  });

  it('FR-293 the running count covers phase-1, phase-2 and locked, never halted or finished', () => {
    withStore((store) => {
      const stages: CoreMatch['stage'][] = ['phase-1', 'phase-2', 'locked', 'halted', 'finished', 'phase-1'];
      expect(store.runningCount()).toBe(0);
      stages.forEach((stage, i) => {
        const match: CoreMatch = { ...base, matchId: `M${i}`, stage, anchors: null, timing: 'manual', lastSeq: 1 };
        const withVictim: CoreMatch = stage === 'phase-2' || stage === 'locked' ? { ...match, victim: { ...victim, round: 1, seq: 1 } } : match;
        const extra: CoreMatch = stage === 'halted' ? { ...withVictim, haltReason: 'map-changed' } : stage === 'finished' ? { ...withVictim, winner: 10 } : withVictim;
        store.transaction(() => {
          store.insertMatch(created(extra));
          store.appendEvents(extra.matchId, [extra.victim !== undefined ? revealed(extra.victim) : schedule(extra)]);
        });
      });
      expect(store.runningCount()).toBe(4);
      // The same matches by id, oldest first (what a tick walks): M0 phase-1, M1 phase-2, M2 locked, M5 phase-1.
      expect(store.runningMatchIds()).toStrictEqual(['M0', 'M1', 'M2', 'M5']);
    });
  });
});

describe('states, records and steps', () => {
  it('FR-293 states and records are stored per applied round and read back in round order', () => {
    withStore((store) => {
      put(store);
      const records = [
        { round: 1, eliminated: 20, absorber: 10, transferred: [2] },
        { round: 2, eliminated: 30, absorber: 10, transferred: [3] },
      ];
      store.transaction(() => store.updateMatch({ ...base, appliedRounds: 1, state: state(1, [[1, 10], [2, 10], [3, 30]]), stateDigest: DIGEST('1') }));
      store.transaction(() => store.putRecord(base.matchId, records[0]!));
      store.transaction(() => store.updateMatch({ ...base, appliedRounds: 2, state: state(2, [[1, 10], [2, 10], [3, 10]]), stateDigest: DIGEST('2') }));
      store.transaction(() => store.putRecord(base.matchId, records[1]!));
      expect(store.records(base.matchId)).toStrictEqual(records);
      expect(store.getState(base.matchId, 2)?.stateDigest).toBe(DIGEST('2'));
      expect(store.records('unknown')).toStrictEqual([]);
    });
  });

  it('FR-293 a record exists only for an applied round: round 0, above N and a replaced record are refused', () => {
    withStore((store) => {
      put(store);
      const record = (round: number): { round: number; eliminated: number; absorber: number; transferred: number[] } => ({ round, eliminated: 20, absorber: 10, transferred: [2] });
      expect(codeOf(() => store.transaction(() => store.putRecord(base.matchId, record(1))))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.putRecord(base.matchId, record(0))))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.putRecord('missing', record(1))))).toBe('invalid-write');
      store.transaction(() => store.updateMatch({ ...base, appliedRounds: 1, state: state(1) }));
      store.transaction(() => store.putRecord(base.matchId, record(1)));
      expect(codeOf(() => store.transaction(() => store.putRecord(base.matchId, record(2))))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.putRecord(base.matchId, record(1))))).toBe('invalid-write');
      expect(store.records(base.matchId)).toHaveLength(1);
    });
  });

  it('FR-240 (storage) two step rows written in one transaction keep their order and instant (L2 = 0)', () => {
    withStore((store) => {
      put(store);
      const instant = 1_700_000_080_123;
      const one = step(1, 'phase-2-close', instant, 2, 2);
      const two = step(1, 'application', instant, 3, 4);
      store.transaction(() => {
        store.appendEvents(base.matchId, [
          { type: 'phase-closed', seq: 2, round: 1, phase: 2, at: instant },
          { type: 'results', seq: 3, round: 1, phase: 2 },
          { type: 'results', seq: 4, round: 1, phase: 2 },
        ]);
        store.putStep(base.matchId, one);
        store.putStep(base.matchId, two);
      });
      expect(store.steps(base.matchId)).toStrictEqual([one, two]);
      // Stored the other way round they read back the other way round: the order is the insertion order, not the kind.
      withStore((other) => {
        put(other);
        other.transaction(() => {
          other.putStep(base.matchId, two);
          other.putStep(base.matchId, one);
        });
        expect(other.steps(base.matchId)).toStrictEqual([two, one]);
      });
    });
  });

  it('FR-293 a step row keeps round, kind, instant, cause and the numbers of its events; a repeat of the row is refused', () => {
    withStore((store) => {
      put(store);
      const rows = [step(1, 'phase-1-close', 1_700_000_080_123, 2, 3, 'clock'), step(1, 'phase-2-close', 1_700_000_090_999, 4, 4, 'manual'), step(1, 'application', 1_700_000_100_001, 5, 6, 'late')];
      store.transaction(() => rows.forEach((row) => store.putStep(base.matchId, row)));
      expect(store.steps(base.matchId)).toStrictEqual(rows);
      // A raw constraint violation (primary key, foreign key) is a refused write, not a storage failure (T4).
      expect(codeOf(() => store.transaction(() => store.putStep(base.matchId, rows[0]!)))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.putStep('missing', rows[0]!)))).toBe('invalid-write');
      expect(store.steps('missing')).toStrictEqual([]);
    });
  });
});

describe('predictions', () => {
  const winner: StoredPrediction = { kind: 'winner', round: 0, choice: 10, version: 1, storedMs: 1_700_000_010_000, winnerCandidates: 3 };
  const victimPick: StoredPrediction = { kind: 'victim', round: 1, choice: 20, version: 1, storedMs: 1_700_000_011_000 };

  it('FR-267 (persistence) a prediction is upserted by (match, player, kind, round) and keeps its version and winner-candidate count', () => {
    withStore((store) => {
      put(store);
      store.transaction(() => {
        store.putPrediction(base.matchId, 'p1', winner);
        store.putPrediction(base.matchId, 'p1', victimPick);
      });
      expect(store.predictionsOf(base.matchId, 'p1')).toStrictEqual([victimPick, winner]);
      const replaced: StoredPrediction = { ...victimPick, choice: 30, version: 2, storedMs: 1_700_000_012_000 };
      store.transaction(() => store.putPrediction(base.matchId, 'p1', replaced));
      expect(store.predictionsOf(base.matchId, 'p1')).toStrictEqual([replaced, winner]);
      const winnerReplaced: StoredPrediction = { ...winner, choice: 20, version: 2, winnerCandidates: 2 };
      store.transaction(() => store.putPrediction(base.matchId, 'p1', winnerReplaced));
      expect(store.predictionsOf(base.matchId, 'p1')).toStrictEqual([replaced, winnerReplaced]);
    });
  });

  it('FR-267 (persistence) the key includes the round: the same kind for two rounds gives two rows', () => {
    withStore((store) => {
      put(store);
      const round2: StoredPrediction = { ...victimPick, round: 2, choice: 10 };
      const absorberPick: StoredPrediction = { kind: 'absorber', round: 1, choice: 10, version: 1, storedMs: 1_700_000_013_000 };
      store.transaction(() => {
        store.putPrediction(base.matchId, 'p1', victimPick);
        store.putPrediction(base.matchId, 'p1', round2);
        store.putPrediction(base.matchId, 'p1', absorberPick);
      });
      expect(store.predictionsOf(base.matchId, 'p1')).toStrictEqual([absorberPick, victimPick, round2]);
    });
  });

  it('FR-270 (storage) predictions are read back per player id and per match, never another player or match', () => {
    withStore((store) => {
      put(store);
      put(store, { ...base, matchId: 'BBBBBBBBBBBBBBBB' });
      const other: StoredPrediction = { ...victimPick, choice: 10 };
      store.transaction(() => {
        store.putPrediction(base.matchId, 'p1', victimPick);
        store.putPrediction(base.matchId, 'p2', other);
        store.putPrediction('BBBBBBBBBBBBBBBB', 'p1', { ...victimPick, choice: 30 });
      });
      expect(store.predictionsOf(base.matchId, 'p1')).toStrictEqual([victimPick]);
      expect(store.predictionsOf(base.matchId, 'p2')).toStrictEqual([other]);
      expect(store.predictionsOf('BBBBBBBBBBBBBBBB', 'p1')).toStrictEqual([{ ...victimPick, choice: 30 }]);
      expect(store.predictionsOf(base.matchId, 'nobody')).toStrictEqual([]);
      expect(store.predictionsOf('missing', 'p1')).toStrictEqual([]);
    });
  });

  it('FR-267 (persistence) a winner prediction without its candidate count, or for another match, is refused', () => {
    withStore((store) => {
      put(store);
      const { winnerCandidates: _count, ...noCount } = winner;
      expect(codeOf(() => store.transaction(() => store.putPrediction(base.matchId, 'p1', noCount)))).toBe('invalid-write');
      expect(() => store.transaction(() => store.putPrediction('missing', 'p1', victimPick))).toThrow();
      expect(store.predictionsOf(base.matchId, 'p1')).toStrictEqual([]);
    });
  });
});

describe('events', () => {
  const closed = (seq: number): MatchEvent => ({ type: 'phase-closed', seq, round: 1, phase: 1, at: 1_700_000_080_000 + seq });

  it('FR-293 events keep unique increasing sequence numbers and eventsAfter returns the later ones in order', () => {
    withStore((store) => {
      put(store);
      store.transaction(() => store.appendEvents(base.matchId, [closed(2), closed(3)]));
      store.transaction(() => store.appendEvents(base.matchId, [closed(4)]));
      expect(store.eventsAfter(base.matchId, 0).map((e) => e.seq)).toStrictEqual([1, 2, 3, 4]);
      expect(store.eventsAfter(base.matchId, 2)).toStrictEqual([closed(3), closed(4)]);
      expect(store.eventsAfter(base.matchId, 4)).toStrictEqual([]);
      expect(store.eventsAfter(base.matchId, 99)).toStrictEqual([]);
      expect(store.eventsAfter('missing', 0)).toStrictEqual([]);
      expect(store.getMatch(base.matchId)?.match.lastSeq).toBe(4);
    });
  });

  it('FR-293 a reused or skipped sequence number is refused and leaves the log unchanged', () => {
    withStore((store) => {
      put(store);
      store.transaction(() => store.appendEvents(base.matchId, [closed(2)]));
      for (const bad of [[closed(2)], [closed(1)], [closed(4)], [closed(3), closed(3)], [closed(3), closed(5)], [closed(0)]]) {
        expect(codeOf(() => store.transaction(() => store.appendEvents(base.matchId, bad)))).toBe('invalid-write');
      }
      expect(store.eventsAfter(base.matchId, 0).map((e) => e.seq)).toStrictEqual([1, 2]);
      store.transaction(() => store.appendEvents(base.matchId, []));
      store.transaction(() => store.appendEvents(base.matchId, [closed(3)]));
      expect(store.eventsAfter(base.matchId, 2)).toStrictEqual([closed(3)]);
    });
  });

  it('FR-293 the sequence numbers of two matches are independent', () => {
    withStore((store) => {
      put(store);
      put(store, { ...base, matchId: 'BBBBBBBBBBBBBBBB' });
      store.transaction(() => store.appendEvents('BBBBBBBBBBBBBBBB', [closed(2)]));
      expect(store.eventsAfter(base.matchId, 0).map((e) => e.seq)).toStrictEqual([1]);
      expect(store.eventsAfter('BBBBBBBBBBBBBBBB', 0).map((e) => e.seq)).toStrictEqual([1, 2]);
    });
  });
});

describe('memo', () => {
  const scope = { credentialDigest: DIGEST('9'), match: null };
  const entry = { contentDigest: DIGEST('7'), reply: { matchId: 'AAAAAAAAAAAAAAAA', hostToken: 'plain-for-24h', nested: [1, 2, { k: null }] }, createdMs: 1_700_000_000_000 };

  it('FR-293 a memo entry is read by scope and request id and an unknown pair reads nothing', () => {
    withStore((store) => {
      store.transaction(() => store.memoPut(scope, 'req-1', entry));
      expect(store.memoGet(scope, 'req-1')).toStrictEqual(entry);
      expect(store.memoGet(scope, 'req-2')).toBeUndefined();
      expect(store.memoGet({ ...scope, match: 'AAAAAAAAAAAAAAAA' }, 'req-1')).toBeUndefined();
      expect(store.memoGet({ credentialDigest: DIGEST('8'), match: null }, 'req-1')).toBeUndefined();
      const replaced = { ...entry, contentDigest: DIGEST('6'), createdMs: entry.createdMs + 5 };
      store.transaction(() => store.memoPut(scope, 'req-1', replaced));
      expect(store.memoGet(scope, 'req-1')).toStrictEqual(replaced);
    });
  });

  it('FR-293 a memo key holds a credential digest: text that is not a digest is refused and nothing is stored', () => {
    withStore((store) => {
      for (const bad of ['operator-credential', DIGEST('A'), DIGEST('a').slice(1), '']) {
        expect(() => store.transaction(() => store.memoPut({ credentialDigest: bad, match: null }, 'r', entry))).toThrow(RangeError);
        expect(() => store.memoGet({ credentialDigest: bad, match: null }, 'r')).toThrow(RangeError);
      }
    });
  });

  it('FR-293 the purge keeps an entry at 24 h and removes it 1 ms later', () => {
    withStore((store) => {
      store.transaction(() => store.memoPut(scope, 'old', entry));
      store.transaction(() => store.memoPut(scope, 'young', { ...entry, createdMs: entry.createdMs + 1 }));
      expect(store.transaction(() => store.memoPurge(entry.createdMs + MEMO_RETENTION_MS))).toBe(0);
      expect(store.memoGet(scope, 'old')).toBeDefined();
      expect(store.transaction(() => store.memoPurge(entry.createdMs + MEMO_RETENTION_MS + 1))).toBe(1);
      expect(store.memoGet(scope, 'old')).toBeUndefined();
      expect(store.memoGet(scope, 'young')).toBeDefined();
      expect(store.transaction(() => store.memoPurge(entry.createdMs + MEMO_RETENTION_MS + 2))).toBe(1);
      expect(store.memoGet(scope, 'young')).toBeUndefined();
    });
  });
});

describe('transactions', () => {
  it('FR-293 a transaction that throws leaves no row of any table', () => {
    withTempDir((dir) => {
      const file = join(dir, 'rollback.sqlite');
      const store = openStore(file);
      try {
        const boom = new Error('boom');
        expect(() =>
          store.transaction(() => {
            store.insertMatch(created());
            store.appendEvents(base.matchId, [schedule(base)]);
            store.updateMatch({ ...base, appliedRounds: 1, state: state(1) });
            store.putRecord(base.matchId, { round: 1, eliminated: 20, absorber: 10, transferred: [2] });
            store.putStep(base.matchId, step(1, 'phase-1-close', 1_700_000_080_123, 1));
            store.putPrediction(base.matchId, 'p1', { kind: 'victim', round: 1, choice: 20, version: 1, storedMs: 1 });
            store.memoPut({ credentialDigest: DIGEST('9'), match: null }, 'r', { contentDigest: DIGEST('7'), reply: {}, createdMs: 1 });
            // Not even a visible row inside the transaction survives the throw.
            expect(store.getMatch(base.matchId)).toBeDefined();
            throw boom;
          }),
        ).toThrow(boom);
        expect(store.getMatch(base.matchId)).toBeUndefined();
        expect(store.runningCount()).toBe(0);
        expect(store.eventsAfter(base.matchId, 0)).toStrictEqual([]);
        expect(store.memoGet({ credentialDigest: DIGEST('9'), match: null }, 'r')).toBeUndefined();
      } finally {
        store.close();
      }
      withRawDb(file, (db) => {
        for (const table of TABLES.filter((t) => t !== 'meta')) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, table).toBe(0);
      });
    });
  });

  it('FR-293 a failed write inside a transaction rolls back the writes before it, and the store stays usable', () => {
    withStore((store) => {
      expect(() =>
        store.transaction(() => {
          store.insertMatch(created());
          store.appendEvents(base.matchId, [schedule(base)]);
          store.appendEvents(base.matchId, [schedule(base)]); // reused number: refused
        }),
      ).toThrow(StoreError);
      expect(store.getMatch(base.matchId)).toBeUndefined();
      put(store);
      expect(store.getMatch(base.matchId)).toBeDefined();
    });
  });

  it('FR-293 a write outside a transaction is refused and the injected fault leaves no row', () => {
    withStore((store) => {
      expect(codeOf(() => store.insertMatch(created()))).toBe('invalid-write');
      expect(codeOf(() => store.memoPurge(0))).toBe('invalid-write');
      expect(store.getMatch(base.matchId)).toBeUndefined();
    });
    const faulty = withFaults(openStore(':memory:'), { failTransaction: 1 });
    try {
      expect(() => faulty.transaction(() => faulty.insertMatch(created()))).toThrow();
      expect(faulty.getMatch(base.matchId)).toBeUndefined();
      put(faulty);
      expect(faulty.getMatch(base.matchId)?.match).toStrictEqual(base);
      expect(faulty.runningCount()).toBe(1);
    } finally {
      faulty.close();
    }
  });
});

describe('what the database holds', () => {
  const PLANTED = 'PLANTED-HOST-TOKEN-0123456789abcdef';

  /** One match through a full round written the way the service will, in a file closed before the scan. */
  const fill = (file: string): void => {
    const store = openStore(file);
    try {
      put(store);
      store.transaction(() => {
        store.putPrediction(base.matchId, 'p1', { kind: 'winner', round: 0, choice: 10, version: 1, storedMs: 5, winnerCandidates: 3 });
        store.memoPut({ credentialDigest: DIGEST('9'), match: null }, 'r', { contentDigest: DIGEST('7'), reply: { hostToken: PLANTED }, createdMs: 5 });
        store.updateMatch({ ...base, appliedRounds: 1, state: state(1) });
        store.putRecord(base.matchId, { round: 1, eliminated: 20, absorber: 10, transferred: [2] });
      });
    } finally {
      store.close();
    }
  };

  it('FR-293 no column holds an absorber outside records, a pending state, a seed or a credential text', () => {
    withTempDir((dir) => {
      const file = join(dir, 'scan.sqlite');
      fill(file);
      withRawDb(file, (db) => {
        const columns = listColumns(db);
        expect(Object.keys(columns).sort()).toStrictEqual([...TABLES].sort());
        expect(columns.records).toContain('absorber');
        expect(columns.matches).toContain('secret');
        expect(columns.matches).toContain('host_token_digest');
        expect(absorberColumnsOutsideRecords(columns)).toStrictEqual([]);
        expect(pendingStateColumns(columns)).toStrictEqual([]);
        expect(credentialTextColumns(columns)).toStrictEqual([]);
        expect(rowsBeyondApplied(db)).toStrictEqual([]);
      });
    });
  });

  it('FR-293 the scanners find a planted column and a planted marker (the checks can fail)', () => {
    withTempDir((dir) => {
      const file = join(dir, 'planted.sqlite');
      fill(file);
      withRawDb(file, (db) => {
        db.exec('ALTER TABLE states ADD COLUMN absorber INTEGER');
        db.exec('ALTER TABLE matches ADD COLUMN pending_state TEXT');
        db.exec('ALTER TABLE matches ADD COLUMN host_token TEXT');
        db.exec('ALTER TABLE memo ADD COLUMN credential TEXT');
        const columns = listColumns(db);
        expect(absorberColumnsOutsideRecords(columns)).toStrictEqual(['states.absorber']);
        expect(pendingStateColumns(columns)).toStrictEqual(['matches.pending_state']);
        expect(credentialTextColumns(columns)).toStrictEqual(['matches.host_token', 'memo.credential']);
        db.exec("UPDATE matches SET host_token = 'PLANTED-X'");
        expect(scanValues(db, ['PLANTED-X'])).toStrictEqual(['matches.host_token']);
        db.prepare('INSERT INTO records (match_id, round, eliminated, absorber, transferred_json) VALUES (?, 9, 1, 1, ?)').run(base.matchId, '[]');
        db.prepare('INSERT INTO states (match_id, round, owners_json, state_digest) VALUES (?, 9, ?, ?)').run(base.matchId, '[]', 'x');
        expect(rowsBeyondApplied(db).map((r) => `${r.table}:${r.round}`).sort()).toStrictEqual(['records:9', 'states:9']);
      });
    });
  });

  it('FR-293 the host token text and the secret appear in no column but the allowed ones', () => {
    withTempDir((dir) => {
      const file = join(dir, 'values.sqlite');
      fill(file);
      withRawDb(file, (db) => {
        // The creation-reply memo holds the plain token for 24 h (D23, PD12), so the scan names that column and no other.
        expect(scanValues(db, [PLANTED])).toStrictEqual(['memo.reply_json']);
        // The secret is stored plain, as a blob, in matches.secret alone (D14).
        expect(scanValues(db, [SECRET])).toStrictEqual(['matches.secret']);
        expect(scanValues(db, [SECRET], ['matches.secret'])).toStrictEqual([]);
        expect({ ...db.prepare('SELECT typeof(secret) AS t, length(secret) AS n FROM matches').get() }).toStrictEqual({ t: 'blob', n: 32 });
        expect(db.prepare('SELECT host_token_digest FROM matches').get()?.host_token_digest).toBe(HOST_DIGEST);
      });
    });
  });
});
