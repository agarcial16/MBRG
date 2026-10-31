// The match lifecycle service (spec 008 FR-231, FR-232, FR-235, FR-236, FR-238, FR-241 to FR-247, FR-250, FR-251, FR-259, FR-260, FR-261 to
// FR-267, FR-282, FR-290, FR-295; plan 17.1).
//
// Halting (FR-250, FR-251): the map check runs before every step (`depsOf`); the core turns a missing map, an engine
// `isolated-faction` answer or a recomputed victim that differs from the stored one into a halted view and one
// `match-halted` event, stored and published like any decision. A halted match is not running: it is never ticked or
// armed, it does not count toward the limit, it answers `match-halted` to advances and submissions, and its public data
// never carries the secret (only a finished match does, FR-259). The shell around the pure core: it draws the secret, the match id and the host token, reads the map
// package, calls the core and the protocol readers, and writes everything of ONE decision in ONE storage transaction
// (PD10) before it replies or publishes anything. It depends on core, protocol and store; the core never imports it.
//
// Dependencies are injected: the clock, the random source (production: the platform CSPRNG through secret.ts), the map
// catalog and, optionally, the scheduler (the only module with timers). The test-only round-seed source (FR-260) is a
// parameter of this constructor and of nothing else: the production entry point builds the service from the settings alone.
//
// Per-match serialisation (FR-295, PD10): every decision is one synchronous `store.transaction` (the store is synchronous and
// the process single-threaded), so decisions on a match never overlap and each sees the stored result of the ones before.
// Events reach subscribers only after the commit, outside the transaction, so a subscriber that calls the service again sees
// the stored result and cannot nest a transaction.
//
// Write order of a step (the application order of the plan): `updateMatch` (N + 1 and its state), `putRecord`, `putStep`,
// `appendEvents`.
//
// Timer loop and failures (FR-238, FR-239, FR-248, FR-292; M2b' T3'): `start` checks the map of every stored running match,
// performs its one overdue step (late, at the effective instant) and arms it; the memo purge is armed at the retention
// boundary of the oldest entry. After every decision the next wake-up is armed BEFORE the events are published. A storage
// failure (`isStorageFailure`) makes a command reply `unavailable` (the transaction rolled back); a clock step that fails,
// for any reason, is isolated from the other matches and retried RETRY_MS later. A storage failure of the enumeration of
// the running matches at `start` arms a retry of the whole start check RETRY_MS later, until it succeeds (FR-294); a
// programming error there is rethrown by `start`. `close` cancels every wake-up.
//
// Results reads (M4'): the results of a scored phase, a player's results and the leaderboard, from the `results` rows alone
// (rows exist only for scored phases) and the public parts of the stored match; they write nothing.
//
// Reads (FR-281 (a) to (d), (h), (j), FR-258, FR-302; M3a T5): outcomes with an `ErrorReply`, no transaction and no write
// (only the in-memory reported time); a storage failure is `unavailable`; keyset pages with the cursors of the protocol.

import {
  PAGE_LIMIT_MAX,
  PLAYER_NAMESPACE,
  canonicalBody,
  encodeCursor,
  encodeJoinReply,
  encodePublicMatch,
  errorReply,
  isJoinedPlayerId,
  isLocalId,
  isNamespace,
  isPlayerId,
  nameKey,
  pageOf,
  playerIdOf,
  readAdvance,
  readCreation,
  readJoin,
  readStart,
  readSubmission,
} from '@mbrg/protocol';
import type {
  AdvanceReply,
  CreationReply,
  CursorKey,
  CursorList,
  ErrorReply,
  JoinReply,
  LeaderboardRow,
  MatchEvent,
  MatchSummary,
  OwnPrediction,
  Page,
  PhaseResultsPage,
  PlayerListItem,
  PlayerResultsPage,
  PredictionReply,
  PublicMatch,
  RecordReply,
  StateReply,
  StepKind,
  Timing,
} from '@mbrg/protocol';
import type { Clock } from '../clock';
import { decideAdvance } from '../core/advance';
import { createLobby, createMatch, creationEvents, lobbyEvents } from '../core/create';
import { expireDecision, joinDecision, startDecision } from '../core/lobby';
import { MEMO_RETENTION_MS, decideMemo, isMemoisable } from '../core/memo';
import type { MemoScope } from '../core/memo';
import { decideSubmission } from '../core/predictions';
import { readRound } from '../core/reads';
import { rankLeaderboard, readResultsRound, scorePhase, scoredPhaseCount } from '../core/scoring';
import type { StoredPrediction, Submission } from '../core/predictions';
import { haltMatch, runDue } from '../core/steps';
import type { StepDeps, StepOutcome } from '../core/steps';
import { dueStep, effectiveInstant, reportedTime, wholeMs } from '../core/time';
import { publicOf } from '../core/view';
import type { CoreMatch, StepRow } from '../core/view';
import { DERIVATION_RULE, commitment as commitmentOf, newSecret, secretHex } from '../secret';
import type { RandomBytes } from '../secret';
import { seedOfSecret } from '../seeds';
import { LOBBY_RETENTION_MS, NameTakenError, StoreError } from '../store/store';
import type { Store, StoredMatch, StoredRecord, StoredStep } from '../store/store';
import { credentialDigest, newHostToken, newMatchId, newPlayerLocalId, newPlayerToken, sameDigest, sha256Ascii } from './ids';
import { isMapFileName, mapForStep } from './maps';
import type { MapCatalog, MapFile } from './maps';
import { checkPublicCreation } from './publiccreate';
import type { Scheduler, SchedulerHandle } from './scheduler';
import type { Settings } from './settings';

/** The path text of a creation in the canonical content of FR-282 (the HTTP layer of M3a uses the same text). */
export const CREATION_PATH = '/matches';

/** The reply of a creation: the first reply or the first error (both are what a replay returns). */
export type CreateOutcome = { readonly ok: true; readonly reply: CreationReply } | { readonly ok: false; readonly error: ErrorReply };

export interface CreateRequest {
  /** The credential the caller presented (a missing one is `undefined`). */
  readonly credential: string | undefined;
  /** The parsed JSON body of the creation command. */
  readonly body: unknown;
}

/**
 * A public creation (spec 011 FR-369, FR-371): no operator credential, only the source the request came from (the HTTP layer
 * resolves it; the service keys the memo by its digest and trusts the text it is given) and the parsed JSON body.
 */
export interface PublicCreateRequest {
  readonly source: string;
  readonly body: unknown;
}

/** The path text of a start in the canonical content of FR-282 (the HTTP layer of M4 uses the same text). */
export const startPath = (matchId: string): string => `${CREATION_PATH}/${matchId}/start`;

/** The start of a lobby (FR-374): only the host token of the match is accepted. */
export interface StartRequest {
  /** The credential the caller presented; only the host token of the match starts it (the operator credential does not). */
  readonly credential: string | undefined;
  readonly matchId: string;
  /** The parsed JSON body `{ requestId? }`. */
  readonly body: unknown;
}

/** The reply of a start: the public data after it (stage `phase-1`, round 1, the clock anchors when the timing has a clock). */
export interface StartReply {
  readonly match: PublicMatch;
}

export type StartOutcome = { readonly ok: true; readonly reply: StartReply } | { readonly ok: false; readonly error: ErrorReply };

/** The path text of a join in the canonical content of FR-282 (the HTTP layer of M4 uses the same text). */
export const joinPath = (matchId: string): string => `${CREATION_PATH}/${matchId}/join`;

/**
 * A join (spec 011 FR-377): no credential. `source` is the text the HTTP layer resolved for the caller (the service keys the
 * memo by its digest and trusts it); the parsed JSON body is `{ name, requestId }`.
 */
export interface JoinRequest {
  readonly source: string;
  readonly matchId: string;
  readonly body: unknown;
}

/** The reply of a join: `{ playerId, name, playerToken, match }` (the only time the token leaves the server), or the error. */
export type JoinOutcome = { readonly ok: true; readonly reply: JoinReply } | { readonly ok: false; readonly error: ErrorReply };

/** The reply of an advance: the reply of FR-295 (b), or the error (`step-mismatch` carries the stage and N, C6). */
export type AdvanceOutcome = { readonly ok: true; readonly reply: AdvanceReply } | { readonly ok: false; readonly error: ErrorReply };

export interface AdvanceRequest {
  /** The credential the caller presented: the operator credential or the match's host token (FR-244, FR-245). Reading it from a request is M3a. */
  readonly credential: string | undefined;
  readonly matchId: string;
  /** The parsed JSON body `{ round, step }`. */
  readonly body: unknown;
}

/** The path texts of the commands in the canonical content of FR-282 (the HTTP layer of M3a uses the same texts). */
export const advancePath = (matchId: string): string => `${CREATION_PATH}/${matchId}/advance`;
export const submissionPath = (matchId: string): string => `${CREATION_PATH}/${matchId}/predictions`;

/**
 * The caller of a prediction command, as the HTTP layer of M3a resolves it from the client credential: the credential TEXT
 * (only its digest is kept, as the memo scope) and the namespace registered for it. The player id is built from this
 * namespace and never from the body (FR-284 is M3a; the service trusts the pair it is given).
 */
export interface ClientIdentity {
  readonly credential: string;
  readonly namespace: string;
}

/**
 * A player the HTTP layer resolved from a match token (spec 011 FR-378, `playerTokenOf`): the digest of the token (the memo
 * scope; the token text never reaches the service again) and the player id `player:<local id>`. The service trusts the pair.
 */
export interface PlayerCaller {
  readonly tokenDigest: string;
  readonly playerId: string;
}

const isPlayerCaller = (caller: ClientIdentity | PlayerCaller): caller is PlayerCaller => Object.hasOwn(caller, 'tokenDigest');
const PLAYER_TOKEN_DIGEST = /^[0-9a-f]{64}$/;
/** A resolved player is a digest and a joined player id; anything else is a programming error of the caller. */
const checkPlayerCaller = (caller: PlayerCaller): void => {
  if (!PLAYER_TOKEN_DIGEST.test(String(caller.tokenDigest)) || !isJoinedPlayerId(caller.playerId)) {
    throw new TypeError('the caller identity is a token digest and a joined player id');
  }
};

export interface SubmitRequest {
  /** A client credential with its namespace (008), or a player resolved from its match token (spec 011 FR-378). */
  readonly client: ClientIdentity | PlayerCaller;
  readonly matchId: string;
  /** The parsed JSON body `{ kind, round?, faction, playerId, requestId? }`. */
  readonly body: unknown;
}

/** The reply of a submission: the stored prediction and its version (FR-267), or the error (first use, or its memoised replay). */
export type SubmitOutcome = { readonly ok: true; readonly reply: PredictionReply } | { readonly ok: false; readonly error: ErrorReply };

export type OwnPredictionsRequest =
  | {
      /** Only the namespace of the credential: a client reads its own player ids and no others. */
      readonly namespace: string;
      /** The local player id (the namespace is added here, never taken from the caller's text). */
      readonly playerId: string;
      readonly matchId: string;
    }
  | {
      /** A player resolved from its match token reads its own predictions; another local id is `forbidden`. */
      readonly player: PlayerCaller;
      readonly playerId: string;
      readonly matchId: string;
    };

export type OwnPredictionsOutcome = { readonly ok: true; readonly predictions: readonly PredictionReply[] } | { readonly ok: false; readonly error: ErrorReply };

/** The outcome of a read (FR-281): the reply, or the error (`unavailable` for a storage failure, FR-292). Reads write nothing. */
export type ReadOutcome<T> = { readonly ok: true; readonly reply: T } | { readonly ok: false; readonly error: ErrorReply };

/**
 * One page request of a list read (FR-279): the page size (1 to 500, as `readPageQuery` gives it; anything else is a
 * programming error of the caller) and the key the previous page ended on (decoded from its cursor), absent for the first.
 */
export interface PageRequest<L extends CursorList> {
  readonly limit: number;
  readonly after?: CursorKey<L>;
}

/** The own predictions of a client (FR-270, FR-281 (h), C3): every player of its namespace, or one local id when given. */
export type OwnPredictionsPageRequest = PageRequest<'predictions'> &
  (
    | {
        /** The namespace of the client credential (resolved by the HTTP layer); never taken from the request. */
        readonly namespace: string;
        readonly matchId: string;
        /** An optional local player id (the namespace is added here, never taken from the caller's text). */
        readonly playerId?: string;
      }
    | {
        /** A player resolved from its match token: its own predictions only; an optional local id must be its own (`forbidden` otherwise). */
        readonly player: PlayerCaller;
        readonly matchId: string;
        readonly playerId?: string;
      }
  );

/**
 * A clock step that could not run (FR-292): `unavailable` for a storage failure, `error` for anything else (a programming
 * error or inconsistent stored data). Either way nothing of it was stored or published, and its retry is armed.
 */
export interface StepFailure {
  readonly matchId: string;
  readonly kind: 'unavailable' | 'error';
}

/** What one `tick` did: the memo entries purged and, per match, the step rows performed (one decision per match at most) or the failure. */
export interface TickReport {
  readonly purged: number;
  readonly performed: readonly { readonly matchId: string; readonly steps: readonly StepRow[] }[];
  readonly failed: readonly StepFailure[];
}

/**
 * What `start` did: a tick of every stored running match, plus the matches halted by the map check at start (FR-250).
 * `retry` is present only when the enumeration of the stored running matches failed with a storage failure: nothing was
 * checked, stepped or armed, and the whole start check runs again at `at` (FR-292, FR-294), and so on until it succeeds.
 */
export interface StartReport extends TickReport {
  readonly halted: readonly string[];
  readonly retry?: { readonly kind: 'unavailable'; readonly at: number };
}

/** The interval between the attempts of a clock step whose storage failed (FR-292): the retry follows FR-248 once overdue. */
export const RETRY_MS = 3000;

/**
 * A storage failure (FR-292): the store could not read or write (`store-failure`, `database-locked`, the fault seam's
 * injected faults). Anything else (a RangeError of inconsistent data, a refused write, a TypeError) is a programming error:
 * commands rethrow it, and the timer loop isolates it like a storage failure but reports it as `error`.
 */
export const isStorageFailure = (error: unknown): boolean => error instanceof StoreError && (error.code === 'store-failure' || error.code === 'database-locked');

/** A subscriber: called after the commit of a decision with the events it stored, in order (FR-287, FR-290). */
export type MatchListener = (matchId: string, events: readonly MatchEvent[]) => void;

/**
 * TEST-ONLY round-seed source (FR-260): replaces the HMAC derivation of FR-252 for the match it is asked about. It is a
 * parameter of `createMatchService` only; no setting, variable, request or production entry point can set it.
 */
export type TestSeedSource = (matchId: string) => (round: number) => number;

/** The reply of `eventsAfter`: the events after the given number and the stored last event number of the match. */
export interface EventsRead {
  readonly lastSeq: number;
  readonly events: readonly MatchEvent[];
}

export interface ServiceOptions {
  readonly store: Store;
  readonly clock: Clock;
  readonly maps: MapCatalog;
  readonly settings: Settings;
  /** The random source of secrets, match ids and host tokens; omitted in production (the platform CSPRNG). */
  readonly random?: RandomBytes;
  /** Wakes the service at the next due instant of each running match, a retry, or the memo purge; omitted: only `tick` performs clock steps. */
  readonly scheduler?: Scheduler;
  /** TEST-ONLY (FR-260). Production passes none. */
  readonly testSeedSource?: TestSeedSource;
  /**
   * Told of every clock step that failed (FR-292, NFR-54), once per failed step, with the ORIGINAL cause (a native SQLite
   * error included) and nothing else: this service logs nothing itself; the entry point passes the log. A callback that
   * throws changes nothing (the retry is armed first).
   */
  readonly onFailure?: (failure: StepFailure, cause: unknown) => void;
}

export interface MatchService {
  /** FR-231, FR-232, FR-238: creates a match, or replays or refuses; one storage transaction. */
  create(request: CreateRequest): CreateOutcome;
  /**
   * FR-371 (public path): creates a match in stage `lobby` for a caller with no operator credential, or replays or refuses;
   * one storage transaction. A refusal stores and draws nothing; only a creation is memoised, under the source's scope.
   */
  createPublic(request: PublicCreateRequest): CreateOutcome;
  /**
   * FR-374, FR-375: starts a lobby with the host token: stage `phase-1` of round 1, clock anchored at the start instant, one
   * `schedule` event, all in one storage transaction. The same request id and content replays the first reply.
   */
  startMatch(request: StartRequest): StartOutcome;
  /**
   * FR-377, FR-376, FR-380: a caller with no credential joins a lobby or a running match with a name; one storage transaction
   * writes the player (as a token digest), the `player-joined` event and the match's last number, and the memo (the plain token
   * lives only there, 24 h). A refusal stores, draws and memoises nothing.
   */
  join(request: JoinRequest): JoinOutcome;
  /** FR-244, FR-245, FR-295: an advance naming the step the caller expects; one storage transaction when it performs a step. */
  advance(request: AdvanceRequest): AdvanceOutcome;
  /** FR-261 to FR-267, FR-282 (b) (c): stores or replaces a prediction, or replays or refuses; one storage transaction. */
  submit(request: SubmitRequest): SubmitOutcome;
  /** FR-270 (storage): the stored predictions of one of the caller's own player ids in one match. */
  ownPredictions(request: OwnPredictionsRequest): OwnPredictionsOutcome;
  /** FR-239, FR-248: purges the expired memo entries and performs the one due step of every running match. */
  tick(): TickReport;
  /** The public data of a match now (FR-288 victim fields in `phase-2` and `locked`; the secret only once finished, FR-246), or undefined. */
  publicMatch(matchId: string): PublicMatch | undefined;
  /** FR-281 (b): `publicMatch` as a read outcome: `unknown-match`, or `unavailable` on a storage failure. */
  readPublicMatch(matchId: string): ReadOutcome<PublicMatch>;
  /** FR-281 (a), FR-279: the match list by creation instant then match id, one keyset page. */
  listMatches(request: PageRequest<'matches'>): ReadOutcome<Page<MatchSummary>>;
  /**
   * FR-281 (c), FR-258, FR-302: the state at an applied round j <= N with its digest and the reported time; a round above
   * N is `round-not-applied` naming only N; a round that is not a whole number >= 0 is `invalid-request ['round']`.
   */
  stateAt(matchId: string, round: number): ReadOutcome<StateReply>;
  /** FR-281 (c), FR-258: the record of an applied round 1 <= j <= N; round 0 is `invalid-request ['round']`. */
  recordAt(matchId: string, round: number): ReadOutcome<RecordReply>;
  /** FR-281 (d), FR-279: the records 1..N in round order, one keyset page. */
  records(matchId: string, request: PageRequest<'records'>): ReadOutcome<Page<RecordReply>>;
  /** FR-281 (h), FR-270 (read), C3: the stored predictions of the caller's namespace (or one local id), one keyset page. */
  ownPredictionsPage(request: OwnPredictionsPageRequest): ReadOutcome<Page<OwnPrediction>>;
  /**
   * FR-281 (e), FR-275, FR-258: the results of the phase `phase` of `round`, one keyset page by player id: phase 1 names the
   * victim, phase 2 carries the record of the round. A phase that is not scored yet (any stage) is `round-not-applied`
   * naming only N; a round that is not a whole number >= 1 is `invalid-request ['round']`, a phase other than 1 or 2
   * `['phase']`, both checked before the match is looked up.
   */
  phaseResults(matchId: string, round: number, phase: 1 | 2, request: PageRequest<'phase-results'>): ReadOutcome<PhaseResultsPage>;
  /**
   * FR-281 (f), FR-276: the scored predictions of one player id (namespaced, as stored), one keyset page by round (0 for the
   * winner) then kind, with the `total` of every scored item. A well-formed player id with no scored prediction gets an
   * empty page with total 0 (no unscored prediction is told apart, FR-270); a malformed one is `invalid-player-id`.
   */
  playerResults(matchId: string, playerId: string, request: PageRequest<'player-results'>): ReadOutcome<PlayerResultsPage>;
  /**
   * FR-281 (g), FR-277, FR-279 (d): the leaderboard, one page of the ranking by rank then player id. A cursor cut at another
   * generation (a phase was scored since) is `stale-cursor`.
   */
  leaderboard(matchId: string, request: PageRequest<'leaderboard'>): ReadOutcome<Page<LeaderboardRow>>;
  /** FR-300 (host-token check): whether the credential is the host token of the match, by digest comparison; false for an unknown match. */
  hostTokenMatches(matchId: string, credential: string): ReadOutcome<boolean>;
  /**
   * FR-385, FR-279: the players of a match in join order (id, name and the join sequence number), one keyset page; any stage
   * answers. No token, digest or prediction is read. `unknown-match`, or `unavailable` on a storage failure. Writes nothing.
   */
  players(matchId: string, request: PageRequest<'players'>): ReadOutcome<Page<PlayerListItem>>;
  /**
   * FR-378: the player of this match whose token this is, by the digest of the token looked up through the index of the
   * match's players (the store sees the digest only); undefined for a token of no player of this match (another match, an
   * unknown match, a wrong, truncated or wrong-case text). `unavailable` on a storage failure. Writes nothing.
   */
  playerTokenOf(matchId: string, token: string): ReadOutcome<{ readonly playerId: string } | undefined>;
  /**
   * FR-281 (i), FR-289 (d), (e): the stored events with a number above `after` in order, and the stored last number (the
   * public data's `lastSeq`). `after` absent: no events (a stream of live events only). `unknown-match`, or `unavailable` on
   * a storage failure. Writes nothing. An `after` that is not a whole number from 0 is a RangeError (the caller maps it).
   */
  eventsAfter(matchId: string, after: number | undefined): ReadOutcome<EventsRead>;
  /** FR-281 (j): one of the three files of a listed map package; `unknown-map`, `unknown-path` (another name), `unavailable` (unreadable). */
  mapFile(mapId: string, name: string): ReadOutcome<MapFile>;
  /** Registers a subscriber of every event stored after this call (FR-290); returns the function that removes it. */
  subscribe(listener: MatchListener): () => void;
  /** Deletes the memo entries past the 24 h retention, host tokens in plain form included (FR-238); returns how many. */
  purgeMemos(): number;
  /**
   * Server start on the stored matches: purges the expired memo entries; for every running match runs the map check
   * (FR-250: a changed package halts it with `map-changed`), then performs its one overdue step, if any, as a late step at
   * the effective instant (FR-248) and arms its next wake-up (FR-239); arms the memo purge at the retention boundary (FR-238).
   * If the enumeration of the running matches fails with a storage failure, it reports `retry` and the whole check runs
   * again RETRY_MS later (FR-292), repeated until it succeeds; it never throws for a storage failure.
   */
  start(): StartReport;
  /** Cancels every wake-up of this service and closes the store. */
  close(): void;
}

/**
 * `seedOf(secret, matchId)(k)`: the HMAC rule of FR-252, or the test-only source when one was given at construction
 * (FR-260). The steps of the service call it; the secret never leaves the service.
 */
export const roundSeeds =
  (testSeedSource?: TestSeedSource) =>
  (secret: Uint8Array, matchId: string): ((round: number) => number) =>
    testSeedSource === undefined ? seedOfSecret(secret) : testSeedSource(matchId);

const failure = (error: ErrorReply): CreateOutcome => ({ ok: false, error });

/**
 * The public data of a view: `publicOf` with the player count of the match when the caller knows it (spec 011 plan P5:
 * always present for a lobby or an expired lobby, otherwise only once the match has players). A view built before any join
 * has no count of its own: a lobby then shows 0.
 */
const publicView = (view: CoreMatch, reportedTime: number, matchSecret?: string, playerCount?: number): PublicMatch =>
  publicOf(playerCount === undefined ? view : { ...view, playerCount }, reportedTime, matchSecret);

const HOUR_MS = 3_600_000;

/** Which decision a wake-up of a match performs: the clock step of a running match, or the expiry of a lobby (spec 011 P16). */
type WakeKind = 'step' | 'expiry';

const RUNNING = ['phase-1', 'phase-2', 'locked'];
const isRunning = (view: CoreMatch): boolean => RUNNING.includes(view.stage);

/** The instant of the next step of a running match with a clock (FR-239): C1 in `phase-1`, C2 in `phase-2`, A in `locked`. */
function nextInstant(view: CoreMatch): number | null {
  if (view.anchors === null) return null;
  if (view.stage === 'phase-1') return view.anchors.c1;
  if (view.stage === 'phase-2') return view.anchors.c2;
  if (view.stage === 'locked') return view.anchors.a;
  return null;
}

/** A decision that was stored: its view, its events and the reported time of its replies, for the steps after the commit. */
interface Committed {
  readonly view: CoreMatch;
  readonly events: readonly MatchEvent[];
}

/** What one clock step of a match stored: its rows (none for a halt), and whether it was the halt of the start check. */
interface TickDone {
  readonly matchId: string;
  readonly steps: readonly StepRow[];
  readonly haltedAtStart: boolean;
}

export function createMatchService(options: ServiceOptions): MatchService {
  const { store, clock, maps, settings, random, scheduler, onFailure } = options;
  if (options.testSeedSource !== undefined && typeof options.testSeedSource !== 'function') throw new TypeError('the test seed source is a function');
  const seedsOf = roundSeeds(options.testSeedSource);
  const operatorDigest = credentialDigest(settings.operatorCredential);
  const limit = settings.runningMatchLimit;

  /**
   * The largest reported time already sent per match (FR-302, Definitions), kept in memory. A process that has sent nothing
   * yet for a match (after a restart) starts from the largest reported time of the match's stored events, read once
   * (FR-249 across restarts, plan section 13 M2b' T4'): the reported time of events never decreases across a restart.
   */
  const sentMax = new Map<string, number>();
  const listeners = new Set<MatchListener>();
  const armed = new Map<string, SchedulerHandle>();

  const sentOf = (matchId: string): number => {
    const known = sentMax.get(matchId);
    if (known !== undefined) return known;
    let stored = 0;
    for (const event of store.eventsAfter(matchId, 0)) if ('reportedTime' in event) stored = Math.max(stored, event.reportedTime);
    sentMax.set(matchId, stored);
    return stored;
  };

  /** The effective instant and the reported time of a match at the current clock reading (FR-249, FR-302). */
  const timesOf = (view: CoreMatch): { effective: number; reported: number } => {
    const effective = effectiveInstant(clock.now(), view.lastStepMs);
    return { effective, reported: reportedTime(effective, sentOf(view.matchId)) };
  };
  const remember = (matchId: string, reported: number): void => {
    // No store read here (it runs after the commit): `timesOf` already filled the entry of a stored match.
    sentMax.set(matchId, Math.max(sentMax.get(matchId) ?? 0, reported));
  };

  /**
   * The pure core's dependencies for a stored match. The map is read only when a step is really performed (the getter), so a
   * tick with nothing due reads no file. The map check of FR-250 runs there, before every step: a package that is not
   * listed, cannot be read, has another digest than the stored one or fails validation gives the core no map (null), and
   * the core halts the match with `map-changed` (FR-251).
   */
  const depsOf = (stored: StoredMatch): StepDeps => {
    const { matchId, mapId, mapDigest } = stored.match;
    const seedOf = seedsOf(stored.secret, matchId);
    let loaded: { map: unknown } | undefined;
    return {
      get map(): unknown {
        loaded ??= { map: mapForStep(maps, mapId, mapDigest) };
        return loaded.map;
      },
      sha256: sha256Ascii,
      seedOf,
      forcedPhaseSeconds: settings.forcedPhaseSeconds,
    };
  };

  /** Publishes after the commit (FR-290): a subscriber that throws never undoes a stored decision. */
  const publish = (matchId: string, events: readonly MatchEvent[]): void => {
    if (events.length === 0) return;
    for (const listener of [...listeners]) {
      try {
        listener(matchId, events);
      } catch {
        // Ignored on purpose: the decision is stored; this service logs nothing (NFR-54).
      }
    }
  };

  /** Whether `start` ran (the memo purge timer is armed only after it) and whether `close` ran (nothing is armed after it). */
  const life = { started: false, closed: false };

  const disarm = (matchId: string): void => {
    const earlier = armed.get(matchId);
    if (earlier !== undefined) scheduler?.cancel(earlier);
    armed.delete(matchId);
  };

  /**
   * Arms the one wake-up of a match at `at`, replacing the earlier one. The callback is isolated (`stepSafely`): whatever
   * happens inside it, nothing escapes to the timer and the match is armed again (its next step, or the retry).
   */
  const armAt = (matchId: string, at: number, checkMap: boolean, kind: WakeKind = 'step'): void => {
    if (scheduler === undefined || life.closed) return;
    disarm(matchId);
    armed.set(
      matchId,
      scheduler.at(at, () => {
        armed.delete(matchId);
        if (kind === 'expiry') expireSafely(matchId);
        else stepSafely(matchId, checkMap);
      }),
    );
  };

  /**
   * Arms the expiry wake-up of a lobby at the instant stored in its row (FR-372, plan P16). A lobby has this wake-up only; it
   * shares the match's one slot, so the step wake-up armed at `start` replaces (cancels) it. A storage failure of the read
   * arms the retry instead: the wake-up reads the row again.
   */
  const armExpiry = (matchId: string): void => {
    if (scheduler === undefined || life.closed) return;
    let at: number | undefined;
    try {
      at = store.getLobby(matchId)?.expiresMs;
    } catch (error) {
      if (!isStorageFailure(error)) throw error;
      at = wholeMs(clock.now()) + RETRY_MS;
    }
    if (at === undefined) disarm(matchId);
    else armAt(matchId, at, false, 'expiry');
  };

  /** Arms the scheduler for the next due step of the match, replacing the earlier wake-up (FR-239); a lobby gets its expiry wake-up; nothing otherwise. */
  const arm = (view: CoreMatch): void => {
    if (scheduler === undefined) return;
    disarm(view.matchId);
    if (view.stage === 'lobby') return armExpiry(view.matchId);
    if (!isRunning(view)) return;
    const at = nextInstant(view);
    if (at !== null) armAt(view.matchId, at, false);
  };

  /** A clock step (or the start check) that failed is tried again RETRY_MS later (FR-292); the core then decides on time or late (FR-248). */
  const armRetry = (matchId: string, checkMap: boolean): void => armAt(matchId, wholeMs(clock.now()) + RETRY_MS, checkMap);

  /**
   * After the commit: remember the reported time, arm the next wake-up from the stored view, then tell the subscribers.
   * Arming first means a subscriber that advances inside its callback re-arms last, from its own newer view: no stale
   * wake-up is left behind.
   */
  const settle = (matchId: string, reported: number, committed: Committed | undefined): void => {
    remember(matchId, reported);
    if (committed === undefined) return;
    arm(committed.view);
    publish(matchId, committed.events);
  };

  /** The memo purge in its own transaction (FR-238, FR-282 (e)); returns how many entries were deleted. */
  const purgeNow = (): number =>
    store.transaction(() => {
      const now = wholeMs(clock.now());
      const memos = store.memoPurge(now);
      // The expired lobbies past their retention go in the same pass (FR-372): the count returned stays the memo entries.
      store.purgeExpired(now);
      return memos;
    });

  /** The one purge wake-up (FR-238 purge timer), armed only after `start`. */
  const purgeTimer: { handle?: SchedulerHandle } = {};
  const armPurgeAt = (at: number): void => {
    if (scheduler === undefined || !life.started || life.closed) return;
    if (purgeTimer.handle !== undefined) scheduler.cancel(purgeTimer.handle);
    purgeTimer.handle = scheduler.at(at, runPurge);
  };
  /**
   * Arms the purge at the earlier retention boundary of the oldest memo entry and the oldest expired lobby (purged once older
   * than the retention), or disarms it.
   */
  const armPurge = (): void => {
    if (scheduler === undefined || !life.started || life.closed) return;
    const memo = store.memoOldest();
    const lobby = store.oldestExpiredMs();
    const boundaries = [...(memo === undefined ? [] : [memo + MEMO_RETENTION_MS + 1]), ...(lobby === undefined ? [] : [lobby + LOBBY_RETENTION_MS + 1])];
    if (boundaries.length > 0) return armPurgeAt(Math.min(...boundaries));
    if (purgeTimer.handle !== undefined) scheduler.cancel(purgeTimer.handle);
    delete purgeTimer.handle;
  };
  /** The purge callback: nothing escapes to the timer; a failure is retried RETRY_MS later. */
  function runPurge(): void {
    delete purgeTimer.handle;
    try {
      purgeNow();
      armPurge();
    } catch {
      armPurgeAt(wholeMs(clock.now()) + RETRY_MS);
    }
  }
  /** After a memo entry was committed at `createdMs`: it expires after every older entry, so only an unarmed purge needs arming. */
  const memoStored = (createdMs: number | undefined): void => {
    if (createdMs !== undefined && purgeTimer.handle === undefined) armPurgeAt(createdMs + MEMO_RETENTION_MS + 1);
  };

  /** A command whose storage fails replies `unavailable` (FR-292); the transaction rolled back, so nothing was accepted or performed. */
  const orUnavailable = <T>(run: () => T, unavailable: () => T): T => {
    try {
      return run();
    } catch (error) {
      if (isStorageFailure(error)) return unavailable();
      throw error;
    }
  };

  /**
   * The running matches a tick walks; a storage failure gives none (a tick is not the start: every match it would step was
   * armed by `start` or by its last decision, and its own wake-up retries it). The start check enumerates on its own
   * (`startCheck`): there a failure arms a retry of the whole check, since nothing is armed yet.
   */
  const runningIds = (): string[] => orUnavailable(() => store.runningMatchIds(), () => []);
  /** The memo purge of a tick or the start; a storage failure purges nothing now (the next tick or the purge timer does). */
  const purgeOrNone = (): number => orUnavailable(purgeNow, () => 0);

  /**
   * One clock step of one match, isolated from the others (the timer callbacks, `tick` and `start`): an exception is caught,
   * classified (FR-292: `unavailable` for a storage failure, `error` otherwise) and the match is armed for a retry.
   */
  function stepSafely(matchId: string, checkMap: boolean): { done: TickDone | null } | { failure: StepFailure } {
    try {
      return { done: tickMatch(matchId, checkMap) };
    } catch (error) {
      armRetry(matchId, checkMap);
      return { failure: reportFailure(matchId, error) };
    }
  }

  /** Classifies a failed clock step or expiry (FR-292) and tells `onFailure` (NFR-54); a callback that throws changes nothing. */
  function reportFailure(matchId: string, error: unknown): StepFailure {
    const failure: StepFailure = { matchId, kind: isStorageFailure(error) ? 'unavailable' : 'error' };
    try {
      onFailure?.(failure, error);
    } catch {
      // Ignored on purpose: a failing report must not stop the retry or the other matches.
    }
    return failure;
  }

  /**
   * The expiry of one lobby, isolated like a clock step (FR-372): a failure is reported and tried again RETRY_MS later. The
   * retry is a wake-up of the same kind, so the lobby stays a lobby until the expiry is stored.
   */
  function expireSafely(matchId: string): { failure: StepFailure } | { expired: boolean } {
    try {
      return { expired: expireMatch(matchId) };
    } catch (error) {
      armAt(matchId, wholeMs(clock.now()) + RETRY_MS, false, 'expiry');
      return { failure: reportFailure(matchId, error) };
    }
  }

  /**
   * Expires the lobby of `matchId` if it is a lobby neither started nor expired whose expiry instant has come, in one
   * transaction: the stage change, the lobby mark (at the effective instant: late when the wake-up was late, FR-248 style) and
   * the `schedule` event of stage `expired`. The decision compares the effective instant, never below the creation, so a
   * clock that went backward does not expire it early; a wake-up that finds the expiry not due arms it again. A started or
   * expired match is never touched (FR-372). True when it expired.
   */
  function expireMatch(matchId: string): boolean {
    const done: { committed?: Committed; reported: number; at: number; again?: number } = { reported: 0, at: 0 };
    store.transaction(() => {
      const stored = store.getMatch(matchId);
      const lobby = store.getLobby(matchId);
      if (stored === undefined || lobby === undefined || lobby.startedMs !== null || lobby.expiredMs !== null || stored.match.stage !== 'lobby') return;
      const times = timesOf(stored.match);
      done.reported = times.reported;
      if (times.effective < lobby.expiresMs) {
        done.again = lobby.expiresMs;
        return;
      }
      const decision = expireDecision(stored.match, times.reported);
      if (!decision.ok) return;
      store.updateMatch(decision.view);
      store.markExpired(matchId, times.effective);
      store.appendEvents(matchId, decision.events);
      done.at = times.effective;
      done.committed = { view: decision.view, events: decision.events };
    });
    if (done.again !== undefined) armAt(matchId, done.again, false, 'expiry');
    if (done.committed === undefined) return false;
    // Its removal waits for the retention: an unarmed purge timer is armed at that boundary (an armed one is never later).
    if (purgeTimer.handle === undefined) armPurgeAt(done.at + LOBBY_RETENTION_MS + 1);
    settle(matchId, done.reported, done.committed);
    return true;
  }

  /**
   * Adds the `match-finished` event after the application of round T (FR-246, FR-259, FR-287 (f)): the winner, the match
   * secret in hex and the derivation rule. It belongs to the same decision, hence the same transaction.
   */
  const withFinish = (stored: StoredMatch, outcome: StepOutcome, reported: number): StepOutcome => {
    const { view } = outcome;
    if (outcome.applied === undefined || view.stage !== 'finished' || view.winner === undefined) return outcome;
    const seq = view.lastSeq + 1;
    const finished: MatchEvent = { type: 'match-finished', seq, winner: view.winner, matchSecret: secretHex(stored.secret), rule: DERIVATION_RULE, reportedTime: reported };
    return { ...outcome, view: { ...view, lastSeq: seq }, events: [...outcome.events, finished] };
  };

  /** Which events belong to which step row (D16): up to the step's own last event; trailing events (schedule, match-finished) go to the last step. */
  const stepRowsOf = (outcome: StepOutcome): StoredStep[] => {
    let from = 0;
    return outcome.steps.map((step, i) => {
      const last = i === outcome.steps.length - 1;
      const end = last
        ? outcome.events.length - 1
        : outcome.events.findIndex(
            (e, j) =>
              j >= from &&
              (step.kind === 'phase-1-close' ? e.type === 'victim-revealed' : step.kind === 'phase-2-close' ? e.type === 'phase-closed' && e.phase === 2 : e.type === 'round-applied'),
          );
      const first = outcome.events[from];
      const closing = outcome.events[end];
      if (first === undefined || closing === undefined || end < from) throw new RangeError('inconsistent decision: a step has no events');
      from = end + 1;
      return { ...step, firstSeq: first.seq, lastSeq: closing.seq };
    });
  };

  /**
   * Writes one decision, inside the caller's transaction, in the order of the plan (20.2): match (N + 1 and its state), record,
   * results, step rows, events. The results of each scored phase are the stored predictions of that phase scored against what
   * the decision made public; a phase nobody predicted writes no row (FR-269). A kill or a failure before the commit loses the
   * step, the rows and the events together, and the redo scores the same stored predictions again (FR-294).
   */
  const persist = (matchId: string, outcome: StepOutcome): void => {
    store.updateMatch(outcome.view);
    if (outcome.applied !== undefined) {
      const { record } = outcome.applied;
      store.putRecord(matchId, { round: record.round, eliminated: record.eliminated, absorber: record.absorber, transferred: [...record.transferred] });
    }
    for (const phase of outcome.scored ?? []) {
      const rows = scorePhase(phase, store.predictionsOfPhase(matchId, phase.kind, phase.kind === 'winner' ? 0 : phase.round));
      if (rows.length > 0) store.putResults(matchId, rows);
    }
    for (const row of stepRowsOf(outcome)) store.putStep(matchId, row);
    store.appendEvents(matchId, outcome.events);
  };

  /**
   * Runs the one due step of a running match, if any, in one transaction; then re-arms and publishes. Null: nothing was due.
   * With `checkMap` (server start, FR-250) the map check runs first even when no step is due: a changed package halts the
   * match with `map-changed`, stored and published like a step decision. A step that is overdue is performed once, late, at
   * the effective instant, with shifted anchors (the core's rule, FR-248); the next one waits for its own wake-up.
   */
  function tickMatch(matchId: string, checkMap: boolean): TickDone | null {
    // Filled inside the transaction (a box, so that the reads after it see the assignments).
    const done: { current?: CoreMatch; committed?: Committed; steps: readonly StepRow[]; reported: number; haltedAtStart: boolean } = { steps: [], reported: 0, haltedAtStart: false };
    store.transaction(() => {
      const stored = store.getMatch(matchId);
      if (stored === undefined || !isRunning(stored.match)) return;
      done.current = stored.match;
      const times = timesOf(stored.match);
      done.reported = times.reported;
      const deps = depsOf(stored);
      if (checkMap && deps.map === null) {
        const halted = haltMatch(stored.match, 'map-changed', times.reported);
        persist(matchId, halted);
        done.committed = { view: halted.view, events: halted.events };
        done.haltedAtStart = true;
        return;
      }
      if (dueStep(stored.match.stage, stored.match.anchors, times.effective) === null) return;
      const outcome = runDue(stored.match, times.effective, times.reported, deps);
      if (outcome === null) return;
      const final = withFinish(stored, outcome, times.reported);
      persist(matchId, final);
      done.committed = { view: final.view, events: final.events };
      done.steps = final.steps;
    });
    if (done.current === undefined) return null;
    if (done.committed === undefined) {
      arm(done.current);
      return null;
    }
    settle(matchId, done.reported, done.committed);
    return { matchId, steps: done.steps, haltedAtStart: done.haltedAtStart };
  }

  /** Steps every stored running match once, each isolated from the others, and collects what happened. */
  const stepAll = (checkMap: boolean, ids: readonly string[]): Omit<StartReport, 'purged'> => {
    const performed: { matchId: string; steps: readonly StepRow[] }[] = [];
    const failed: StepFailure[] = [];
    const halted: string[] = [];
    for (const id of ids) {
      const result = stepSafely(id, checkMap);
      if ('failure' in result) failed.push(result.failure);
      else if (result.done?.haltedAtStart === true) halted.push(id);
      else if (result.done != null) performed.push({ matchId: id, steps: result.done.steps });
    }
    return { performed, failed, halted };
  };

  /** The one wake-up of a start check whose enumeration failed (FR-292, FR-294). */
  const startTimer: { handle?: SchedulerHandle } = {};

  /**
   * The start check (FR-238, FR-248, FR-250, FR-294): the memo purge, then per stored running match the map check, the one
   * overdue late step and the arming, then the purge timer. A storage failure of the enumeration of the running matches
   * arms a retry of this whole check RETRY_MS later (nothing else is armed yet, so nothing else would retry it); any other
   * error is a programming error and is rethrown to the caller.
   */
  function startCheck(): StartReport {
    const purged = purgeOrNone();
    let ids: string[];
    let lobbies: string[];
    try {
      ids = store.runningMatchIds();
      lobbies = store.lobbyIds();
    } catch (error) {
      if (!isStorageFailure(error)) throw error;
      const at = wholeMs(clock.now()) + RETRY_MS;
      armStartRetry(at);
      return { purged, performed: [], failed: [], halted: [], retry: { kind: 'unavailable', at } };
    }
    const report = stepAll(true, ids);
    // Every stored lobby: expired now if its expiry is past (late, FR-372), armed for its expiry otherwise. A failure arms its own retry.
    for (const id of lobbies) expireSafely(id);
    try {
      armPurge();
    } catch {
      armPurgeAt(wholeMs(clock.now()) + RETRY_MS);
    }
    return { purged, ...report };
  }

  /** Arms the retry of the start check; its callback is isolated: nothing escapes to the timer, and a failure re-arms it. */
  function armStartRetry(at: number): void {
    if (scheduler === undefined || life.closed) return;
    if (startTimer.handle !== undefined) scheduler.cancel(startTimer.handle);
    startTimer.handle = scheduler.at(at, () => {
      delete startTimer.handle;
      try {
        startCheck();
      } catch {
        armStartRetry(wholeMs(clock.now()) + RETRY_MS);
      }
    });
  }

  // --- Reads (FR-281, M3a T5): no transaction, no write; the reported time is kept in memory only (FR-302). ---

  /** A read whose storage fails replies `unavailable` (FR-292); any other error is a programming error and is rethrown. */
  const read = <T>(run: () => ReadOutcome<T>): ReadOutcome<T> => orUnavailable(run, (): ReadOutcome<T> => ({ ok: false, error: errorReply('unavailable') }));
  const unknownMatch = (): { ok: false; error: ErrorReply } => ({ ok: false, error: errorReply('unknown-match') });
  const invalidRound = (): { ok: false; error: ErrorReply } => ({ ok: false, error: errorReply('invalid-request', ['round']) });
  const isRound = (round: unknown, min: number): boolean => typeof round === 'number' && Number.isSafeInteger(round) && round >= min;
  /** The stored match of an id; a match id that is not a text is no match (`unknown-match`). */
  const storedMatch = (matchId: unknown): StoredMatch | undefined => (typeof matchId === 'string' ? store.getMatch(matchId) : undefined);
  /** The public data of a stored match now, remembering the reported time sent (FR-302). */
  const publicNow = (stored: StoredMatch): PublicMatch => {
    const { reported } = timesOf(stored.match);
    remember(stored.match.matchId, reported);
    return publicView(stored.match, reported, stored.match.stage === 'finished' ? secretHex(stored.secret) : undefined, store.playerCount(stored.match.matchId));
  };
  /** A page size outside 1 to 500 never comes from `readPageQuery`: a programming error of the caller. */
  const checkPageSize = (limit: number): void => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_LIMIT_MAX) throw new RangeError('the page size is a whole number from 1 to 500');
  };
  /**
   * One keyset page (FR-279): `rows` were read with `limit + 1`, so a row beyond the page tells that more follow; `next` is
   * then the cursor of the last item kept, and absent on the last page.
   */
  const pageFrom = <R, T, L extends CursorList>(list: L, rows: readonly R[], limit: number, item: (row: R) => T, keyOf: (row: R) => CursorKey<L>): Page<T> => {
    const kept = rows.slice(0, limit);
    const last = kept[kept.length - 1];
    const items = kept.map(item);
    return rows.length > limit && last !== undefined ? { items, next: encodeCursor(list, keyOf(last)) } : { items };
  };
  const recordReply = (r: StoredRecord): RecordReply => ({ round: r.round, eliminated: r.eliminated, absorber: r.absorber, transferred: [...r.transferred] });

  /** Everything after the shape, credential and memo checks; runs inside the transaction and writes only on success. */
  const decide = (mapId: string, timing: Timing, timingError: ErrorReply | undefined, now: number, made: (m: Committed & { reported: number }) => void): CreateOutcome => {
    const loaded = maps.load(mapId);
    if (loaded === undefined) return failure(errorReply('unknown-map'));
    // The id and the commitment are filled in below, once nothing can fail any more: errors draw no random bytes.
    const created = createMatch(
      { matchId: '', mapId, mapDigest: loaded.digest, timing, commitment: '', now },
      { map: loaded.map, sha256: sha256Ascii },
    );
    if (!created.ok) {
      // The 001 validation errors come before too-few-factions in the order of FR-301 (the shared validator may report both).
      const others = created.errors.filter((e) => e.kind !== 'too-few-factions');
      return failure(others.length === 0 ? errorReply('too-few-factions') : errorReply('map-validation', others.map((e) => e.kind)));
    }
    if (timingError !== undefined) return failure(timingError);
    if (store.runningCount() >= limit) return failure(errorReply('too-many-matches'));

    const secret = newSecret(random);
    const matchId = newMatchId(random);
    const hostToken = newHostToken(random);
    const view = { ...created.view, matchId, commitment: commitmentOf(secret) };
    const reported = reportedTime(effectiveInstant(now, view.lastStepMs), 0);
    const first = creationEvents(view, reported);
    const reply: CreationReply = { matchId, match: publicOf(first.view, reported), hostToken };
    encodePublicMatch(reply.match); // the public data must be encodable before anything is stored
    store.insertMatch({ match: first.view, secret, hostTokenDigest: credentialDigest(hostToken) });
    store.appendEvents(matchId, first.events);
    made({ view: first.view, events: first.events, reported });
    return { ok: true, reply };
  };

  /**
   * The public creation after the shape and memo checks; runs inside the transaction and writes only on success. The order
   * is the plan's (section 8): map in the public list, bounds, map package, cap, then the draws and the writes.
   */
  const decidePublic = (mapId: string, timing: Timing, now: number, made: (m: Committed & { reported: number }) => void): CreateOutcome => {
    const rules = settings.publicCreation;
    const refused = checkPublicCreation(rules, mapId, timing);
    if (refused !== undefined) return failure(refused);
    const loaded = maps.load(mapId);
    if (loaded === undefined) return failure(errorReply('unknown-map'));
    const created = createLobby({ matchId: '', mapId, mapDigest: loaded.digest, timing, commitment: '', now }, { map: loaded.map, sha256: sha256Ascii });
    if (!created.ok) {
      const others = created.errors.filter((e) => e.kind !== 'too-few-factions');
      return failure(others.length === 0 ? errorReply('too-few-factions') : errorReply('map-validation', others.map((e) => e.kind)));
    }
    if (store.openLobbyCount() >= rules.maxOpenLobbies) return failure(errorReply('too-many-matches'));

    const secret = newSecret(random);
    const matchId = newMatchId(random);
    const hostToken = newHostToken(random);
    const view = { ...created.view, matchId, commitment: commitmentOf(secret) };
    const reported = reportedTime(effectiveInstant(now, view.lastStepMs), 0);
    const first = lobbyEvents(view, reported);
    const reply: CreationReply = { matchId, match: publicView(first.view, reported), hostToken };
    encodePublicMatch(reply.match); // the public data must be encodable before anything is stored
    store.insertMatch({ match: first.view, secret, hostTokenDigest: credentialDigest(hostToken) });
    store.insertLobby({ matchId, public: true, expiresMs: now + rules.lobbyExpiryHours * HOUR_MS });
    store.appendEvents(matchId, first.events);
    made({ view: first.view, events: first.events, reported });
    return { ok: true, reply };
  };

  return {
    createPublic(request: PublicCreateRequest): CreateOutcome {
      if (typeof request.source !== 'string' || request.source.length === 0) throw new TypeError('the source of a public creation is a non-empty text');
      const read = readCreation(request.body);
      if (!read.ok && read.error.kind !== 'invalid-timing') return failure(read.error);
      const body = request.body as Record<string, unknown>;
      const mapId = (read.ok ? read.value.mapId : body.mapId) as string;
      const timing = (read.ok ? read.value.timing : body.timing) as Timing;
      const requestId = (read.ok ? read.value.requestId : body.requestId) as string;

      // The scope is the digest of the source: the same id from another source is another creation, and no operator scope is reused.
      const scope: MemoScope = { credentialDigest: credentialDigest(`public:${request.source}`), match: null };
      const contentDigest = sha256Ascii(canonicalBody('POST', CREATION_PATH, request.body));
      const now = wholeMs(clock.now());
      const fresh: { value?: Committed & { reported: number }; memoAt?: number } = {};
      const unavailable = { ok: false as const, error: errorReply('unavailable') };
      const outcome = orUnavailable(
        () =>
          store.transaction((): CreateOutcome => {
            const stored = store.memoGet(scope, requestId);
            const memo = decideMemo<CreateOutcome>(
              stored === undefined ? undefined : { content: stored.contentDigest, reply: stored.reply as CreateOutcome, createdMs: stored.createdMs },
              { content: contentDigest, now },
            );
            if (memo.decision === 'replay') return memo.reply;
            if (memo.decision === 'request-id-reused') return failure(memo.error);
            const result = decidePublic(mapId, timing, now, (made) => (fresh.value = made));
            // Only a creation is memoised: a refusal stores nothing (FR-370), so the same id may retry once a cap has room.
            if (result.ok) {
              store.memoPut(scope, requestId, { contentDigest, reply: result, createdMs: now });
              fresh.memoAt = now;
            }
            return result;
          }),
        (): CreateOutcome => unavailable,
      );
      if (outcome === unavailable) return outcome;
      memoStored(fresh.memoAt);
      if (fresh.value !== undefined && outcome.ok) settle(outcome.reply.matchId, fresh.value.reported, fresh.value);
      return outcome;
    },

    startMatch(request: StartRequest): StartOutcome {
      const read = readStart(request.body);
      if (!read.ok) return { ok: false, error: read.error };
      const presented = typeof request.credential === 'string' ? credentialDigest(request.credential) : undefined;
      const { matchId } = request;
      const done: { committed?: Committed; reported: number; memoAt?: number } = { reported: 0 };
      const unavailable = { ok: false as const, error: errorReply('unavailable') };
      const outcome = orUnavailable((): StartOutcome => store.transaction((): StartOutcome => {
        const stored = typeof matchId === 'string' ? store.getMatch(matchId) : undefined;
        // Only the host token starts a lobby (P14): the operator credential is not accepted, and a match that does not exist has
        // no host, so it answers `forbidden` too.
        const isHost = presented !== undefined && stored !== undefined && sameDigest(presented, stored.hostTokenDigest);
        if (!isHost || stored === undefined || presented === undefined) return { ok: false, error: errorReply('forbidden') };
        const requestId = read.value.requestId;
        const memoScope: MemoScope = { credentialDigest: presented, match: matchId };
        const content = sha256Ascii(canonicalBody('POST', startPath(matchId), request.body));
        const now = wholeMs(clock.now());
        if (requestId !== undefined) {
          const memoStored = store.memoGet(memoScope, requestId);
          const memo = decideMemo<StartOutcome>(
            memoStored === undefined ? undefined : { content: memoStored.contentDigest, reply: memoStored.reply as StartOutcome, createdMs: memoStored.createdMs },
            { content, now },
          );
          if (memo.decision === 'replay') return memo.reply;
          if (memo.decision === 'request-id-reused') return { ok: false, error: memo.error };
        }
        const times = timesOf(stored.match);
        done.reported = times.reported;
        const decision = startDecision(stored.match, now, times.reported, store.getLobby(matchId)?.expiresMs);
        if (!decision.ok) return { ok: false, error: decision.error };
        // The 008 limit counts public matches too (D7); the cap of running public matches is checked here, at the start.
        if (store.runningCount() >= limit) return { ok: false, error: errorReply('too-many-matches') };
        if (store.getLobby(matchId)?.public === true && store.publicRunningCount() >= settings.publicCreation.maxPublicRunning) return { ok: false, error: errorReply('too-many-matches') };
        store.updateMatch(decision.view);
        store.markStarted(matchId, decision.view.lastStepMs);
        store.appendEvents(matchId, decision.events);
        done.committed = { view: decision.view, events: decision.events };
        const result: StartOutcome = { ok: true, reply: { match: publicView(decision.view, times.reported, undefined, store.playerCount(matchId)) } };
        // Only a start is memoised: a refusal (started, expired, a cap) stores nothing.
        if (requestId !== undefined) {
          store.memoPut(memoScope, requestId, { contentDigest: content, reply: result, createdMs: now });
          done.memoAt = now;
        }
        return result;
      }), (): StartOutcome => unavailable);
      if (outcome === unavailable) return outcome;
      memoStored(done.memoAt);
      if (done.committed !== undefined) settle(matchId, done.reported, done.committed);
      return outcome;
    },

    join(request: JoinRequest): JoinOutcome {
      if (typeof request.source !== 'string' || request.source.length === 0) throw new TypeError('the source of a join is a non-empty text');
      const read = readJoin(request.body);
      if (!read.ok) return { ok: false, error: read.error };
      const { matchId } = request;
      if (typeof matchId !== 'string') return { ok: false, error: errorReply('unknown-match') };
      const { name, requestId } = read.value;
      // The scope is the digest of the source and the match: the same id from another source, or for another match, is another join.
      const scope: MemoScope = { credentialDigest: credentialDigest(`join:${request.source}`), match: matchId };
      const content = sha256Ascii(canonicalBody('POST', joinPath(matchId), request.body));
      const done: { committed?: Committed; reported: number; memoAt?: number } = { reported: 0 };
      const unavailable = { ok: false as const, error: errorReply('unavailable') };
      let outcome: JoinOutcome;
      try {
        outcome = orUnavailable(
          (): JoinOutcome =>
            store.transaction((): JoinOutcome => {
              const now = wholeMs(clock.now());
              const first = store.memoGet(scope, requestId);
              const memo = decideMemo<JoinOutcome>(
                first === undefined ? undefined : { content: first.contentDigest, reply: first.reply as JoinOutcome, createdMs: first.createdMs },
                { content, now },
              );
              if (memo.decision === 'replay') return memo.reply;
              if (memo.decision === 'request-id-reused') return { ok: false, error: memo.error };
              const stored = store.getMatch(matchId);
              if (stored === undefined) return { ok: false, error: errorReply('unknown-match') };
              const times = timesOf(stored.match);
              done.reported = times.reported;
              // A lobby at or after its expiry instant is expired by its own rule, whether or not the wake-up has run yet (FR-372).
              const expiresMs = stored.match.stage === 'lobby' ? store.getLobby(matchId)?.expiresMs : undefined;
              if (expiresMs !== undefined && times.effective >= expiresMs) return { ok: false, error: errorReply('match-expired') };
              const count = store.playerCount(matchId);
              const decision = joinDecision(stored.match, count, settings.maxPlayers);
              if (!decision.ok) return { ok: false, error: decision.error };
              // The name rule comes after the shape, stage and cap checks, and before any draw: a taken name draws nothing.
              const key = nameKey(name);
              if (store.nameKeyTaken(matchId, key)) return { ok: false, error: errorReply('name-taken') };

              const playerId = playerIdOf(PLAYER_NAMESPACE, newPlayerLocalId(random));
              const playerToken = newPlayerToken(random);
              const reply: JoinReply = { playerId, name, playerToken, match: publicView(decision.view, times.reported, undefined, count + 1) };
              encodeJoinReply(reply); // the reply must be encodable before anything is stored
              const events: MatchEvent[] = [{ type: 'player-joined', seq: decision.seq, playerId, name }];
              store.insertPlayer({ matchId, playerId, name, nameKey: key, tokenDigest: credentialDigest(playerToken), joinedSeq: decision.seq, joinedMs: now });
              store.appendEvents(matchId, events);
              store.updateMatch(decision.view);
              const result: JoinOutcome = { ok: true, reply };
              // Only a join is memoised (the token is in the reply, kept 24 h): a refusal stores nothing and may be retried.
              store.memoPut(scope, requestId, { contentDigest: content, reply: result, createdMs: now });
              done.memoAt = now;
              done.committed = { view: decision.view, events };
              return result;
            }),
          (): JoinOutcome => unavailable,
        );
      } catch (error) {
        // The unique index decided a race the check could not see: the transaction rolled back, nothing was stored.
        if (error instanceof NameTakenError) return { ok: false, error: errorReply('name-taken') };
        throw error;
      }
      if (outcome === unavailable) return outcome;
      memoStored(done.memoAt);
      if (done.committed !== undefined) settle(matchId, done.reported, done.committed);
      return outcome;
    },

    create(request: CreateRequest): CreateOutcome {
      const read = readCreation(request.body);
      // Shape problems come first (FR-301); the timing rules come later in the order, so their error waits.
      if (!read.ok && read.error.kind !== 'invalid-timing') return failure(read.error);
      const body = request.body as Record<string, unknown>;
      const mapId = (read.ok ? read.value.mapId : body.mapId) as string;
      const timing = (read.ok ? read.value.timing : body.timing) as Timing;
      const requestId = (read.ok ? read.value.requestId : body.requestId) as string;
      const timingError = read.ok ? undefined : read.error;

      if (typeof request.credential !== 'string' || !sameDigest(credentialDigest(request.credential), operatorDigest)) return failure(errorReply('forbidden'));

      const scope: MemoScope = { credentialDigest: operatorDigest, match: null };
      const contentDigest = sha256Ascii(canonicalBody('POST', CREATION_PATH, request.body));
      const now = wholeMs(clock.now());
      const fresh: { value?: Committed & { reported: number }; memoAt?: number } = {};
      const unavailable = { ok: false as const, error: errorReply('unavailable') };
      const outcome = orUnavailable(
        () =>
          store.transaction((): CreateOutcome => {
            const stored = store.memoGet(scope, requestId);
            const memo = decideMemo<CreateOutcome>(
              stored === undefined ? undefined : { content: stored.contentDigest, reply: stored.reply as CreateOutcome, createdMs: stored.createdMs },
              { content: contentDigest, now },
            );
            if (memo.decision === 'replay') return memo.reply;
            if (memo.decision === 'request-id-reused') return failure(memo.error);
            const result = decide(mapId, timing, timingError, now, (made) => (fresh.value = made));
            if (isMemoisable(result)) {
              store.memoPut(scope, requestId, { contentDigest, reply: result, createdMs: now });
              fresh.memoAt = now;
            }
            return result;
          }),
        // FR-292: the transaction rolled back, so no match exists and the request id is free (unavailable is never memoised).
        (): CreateOutcome => unavailable,
      );
      if (outcome === unavailable) return outcome;
      memoStored(fresh.memoAt);
      if (fresh.value !== undefined && outcome.ok) settle(outcome.reply.matchId, fresh.value.reported, fresh.value);
      return outcome;
    },

    advance(request: AdvanceRequest): AdvanceOutcome {
      const read = readAdvance(request.body);
      if (!read.ok) return { ok: false, error: read.error };
      const presented = typeof request.credential === 'string' ? credentialDigest(request.credential) : undefined;
      const matchId = request.matchId;
      const done: { committed?: Committed; reported: number; touched: boolean; memoAt?: number } = { reported: 0, touched: false };
      const unavailable = { ok: false as const, error: errorReply('unavailable') };
      // FR-292: a storage failure rolls the whole decision back: nothing is performed, published or memoised.
      const outcome = orUnavailable((): AdvanceOutcome => store.transaction((): AdvanceOutcome => {
        const stored = typeof matchId === 'string' ? store.getMatch(matchId) : undefined;
        // Both comparisons always run, in time independent of the credential (FR-300).
        const isOperator = presented !== undefined && sameDigest(presented, operatorDigest);
        const isHost = presented !== undefined && stored !== undefined && sameDigest(presented, stored.hostTokenDigest);
        if (!isOperator && !isHost) return { ok: false, error: errorReply('forbidden') };
        // FR-282 (b) (c): a client request id makes the advance idempotent under (credential digest, match id); a replay
        // or a reused id changes nothing and publishes nothing. The memo is written in the same transaction as the decision.
        const requestId = read.value.requestId;
        const memoScope: MemoScope = { credentialDigest: presented as string, match: matchId };
        const content = sha256Ascii(canonicalBody('POST', advancePath(matchId), request.body));
        const now = wholeMs(clock.now());
        if (requestId !== undefined) {
          const memoStored = store.memoGet(memoScope, requestId);
          const memo = decideMemo<AdvanceOutcome>(
            memoStored === undefined ? undefined : { content: memoStored.contentDigest, reply: memoStored.reply as AdvanceOutcome, createdMs: memoStored.createdMs },
            { content, now },
          );
          if (memo.decision === 'replay') return memo.reply;
          if (memo.decision === 'request-id-reused') return { ok: false, error: memo.error };
        }
        let result: AdvanceOutcome = { ok: false, error: errorReply('unknown-match') };
        if (stored !== undefined) {
          done.touched = true;
          result = decideStep(stored, read.value);
        }
        if (requestId !== undefined && isMemoisable(result)) {
          store.memoPut(memoScope, requestId, { contentDigest: content, reply: result, createdMs: now });
          done.memoAt = now;
        }
        return result;
      }), (): AdvanceOutcome => unavailable);
      if (outcome === unavailable) return outcome;
      memoStored(done.memoAt);
      if (done.touched) settle(matchId, done.reported, done.committed);
      return outcome;

      function decideStep(stored: StoredMatch, wanted: { round: number; step: StepKind }): AdvanceOutcome {
        const times = timesOf(stored.match);
        done.reported = times.reported;
        // The stored row of the named step, if it was performed: the core answers `already-performed` from it.
        const row = store.steps(matchId).find((s) => s.round === wanted.round && s.kind === wanted.step);
        const decision = decideAdvance(
          stored.match,
          {
            round: wanted.round,
            step: wanted.step,
            effective: times.effective,
            reportedTime: times.reported,
            ...(row === undefined ? {} : { stored: { round: row.round, kind: row.kind, instant: row.instant, cause: row.cause } }),
          },
          depsOf(stored),
        );
        if (!decision.ok) {
          // An advance that halts the match stores the halted view and its `match-halted` event and replies `match-halted` (FR-251).
          if (decision.outcome !== undefined) {
            persist(matchId, decision.outcome);
            done.committed = { view: decision.outcome.view, events: decision.outcome.events };
          }
          return { ok: false, error: decision.error };
        }
        const final = withFinish(stored, decision.outcome, times.reported);
        if (final.steps.length === 0 && final.events.length === 0) return { ok: true, reply: decision.reply };
        persist(matchId, final);
        done.committed = { view: final.view, events: final.events };
        // The finished public data needs the secret and the event number of `match-finished`: the shell builds it (FR-246).
        const match = final.view.stage === 'finished' ? publicOf(final.view, times.reported, secretHex(stored.secret)) : decision.reply.match;
        return { ok: true, reply: { ...decision.reply, match } };
      }
    },

    submit(request: SubmitRequest): SubmitOutcome {
      const read = readSubmission(request.body);
      if (!read.ok) return { ok: false, error: read.error };
      const { client, matchId } = request;
      const body = read.value;
      // A client: the namespace of its credential builds the id (008, unchanged). A player: only its own id, nothing is stored or memoised otherwise.
      let playerId: string;
      let scopeDigest: string;
      if (isPlayerCaller(client)) {
        checkPlayerCaller(client);
        if (playerIdOf(PLAYER_NAMESPACE, body.playerId) !== client.playerId) return { ok: false, error: errorReply('forbidden') };
        playerId = client.playerId;
        scopeDigest = client.tokenDigest;
      } else {
        if (!isNamespace(client.namespace) || typeof client.credential !== 'string') throw new TypeError('the caller identity is a credential text and a namespace');
        playerId = playerIdOf(client.namespace, body.playerId);
        scopeDigest = credentialDigest(client.credential);
      }
      const submission: Submission = body.kind === 'winner' ? { kind: 'winner', choice: body.faction } : { kind: body.kind, round: body.round as number, choice: body.faction };
      const round = body.kind === 'winner' ? 0 : (body.round as number);
      const scope: MemoScope = { credentialDigest: scopeDigest, match: matchId };
      const content = sha256Ascii(canonicalBody('POST', submissionPath(matchId), request.body));
      const memo: { at?: number } = {};
      // FR-292: a storage failure rolls the prediction and its memo back together: nothing is reported as accepted.
      const outcome = orUnavailable((): SubmitOutcome => store.transaction((): SubmitOutcome => {
        const now = wholeMs(clock.now());
        if (body.requestId !== undefined) {
          const memoStored = store.memoGet(scope, body.requestId);
          const memo = decideMemo<SubmitOutcome>(
            memoStored === undefined ? undefined : { content: memoStored.contentDigest, reply: memoStored.reply as SubmitOutcome, createdMs: memoStored.createdMs },
            { content, now },
          );
          if (memo.decision === 'replay') return memo.reply;
          if (memo.decision === 'request-id-reused') return { ok: false, error: memo.error };
        }
        const stored = typeof matchId === 'string' ? store.getMatch(matchId) : undefined;
        let result: SubmitOutcome = { ok: false, error: errorReply('unknown-match') };
        if (stored !== undefined) {
          // The cutoff uses the server's effective instant from the stored last step instant, never a time of the caller (FR-266).
          const effective = timesOf(stored.match).effective;
          const row = store.predictionsOf(matchId, playerId).find((p) => p.kind === submission.kind && p.round === round);
          const decision = decideSubmission(stored.match, { submission, effective, ...(row === undefined ? {} : { stored: row }) });
          if (decision.ok) {
            if (decision.store !== undefined) store.putPrediction(matchId, playerId, decision.store);
            result = { ok: true, reply: decision.reply };
          } else {
            result = { ok: false, error: decision.error };
          }
        }
        if (body.requestId !== undefined && isMemoisable(result)) {
          store.memoPut(scope, body.requestId, { contentDigest: content, reply: result, createdMs: now });
          memo.at = now;
        }
        return result;
      }), (): SubmitOutcome => ({ ok: false, error: errorReply('unavailable') }));
      memoStored(memo.at);
      return outcome;
    },

    ownPredictions(request: OwnPredictionsRequest): OwnPredictionsOutcome {
      let player: string;
      if ('player' in request) {
        checkPlayerCaller(request.player);
        if (!isLocalId(request.playerId)) return { ok: false, error: errorReply('invalid-player-id', ['playerId']) };
        // A player reads its own predictions only (a malformed id first, then another player's id).
        if (playerIdOf(PLAYER_NAMESPACE, request.playerId) !== request.player.playerId) return { ok: false, error: errorReply('forbidden') };
        player = request.player.playerId;
      } else {
        if (!isNamespace(request.namespace)) throw new TypeError('the caller identity is a namespace');
        if (!isLocalId(request.playerId)) return { ok: false, error: errorReply('invalid-player-id', ['playerId']) };
        player = playerIdOf(request.namespace, request.playerId);
      }
      const toReply = (p: StoredPrediction): PredictionReply => ({ kind: p.kind, ...(p.kind === 'winner' ? {} : { round: p.round }), choice: p.choice, version: p.version });
      return orUnavailable(
        (): OwnPredictionsOutcome => {
          if (typeof request.matchId !== 'string' || store.getMatch(request.matchId) === undefined) return { ok: false, error: errorReply('unknown-match') };
          return { ok: true, predictions: store.predictionsOf(request.matchId, player).map(toReply) };
        },
        () => ({ ok: false, error: errorReply('unavailable') }),
      );
    },

    tick(): TickReport {
      const purged = purgeOrNone();
      const { performed, failed } = stepAll(false, runningIds());
      // The lobbies whose expiry has come (a failure here arms its retry and is reported; the tick lists clock steps only).
      for (const id of orUnavailable(() => store.lobbiesExpiringBefore(wholeMs(clock.now())), (): string[] => [])) expireSafely(id);
      return { purged, performed, failed };
    },

    start(): StartReport {
      life.started = true;
      return startCheck();
    },

    close(): void {
      life.closed = true;
      if (startTimer.handle !== undefined) scheduler?.cancel(startTimer.handle);
      delete startTimer.handle;
      for (const handle of armed.values()) scheduler?.cancel(handle);
      armed.clear();
      if (purgeTimer.handle !== undefined) scheduler?.cancel(purgeTimer.handle);
      delete purgeTimer.handle;
      store.close();
    },

    publicMatch(matchId: string): PublicMatch | undefined {
      const stored = storedMatch(matchId);
      return stored === undefined ? undefined : publicNow(stored);
    },

    readPublicMatch(matchId: string): ReadOutcome<PublicMatch> {
      return read(() => {
        const stored = storedMatch(matchId);
        return stored === undefined ? unknownMatch() : { ok: true, reply: publicNow(stored) };
      });
    },

    listMatches(request: PageRequest<'matches'>): ReadOutcome<Page<MatchSummary>> {
      const { limit, after } = request;
      checkPageSize(limit);
      // Only the summary fields are copied, whatever else a row could hold (no secret, digest or state, FR-281 (a)).
      const summary = (s: MatchSummary): MatchSummary => ({ matchId: s.matchId, mapId: s.mapId, stage: s.stage, appliedRounds: s.appliedRounds, totalRounds: s.totalRounds, createdAt: s.createdAt });
      return read(() => ({ ok: true, reply: pageFrom('matches', store.listMatches(after, limit + 1), limit, summary, (s) => [s.createdAt, s.matchId]) }));
    },

    stateAt(matchId: string, round: number): ReadOutcome<StateReply> {
      if (!isRound(round, 0)) return invalidRound();
      return read(() => {
        const stored = storedMatch(matchId);
        if (stored === undefined) return unknownMatch();
        // A round above N gets the same reply whatever the round and the stage, naming only N (FR-258).
        const readable = readRound(stored.match, round);
        if (!readable.ok) return readable;
        const state = store.getState(stored.match.matchId, round);
        if (state === undefined) throw new RangeError('inconsistent stored data: no state at an applied round');
        const { reported } = timesOf(stored.match);
        remember(stored.match.matchId, reported);
        return { ok: true, reply: { round, owners: state.state.owners, stateDigest: state.stateDigest, reportedTime: reported } };
      });
    },

    recordAt(matchId: string, round: number): ReadOutcome<RecordReply> {
      // A record exists from round 1 (round 0 is the creation state): `records/0` is a bad round segment (FR-281 (c)).
      if (!isRound(round, 1)) return invalidRound();
      return read(() => {
        const stored = storedMatch(matchId);
        if (stored === undefined) return unknownMatch();
        const readable = readRound(stored.match, round);
        if (!readable.ok) return readable;
        const record = store.recordsAfter(stored.match.matchId, round - 1, 1)[0];
        if (record === undefined || record.round !== round) throw new RangeError('inconsistent stored data: no record of an applied round');
        return { ok: true, reply: recordReply(record) };
      });
    },

    records(matchId: string, request: PageRequest<'records'>): ReadOutcome<Page<RecordReply>> {
      const { limit, after } = request;
      checkPageSize(limit);
      return read(() => {
        const stored = storedMatch(matchId);
        if (stored === undefined) return unknownMatch();
        const rows = store.recordsAfter(stored.match.matchId, after === undefined ? 0 : after[0], limit + 1);
        return { ok: true, reply: pageFrom('records', rows, limit, recordReply, (r) => [r.round]) };
      });
    },

    ownPredictionsPage(request: OwnPredictionsPageRequest): ReadOutcome<Page<OwnPrediction>> {
      const { matchId, limit, after } = request;
      let namespace: string;
      let playerId = request.playerId;
      if ('player' in request) {
        // A player: the namespace is the reserved one and the local id is its own, whatever the caller asked for.
        checkPlayerCaller(request.player);
        if (playerId !== undefined && !isLocalId(playerId)) return { ok: false, error: errorReply('invalid-player-id', ['playerId']) };
        const own = request.player.playerId.slice(PLAYER_NAMESPACE.length + 1);
        if (playerId !== undefined && playerId !== own) return { ok: false, error: errorReply('forbidden') };
        namespace = PLAYER_NAMESPACE;
        playerId = own;
      } else {
        namespace = request.namespace;
        // The namespace comes from the configured credential (FR-284): one outside its set is a programming error of the caller.
        if (!isNamespace(namespace)) throw new TypeError('the caller identity is a namespace');
        // Checked before the store sees it (the store refuses it as a RangeError): a namespace cannot be sent (FR-270).
        if (playerId !== undefined && !isLocalId(playerId)) return { ok: false, error: errorReply('invalid-player-id', ['playerId']) };
      }
      checkPageSize(limit);
      return read(() => {
        const stored = storedMatch(matchId);
        if (stored === undefined) return unknownMatch();
        const rows = store.predictionsInNamespace(stored.match.matchId, namespace, after, limit + 1, playerId);
        const own = ({ localId, prediction: p }: { localId: string; prediction: StoredPrediction }): OwnPrediction => ({
          playerId: localId,
          kind: p.kind,
          ...(p.kind === 'winner' ? {} : { round: p.round }),
          choice: p.choice,
          version: p.version,
        });
        return { ok: true, reply: pageFrom('predictions', rows, limit, own, (r) => [r.localId, r.prediction.round, r.prediction.kind]) };
      });
    },

    phaseResults(matchId: string, round: number, phase: 1 | 2, request: PageRequest<'phase-results'>): ReadOutcome<PhaseResultsPage> {
      const { limit, after } = request;
      checkPageSize(limit);
      // Shape checks come before the match is looked up (FR-301 order); readResultsRound repeats them for the scored check.
      if (typeof round !== 'number' || !Number.isInteger(round) || round < 1) return invalidRound();
      if (phase !== 1 && phase !== 2) return { ok: false, error: errorReply('invalid-request', ['phase']) };
      return read(() => {
        const stored = storedMatch(matchId);
        if (stored === undefined) return unknownMatch();
        const scored = readResultsRound(stored.match, round, phase);
        if (!scored.ok) return scored;
        const id = stored.match.matchId;
        const rows = store.phaseResultsAfter(id, phase === 1 ? 'victim' : 'absorber', round, after === undefined ? undefined : after[0], limit + 1);
        const page = pageFrom('phase-results', rows, limit, (r) => ({ playerId: r.playerId, choice: r.choice, correct: r.correct, points: r.points }), (r) => [r.playerId]);
        const applied = round <= stored.match.appliedRounds;
        const record = applied ? store.recordsAfter(id, round - 1, 1)[0] : undefined;
        if (applied && (record === undefined || record.round !== round)) throw new RangeError('inconsistent stored data: no record of an applied round');
        const victim = record !== undefined ? record.eliminated : stored.match.victim?.victim;
        if (phase === 1 && victim === undefined) throw new RangeError('inconsistent stored data: no victim of a scored phase');
        return {
          ok: true,
          reply: { round, phase, ...(phase === 1 ? { victim: victim! } : { record: recordReply(record!) }), ...page },
        };
      });
    },

    playerResults(matchId: string, playerId: string, request: PageRequest<'player-results'>): ReadOutcome<PlayerResultsPage> {
      const { limit, after } = request;
      checkPageSize(limit);
      if (!isPlayerId(playerId)) return { ok: false, error: errorReply('invalid-player-id', ['playerId']) };
      return read(() => {
        const stored = storedMatch(matchId);
        if (stored === undefined) return unknownMatch();
        const id = stored.match.matchId;
        const rows = store.playerResultsAfter(id, playerId, after, limit + 1);
        const page = pageFrom('player-results', rows, limit, (r) => ({ kind: r.kind, ...(r.kind === 'winner' ? {} : { round: r.round }), choice: r.choice, correct: r.correct, points: r.points }), (r) => [r.round, r.kind]);
        return { ok: true, reply: { playerId, total: store.playerTotal(id, playerId), ...page } };
      });
    },

    leaderboard(matchId: string, request: PageRequest<'leaderboard'>): ReadOutcome<Page<LeaderboardRow>> {
      const { limit, after } = request;
      checkPageSize(limit);
      return read(() => {
        const stored = storedMatch(matchId);
        if (stored === undefined) return unknownMatch();
        // The generation counts the scored phases: a cursor cut before (or after, never issued) another phase was scored is stale.
        const generation = scoredPhaseCount(stored.match);
        if (after !== undefined && after[0] !== generation) return { ok: false, error: errorReply('stale-cursor') };
        const ranked = rankLeaderboard(store.leaderboardTotals(stored.match.matchId));
        const page = pageOf(ranked, (e): readonly [number, string] => [e.rank, e.playerId], after === undefined ? undefined : [after[1], after[2]], limit);
        const items = page.items.map((e): LeaderboardRow => ({ rank: e.rank, playerId: e.playerId, total: e.total, correctVictims: e.correctVictims, correctAbsorbers: e.correctAbsorbers, correctWinner: e.correctWinner }));
        return { ok: true, reply: page.next === undefined ? { items } : { items, next: encodeCursor('leaderboard', [generation, page.next[0], page.next[1]]) } };
      });
    },

    hostTokenMatches(matchId: string, credential: string): ReadOutcome<boolean> {
      const presented = typeof credential === 'string' ? credentialDigest(credential) : undefined;
      if (typeof matchId !== 'string') return { ok: true, reply: false };
      return read(() => {
        const digest = store.hostTokenDigest(matchId);
        // Compared as digests in time independent of the token (FR-300); an unknown match has no host token.
        return { ok: true, reply: presented !== undefined && digest !== undefined && sameDigest(presented, digest) };
      });
    },

    players(matchId: string, request: PageRequest<'players'>): ReadOutcome<Page<PlayerListItem>> {
      const { limit, after } = request;
      checkPageSize(limit);
      return read(() => {
        const stored = storedMatch(matchId);
        if (stored === undefined) return unknownMatch();
        // The store never reads back a token digest or a name key; only id, name and join order are copied (FR-385).
        const rows = store.playersAfter(stored.match.matchId, after === undefined ? undefined : after[0], limit + 1);
        return { ok: true, reply: pageFrom('players', rows, limit, (p): PlayerListItem => ({ playerId: p.playerId, name: p.name, joinedSeq: p.joinedSeq }), (p) => [p.joinedSeq]) };
      });
    },

    playerTokenOf(matchId: string, token: string): ReadOutcome<{ readonly playerId: string } | undefined> {
      if (typeof matchId !== 'string' || typeof token !== 'string') return { ok: true, reply: undefined };
      // Only the digest goes to the store, which looks it up by the index within this match; a token of another match finds nothing.
      const digest = credentialDigest(token);
      return read(() => {
        const found = store.playerByTokenDigest(matchId, digest);
        return { ok: true, reply: found === undefined ? undefined : { playerId: found.playerId } };
      });
    },

    eventsAfter(matchId: string, after: number | undefined): ReadOutcome<EventsRead> {
      if (after !== undefined && !isRound(after, 0)) throw new RangeError('the event number is a whole number from 0');
      return read(() => {
        const stored = storedMatch(matchId);
        if (stored === undefined) return unknownMatch();
        const { lastSeq } = stored.match;
        // Nothing above the stored last number: no read of the events (also keeps a huge number out of the query).
        const events = after === undefined || after >= lastSeq ? [] : store.eventsAfter(stored.match.matchId, after);
        return { ok: true, reply: { lastSeq, events } };
      });
    },

    mapFile(mapId: string, name: string): ReadOutcome<MapFile> {
      // Only the three fixed names exist (FR-281 (j)): any other text is not a path of the server, whatever it contains.
      if (!isMapFileName(name)) return { ok: false, error: errorReply('unknown-path') };
      const file = maps.file?.(mapId, name);
      if (file === undefined) return { ok: false, error: errorReply('unknown-map') };
      // A listed package whose file cannot be read now: the server cannot serve it (retry later).
      if (file === null) return { ok: false, error: errorReply('unavailable') };
      return { ok: true, reply: file };
    },

    subscribe(listener: MatchListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    purgeMemos(): number {
      return purgeNow();
    },
  };
}
