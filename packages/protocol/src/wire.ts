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
export const SUBMISSION_FIELDS = ['kind', 'round', 'faction', 'playerId', 'requestId'] as const;

/** Stages of a match (spec Definitions "Stage"). */
export const STAGES = ['phase-1', 'phase-2', 'locked', 'finished', 'halted'] as const;
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
  readonly seq: number;
}
export const PUBLIC_VICTIM_KEYS = ['round', 'victim', 'candidates', 'living', 'revealedAt', 'c2', 'a', 'seq'] as const;

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
export type MatchEvent =
  | PhaseClosedEvent
  | VictimRevealedEvent
  | RoundAppliedEvent
  | ResultsEvent
  | ScheduleEvent
  | MatchFinishedEvent
  | MatchHaltedEvent;

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

/** The `step-mismatch` reply (FR-295 (b)): the named step is neither the next one nor a performed one; it names the current stage and N. */
export interface StepMismatchReply {
  readonly kind: 'step-mismatch';
  readonly stage: Stage;
  /** N: the number of applied rounds. */
  readonly appliedRounds: number;
}
