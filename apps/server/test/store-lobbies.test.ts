import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MatchEvent, PublicState } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { CoreMatch } from '../src/core/view';
import { InjectedFault, withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { LOBBY_RETENTION_MS, StoreError, type Store } from '../src/store/store';
import { credentialTextColumns, listColumns, scanValues, storedFutureViolations, withRawDb } from './helpers/db-scan';

// Lobby storage: a lobby row is written in the caller's transaction, with its match and its event, and rolls back with it.
// FR-391 (open) is traced in store-open; here the schema-version-2 operations: the lobby rows, the counts, the expiry query, the marks and the purge.
// Every file database lives in a unique temporary directory removed in `finally`.

const withTempDir = <T>(body: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-lobbies-'));
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

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 1) % 256);
const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 20], [3, 30]] });

/** A match in the lobby stage as the service stores it: round 0, no anchors, creation instant as t0 and last step. */
const lobbyMatch = (id: string, over: Partial<CoreMatch> = {}): CoreMatch => ({
  matchId: id,
  mapId: 'dev',
  mapDigest: DIGEST('a'),
  totalRounds: 5,
  timing: { i: 120, l1: 30, l2: 10 },
  commitment: DIGEST('c'),
  stage: 'lobby',
  appliedRounds: 0,
  state: state(0),
  stateDigest: DIGEST('d'),
  lastSeq: 1,
  createdAt: T0,
  lastStepMs: T0,
  anchors: null,
  ...over,
});

const schedule = (match: CoreMatch, seq = 1): MatchEvent => ({ type: 'schedule', seq, stage: match.stage, reportedTime: match.createdAt });

const id = (c: string): string => c.repeat(16);

/** The match, its first event and (when given) its lobby row, in one transaction as the service does. */
const putMatch = (store: Store, match: CoreMatch, lobby?: { public: boolean; expiresMs: number }): void => {
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    store.appendEvents(match.matchId, [schedule(match)]);
    if (lobby !== undefined) store.insertLobby({ matchId: match.matchId, ...lobby });
  });
};

const codeOf = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    if (error instanceof StoreError) return error.code;
    throw error;
  }
  return 'no error';
};

const phase1 = (matchId: string, startMs: number): CoreMatch =>
  lobbyMatch(matchId, { stage: 'phase-1', lastSeq: 2, lastStepMs: startMs, anchors: { t0: startMs, c1: startMs + 80_000, c2: startMs + 110_000, a: startMs + 120_000 } });

/** Starts a lobby the way the service will: the stage change, the second event and the mark, in one transaction. */
const start = (store: Store, matchId: string, startMs: number, stage: CoreMatch['stage'] = 'phase-1'): void => {
  store.transaction(() => {
    const started = { ...phase1(matchId, startMs), stage };
    store.updateMatch(started);
    store.appendEvents(matchId, [schedule(started, 2)]);
    store.markStarted(matchId, startMs);
  });
};

describe('lobby rows', () => {
  it('FR-291 (lobby storage) a lobby row is stored with its match and read back; an unknown match has none', () => {
    withStore((store) => {
      putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + 24 * HOUR });
      expect(store.getLobby(id('A'))).toStrictEqual({ matchId: id('A'), public: true, expiresMs: T0 + 24 * HOUR, startedMs: null, expiredMs: null });
      expect(store.getLobby(id('Z'))).toBeUndefined();
      expect(store.getMatch(id('A'))?.match).toStrictEqual(lobbyMatch(id('A')));
      putMatch(store, lobbyMatch(id('B')), { public: false, expiresMs: T0 + HOUR });
      expect(store.getLobby(id('B'))?.public).toBe(false);
    });
  });

  it('FR-291 (lobby storage) a lobby match is stored in the 008 columns: stage lobby, round 0, t0 and last step at creation, no anchors', () => {
    withTempDir((dir) => {
      const file = join(dir, 'cols.sqlite');
      const store = openStore(file);
      try {
        putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + HOUR });
      } finally {
        store.close();
      }
      withRawDb(file, (db) => {
        expect({ ...db.prepare('SELECT stage, n, t0_ms, last_step_ms, c1_ms, c2_ms, a_ms, victim, winner FROM matches').get() }).toStrictEqual({
          stage: 'lobby',
          n: 0,
          t0_ms: T0,
          last_step_ms: T0,
          c1_ms: null,
          c2_ms: null,
          a_ms: null,
          victim: null,
          winner: null,
        });
      });
    });
  });

  it('FR-291 (lobby storage) the lobby row rolls back with its match and its event, and a write outside a transaction is refused', () => {
    withTempDir((dir) => {
      const file = join(dir, 'rollback.sqlite');
      const store = openStore(file);
      try {
        const boom = new Error('boom');
        expect(() =>
          store.transaction(() => {
            store.insertMatch({ match: lobbyMatch(id('A')), secret: SECRET, hostTokenDigest: DIGEST('b') });
            store.appendEvents(id('A'), [schedule(lobbyMatch(id('A')))]);
            store.insertLobby({ matchId: id('A'), public: true, expiresMs: T0 + HOUR });
            expect(store.getLobby(id('A'))).toBeDefined();
            expect(store.openLobbyCount()).toBe(1);
            throw boom;
          }),
        ).toThrow(boom);
        expect(store.getLobby(id('A'))).toBeUndefined();
        expect(store.getMatch(id('A'))).toBeUndefined();
        expect(store.openLobbyCount()).toBe(0);
        expect(codeOf(() => store.insertLobby({ matchId: id('A'), public: true, expiresMs: T0 }))).toBe('invalid-write');
        expect(codeOf(() => store.markStarted(id('A'), T0))).toBe('invalid-write');
        expect(codeOf(() => store.markExpired(id('A'), T0))).toBe('invalid-write');
        expect(codeOf(() => store.purgeExpired(T0))).toBe('invalid-write');
      } finally {
        store.close();
      }
      withRawDb(file, (db) => {
        expect(db.prepare('SELECT COUNT(*) AS n FROM lobbies').get()?.n).toBe(0);
        expect(db.prepare('SELECT COUNT(*) AS n FROM matches').get()?.n).toBe(0);
      });
    });
  });

  it('FR-291 (lobby storage) a second lobby row for a match, a lobby for a missing match and a bad expiry are refused', () => {
    withStore((store) => {
      putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + HOUR });
      expect(codeOf(() => store.transaction(() => store.insertLobby({ matchId: id('A'), public: true, expiresMs: T0 + 2 * HOUR })))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.insertLobby({ matchId: id('Q'), public: true, expiresMs: T0 })))).toBe('invalid-write');
      store.transaction(() => store.insertMatch({ match: lobbyMatch(id('B')), secret: SECRET, hostTokenDigest: DIGEST('b') }));
      for (const bad of [1.5, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        expect(codeOf(() => store.transaction(() => store.insertLobby({ matchId: id('B'), public: true, expiresMs: bad }))), String(bad)).toBe('invalid-write');
      }
      expect(store.getLobby(id('A'))?.expiresMs).toBe(T0 + HOUR);
      expect(store.getLobby(id('B'))).toBeUndefined();
    });
  });

  it('FR-291 (lobby storage) a lobby match appears in the match list with its stage', () => {
    withStore((store) => {
      putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + HOUR });
      expect(store.listMatches(undefined, 5)).toStrictEqual([{ matchId: id('A'), mapId: 'dev', stage: 'lobby', appliedRounds: 0, totalRounds: 5, createdAt: T0 }]);
    });
  });
});

describe('lobby counts', () => {
  it('FR-291 (lobby storage) open lobbies exclude started, expired and non-public ones', () => {
    withStore((store) => {
      putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + HOUR });
      putMatch(store, lobbyMatch(id('B')), { public: true, expiresMs: T0 + HOUR });
      putMatch(store, lobbyMatch(id('C')), { public: true, expiresMs: T0 + HOUR });
      putMatch(store, lobbyMatch(id('D')), { public: true, expiresMs: T0 + HOUR });
      putMatch(store, lobbyMatch(id('E')), { public: false, expiresMs: T0 + HOUR });
      expect(store.openLobbyCount()).toBe(4);
      start(store, id('B'), T0 + 1000);
      expect(store.openLobbyCount()).toBe(3);
      store.transaction(() => store.markExpired(id('C'), T0 + HOUR));
      expect(store.openLobbyCount()).toBe(2);
      store.transaction(() => store.markExpired(id('D'), T0 + HOUR));
      expect(store.openLobbyCount()).toBe(1);
    });
  });

  it('FR-291 (lobby storage) public running counts only public matches in phase-1, phase-2 and locked; operator matches count in neither count', () => {
    withStore((store) => {
      // Public: one still a lobby, one per running stage, one finished, one halted, one expired.
      putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + HOUR });
      for (const [c, stage] of [['B', 'phase-1'], ['C', 'phase-2'], ['D', 'locked'], ['E', 'finished'], ['F', 'halted']] as const) {
        putMatch(store, lobbyMatch(id(c)), { public: true, expiresMs: T0 + HOUR });
        start(store, id(c), T0 + 1000, stage);
      }
      putMatch(store, lobbyMatch(id('G')), { public: true, expiresMs: T0 + HOUR });
      store.transaction(() => store.markExpired(id('G'), T0 + HOUR));
      // Operator matches: no lobby row.
      putMatch(store, phase1(id('H'), T0));
      putMatch(store, phase1(id('I'), T0));
      expect(store.publicRunningCount()).toBe(3);
      expect(store.openLobbyCount()).toBe(1);
      // The 008 operator limit keeps counting every running match.
      expect(store.runningCount()).toBe(5);
    });
  });

  it('FR-291 (lobby storage) the lobby ids are the open ones, in id order; the expiry query takes expires_ms <= now, never a started or expired one', () => {
    withStore((store) => {
      putMatch(store, lobbyMatch(id('D')), { public: true, expiresMs: T0 + 3 * HOUR });
      putMatch(store, lobbyMatch(id('B')), { public: true, expiresMs: T0 + HOUR });
      putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + 2 * HOUR });
      putMatch(store, lobbyMatch(id('C')), { public: false, expiresMs: T0 + HOUR });
      putMatch(store, lobbyMatch(id('E')), { public: true, expiresMs: T0 + HOUR });
      putMatch(store, lobbyMatch(id('F')), { public: true, expiresMs: T0 + HOUR });
      start(store, id('E'), T0 + 10);
      store.transaction(() => store.markExpired(id('F'), T0 + HOUR));
      putMatch(store, phase1(id('G'), T0)); // operator: no row
      expect(store.lobbyIds()).toStrictEqual([id('A'), id('B'), id('C'), id('D')]);
      expect(store.lobbiesExpiringBefore(T0 + HOUR - 1)).toStrictEqual([]);
      expect(store.lobbiesExpiringBefore(T0 + HOUR)).toStrictEqual([id('B'), id('C')]);
      expect(store.lobbiesExpiringBefore(T0 + 2 * HOUR)).toStrictEqual([id('A'), id('B'), id('C')]);
      expect(store.lobbiesExpiringBefore(T0 + 99 * HOUR)).toStrictEqual([id('A'), id('B'), id('C'), id('D')]);
    });
  });
});

describe('lobby marks', () => {
  it('FR-291 (lobby storage) a start and an expiry are marked once with their instant; a second mark of either kind is refused', () => {
    withStore((store) => {
      putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + HOUR });
      putMatch(store, lobbyMatch(id('B')), { public: true, expiresMs: T0 + HOUR });
      start(store, id('A'), T0 + 500);
      store.transaction(() => store.markExpired(id('B'), T0 + HOUR));
      expect(store.getLobby(id('A'))).toStrictEqual({ matchId: id('A'), public: true, expiresMs: T0 + HOUR, startedMs: T0 + 500, expiredMs: null });
      expect(store.getLobby(id('B'))).toStrictEqual({ matchId: id('B'), public: true, expiresMs: T0 + HOUR, startedMs: null, expiredMs: T0 + HOUR });
      for (const [matchId, mark] of [
        [id('A'), 'markStarted'],
        [id('A'), 'markExpired'],
        [id('B'), 'markStarted'],
        [id('B'), 'markExpired'],
      ] as const) {
        expect(codeOf(() => store.transaction(() => store[mark](matchId, T0 + 2 * HOUR))), `${matchId} ${mark}`).toBe('invalid-write');
      }
      // The refused marks changed nothing.
      expect(store.getLobby(id('A'))?.startedMs).toBe(T0 + 500);
      expect(store.getLobby(id('A'))?.expiredMs).toBeNull();
      expect(store.getLobby(id('B'))?.expiredMs).toBe(T0 + HOUR);
      expect(store.getLobby(id('B'))?.startedMs).toBeNull();
    });
  });

  it('FR-291 (lobby storage) a mark of a match with no lobby row (an operator match) or of a bad instant is refused', () => {
    withStore((store) => {
      putMatch(store, phase1(id('H'), T0));
      putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + HOUR });
      expect(codeOf(() => store.transaction(() => store.markStarted(id('H'), T0)))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.markExpired(id('H'), T0)))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.markStarted(id('Z'), T0)))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.markStarted(id('A'), 1.5)))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.markExpired(id('A'), -1)))).toBe('invalid-write');
      expect(store.getLobby(id('A'))).toMatchObject({ startedMs: null, expiredMs: null });
    });
  });

  it('FR-291 (lobby storage) a mark rolls back with the transaction that holds it', () => {
    withStore((store) => {
      putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + HOUR });
      expect(() =>
        store.transaction(() => {
          store.markStarted(id('A'), T0 + 5);
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(store.getLobby(id('A'))?.startedMs).toBeNull();
      expect(store.openLobbyCount()).toBe(1);
    });
  });
});

describe('lobby purge', () => {
  it('FR-291 (lobby storage) an expired lobby is purged strictly after the retention, with its match and every child row; nothing else', () => {
    withTempDir((dir) => {
      const file = join(dir, 'purge.sqlite');
      const expiredAt = T0 + HOUR;
      let store = openStore(file);
      try {
        // A: expired lobby, with a step and a prediction row (children of a match). B: expired later. C: started. D: open. E: operator.
        for (const c of ['A', 'B', 'C', 'D']) putMatch(store, lobbyMatch(id(c)), { public: true, expiresMs: expiredAt });
        putMatch(store, phase1(id('E'), T0));
        store.transaction(() => {
          store.putStep(id('A'), { round: 1, kind: 'phase-1-close', instant: T0, cause: 'clock', firstSeq: 1, lastSeq: 1 });
          store.putPrediction(id('A'), 'client:p', { kind: 'winner', round: 0, choice: 10, version: 1, storedMs: T0, winnerCandidates: 3 });
          store.memoPut({ credentialDigest: DIGEST('9'), match: null }, 'r', { contentDigest: DIGEST('7'), reply: {}, createdMs: T0 });
        });
        start(store, id('C'), T0 + 5);
        store.transaction(() => {
          store.markExpired(id('A'), expiredAt);
          store.markExpired(id('B'), expiredAt + HOUR);
        });
      } finally {
        store.close();
      }
      // A player row of the expired lobby (the join operations come later; the purge must clear it).
      const raw = new DatabaseSync(file);
      raw.prepare('INSERT INTO players (match_id, player_id, name, name_key, token_digest, joined_seq, joined_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('A'), 'player:x', 'Ana', 'ana', DIGEST('6'), 2, T0);
      raw.close();
      store = openStore(file);
      try {
        // At exactly the retention nothing goes; 1 ms later the lobby A goes.
        expect(store.transaction(() => store.purgeExpired(expiredAt + LOBBY_RETENTION_MS))).toBe(0);
        expect(store.getLobby(id('A'))).toBeDefined();
        expect(store.transaction(() => store.purgeExpired(expiredAt + LOBBY_RETENTION_MS + 1))).toBe(1);
        expect(store.getLobby(id('A'))).toBeUndefined();
        expect(store.getMatch(id('A'))).toBeUndefined();
        expect(store.eventsAfter(id('A'), 0)).toStrictEqual([]);
        expect(store.getState(id('A'), 0)).toBeUndefined();
        expect(store.steps(id('A'))).toStrictEqual([]);
        expect(store.predictionsOf(id('A'), 'client:p')).toStrictEqual([]);
        // The others stay: expired later (B), started (C), open (D), operator (E), and the memo.
        for (const c of ['B', 'C', 'D', 'E']) expect(store.getMatch(id(c)), c).toBeDefined();
        expect(store.getLobby(id('B'))?.expiredMs).toBe(expiredAt + HOUR);
        expect(store.getLobby(id('C'))?.startedMs).toBe(T0 + 5);
        expect(store.getLobby(id('D'))).toBeDefined();
        expect(store.getLobby(id('E'))).toBeUndefined();
        expect(store.memoOldest()).toBe(T0);
        // Later, B goes as well; C, D and E never.
        expect(store.transaction(() => store.purgeExpired(expiredAt + 99 * 24 * HOUR))).toBe(1);
        expect(store.getMatch(id('B'))).toBeUndefined();
        for (const c of ['C', 'D', 'E']) expect(store.getMatch(id(c)), c).toBeDefined();
        expect(store.transaction(() => store.purgeExpired(expiredAt + 999 * 24 * HOUR))).toBe(0);
      } finally {
        store.close();
      }
      withRawDb(file, (db) => {
        expect(db.prepare('SELECT COUNT(*) AS n FROM players').get()?.n).toBe(0);
        expect(db.prepare('SELECT COUNT(*) AS n FROM matches').get()?.n).toBe(3);
        expect(db.prepare('SELECT COUNT(*) AS n FROM lobbies').get()?.n).toBe(2);
      });
    });
  });
});

describe('what a lobby stores', () => {
  it('FR-291 (lobby storage) the storage scan for future data finds nothing in a lobby match, and the new tables hold no credential text', () => {
    withTempDir((dir) => {
      const file = join(dir, 'scan.sqlite');
      const store = openStore(file);
      try {
        putMatch(store, lobbyMatch(id('A')), { public: true, expiresMs: T0 + HOUR });
        putMatch(store, lobbyMatch(id('B')), { public: true, expiresMs: T0 + HOUR });
        start(store, id('B'), T0 + 5);
        putMatch(store, lobbyMatch(id('C')), { public: true, expiresMs: T0 + HOUR });
        store.transaction(() => {
          store.updateMatch(lobbyMatch(id('C'), { stage: 'expired', lastSeq: 2, lastStepMs: T0 + HOUR }));
          store.markExpired(id('C'), T0 + HOUR);
          store.appendEvents(id('C'), [{ type: 'schedule', seq: 2, stage: 'expired', reportedTime: T0 + HOUR }]);
        });
      } finally {
        store.close();
      }
      withRawDb(file, (db) => {
        expect(storedFutureViolations(db)).toStrictEqual([]);
        const columns = listColumns(db);
        expect(columns.lobbies).toStrictEqual(['match_id', 'public', 'expires_ms', 'started_ms', 'expired_ms']);
        expect(columns.players).toStrictEqual(['match_id', 'player_id', 'name', 'name_key', 'token_digest', 'joined_seq', 'joined_ms']);
        expect(credentialTextColumns(columns)).toStrictEqual([]);
        expect(scanValues(db, [SECRET])).toStrictEqual(['matches.secret']);
      });
    });
  });
});

describe('lobby writes and the fault seam', () => {
  it('FR-291 (lobby storage) each lobby write is one write of the seam: a failure inside the transaction leaves no lobby row, and the reads pass through', () => {
    withStore((base) => {
      putMatch(base, lobbyMatch(id('A')), { public: true, expiresMs: T0 + HOUR });
      putMatch(base, lobbyMatch(id('B')), { public: true, expiresMs: T0 + HOUR });
      // The transaction counter of a wrapper starts at 1: one wrapper per planned fault.
      const creation = withFaults(base, { failWrite: { transaction: 1, afterWrites: 2 } });
      expect(() =>
        creation.transaction(() => {
          creation.insertMatch({ match: lobbyMatch(id('X')), secret: SECRET, hostTokenDigest: DIGEST('b') });
          creation.appendEvents(id('X'), [schedule(lobbyMatch(id('X')))]);
          creation.insertLobby({ matchId: id('X'), public: true, expiresMs: T0 + HOUR });
        }),
      ).toThrow(InjectedFault);
      expect(base.getMatch(id('X'))).toBeUndefined();
      expect(base.getLobby(id('X'))).toBeUndefined();
      const mark = withFaults(base, { failWrite: { transaction: 1, afterWrites: 0 } });
      expect(() => mark.transaction(() => mark.markStarted(id('A'), T0))).toThrow(InjectedFault);
      expect(base.getLobby(id('A'))?.startedMs).toBeNull();
      const expire = withFaults(base, { failWrite: { transaction: 1, afterWrites: 0 } });
      expect(() => expire.transaction(() => expire.markExpired(id('B'), T0))).toThrow(InjectedFault);
      expect(base.getLobby(id('B'))?.expiredMs).toBeNull();
      const purge = withFaults(base, { failWrite: { transaction: 1, afterWrites: 0 } });
      expect(() => purge.transaction(() => purge.purgeExpired(T0))).toThrow(InjectedFault);
      const reads = withFaults(base, {});
      expect(reads.openLobbyCount()).toBe(2);
      expect(reads.publicRunningCount()).toBe(0);
      expect(reads.lobbyIds()).toStrictEqual([id('A'), id('B')]);
      expect(reads.lobbiesExpiringBefore(T0 + HOUR)).toStrictEqual([id('A'), id('B')]);
      expect(reads.getLobby(id('A'))?.public).toBe(true);
    });
  });
});
