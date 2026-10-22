// The core view of a match (spec 008 plan PD7): everything the pure decisions keep about one match.
// It has NO absorber field and NO pending-state field (FR-256 by construction) and carries no secret (PD6);
// it maps onto the protocol's `PublicMatch` by `publicOf`.

import type { HaltReason, PublicMatch, PublicState, PublicVictim, Stage, StepKind, Timing } from '@mbrg/protocol';
import type { Anchors } from './time';

/** Why a step was performed (FR-240). */
export type StepCause = 'clock' | 'manual' | 'late';

/** One stored step (FR-240, FR-293): round, kind, instant (whole ms) and cause. */
export interface StepRow {
  readonly round: number;
  readonly kind: StepKind;
  readonly instant: number;
  readonly cause: StepCause;
}

export interface CoreMatch {
  readonly matchId: string;
  readonly mapId: string;
  readonly mapDigest: string;
  readonly totalRounds: number;
  readonly timing: Timing;
  readonly commitment: string;
  readonly stage: Stage;
  /** N: the number of applied rounds. */
  readonly appliedRounds: number;
  /** The published state at N (never the state of a pending round). */
  readonly state: PublicState;
  readonly stateDigest: string;
  readonly lastSeq: number;
  /** The creation instant (whole ms). */
  readonly createdAt: number;
  /** The instant of the latest stored step row, the creation instant before any step; updated only by a step row. */
  readonly lastStepMs: number;
  /** The anchors of the pending round as currently shifted; null when the timing is `manual` or the match is over. */
  readonly anchors: Anchors | null;
  /** Revealed victim data (FR-288): present in `phase-2`, `locked` and in `halted` after a reveal. */
  readonly victim?: PublicVictim;
  readonly winner?: number;
  readonly haltReason?: HaltReason;
}

/** Field list of the core view, pinned by a test: nothing named like an absorber, a seed or a pending state. */
export const CORE_MATCH_KEYS = [
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
  'createdAt',
  'lastStepMs',
  'anchors',
  'victim',
  'winner',
  'haltReason',
] as const satisfies readonly (keyof CoreMatch)[];

/**
 * Maps a core view onto the public view. `reportedTime` comes from `reportedTime()`; `matchSecret` (hex) is passed by
 * the shell and only used when the match is finished (FR-253). The schedule is exposed while the match is running
 * with a clock; no field of the result can carry an absorber or a pending state.
 */
export function publicOf(view: CoreMatch, reportedTime: number, matchSecret?: string): PublicMatch {
  const running = view.stage === 'phase-1' || view.stage === 'phase-2' || view.stage === 'locked';
  const out: { -readonly [K in keyof PublicMatch]: PublicMatch[K] } = {
    matchId: view.matchId,
    mapId: view.mapId,
    mapDigest: view.mapDigest,
    totalRounds: view.totalRounds,
    timing: view.timing,
    commitment: view.commitment,
    stage: view.stage,
    appliedRounds: view.appliedRounds,
    state: view.state,
    stateDigest: view.stateDigest,
    lastSeq: view.lastSeq,
    reportedTime,
  };
  if (running && view.anchors !== null) out.schedule = { c1: view.anchors.c1, c2: view.anchors.c2, a: view.anchors.a };
  if (view.victim !== undefined) out.victim = view.victim;
  if (view.stage === 'finished' && view.winner !== undefined) {
    out.winner = view.winner;
    if (matchSecret !== undefined) out.matchSecret = matchSecret;
  }
  if (view.stage === 'halted' && view.haltReason !== undefined) out.haltReason = view.haltReason;
  return out;
}
