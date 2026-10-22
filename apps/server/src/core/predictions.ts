// Prediction acceptance, closing and replacement of a match (spec 008 FR-261 to FR-268, FR-295 (a)). Pure: the effective
// instant and the stored prediction (if any) are parameters; the module keeps nothing, stores nothing and reads no clock.
// Every check uses the core view, which holds public data only (FR-265): no absorber, no pending state, no seed.
//
// Scoring (M4) is not here: the core stores choices only. "Closed" means the cutoff passed or the closing step began.

import { errorReply } from '@mbrg/protocol';
import type { ErrorReply, PredictionKind } from '@mbrg/protocol';
import type { CoreMatch } from './view';

/** A submission as the shell decoded it: the kind, the round of a per-round kind (none for the winner) and the faction. */
export type Submission =
  | { readonly kind: 'winner'; readonly choice: number }
  | { readonly kind: 'victim' | 'absorber'; readonly round: number; readonly choice: number };

/** One stored prediction (FR-267): `round` is 0 for the winner; `winnerCandidates` only for the winner (P27). */
export interface StoredPrediction {
  readonly kind: PredictionKind;
  readonly round: number;
  readonly choice: number;
  /** Informational only (P37): 1 at the first store, +1 on each replacement. */
  readonly version: number;
  readonly storedMs: number;
  readonly winnerCandidates?: number;
}

/** The reply of an accepted submission: the stored prediction and its version (FR-267). */
export interface PredictionReply {
  readonly kind: PredictionKind;
  readonly round?: number;
  readonly choice: number;
  readonly version: number;
}

export interface SubmissionInput {
  readonly submission: Submission;
  /** The server's effective instant of the submission, never a time sent by the client (FR-266). */
  readonly effective: number;
  /** The stored prediction for the same (player, kind, round), if any; the caller looks it up. */
  readonly stored?: StoredPrediction;
}

/** `store` is the row to write (absent for `unchanged`: nothing changes, FR-267). */
export type SubmissionDecision =
  | { readonly ok: true; readonly change: 'created' | 'replaced' | 'unchanged'; readonly store?: StoredPrediction; readonly reply: PredictionReply }
  | { readonly ok: false; readonly error: ErrorReply };

const closed = (): SubmissionDecision => ({ ok: false, error: errorReply('prediction-closed') });
const invalid = (): SubmissionDecision => ({ ok: false, error: errorReply('invalid-choice') });

/** Factions living at N (those owning a territory), ascending; the public state is enough, no map is read. */
function livingAt(view: CoreMatch): number[] {
  return [...new Set(view.state.owners.map(([, faction]) => faction))].sort((a, b) => a - b);
}

/** Winner candidates now: the factions living at N, minus the victim of the pending round once revealed (definitions, P27). */
export function winnerCandidates(view: CoreMatch): number[] {
  const living = livingAt(view);
  const revealed = view.victim?.victim;
  return revealed === undefined ? living : living.filter((f) => f !== revealed);
}

/** Whether a submission is still open at `effective`: the stage, the pending round and the exclusive cutoff (FR-266). */
function isOpen(view: CoreMatch, submission: Submission, effective: number): boolean {
  const pending = view.appliedRounds + 1;
  if (submission.kind === 'winner') {
    if (pending < view.totalRounds) return true;
    // Round T: open until its phase-1 close; an overdue close does not reopen it, the cutoff is exclusive.
    return view.stage === 'phase-1' && (view.anchors === null || effective < view.anchors.c1);
  }
  if (!Number.isSafeInteger(submission.round) || submission.round !== pending) return false;
  if (submission.kind === 'victim') return view.stage === 'phase-1' && (view.anchors === null || effective < view.anchors.c1);
  return view.stage === 'phase-2' && (view.anchors === null || effective < view.anchors.c2);
}

/** The faction ids a submission may name now (FR-262, FR-263, FR-264), from public data only. */
function allowedChoices(view: CoreMatch, kind: PredictionKind): readonly number[] {
  if (kind === 'victim') return livingAt(view);
  if (kind === 'absorber') {
    if (view.victim === undefined) throw new RangeError('inconsistent view: phase 2 without a revealed victim');
    return view.victim.candidates;
  }
  return winnerCandidates(view);
}

/**
 * Decides a submission (FR-261 to FR-268). Errors in the FR-301 order: `match-halted`, `match-finished`,
 * `prediction-closed`, `invalid-choice`. A closed or invalid submission stores nothing and costs the player nothing
 * (FR-268). An accepted one replaces the stored prediction with version + 1; an equal one changes nothing and keeps the
 * version; there is no version precondition, so a delayed older resubmission overwrites a newer one (P37).
 */
export function decideSubmission(view: CoreMatch, input: SubmissionInput): SubmissionDecision {
  const { submission, effective, stored } = input;
  if (view.stage === 'halted') return { ok: false, error: errorReply('match-halted') };
  if (view.stage === 'finished') return { ok: false, error: errorReply('match-finished') };
  if (!isOpen(view, submission, effective)) return closed();
  const kind = submission.kind;
  if (!Number.isSafeInteger(submission.choice) || !allowedChoices(view, kind).includes(submission.choice)) return invalid();
  const round = kind === 'winner' ? 0 : submission.round;
  if (stored !== undefined && (stored.kind !== kind || stored.round !== round)) {
    throw new RangeError('inconsistent stored data: the stored prediction is for another key');
  }
  const reply = (version: number): PredictionReply => ({ kind, ...(kind === 'winner' ? {} : { round }), choice: submission.choice, version });
  if (stored !== undefined && stored.choice === submission.choice) {
    return { ok: true, change: 'unchanged', reply: reply(stored.version) };
  }
  const version = stored === undefined ? 1 : stored.version + 1;
  const row: StoredPrediction = {
    kind,
    round,
    choice: submission.choice,
    version,
    storedMs: effective,
    ...(kind === 'winner' ? { winnerCandidates: winnerCandidates(view).length } : {}),
  };
  return { ok: true, change: stored === undefined ? 'created' : 'replaced', store: row, reply: reply(version) };
}
