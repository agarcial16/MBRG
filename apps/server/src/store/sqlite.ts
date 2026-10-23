// The SQLite adapter (spec 008 FR-291, FR-292; plan PD9, PD10): the only module that imports `node:sqlite`.
// It does not depend on the ExperimentalWarning being printed: warnings.ts only hides it where Node prints it.
import { DatabaseSync } from 'node:sqlite';
import { isLocalId, isNamespace, NAMESPACE_SEPARATOR, PREDICTION_KINDS } from '@mbrg/protocol';
import type { MatchEvent, MatchSummary, PredictionKind, PublicState, PublicVictim, Timing } from '@mbrg/protocol';
import { MEMO_RETENTION_MS, type MemoScope } from '../core/memo';
import type { StoredPrediction } from '../core/predictions';
import type { ResultRow, ScorablePrediction } from '../core/scoring';
import type { Anchors } from '../core/time';
import type { CoreMatch } from '../core/view';
import { SCHEMA_V1, SCHEMA_VERSION, TABLES } from './schema';
import {
  StoreError,
  type MatchListKey,
  type NamespacePrediction,
  type PredictionKey,
  type Store,
  type StoredMatch,
  type StoredMemo,
  type StoredRecord,
  type StoredState,
  type StoredStep,
  type StoreErrorCode,
  type StoreErrorDetails,
  type StoreSettings,
} from './store';

const SYNCHRONOUS = ['off', 'normal', 'full', 'extra'] as const;

const isLockedError = (error: unknown): boolean => error instanceof Error && /\b(locked|busy)\b/i.test(error.message);

/** Primary result codes (the low byte of `errcode`) that are storage failures (FR-292, plan 18.1). */
const LOCKED_CODES: ReadonlySet<number> = new Set([5, 6]); // BUSY, LOCKED
// NOMEM, READONLY, INTERRUPT, IOERR, CORRUPT, FULL, CANTOPEN, PROTOCOL, NOLFS, NOTADB: transient or environmental.
const FAILURE_CODES: ReadonlySet<number> = new Set([7, 8, 9, 10, 11, 13, 14, 15, 22, 26]);

/**
 * The texts SQLite gives those codes (sqlite3_errstr) and its constraint, logic and misuse messages: the class of a native
 * error that carries no `errcode` (a platform that does not attach it). An unrecognised text keeps the earlier rule (a
 * storage failure).
 */
const LOCKED_TEXT = /\b(locked|busy)\b/i;
const FAILURE_TEXT = /disk I\/O error|database or disk is full|readonly database|unable to open database|malformed|not a database|out of memory|interrupted|locking protocol|large file support/i;
const PROGRAMMING_TEXT = /constraint failed|syntax error|no such (table|column|index)|within a transaction|out of range|misuse|datatype mismatch|has no column|values for \d+ columns/i;

type Classified = Exclude<StoreErrorCode, 'unknown-schema-version'>;

const classOfCode = (errcode: number): Classified => {
  const primary = errcode & 0xff;
  if (LOCKED_CODES.has(primary)) return 'database-locked';
  if (FAILURE_CODES.has(primary)) return 'store-failure';
  return 'invalid-write';
};

const classOfText = (message: string): Classified => {
  if (LOCKED_TEXT.test(message)) return 'database-locked';
  if (FAILURE_TEXT.test(message)) return 'store-failure';
  if (PROGRAMMING_TEXT.test(message)) return 'invalid-write';
  return 'store-failure';
};

const MESSAGES: Readonly<Record<Classified, string>> = {
  'database-locked': 'another connection holds the database',
  'store-failure': 'storage failure',
  'invalid-write': 'the database refused the statement',
};

/**
 * FR-292 (error classification), NFR-54. A native SQLite error (`ERR_SQLITE_ERROR`) is classified by its primary result
 * code when the platform attaches `errcode`, otherwise by its message: busy and locked are `database-locked`; I/O, full,
 * read-only, cannot-open, corrupt, not-a-database, out-of-memory, interrupted, locking-protocol and no-large-file
 * support are `store-failure` (storage failures: `unavailable`, retried); a
 * constraint violation, a misuse, a range or a logic error is `invalid-write` (a programming error, rethrown). A use of the
 * closed connection (`ERR_INVALID_STATE`) is `store-failure`. The StoreError keeps the native error as `cause` and the
 * result code and its generic text; its message never quotes the native message. Anything else is returned unchanged.
 */
export const classifyStoreError = (error: unknown): unknown => {
  if (error instanceof StoreError || !(error instanceof Error)) return error;
  const native = error as Error & { code?: unknown; errcode?: unknown; errstr?: unknown };
  if (native.code === 'ERR_INVALID_STATE') return new StoreError('store-failure', 'the database connection is not open', { cause: error });
  if (native.code !== 'ERR_SQLITE_ERROR') return error;
  const errcode = typeof native.errcode === 'number' && Number.isSafeInteger(native.errcode) ? native.errcode : undefined;
  const code = errcode === undefined ? classOfText(native.message) : classOfCode(errcode);
  const details: StoreErrorDetails = {
    cause: error,
    ...(errcode === undefined ? {} : { sqliteCode: errcode }),
    ...(errcode !== undefined && typeof native.errstr === 'string' ? { sqliteText: native.errstr } : {}),
  };
  return new StoreError(code, errcode === undefined ? MESSAGES[code] : `${MESSAGES[code]} (result code ${errcode})`, details);
};

/** An error of the open step: a locked file is `database-locked` (with its cause); any other error is kept as it is. */
const asStoreError = (error: unknown, path: string): Error => {
  if (error instanceof StoreError) return error;
  const classified = classifyStoreError(error);
  if (classified instanceof StoreError && classified.code === 'database-locked') return classified;
  if (isLockedError(error)) return new StoreError('database-locked', `the database ${path} is locked by another connection or process`, { cause: error });
  return error instanceof Error ? error : new Error(String(error));
};

const guard = <T>(action: () => T): T => {
  try {
    return action();
  } catch (error) {
    throw classifyStoreError(error);
  }
};

const closeQuietly = (db: DatabaseSync): void => {
  try {
    db.close();
  } catch {
    // Already closed or unusable: nothing more to release.
  }
};

const userVersionOf = (db: DatabaseSync): number => {
  const value = db.prepare('PRAGMA user_version').get()?.user_version;
  if (typeof value !== 'number') throw new StoreError('store-failure', 'the database did not report its schema version');
  return value;
};

type Row = Record<string, unknown>;
type Param = string | number | null | Uint8Array;

const DIGEST = /^[0-9a-f]{64}$/;
const SECRET_BYTES = 32;

const invalid = (message: string): StoreError => new StoreError('invalid-write', message);
const corrupt = (message: string): StoreError => new StoreError('store-failure', `the stored data is inconsistent: ${message}`);

const num = (row: Row, key: string): number => {
  const v = row[key];
  if (typeof v !== 'number') throw corrupt(`column ${key} is not a number`);
  return v;
};
const str = (row: Row, key: string): string => {
  const v = row[key];
  if (typeof v !== 'string') throw corrupt(`column ${key} is not text`);
  return v;
};
const optNum = (row: Row, key: string): number | null => (row[key] === null ? null : num(row, key));

/** A memo scope is encoded as JSON text that holds a credential digest, never a credential (FR-300, PD12). */
const scopeText = (scope: MemoScope): string => {
  if (!DIGEST.test(scope.credentialDigest)) throw new RangeError('the memo scope holds a credential digest (64 lowercase hexadecimal characters)');
  return JSON.stringify([scope.credentialDigest, scope.match]);
};

const timingText = (timing: Timing): string => JSON.stringify(timing);

/**
 * The statements of the keyset reads (FR-279, FR-270, FR-300), exported so a test can scan their text. Keysets compare
 * row values strictly (`>`), in the order of the ORDER BY; texts compare by SQLite's BINARY order (byte order, equal to
 * the code unit order of protocol page.ts for the ASCII ids these lists hold). The match list selects the summary
 * columns only.
 */
export const READ_SQL = {
  listMatches: 'SELECT id, map_id, stage, n, t, created_ms FROM matches WHERE (created_ms, id) > (?, ?) ORDER BY created_ms, id LIMIT ?',
  recordsAfter: 'SELECT round, eliminated, absorber, transferred_json FROM records WHERE match_id = ? AND round > ? ORDER BY round LIMIT ?',
  // The namespace is a range of player ids [`<ns>:`, `<ns>;`) (';' follows ':'), never a LIKE pattern; one local id is an
  // equality. The winner has round 0, so (player id, round, kind) is the order key of protocol page.ts.
  predictionsInNamespace: `SELECT player_id, kind, round, choice, version, stored_ms, winner_candidates FROM predictions
    WHERE match_id = ? AND player_id >= ? AND player_id < ? AND (? IS NULL OR player_id = ?) AND (player_id, round, kind) > (?, ?, ?)
    ORDER BY player_id, round, kind LIMIT ?`,
  hostTokenDigest: 'SELECT host_token_digest FROM matches WHERE id = ?',
  // The scorer's input: one phase of one match, by player id (BINARY order, the code unit order of the ASCII ids).
  predictionsOfPhase: 'SELECT player_id, choice, winner_candidates FROM predictions WHERE match_id = ? AND kind = ? AND round = ? ORDER BY player_id',
} as const;

const checkLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('a read limit is a whole number of at least 1');
};

const recordOf = (r: Row): StoredRecord => ({
  round: num(r, 'round'),
  eliminated: num(r, 'eliminated'),
  absorber: num(r, 'absorber'),
  transferred: JSON.parse(str(r, 'transferred_json')) as number[],
});

const STAGES: readonly string[] = ['phase-1', 'phase-2', 'locked', 'halted', 'finished'];

const predictionOf = (r: Row): StoredPrediction => {
  const kind = str(r, 'kind') as StoredPrediction['kind'];
  const base = { kind, round: num(r, 'round'), choice: num(r, 'choice'), version: num(r, 'version'), storedMs: num(r, 'stored_ms') };
  return kind === 'winner' ? { ...base, winnerCandidates: num(r, 'winner_candidates') } : base;
};

/** The fields that never change after creation (FR-235). */
const sameFixedFields = (a: CoreMatch, b: CoreMatch): boolean =>
  a.mapId === b.mapId && a.mapDigest === b.mapDigest && a.commitment === b.commitment && a.createdAt === b.createdAt && a.totalRounds === b.totalRounds && timingText(a.timing) === timingText(b.timing);

/**
 * Opens (and, for a new file, creates) the store. `path` is a file path or `:memory:`.
 * PRAGMAs (PD9): exclusive locking, write-ahead log on a file, synchronous FULL, foreign keys ON. An immediate
 * write transaction at open takes the lock, so a second connection or process fails here with `database-locked`.
 * `user_version` 0 is a new file (schema 1 created in that same transaction); any other value than 1 is refused.
 */
export const openStore = (path: string): Store => {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { timeout: 0 });
  } catch (error) {
    throw asStoreError(error, path);
  }
  let inTransaction = false;
  let closed = false;
  try {
    db.exec('PRAGMA locking_mode = EXCLUSIVE');
    if (path !== ':memory:') {
      const mode = db.prepare('PRAGMA journal_mode = WAL').get()?.journal_mode;
      if (mode !== 'wal') throw new StoreError('store-failure', `the write-ahead log could not be enabled (journal mode ${String(mode)})`);
    }
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('BEGIN IMMEDIATE');
    try {
      const version = userVersionOf(db);
      if (version === 0) {
        for (const statement of SCHEMA_V1) db.exec(statement);
        db.prepare('INSERT INTO meta (schema_version) VALUES (?)').run(SCHEMA_VERSION);
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      } else if (version !== SCHEMA_VERSION) {
        throw new StoreError('unknown-schema-version', `the database has schema version ${version}; this server supports version ${SCHEMA_VERSION}`);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    closeQuietly(db);
    throw asStoreError(error, path);
  }

  const requireTransaction = (): void => {
    if (!inTransaction) throw invalid('a store write runs inside a transaction');
  };
  const one = (sql: string, ...params: Param[]): Row | undefined => guard(() => db.prepare(sql).get(...params));
  const all = (sql: string, ...params: Param[]): Row[] => guard(() => db.prepare(sql).all(...params));
  const run = (sql: string, ...params: Param[]): void => {
    guard(() => db.prepare(sql).run(...params));
  };

  const checkMatch = (match: CoreMatch): void => {
    if (match.state.round !== match.appliedRounds) throw invalid('the state round differs from the applied rounds');
    if (match.state.mode !== 'classic') throw invalid('only the classic mode is stored');
  };

  /** The state at N is stored once; a different state for the same round is refused. */
  const putStateOf = (match: CoreMatch): void => {
    const text = JSON.stringify(match.state.owners);
    const existing = one('SELECT owners_json, state_digest FROM states WHERE match_id = ? AND round = ?', match.matchId, match.appliedRounds);
    if (existing === undefined) {
      run('INSERT INTO states (match_id, round, owners_json, state_digest) VALUES (?, ?, ?, ?)', match.matchId, match.appliedRounds, text, match.stateDigest);
    } else if (str(existing, 'owners_json') !== text || str(existing, 'state_digest') !== match.stateDigest) {
      throw invalid(`the state of round ${match.appliedRounds} is already stored and differs`);
    }
  };

  const lastSeqOf = (matchId: string): number => {
    const row = one('SELECT COALESCE(MAX(seq), 0) AS last FROM events WHERE match_id = ?', matchId);
    return row === undefined ? 0 : num(row, 'last');
  };

  const eventOf = (row: Row): MatchEvent => JSON.parse(str(row, 'payload_json')) as MatchEvent;

  /** The revealed victim of round N + 1: the victim and its instant from the match row, the rest from the public event. */
  const victimOf = (matchId: string, round: number, victim: number, revealMs: number | null): PublicVictim => {
    const rows = all("SELECT payload_json FROM events WHERE match_id = ? AND type = 'victim-revealed' ORDER BY seq DESC", matchId);
    for (const row of rows) {
      const e = eventOf(row);
      if (e.type !== 'victim-revealed' || e.round !== round) continue;
      if (e.victim !== victim || e.revealedAt !== revealMs) throw corrupt('the victim columns differ from the victim-revealed event');
      return { round: e.round, victim: e.victim, candidates: e.candidates, living: e.living, revealedAt: e.revealedAt, c2: e.c2, a: e.a, seq: e.seq };
    }
    throw corrupt(`no victim-revealed event for round ${round}`);
  };

  const readMatch = (matchId: string): StoredMatch | undefined => {
    const row = one('SELECT * FROM matches WHERE id = ?', matchId);
    if (row === undefined) return undefined;
    const n = num(row, 'n');
    const stored = one('SELECT owners_json, state_digest FROM states WHERE match_id = ? AND round = ?', matchId, n);
    if (stored === undefined) throw corrupt(`no state at round ${n}`);
    const state: PublicState = { mode: 'classic', round: n, owners: JSON.parse(str(stored, 'owners_json')) as [number, number][] };
    const c1 = optNum(row, 'c1_ms');
    const c2 = optNum(row, 'c2_ms');
    const a = optNum(row, 'a_ms');
    const anchors: Anchors | null = c1 === null || c2 === null || a === null ? null : { t0: num(row, 't0_ms'), c1, c2, a };
    const victim = optNum(row, 'victim');
    const winner = optNum(row, 'winner');
    const halt = row.halt_reason;
    const match: { -readonly [K in keyof CoreMatch]: CoreMatch[K] } = {
      matchId: str(row, 'id'),
      mapId: str(row, 'map_id'),
      mapDigest: str(row, 'map_digest'),
      totalRounds: num(row, 't'),
      timing: JSON.parse(str(row, 'timing')) as Timing,
      commitment: str(row, 'commitment'),
      stage: str(row, 'stage') as CoreMatch['stage'],
      appliedRounds: n,
      state,
      stateDigest: str(stored, 'state_digest'),
      lastSeq: lastSeqOf(matchId),
      createdAt: num(row, 'created_ms'),
      lastStepMs: num(row, 'last_step_ms'),
      anchors,
    };
    if (victim !== null) match.victim = victimOf(matchId, n + 1, victim, optNum(row, 'reveal_ms'));
    if (winner !== null) match.winner = winner;
    if (typeof halt === 'string') match.haltReason = halt as CoreMatch['haltReason'];
    const secret = row.secret;
    if (!(secret instanceof Uint8Array)) throw corrupt('the secret is not a blob');
    return { match, secret: Uint8Array.from(secret), hostTokenDigest: str(row, 'host_token_digest') };
  };

  const pragma = (name: string): unknown => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];

  return {
    settings(): StoreSettings {
      return {
        journalMode: String(pragma('journal_mode')),
        synchronous: SYNCHRONOUS[Number(pragma('synchronous'))] ?? 'off',
        foreignKeys: Number(pragma('foreign_keys')) === 1,
        lockingMode: String(pragma('locking_mode')),
        userVersion: Number(pragma('user_version')),
      };
    },
    tables(): string[] {
      const own = new Set<string>(TABLES);
      return db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row.name))
        .filter((name) => own.has(name));
    },
    transaction<T>(fn: () => T): T {
      if (inTransaction) throw new Error('store transactions do not nest');
      guard(() => db.exec('BEGIN IMMEDIATE'));
      inTransaction = true;
      try {
        const value = fn();
        guard(() => db.exec('COMMIT'));
        return value;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // The failed COMMIT may already have ended the transaction.
        }
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    insertMatch(row: StoredMatch): void {
      requireTransaction();
      const m = row.match;
      checkMatch(m);
      if (row.secret.length !== SECRET_BYTES) throw invalid(`the secret is ${SECRET_BYTES} bytes`);
      if (!DIGEST.test(row.hostTokenDigest)) throw invalid('the host token is stored as a digest (64 lowercase hexadecimal characters)');
      if (one('SELECT 1 AS found FROM matches WHERE id = ?', m.matchId) !== undefined) throw invalid(`the match ${m.matchId} already exists`);
      run(
        `INSERT INTO matches (id, map_id, map_digest, secret, commitment, timing, created_ms, stage, n, t, t0_ms, c1_ms, c2_ms, a_ms,
           last_step_ms, victim, reveal_ms, halt_reason, winner, host_token_digest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        m.matchId, m.mapId, m.mapDigest, row.secret, m.commitment, timingText(m.timing), m.createdAt, m.stage, m.appliedRounds, m.totalRounds,
        m.anchors?.t0 ?? m.createdAt, m.anchors?.c1 ?? null, m.anchors?.c2 ?? null, m.anchors?.a ?? null, m.lastStepMs,
        m.victim?.victim ?? null, m.victim?.revealedAt ?? null, m.haltReason ?? null, m.winner ?? null, row.hostTokenDigest,
      );
      putStateOf(m);
    },
    updateMatch(match: CoreMatch): void {
      requireTransaction();
      checkMatch(match);
      const stored = readMatch(match.matchId);
      if (stored === undefined) throw invalid(`the match ${match.matchId} does not exist`);
      if (!sameFixedFields(stored.match, match)) throw invalid('timing, map, commitment, creation instant and rounds never change');
      if (match.appliedRounds < stored.match.appliedRounds) throw invalid('the applied rounds never decrease');
      putStateOf(match);
      run(
        `UPDATE matches SET stage = ?, n = ?, t0_ms = ?, c1_ms = ?, c2_ms = ?, a_ms = ?, last_step_ms = ?, victim = ?, reveal_ms = ?,
           halt_reason = ?, winner = ? WHERE id = ?`,
        match.stage, match.appliedRounds, match.anchors?.t0 ?? match.createdAt, match.anchors?.c1 ?? null, match.anchors?.c2 ?? null,
        match.anchors?.a ?? null, match.lastStepMs, match.victim?.victim ?? null, match.victim?.revealedAt ?? null,
        match.haltReason ?? null, match.winner ?? null, match.matchId,
      );
    },
    getMatch: readMatch,
    runningCount(): number {
      const row = one("SELECT COUNT(*) AS n FROM matches WHERE stage IN ('phase-1', 'phase-2', 'locked')");
      return row === undefined ? 0 : num(row, 'n');
    },
    runningMatchIds(): string[] {
      return all("SELECT id FROM matches WHERE stage IN ('phase-1', 'phase-2', 'locked') ORDER BY rowid").map((row) => str(row, 'id'));
    },
    getState(matchId: string, round: number): StoredState | undefined {
      const row = one('SELECT owners_json, state_digest FROM states WHERE match_id = ? AND round = ?', matchId, round);
      if (row === undefined) return undefined;
      return { state: { mode: 'classic', round, owners: JSON.parse(str(row, 'owners_json')) as [number, number][] }, stateDigest: str(row, 'state_digest') };
    },
    putRecord(matchId: string, record: StoredRecord): void {
      requireTransaction();
      const match = one('SELECT n FROM matches WHERE id = ?', matchId);
      if (match === undefined) throw invalid(`the match ${matchId} does not exist`);
      if (!Number.isInteger(record.round) || record.round < 1 || record.round > num(match, 'n')) throw invalid('a record exists only for an applied round');
      if (one('SELECT 1 AS found FROM records WHERE match_id = ? AND round = ?', matchId, record.round) !== undefined) throw invalid('the record of an applied round is never replaced');
      run('INSERT INTO records (match_id, round, eliminated, absorber, transferred_json) VALUES (?, ?, ?, ?, ?)', matchId, record.round, record.eliminated, record.absorber, JSON.stringify(record.transferred));
    },
    records(matchId: string): StoredRecord[] {
      return all('SELECT round, eliminated, absorber, transferred_json FROM records WHERE match_id = ? ORDER BY round', matchId).map(recordOf);
    },
    putStep(matchId: string, step: StoredStep): void {
      requireTransaction();
      run('INSERT INTO steps (match_id, round, kind, instant_ms, cause, first_seq, last_seq) VALUES (?, ?, ?, ?, ?, ?, ?)', matchId, step.round, step.kind, step.instant, step.cause, step.firstSeq, step.lastSeq);
    },
    steps(matchId: string): StoredStep[] {
      return all('SELECT round, kind, instant_ms, cause, first_seq, last_seq FROM steps WHERE match_id = ? ORDER BY rowid', matchId).map((r) => ({
        round: num(r, 'round'),
        kind: str(r, 'kind') as StoredStep['kind'],
        instant: num(r, 'instant_ms'),
        cause: str(r, 'cause') as StoredStep['cause'],
        firstSeq: num(r, 'first_seq'),
        lastSeq: num(r, 'last_seq'),
      }));
    },
    putPrediction(matchId: string, playerId: string, p: StoredPrediction): void {
      requireTransaction();
      if (p.kind === 'winner' && (p.winnerCandidates === undefined || p.round !== 0)) throw invalid('a winner prediction has round 0 and its candidate count');
      run(
        `INSERT INTO predictions (match_id, player_id, kind, round, choice, version, stored_ms, winner_candidates) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (match_id, player_id, kind, round) DO UPDATE SET choice = excluded.choice, version = excluded.version,
           stored_ms = excluded.stored_ms, winner_candidates = excluded.winner_candidates`,
        matchId, playerId, p.kind, p.round, p.choice, p.version, p.storedMs, p.kind === 'winner' ? (p.winnerCandidates ?? 0) : 0,
      );
    },
    predictionsOf(matchId: string, playerId: string): StoredPrediction[] {
      return all('SELECT kind, round, choice, version, stored_ms, winner_candidates FROM predictions WHERE match_id = ? AND player_id = ? ORDER BY kind, round', matchId, playerId).map(predictionOf);
    },
    predictionsInNamespace(matchId: string, namespace: string, after: PredictionKey | undefined, limit: number, localId?: string): NamespacePrediction[] {
      if (!isNamespace(namespace)) throw new RangeError('a namespace is 1 to 16 characters of a-z 0-9');
      if (localId !== undefined && !isLocalId(localId)) throw new RangeError('a local player id is 1 to 64 characters of A-Z a-z 0-9 _ - .');
      if (after !== undefined && (!isLocalId(after[0]) || !Number.isSafeInteger(after[1]) || typeof after[2] !== 'string')) throw new RangeError('not a key of the predictions list');
      checkLimit(limit);
      const prefix = `${namespace}${NAMESPACE_SEPARATOR}`;
      const end = `${namespace}${String.fromCharCode(NAMESPACE_SEPARATOR.charCodeAt(0) + 1)}`;
      const only = localId === undefined ? null : prefix + localId;
      const [afterPlayer, afterRound, afterKind] = after === undefined ? [prefix, -1, ''] : [prefix + after[0], after[1], after[2]];
      return all(READ_SQL.predictionsInNamespace, matchId, prefix, end, only, only, afterPlayer, afterRound, afterKind, limit).map((r) => {
        const playerId = str(r, 'player_id');
        if (!playerId.startsWith(prefix)) throw corrupt('a player id outside the namespace range');
        return { localId: playerId.slice(prefix.length), prediction: predictionOf(r) };
      });
    },
    listMatches(after: MatchListKey | undefined, limit: number): MatchSummary[] {
      checkLimit(limit);
      const [afterMs, afterId] = after === undefined ? [-1, ''] : after;
      return all(READ_SQL.listMatches, afterMs, afterId, limit).map((r) => {
        const stage = str(r, 'stage');
        if (!STAGES.includes(stage)) throw corrupt(`unknown stage ${stage}`);
        return { matchId: str(r, 'id'), mapId: str(r, 'map_id'), stage: stage as MatchSummary['stage'], appliedRounds: num(r, 'n'), totalRounds: num(r, 't'), createdAt: num(r, 'created_ms') };
      });
    },
    recordsAfter(matchId: string, round: number, limit: number): StoredRecord[] {
      if (!Number.isSafeInteger(round) || round < 0) throw new RangeError('a record keyset is a round of at least 0');
      checkLimit(limit);
      return all(READ_SQL.recordsAfter, matchId, round, limit).map(recordOf);
    },
    hostTokenDigest(matchId: string): string | undefined {
      const row = one(READ_SQL.hostTokenDigest, matchId);
      return row === undefined ? undefined : str(row, 'host_token_digest');
    },
    predictionsOfPhase(matchId: string, kind: PredictionKind, round: number): ScorablePrediction[] {
      if (!PREDICTION_KINDS.includes(kind)) throw new RangeError('not a prediction kind');
      if (!Number.isSafeInteger(round) || round < 0 || (kind === 'winner') !== (round === 0)) throw new RangeError('a winner phase is round 0, any other phase a round of at least 1');
      return all(READ_SQL.predictionsOfPhase, matchId, kind, round).map((r) =>
        kind === 'winner' ? { playerId: str(r, 'player_id'), choice: num(r, 'choice'), winnerCandidates: num(r, 'winner_candidates') } : { playerId: str(r, 'player_id'), choice: num(r, 'choice') },
      );
    },
    putResults(matchId: string, rows: readonly ResultRow[]): void {
      requireTransaction();
      const match = one('SELECT stage, n, victim FROM matches WHERE id = ?', matchId);
      if (match === undefined) throw invalid(`the match ${matchId} does not exist`);
      const n = num(match, 'n');
      const revealed = match.victim !== null;
      const finished = str(match, 'stage') === 'finished';
      for (const r of rows) {
        if (!PREDICTION_KINDS.includes(r.kind)) throw invalid('a result row has a prediction kind');
        if (!Number.isSafeInteger(r.choice) || typeof r.correct !== 'boolean' || !Number.isSafeInteger(r.points) || r.points < 0 || (!r.correct && r.points !== 0)) {
          throw invalid('a result row has a choice, a correct bit and points that are 0 when wrong and never negative');
        }
        if (r.kind === 'winner') {
          if (r.round !== 0) throw invalid('the winner row has round 0');
          if (!finished) throw invalid('the winner is scored only when the match is finished');
        } else {
          if (!Number.isSafeInteger(r.round) || r.round < 1) throw invalid('a result row names a round of at least 1');
          if (r.kind === 'absorber' && r.round > n) throw invalid('an absorber is scored only for an applied round');
          if (r.kind === 'victim' && (r.round > n + 1 || (r.round === n + 1 && !revealed))) throw invalid('a victim is scored only once it is revealed');
        }
        if (one('SELECT 1 AS found FROM results WHERE match_id = ? AND round = ? AND kind = ? AND player_id = ?', matchId, r.round, r.kind, r.playerId) !== undefined) {
          throw invalid('a phase is scored once: the result row already exists');
        }
        run('INSERT INTO results (match_id, round, kind, player_id, choice, correct, points) VALUES (?, ?, ?, ?, ?, ?, ?)', matchId, r.round, r.kind, r.playerId, r.choice, r.correct ? 1 : 0, r.points);
      }
    },
    appendEvents(matchId: string, events: readonly MatchEvent[]): void {
      requireTransaction();
      let expected = lastSeqOf(matchId) + 1;
      for (const event of events) {
        if (event.seq !== expected) throw invalid(`event number ${event.seq} where ${expected} is next`);
        run('INSERT INTO events (match_id, seq, type, payload_json) VALUES (?, ?, ?, ?)', matchId, event.seq, event.type, JSON.stringify(event));
        expected += 1;
      }
    },
    eventsAfter(matchId: string, seq: number): MatchEvent[] {
      return all('SELECT payload_json FROM events WHERE match_id = ? AND seq > ? ORDER BY seq', matchId, seq).map(eventOf);
    },
    memoGet(scope: MemoScope, requestId: string): StoredMemo | undefined {
      const row = one('SELECT content_digest, reply_json, created_ms FROM memo WHERE scope = ? AND request_id = ?', scopeText(scope), requestId);
      if (row === undefined) return undefined;
      return { contentDigest: str(row, 'content_digest'), reply: JSON.parse(str(row, 'reply_json')) as unknown, createdMs: num(row, 'created_ms') };
    },
    memoPut(scope: MemoScope, requestId: string, entry: StoredMemo): void {
      requireTransaction();
      run(
        `INSERT INTO memo (scope, request_id, content_digest, reply_json, created_ms) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (scope, request_id) DO UPDATE SET content_digest = excluded.content_digest, reply_json = excluded.reply_json, created_ms = excluded.created_ms`,
        scopeText(scope), requestId, entry.contentDigest, JSON.stringify(entry.reply), entry.createdMs,
      );
    },
    memoPurge(now: number): number {
      requireTransaction();
      const result = guard(() => db.prepare('DELETE FROM memo WHERE ? - created_ms > ?').run(now, MEMO_RETENTION_MS));
      return Number(result.changes);
    },
    memoOldest(): number | undefined {
      const row = one('SELECT MIN(created_ms) AS oldest FROM memo');
      return row === undefined || row.oldest === null ? undefined : num(row, 'oldest');
    },
    close(): void {
      if (closed) return;
      closed = true;
      closeQuietly(db);
    },
  };
};
