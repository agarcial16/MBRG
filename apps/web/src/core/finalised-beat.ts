// The finalised beat (spec 013 FR-409). The server sends the close of a prediction window and the reveal that follows it in one
// burst, so the viewer holds the rest of the stream for a short beat and shows PREDICCIONES FINALIZADAS before any of the reveal.
// A viewer-side hold only: the server timeline is unchanged. Pure; the model keeps the result and the shell arms the timer.
import { TOUR_PARAMS } from './tour-params';

/** How long the close is shown alone before the reveal (about two seconds). Shorter than `TOUR_PARAMS.lateMs`, so a held reveal is still fresh. */
export const BEAT_MS = 2000;

/** A beat in progress: the round whose window closed and the instant it ends. It names no faction. */
export interface Beat {
  readonly round: number;
  readonly until: number;
}

/** What decides whether a close starts a beat (plain data of the live model at the receipt of `phase-closed`). */
export interface BeatInput {
  readonly halted: boolean;
  /** k: the round whose window closed. */
  readonly round: number;
  readonly displayed: number | undefined;
  readonly applied: number;
  /** The reported-time estimate at the receipt. */
  readonly estimate: number;
  /** The match instant of the close. */
  readonly closedAt: number;
  /** The clock reading of the receipt: the beat runs from it. */
  readonly at: number;
}

/**
 * The beat of a close, or none. It needs a close that is fresh (not older than `lateMs`: a reconnection that replays old events has
 * no beat), a viewer on the live edge of the round in play (a replay of history has none) and a match that still runs.
 */
export function beatOf(input: BeatInput): Beat | undefined {
  if (input.halted) return undefined;
  if (input.round !== input.applied + 1 || input.displayed !== input.applied) return undefined;
  if (Math.max(0, input.estimate - input.closedAt) > TOUR_PARAMS.lateMs) return undefined;
  return { round: input.round, until: input.at + BEAT_MS };
}
