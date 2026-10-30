// The storage interface (spec 008, FR-291, FR-293, plan 17.1). Everything the lifecycle service needs from storage
// goes through this interface, so a change in `node:sqlite` touches `sqlite.ts` only. Reads run anywhere; every
// write runs inside `transaction` (a write outside one throws). No operation takes or returns an absorber outside a
// record of an applied round, a pending state or a credential text (PD11, PD12).
import type { MatchEvent, MatchSummary, PredictionKind, PublicState } from '@mbrg/protocol';
import type { MemoScope } from '../core/memo';
import type { StoredPrediction } from '../core/predictions';
import type { PlayerTotals, ResultRow, ScorablePrediction } from '../core/scoring';
import type { CoreMatch, StepRow } from '../core/view';

/**
 * Why a store could not be opened or used. `store-failure` and `database-locked` are storage failures (the service replies
 * `unavailable` and retries a clock step, FR-292); `invalid-write` (a refused write, a constraint violation, a misuse or
 * a logic error of SQLite) and `unknown-schema-version` are not.
 */
export type StoreErrorCode = 'unknown-schema-version' | 'database-locked' | 'store-failure' | 'invalid-write';

/** What a StoreError keeps of the error it classifies (NFR-54: for the log of T9, never stored or sent). */
export interface StoreErrorDetails {
  /** The original error (a native SQLite error). Not an enumerable field: serialising the StoreError leaves it out. */
  readonly cause?: unknown;
  /** The SQLite result code (`errcode`, extended codes included), when the platform attaches it. */
  readonly sqliteCode?: number;
  /** The generic text of that result code (`errstr`, no value), when the platform attaches it. */
  readonly sqliteText?: string;
}

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly sqliteCode?: number;
  readonly sqliteText?: string;
  /**
   * The message never quotes the native message (it may hold values, NFR-54); the native error is the cause.
   */
  constructor(code: StoreErrorCode, message: string, details: StoreErrorDetails = {}) {
    super(message, 'cause' in details ? { cause: details.cause } : undefined);
    this.name = 'StoreError';
    this.code = code;
    if (details.sqliteCode !== undefined) this.sqliteCode = details.sqliteCode;
    if (details.sqliteText !== undefined) this.sqliteText = details.sqliteText;
  }
}

/**
 * A second player with a name key a match already holds (spec 011 FR-377, plan section 3). It is an `invalid-write` for the
 * classification of storage failures (a constraint violation is not a storage failure), and a type of its own so the service
 * can answer `name-taken` and nothing else. The message carries no name and no key.
 */
export class NameTakenError extends StoreError {
  constructor(details: StoreErrorDetails = {}) {
    super('invalid-write', 'the name key is already taken in this match', details);
    this.name = 'NameTakenError';
  }
}

/** The settings of the open database, read back from the connection (plan PD9). */
export interface StoreSettings {
  readonly journalMode: string;
  readonly synchronous: 'off' | 'normal' | 'full' | 'extra';
  readonly foreignKeys: boolean;
  readonly lockingMode: string;
  readonly userVersion: number;
}

/** A match as stored: the core view, the plain secret (D14, 32 bytes) and the digest of the host token (PD12). */
export interface StoredMatch {
  readonly match: CoreMatch;
  readonly secret: Uint8Array;
  readonly hostTokenDigest: string;
}

/** A step row (FR-293) with the sequence numbers of its events (D16). */
export interface StoredStep extends StepRow {
  readonly firstSeq: number;
  readonly lastSeq: number;
}

export interface StoredState {
  readonly state: PublicState;
  readonly stateDigest: string;
}

/** The record of an APPLIED round: the only place an absorber is stored (PD11). */
export interface StoredRecord {
  readonly round: number;
  readonly eliminated: number;
  readonly absorber: number;
  readonly transferred: readonly number[];
}

/** A stored prediction of a namespace's player, with the local part of its player id (FR-270, C3). */
export interface NamespacePrediction {
  readonly localId: string;
  readonly prediction: StoredPrediction;
}

/** The keyset of the match list (FR-279 (b)): creation instant, then match id. */
export type MatchListKey = readonly [createdAt: number, matchId: string];
/** The keyset of the own predictions (FR-279 (b)): local player id, round (0 for the winner), kind. */
export type PredictionKey = readonly [localId: string, round: number, kind: PredictionKind];

/** The keyset of a player's results (plan 20.7): round (0 for the winner), then kind in text order. */
export type PlayerResultKey = readonly [round: number, kind: PredictionKind];

/** One stored result of a phase as the phase results list it: the player id as stored, the choice, the correct bit and the points. */
export interface StoredPhaseResult {
  readonly playerId: string;
  readonly choice: number;
  readonly correct: boolean;
  readonly points: number;
}

/** One stored result of one player: the winner has round 0. */
export interface StoredPlayerResult {
  readonly kind: PredictionKind;
  readonly round: number;
  readonly choice: number;
  readonly correct: boolean;
  readonly points: number;
}

/** A memo entry: the digest of the canonical content, the reply as given and the first-use instant (FR-282, PD12). */
export interface StoredMemo {
  readonly contentDigest: string;
  readonly reply: unknown;
  readonly createdMs: number;
}

/** The lobby row of a match created through the public path (spec 011 plan section 3). */
export interface StoredLobby {
  readonly matchId: string;
  /** 1 in the table: a public lobby counts in the caps. */
  readonly public: boolean;
  /** The instant the lobby expires if it is not started (`created + the expiry setting`). */
  readonly expiresMs: number;
  readonly startedMs: number | null;
  readonly expiredMs: number | null;
}

/** A player as the store reads it back: no token digest and no name key leave the store (spec 011 FR-378, FR-382). */
export interface StoredPlayer {
  /** `player:<local id>`. */
  readonly playerId: string;
  /** The name as shown (trimmed, NFC). */
  readonly name: string;
  /** The sequence number of the `player-joined` event: the join order and the key of the players list. */
  readonly joinedSeq: number;
  readonly joinedMs: number;
}

/**
 * A player to store. There is no token here: the token is hashed by the service and only `tokenDigest` (64 lowercase
 * hexadecimal characters) is written. `nameKey` is the folded name of protocol `nameKey`, unique in the match.
 */
export interface NewPlayer {
  readonly matchId: string;
  readonly playerId: string;
  readonly name: string;
  readonly nameKey: string;
  readonly tokenDigest: string;
  readonly joinedSeq: number;
  readonly joinedMs: number;
}

/** An expired lobby is kept this long after its expiry, then purged with its match (FR-282 retention, 24 h). */
export const LOBBY_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface Store {
  /** The settings in force on this connection. */
  settings(): StoreSettings;
  /** The tables of the schema, as the database reports them. */
  tables(): string[];
  /**
   * Runs `fn` inside one write transaction (BEGIN IMMEDIATE ... COMMIT): a throw rolls everything back and is
   * rethrown. Transactions never nest. Plan PD10.
   */
  transaction<T>(fn: () => T): T;
  /**
   * Stores a new match (FR-293): its row and the state at N. The secret is 32 bytes; the host token arrives as a digest.
   * A match id that exists is refused (`invalid-write`).
   */
  insertMatch(row: StoredMatch): void;
  /**
   * Updates the mutable columns of a match (stage, N, anchors, last step instant, victim, winner, halt reason) and
   * stores the state at N when it is new. Timing, map, commitment, creation instant and T never change (FR-235); N
   * never decreases.
   */
  updateMatch(match: CoreMatch): void;
  /** The match with its secret, or undefined. `lastSeq` is the highest event number stored (0 with no event). */
  getMatch(matchId: string): StoredMatch | undefined;
  /** Matches in `phase-1`, `phase-2` or `locked` (FR-232): halted and finished ones do not count. */
  runningCount(): number;
  /** The ids of the running matches (the stages counted by `runningCount`), oldest first: what a tick walks. */
  runningMatchIds(): string[];
  /**
   * Stores the lobby row of a match that exists (insert the match first, in the same transaction). A second row for a
   * match, a missing match or an expiry that is not a non-negative whole number is refused (`invalid-write`).
   */
  insertLobby(lobby: { readonly matchId: string; readonly public: boolean; readonly expiresMs: number }): void;
  /** The lobby row of a match, or undefined (an operator match has none). */
  getLobby(matchId: string): StoredLobby | undefined;
  /**
   * Marks a lobby started at `nowMs`. A match with no lobby row, a lobby already started or already expired, or an instant
   * that is not a non-negative whole number is refused (`invalid-write`): a lobby is marked once. The caller changes the
   * match row and appends the event in the same transaction.
   */
  markStarted(matchId: string, nowMs: number): void;
  /** Marks a lobby expired at `nowMs`; refused exactly as `markStarted` is. */
  markExpired(matchId: string, nowMs: number): void;
  /** Public lobbies neither started nor expired: what the open-lobby cap counts. */
  openLobbyCount(): number;
  /** Public matches with a lobby row whose match is in `phase-1`, `phase-2` or `locked`. Operator matches are not counted. */
  publicRunningCount(): number;
  /** The ids of the lobbies (public or not) with `expires_ms <= now` that are neither started nor expired, in id order. */
  lobbiesExpiringBefore(now: number): string[];
  /** The ids of the lobbies neither started nor expired, in id order: what `start()` re-arms. */
  lobbyIds(): string[];
  /**
   * Deletes the lobbies expired for more than the retention at `now` (`now - expired_ms > LOBBY_RETENTION_MS`) with their
   * match, events, states, records, steps, predictions, results and players, and returns how many lobbies. Started and open
   * lobbies, operator matches and the memo are never touched.
   */
  purgeExpired(now: number): number;
  /** The expiry instant of the oldest expired lobby still stored (where its removal is armed), or undefined with none. */
  oldestExpiredMs(): number | undefined;
  /**
   * Stores a player of a match that exists (insert it first, in the same transaction as the `player-joined` event). Refused
   * as `invalid-write`: a digest that is not 64 lowercase hexadecimal characters, a player id outside the `player:` namespace,
   * an empty name or key, a join order that is not a whole number from 1 or an instant that is not a non-negative whole
   * number, a missing match, a player id or join order the match already holds. A name key the match already holds is a
   * `NameTakenError` (an `invalid-write`), raised by the unique index of the table.
   */
  insertPlayer(player: NewPlayer): void;
  /** The number of players of a match (0 with none or for an unknown match). */
  playerCount(matchId: string): number;
  /**
   * The player of a match whose token has this digest, or undefined: looked up by the index on the digest and always scoped
   * to the match. A value that is not a digest is a RangeError.
   */
  playerByTokenDigest(matchId: string, tokenDigest: string): StoredPlayer | undefined;
  /**
   * The players of a match with a join order above `after` (exclusive; from the start when absent), at most `limit`, in
   * join order. A page asks `limit + 1` to know whether another follows.
   */
  playersAfter(matchId: string, after: number | undefined, limit: number): StoredPlayer[];
  /** The names of the joined players of a match among `ids` (an id that is not a player of this match is left out). */
  playerNames(matchId: string, ids: readonly string[]): ReadonlyMap<string, string>;
  /** The state at an applied round, or undefined. */
  getState(matchId: string, round: number): StoredState | undefined;
  /** Stores the record of an applied round (1 <= round <= N): any other round is refused (FR-255, FR-256). */
  putRecord(matchId: string, record: StoredRecord): void;
  /** The records 1..N in round order. */
  records(matchId: string): StoredRecord[];
  /**
   * The match list after `after` (exclusive; from the start when absent), at most `limit` summaries ordered by creation
   * instant then match id (code unit order). Selects the summary columns only: no secret, host-token digest or owners.
   */
  listMatches(after: MatchListKey | undefined, limit: number): MatchSummary[];
  /** The records of the rounds above `round`, in round order, at most `limit` (FR-279). */
  recordsAfter(matchId: string, round: number, limit: number): StoredRecord[];
  /**
   * The stored predictions of every player id `<namespace>:<local id>` of a match (only `localId` when given), after
   * `after` (exclusive), at most `limit`, ordered by local id, round (0 for the winner), kind (FR-270, FR-279, C3). The
   * namespace is matched exactly, never as a pattern; a namespace or local id outside its character set is a RangeError.
   */
  predictionsInNamespace(matchId: string, namespace: string, after: PredictionKey | undefined, limit: number, localId?: string): NamespacePrediction[];
  /** The stored digest of a match's host token, or undefined for an unknown match (FR-300, PD16). */
  hostTokenDigest(matchId: string): string | undefined;
  /** Stores a step row (FR-240, FR-293); two rows of one transaction keep their insertion order. */
  putStep(matchId: string, step: StoredStep): void;
  /** The step rows in the order they were stored. */
  steps(matchId: string): StoredStep[];
  /** Upserts the prediction of (match, player, kind, round) with the given version (FR-267); round 0 is the winner. */
  putPrediction(matchId: string, playerId: string, prediction: StoredPrediction): void;
  /** The stored predictions of one player id in one match, by kind then round (FR-270). */
  predictionsOf(matchId: string, playerId: string): StoredPrediction[];
  /**
   * Every stored prediction of one phase of a match, ordered by player id (code unit order): the victim or absorber
   * predictions of `round`, or the winner predictions (`round` 0), each with its stored candidate count (FR-267, M4 scoring).
   * Read inside the decision's transaction, so the set is the one stored before the cutoff and the closing step (FR-295).
   */
  predictionsOfPhase(matchId: string, kind: PredictionKind, round: number): ScorablePrediction[];
  /**
   * Stores the result rows of one scored phase (FR-271 to FR-273; plan 20.5). Read in the same transaction after
   * `updateMatch`, so the refusals (`invalid-write`) judge the match as the decision leaves it: an absorber row of a round
   * above N, a victim row of a round above N + 1 (or of N + 1 while the match row holds no victim), a winner row unless the
   * stage is `finished` (and then round 0 only), a row whose points do not fit its `correct` bit, and a second row with the
   * same (round, kind, player): a phase is scored once. Defence in depth for FR-256 and FR-270: a premature `correct` bit
   * would reveal an outcome.
   */
  putResults(matchId: string, rows: readonly ResultRow[]): void;
  /**
   * The result rows of one scored phase (`victim` for phase 1, `absorber` for phase 2) of `round`, after the player id
   * `after` (exclusive; from the start when absent), at most `limit`, ordered by player id (code unit order; M4' reads,
   * phase results). Rows exist only for scored phases (the refusals of `putResults`), so nothing unscored can be listed.
   */
  phaseResultsAfter(matchId: string, kind: 'victim' | 'absorber', round: number, after: string | undefined, limit: number): StoredPhaseResult[];
  /**
   * The result rows of one player id (as stored, namespace included) after the key `after` (exclusive), at most `limit`,
   * ordered by round (0 for the winner) then kind.
   */
  playerResultsAfter(matchId: string, playerId: string, after: PlayerResultKey | undefined, limit: number): StoredPlayerResult[];
  /** The sum of every stored result of one player id in a match (0 with none): the `total` of the player results. */
  playerTotal(matchId: string, playerId: string): number;
  /** One aggregate per player id with at least one result row: total and correct counts per kind, in no promised order. */
  leaderboardTotals(matchId: string): PlayerTotals[];
  /** Appends events: the first number is the stored last number + 1 and the rest follow without a gap (FR-289). */
  appendEvents(matchId: string, events: readonly MatchEvent[]): void;
  /** The events with a number above `seq`, in order. */
  eventsAfter(matchId: string, seq: number): MatchEvent[];
  /** The memo entry of a scope and request id, or undefined. The scope holds a credential digest only (FR-300). */
  memoGet(scope: MemoScope, requestId: string): StoredMemo | undefined;
  /** Stores or replaces a memo entry. */
  memoPut(scope: MemoScope, requestId: string, entry: StoredMemo): void;
  /** Deletes the entries older than the 24 h retention at `now` (FR-282 (e)) and returns how many. */
  memoPurge(now: number): number;
  /** The first-use instant of the oldest memo entry, or undefined with none: where the purge timer is armed (FR-238). */
  memoOldest(): number | undefined;
  /** Releases the connection and the exclusive lock. */
  close(): void;
}
