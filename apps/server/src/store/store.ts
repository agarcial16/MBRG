// The storage interface (spec 008, FR-291, FR-293, plan 17.1). Everything the lifecycle service needs from storage
// goes through this interface, so a change in `node:sqlite` touches `sqlite.ts` only. Reads run anywhere; every
// write runs inside `transaction` (a write outside one throws). No operation takes or returns an absorber outside a
// record of an applied round, a pending state or a credential text (PD11, PD12).
import type { MatchEvent, PublicState } from '@mbrg/protocol';
import type { MemoScope } from '../core/memo';
import type { StoredPrediction } from '../core/predictions';
import type { CoreMatch, StepRow } from '../core/view';

/**
 * Why a store could not be opened or used. `store-failure` and `database-locked` are storage failures (the service replies
 * `unavailable` and retries a clock step, FR-292); `invalid-write` and `unknown-schema-version` are not.
 */
export type StoreErrorCode = 'unknown-schema-version' | 'database-locked' | 'store-failure' | 'invalid-write';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
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

/** A memo entry: the digest of the canonical content, the reply as given and the first-use instant (FR-282, PD12). */
export interface StoredMemo {
  readonly contentDigest: string;
  readonly reply: unknown;
  readonly createdMs: number;
}

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
  /** The state at an applied round, or undefined. */
  getState(matchId: string, round: number): StoredState | undefined;
  /** Stores the record of an applied round (1 <= round <= N): any other round is refused (FR-255, FR-256). */
  putRecord(matchId: string, record: StoredRecord): void;
  /** The records 1..N in round order. */
  records(matchId: string): StoredRecord[];
  /** Stores a step row (FR-240, FR-293); two rows of one transaction keep their insertion order. */
  putStep(matchId: string, step: StoredStep): void;
  /** The step rows in the order they were stored. */
  steps(matchId: string): StoredStep[];
  /** Upserts the prediction of (match, player, kind, round) with the given version (FR-267); round 0 is the winner. */
  putPrediction(matchId: string, playerId: string, prediction: StoredPrediction): void;
  /** The stored predictions of one player id in one match, by kind then round (FR-270). */
  predictionsOf(matchId: string, playerId: string): StoredPrediction[];
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
