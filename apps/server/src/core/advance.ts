// The advance decision of a match (spec 008 FR-244, FR-295 (b), (c)). Pure: the effective instant, the reported time and
// the stored row of an already performed step are parameters. Who may advance (FR-245 forbidden) is decided by the shell;
// this module sees only a request that already passed authorization.
//
// Late steps (FR-248) need no module of their own: an overdue clock step is `runDue` in steps.ts (cause `late` at the
// effective instant, anchors shifted from it by `anchorsAfterStep`, one step per call).

import { errorReply } from '@mbrg/protocol';
import type { AdvanceReply, ErrorReply, StepKind, StepMismatchReply } from '@mbrg/protocol';
import { nextStep, performStep } from './steps';
import type { StepDeps, StepOutcome } from './steps';
import { publicOf } from './view';
import type { CoreMatch, StepRow } from './view';

export interface AdvanceInput {
  /** The step the caller expects, by round and kind (FR-295 (b)). */
  readonly round: number;
  readonly step: StepKind;
  /** The effective instant t of the decision: max(clock reading, last step instant) (FR-249). */
  readonly effective: number;
  /** The reported time of the events and of the reply (FR-302), computed by the caller. */
  readonly reportedTime: number;
  /** The stored step row of the named step; required exactly when that step was already performed (the core keeps no rows). */
  readonly stored?: StepRow;
  /** The match secret in hex, only for the public data of a finished match (FR-253); the core never reads it. */
  readonly matchSecret?: string;
}

/** Accepted: the outcome to store and publish (no rows and no events when nothing was performed) and the reply. */
export type AdvanceDecision =
  | { readonly ok: true; readonly outcome: StepOutcome; readonly reply: AdvanceReply }
  /** `outcome` is present only when the advance halted the match (FR-251): the halted view and its event are to be stored. */
  | { readonly ok: false; readonly error: ErrorReply | StepMismatchReply; readonly outcome?: StepOutcome };

const KIND_INDEX: Record<StepKind, number> = { 'phase-1-close': 0, 'phase-2-close': 1, application: 2 };
/** The position of a step in the match: three per round, in order. */
const positionOf = (round: number, kind: StepKind): number => (round - 1) * 3 + KIND_INDEX[kind];

/**
 * Decides an advance by its expected step (FR-295 (b), (c)): the next step is performed at `effective` with cause
 * `manual` and exactly one step (D22; with L2 = 0 the application that falls due at once follows in the same decision,
 * FR-240); a step before the next one is already performed and gets its stored row, nothing performed; any other step
 * is `step-mismatch` with the stage and N. A finished or halted match answers first (FR-301 order).
 */
export function decideAdvance(view: CoreMatch, input: AdvanceInput, deps: StepDeps): AdvanceDecision {
  if (view.stage === 'halted') return { ok: false, error: errorReply('match-halted') };
  if (view.stage === 'finished') return { ok: false, error: errorReply('match-finished') };
  const next = nextStep(view);
  if (next === null) throw new RangeError(`a running match has a next step; stage ${view.stage}`);
  const mismatch: AdvanceDecision = { ok: false, error: { kind: 'step-mismatch', stage: view.stage, appliedRounds: view.appliedRounds } };
  if (!Number.isSafeInteger(input.round) || input.round < 1) return mismatch;
  const named = positionOf(input.round, input.step);
  const current = positionOf(view.appliedRounds + 1, next);
  if (named > current) return mismatch;
  if (named < current) {
    // Already performed: the caller passes the row it stored for this step.
    const { stored } = input;
    if (stored === undefined) throw new RangeError('inconsistent stored data: a performed step has no stored row');
    if (stored.round !== input.round || stored.kind !== input.step) throw new RangeError('the stored row is not the named step');
    return {
      ok: true,
      outcome: { view, steps: [], events: [] },
      reply: { result: 'already-performed', step: { ...stored }, match: publicOf(view, input.reportedTime, input.matchSecret) },
    };
  }
  if (input.stored !== undefined) throw new RangeError('inconsistent stored data: the next step already has a stored row');
  const outcome = performStep(view, { kind: next, instant: input.effective, cause: 'manual', reportedTime: input.reportedTime }, deps);
  const performed = outcome.steps[0];
  if (performed === undefined) {
    // A halt (FR-250, FR-251) is a decision without a step row: the reply is the halt, as for any later advance.
    return { ok: false, error: errorReply('match-halted'), outcome };
  }
  return {
    ok: true,
    outcome,
    reply: { result: 'performed', step: { ...performed }, match: publicOf(outcome.view, input.reportedTime, input.matchSecret) },
  };
}
