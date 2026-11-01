/** Wire types of the request bodies (payload types only; replies and events come in later tasks). */

/** The timing setting of a creation: `manual` or the host's I, L1, L2 in whole seconds (FR-233). */
export type Timing = 'manual' | { readonly i: number; readonly l1: number; readonly l2: number };

/** The three steps of a round (spec Definitions "Step"). */
export const STEP_KINDS = ['phase-1-close', 'phase-2-close', 'application'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** The three kinds of prediction (FR-261). */
export const PREDICTION_KINDS = ['victim', 'absorber', 'winner'] as const;
export type PredictionKind = (typeof PREDICTION_KINDS)[number];

export interface CreationBody {
  readonly mapId: string;
  readonly timing: Timing;
  readonly requestId: string;
}

export interface AdvanceBody {
  readonly round: number;
  readonly step: StepKind;
  readonly requestId?: string;
}

/** The start body of a lobby: empty, or just a client request id (FR-296). */
export interface StartBody {
  readonly requestId?: string;
}

/** The join body of a lobby or a running match: the player's chosen name and a client request id (FR-377, FR-296). */
export interface JoinBody {
  readonly name: string;
  readonly requestId: string;
}

export interface SubmissionBody {
  readonly kind: PredictionKind;
  /** Present exactly for `victim` and `absorber`. */
  readonly round?: number;
  readonly faction: number;
  /** The local player id (no namespace: the server builds the player id from the credential). */
  readonly playerId: string;
  readonly requestId?: string;
}

/** Documented field order of each body (FR-296): the first failing field in this order is named. */
export const CREATION_FIELDS = ['mapId', 'timing', 'requestId'] as const;
export const ADVANCE_FIELDS = ['round', 'step', 'requestId'] as const;
export const START_FIELDS = ['requestId'] as const;
export const JOIN_FIELDS = ['name', 'requestId'] as const;
export const SUBMISSION_FIELDS = ['kind', 'round', 'faction', 'playerId', 'requestId'] as const;

/**
 * Stages of a match (spec Definitions "Stage"). `lobby` (created, not started) and `expired` (never started, closed) have
 * no round: no anchors, victim, winner or secret.
 */
export const STAGES = ['phase-1', 'phase-2', 'locked', 'finished', 'halted', 'lobby', 'expired'] as const;
export type Stage = (typeof STAGES)[number];

/** Halt reasons: data of a `halted` match, not error kinds (FR-250, FR-251). */
export const HALT_REASONS = ['map-changed', 'isolated-faction', 'victim-mismatch'] as const;
export type HaltReason = (typeof HALT_REASONS)[number];

/** The anchors C1, C2, A of the pending round as currently scheduled (instants in ms). Only while the clock runs. */
export interface PublicSchedule {
  readonly c1: number;
  readonly c2: number;
  readonly a: number;
}

/**
 * The FR-288 fields, public from the phase-1 close of round k: the victim, its absorption candidates in the state at N,
 * the factions living at N in faction order (victim included), the reveal instant (the phase-1 close step), C2 and A
 * (null when the timing is `manual`) and the sequence number of the `victim-revealed` event. No absorber.
 */
export interface PublicVictim {
  readonly round: number;
  readonly victim: number;
  readonly candidates: readonly number[];
  readonly living: readonly number[];
  readonly revealedAt: number;
  readonly c2: number | null;
  readonly a: number | null;
  /** Present, and `true`, only when the victim has a single candidate (the absorber is forced): never `false`. */
  readonly forced?: true;
  readonly seq: number;
}
export const PUBLIC_VICTIM_KEYS = ['round', 'victim', 'candidates', 'living', 'revealedAt', 'c2', 'a', 'forced', 'seq'] as const;

/** Owners of the state at N in map order, as [territory, faction] pairs (the shape of a sim `MatchState`). */
export interface PublicState {
  readonly mode: 'classic';
  readonly round: number;
  readonly owners: readonly (readonly [number, number])[];
}

/**
 * The public view of a match (spec Definitions "Public data"): the only input of reply and event builders (FR-257,
 * NFR-47 (b)). There is no field for an absorber, a pending state or a round seed. `matchSecret` exists only for a
 * finished match (FR-253, FR-259); it is never present in another stage.
 */
export interface PublicMatch {
  readonly matchId: string;
  readonly mapId: string;
  readonly mapDigest: string;
  readonly totalRounds: number;
  readonly timing: Timing;
  readonly commitment: string;
  readonly stage: Stage;
  /** N: the number of applied rounds. */
  readonly appliedRounds: number;
  readonly state: PublicState;
  readonly stateDigest: string;
  readonly lastSeq: number;
  readonly reportedTime: number;
  /** Required in `lobby` and `expired`; optional elsewhere, and absent means the 008 bytes (a whole number >= 0). */
  readonly playerCount?: number;
  /** Present exactly while the match is running and its timing is not `manual`. */
  readonly schedule?: PublicSchedule;
  /** Present in `phase-2` and `locked`, and in `halted` when the halting round's victim was revealed (FR-288). */
  readonly victim?: PublicVictim;
  /** Present exactly in `finished`. */
  readonly winner?: number;
  /** Present exactly in `finished` (64 hexadecimal characters). */
  readonly matchSecret?: string;
  /** Present exactly in `halted`. */
  readonly haltReason?: HaltReason;
}
/** Field order of the public view encoding (fixed, independent of the order of the input). */
export const PUBLIC_MATCH_KEYS = [
  'matchId',
  'mapId',
  'mapDigest',
  'totalRounds',
  'timing',
  'commitment',
  'stage',
  'appliedRounds',
  'state',
  'stateDigest',
  'lastSeq',
  'reportedTime',
  'playerCount',
  'schedule',
  'victim',
  'winner',
  'matchSecret',
  'haltReason',
] as const;

/** Reply to a creation (FR-231): the match id, its public data at round 0 and the host token. */
export interface CreationReply {
  readonly matchId: string;
  readonly match: PublicMatch;
  readonly hostToken: string;
}

/** Event payloads of FR-287, in the order they are sent within one step. `seq` starts at 1 (FR-289). */
export interface PhaseClosedEvent {
  readonly type: 'phase-closed';
  readonly seq: number;
  readonly round: number;
  readonly phase: 1 | 2;
  readonly at: number;
}
export interface VictimRevealedEvent extends PublicVictim {
  readonly type: 'victim-revealed';
  readonly reportedTime: number;
}
export interface RoundAppliedEvent {
  readonly type: 'round-applied';
  readonly seq: number;
  readonly round: number;
  readonly record: { readonly round: number; readonly eliminated: number; readonly absorber: number; readonly transferred: readonly number[] };
  readonly stateDigest: string;
  readonly appliedAt: number;
}
export interface ResultsEvent {
  readonly type: 'results';
  readonly seq: number;
  readonly round: number;
  readonly phase: 1 | 2;
}
export interface ScheduleEvent {
  readonly type: 'schedule';
  readonly seq: number;
  readonly stage: Stage;
  readonly schedule?: PublicSchedule;
  readonly reportedTime: number;
}
export interface MatchFinishedEvent {
  readonly type: 'match-finished';
  readonly seq: number;
  readonly winner: number;
  readonly matchSecret: string;
  readonly rule: string;
  readonly reportedTime: number;
}
export interface MatchHaltedEvent {
  readonly type: 'match-halted';
  readonly seq: number;
  readonly round: number;
  readonly reason: HaltReason;
  readonly reportedTime: number;
}
/** A player joined (FR-376): the namespaced player id and the name, nothing else (no token, no digest, no request id). */
export interface PlayerJoinedEvent {
  readonly type: 'player-joined';
  readonly seq: number;
  readonly playerId: string;
  readonly name: string;
}
export type MatchEvent =
  | PhaseClosedEvent
  | VictimRevealedEvent
  | RoundAppliedEvent
  | ResultsEvent
  | ScheduleEvent
  | MatchFinishedEvent
  | MatchHaltedEvent
  | PlayerJoinedEvent;

/**
 * Wire key order of each event type (FR-257 (event encoders), FR-287): fixed, whatever the order of the input object.
 * No list holds an absorber before its application, a round seed or a credential; `matchSecret` is in `match-finished` only.
 */
export const EVENT_KEYS = {
  'phase-closed': ['type', 'seq', 'round', 'phase', 'at'],
  'victim-revealed': ['type', 'seq', 'round', 'victim', 'candidates', 'living', 'revealedAt', 'c2', 'a', 'forced', 'reportedTime'],
  'round-applied': ['type', 'seq', 'round', 'record', 'stateDigest', 'appliedAt'],
  results: ['type', 'seq', 'round', 'phase'],
  schedule: ['type', 'seq', 'stage', 'schedule', 'reportedTime'],
  'match-finished': ['type', 'seq', 'winner', 'matchSecret', 'rule', 'reportedTime'],
  'match-halted': ['type', 'seq', 'round', 'reason', 'reportedTime'],
  'player-joined': ['type', 'seq', 'playerId', 'name'],
} as const satisfies Record<MatchEvent['type'], readonly string[]>;

/** Why a step was performed (FR-240): the clock on time, a manual advance, or a late catch-up (FR-248). */
export const STEP_CAUSES = ['clock', 'manual', 'late'] as const;
export type StepCause = (typeof STEP_CAUSES)[number];

/** A step as an advance reply carries it (FR-295 (b)): round, kind, instant in whole ms and cause. */
export interface StepInfo {
  readonly round: number;
  readonly kind: StepKind;
  readonly instant: number;
  readonly cause: StepCause;
}

/**
 * The reply to an accepted advance (FR-295 (b)): `performed` with the step just performed, or `already-performed` with
 * the stored row of the named step (nothing was performed); both carry the public data after the decision. A data
 * result, not an error (FR-301).
 */
export interface AdvanceReply {
  readonly result: 'performed' | 'already-performed';
  readonly step: StepInfo;
  readonly match: PublicMatch;
}

// The `step-mismatch` reply (FR-295 (b)) is an `ErrorReply` with `stage` and `appliedRounds` (C6, `stepMismatch`).

/** The reply of an accepted prediction: the stored prediction and its version (FR-267); `round` is absent for the winner. */
export interface PredictionReply {
  readonly kind: PredictionKind;
  readonly round?: number;
  readonly choice: number;
  readonly version: number;
}

/** One stored prediction of a client's own player (FR-270): the local player id (no namespace) and the stored prediction. */
export interface OwnPrediction {
  readonly playerId: string;
  readonly kind: PredictionKind;
  /** Absent exactly for the winner. */
  readonly round?: number;
  readonly choice: number;
  readonly version: number;
}

/**
 * The reply to a join (FR-377): the player's namespaced id, the stored name, the player token (given once, here only) and
 * the public data after the join, as a creation reply carries it.
 */
export interface JoinReply {
  readonly playerId: string;
  readonly name: string;
  readonly playerToken: string;
  readonly match: PublicMatch;
}

/** One row of the players list (FR-385): id, name and the sequence number of the event that announced the join. */
export interface PlayerListItem {
  readonly playerId: string;
  readonly name: string;
  readonly joinedSeq: number;
}

/** One row of the match list (FR-279 (b): ordered by creation instant, then match id). */
export interface MatchSummary {
  readonly matchId: string;
  readonly mapId: string;
  readonly stage: Stage;
  readonly appliedRounds: number;
  readonly totalRounds: number;
  readonly createdAt: number;
}

/** The state at an applied round j <= N with its state digest and the reported time of the read (FR-302). */
export interface StateReply {
  readonly round: number;
  readonly owners: readonly (readonly [number, number])[];
  readonly stateDigest: string;
  readonly reportedTime: number;
}

/** The record of an applied round j >= 1 (spec 001 record). */
export interface RecordReply {
  readonly round: number;
  readonly eliminated: number;
  readonly absorber: number;
  readonly transferred: readonly number[];
}

/** One scored prediction of a phase (plan 20.7): the namespaced player id, the stored choice, whether it was right, the points. */
export interface PhaseResult {
  readonly playerId: string;
  readonly choice: number;
  readonly correct: boolean;
  readonly points: number;
  /** The name of a player who joined by name; absent for a client-credential player. */
  readonly name?: string;
}

/**
 * One page of the results of a scored phase (round k, phase 1 or 2): `victim` exactly for phase 1, `record` (the record of
 * round k) exactly for phase 2, then the items ordered by player id; `next` exactly when more items follow.
 */
export interface PhaseResultsPage {
  readonly round: number;
  readonly phase: 1 | 2;
  readonly victim?: number;
  readonly record?: RecordReply;
  readonly items: readonly PhaseResult[];
  readonly next?: string;
}

/** One scored prediction of a player: `round` is absent exactly for the winner. */
export interface PlayerResult {
  readonly kind: PredictionKind;
  readonly round?: number;
  readonly choice: number;
  readonly correct: boolean;
  readonly points: number;
}

/** One page of a player's scored predictions; `total` sums every scored item of the player as of the read. */
export interface PlayerResultsPage {
  readonly playerId: string;
  readonly total: number;
  readonly items: readonly PlayerResult[];
  readonly next?: string;
  /** The name of the player when it joined by name; absent otherwise. */
  readonly name?: string;
}

/** One leaderboard row: competition rank (equal totals share it), totals and correct counts (`correctWinner` is 0 or 1). */
export interface LeaderboardRow {
  readonly rank: number;
  readonly playerId: string;
  readonly total: number;
  readonly correctVictims: number;
  readonly correctAbsorbers: number;
  readonly correctWinner: number;
  /** The name of the player when it joined by name; absent otherwise. */
  readonly name?: string;
}

/** One player who guessed a scored phase right: only the id and the name (no choice, no points). */
export interface PhaseWinner {
  readonly playerId: string;
  readonly name: string;
}

/** One page of the named players who guessed right in a scored phase, ordered by player id; `next` exactly when more follow. */
export interface PhaseWinnersPage {
  readonly round: number;
  readonly phase: 1 | 2;
  readonly items: readonly PhaseWinner[];
  readonly next?: string;
}

/** One page of a list read (FR-279 (a)): `next` is present exactly when the page is not the last. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly next?: string;
}

/** Wire key order of each reply (FR-257 (encoders)): fixed, whatever the order of the input object. */
export const CREATION_REPLY_KEYS = ['matchId', 'match', 'hostToken'] as const;
export const JOIN_REPLY_KEYS = ['playerId', 'name', 'playerToken', 'match'] as const;
export const PLAYER_LIST_ITEM_KEYS = ['playerId', 'name', 'joinedSeq'] as const;
export const ADVANCE_REPLY_KEYS = ['result', 'step', 'match'] as const;
export const STEP_INFO_KEYS = ['round', 'kind', 'instant', 'cause'] as const;
export const PREDICTION_REPLY_KEYS = ['kind', 'round', 'choice', 'version'] as const;
export const OWN_PREDICTION_KEYS = ['playerId', 'kind', 'round', 'choice', 'version'] as const;
export const MATCH_SUMMARY_KEYS = ['matchId', 'mapId', 'stage', 'appliedRounds', 'totalRounds', 'createdAt'] as const;
export const STATE_REPLY_KEYS = ['round', 'owners', 'stateDigest', 'reportedTime'] as const;
export const RECORD_REPLY_KEYS = ['round', 'eliminated', 'absorber', 'transferred'] as const;
export const PAGE_KEYS = ['items', 'next'] as const;
export const PHASE_RESULT_KEYS = ['playerId', 'choice', 'correct', 'points', 'name'] as const;
export const PHASE_RESULTS_PAGE_KEYS = ['round', 'phase', 'victim', 'record', 'items', 'next'] as const;
export const PLAYER_RESULT_KEYS = ['kind', 'round', 'choice', 'correct', 'points'] as const;
export const PLAYER_RESULTS_PAGE_KEYS = ['playerId', 'total', 'items', 'next', 'name'] as const;
export const LEADERBOARD_ROW_KEYS = ['rank', 'playerId', 'total', 'correctVictims', 'correctAbsorbers', 'correctWinner', 'name'] as const;
export const PHASE_WINNER_KEYS = ['playerId', 'name'] as const;
export const PHASE_WINNERS_PAGE_KEYS = ['round', 'phase', 'items', 'next'] as const;
