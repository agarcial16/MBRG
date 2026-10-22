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
