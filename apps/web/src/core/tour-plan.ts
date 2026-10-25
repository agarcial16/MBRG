// When a reveal tour plays (spec 009 FR-316, FR-319, FR-320, FR-336, FR-338, FR-349). Pure decisions over plain
// inputs: the live model gives the match timeline (freshness, participants, time left), the view gives the
// reduced-motion preference. Nothing here reads a clock; the caller passes the reported-time estimate.
import { LABEL_PARAMS } from './label-params';
import { nominalEnd } from './tour';
import type { TourKind } from './tour-key';
import { TOUR_PARAMS } from './tour-params';

/** The timing of the match: `manual`, or the host's I, L1, L2 in whole seconds. */
export type PlanTiming = 'manual' | { readonly i: number; readonly l1: number; readonly l2: number };

export type SkipReason =
  | 'not-fresh'
  | 'mismatch'
  | 'no-candidates'
  | 'not-a-candidate'
  | 'too-short'
  | 'reduced-motion';

/** Play (with the time available in ms, absent for nominal speed) or skip with the reason. */
export type Decision =
  | { readonly play: true; readonly budget?: number }
  | { readonly play: false; readonly reason: SkipReason };

/** How a tour is played after the scale rule: `budget` is present only when the tour is compressed. */
export type Scale = { readonly play: true; readonly budget?: number } | { readonly play: false };

/** What the victim decision reads (all plain data of the live model at the receipt of the reveal). */
export interface VictimInput {
  /** `event`: the reveal came over the stream; `public`: read from the public data (late join, reload). */
  readonly source: 'event' | 'public';
  readonly halted: boolean;
  /** k: the round whose victim is revealed. */
  readonly round: number;
  readonly displayed: number | undefined;
  /** The reported-time estimate at the receipt, already raised with the event's own reported time. */
  readonly estimate: number;
  readonly revealedAt: number;
  /** The participants of the reveal. */
  readonly living: readonly number[];
  /** The factions living in the held owners of the displayed round. */
  readonly displayedLiving: readonly number[];
  readonly victim: number;
  readonly timing: PlanTiming;
  readonly c2: number | null;
}

/** What the absorber decision reads at the receipt of `round-applied`. */
export interface AbsorberInput {
  readonly halted: boolean;
  readonly round: number;
  readonly totalRounds: number;
  readonly displayed: number | undefined;
  readonly estimate: number;
  readonly appliedAt: number;
  /** The candidates of round k held from the victim reveal, or undefined when they are not held. */
  readonly candidates: readonly number[] | undefined;
  readonly absorber: number;
  readonly timing: PlanTiming;
}

/** The age of a match instant: never negative, even when the estimate is below it. */
const ageOf = (estimate: number, instant: number): number => Math.max(0, estimate - instant);

const sameFactions = (a: readonly number[], b: readonly number[]): boolean => {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
};

/**
 * FR-316 FR-319 FR-320: whether the victim tour of round k plays. Not fresh (public data, halted match, another
 * displayed round, older than Dlate) -> `not-fresh`; participants that differ from the held owners, a victim
 * outside them or fewer than two -> `mismatch`. The budget is C2 - estimate - 1,000 ms (FR-336), absent under
 * `manual` timing or without a C2 (FR-338); the view applies `viewChoice` to it.
 */
export function victimTourDecision(input: VictimInput): Decision {
  const fresh =
    input.source === 'event' &&
    !input.halted &&
    input.displayed === input.round - 1 &&
    ageOf(input.estimate, input.revealedAt) <= TOUR_PARAMS.lateMs;
  if (!fresh) return { play: false, reason: 'not-fresh' };
  if (input.living.length < 2 || !input.living.includes(input.victim) || !sameFactions(input.living, input.displayedLiving)) {
    return { play: false, reason: 'mismatch' };
  }
  if (input.timing === 'manual' || input.c2 === null) return { play: true };
  return { play: true, budget: input.c2 - input.estimate - TOUR_PARAMS.marginMs };
}

/**
 * FR-349: the scale of a tour with nominal end `end` and `budget` ms available: nominal when the budget holds
 * (or there is none), the budget itself when it is at least half of `end`, otherwise skipped.
 */
export function scaleFor(end: number, budget: number | undefined): Scale {
  if (budget === undefined || budget >= end) return { play: true };
  if (budget * 2 >= end) return { play: true, budget };
  return { play: false };
}

/**
 * The view's choice (reduced motion is known only there): a victim tour becomes the still tour (D = 1,800 ms) and
 * is scaled with that D (D14); an absorber tour is dropped. `n` is the size of the tour's set.
 */
export function viewChoice(
  kind: TourKind,
  reduced: boolean,
  n: number,
  budget: number | undefined,
): { readonly play: true; readonly still?: true; readonly budget?: number } | { readonly play: false; readonly reason: SkipReason } {
  if (kind === 'absorber' && reduced) return { play: false, reason: 'reduced-motion' };
  const still = kind === 'victim' && reduced;
  const scale = scaleFor(nominalEnd(kind, n, still), budget);
  if (!scale.play) return { play: false, reason: 'too-short' };
  return { play: true, ...(still ? { still: true as const } : {}), ...(scale.budget === undefined ? {} : { budget: scale.budget }) };
}

/**
 * FR-345 FR-349 FR-350 (decision part): whether the absorber tour of round k plays, decided at the receipt of
 * `round-applied`. The budget is appliedAt + (I - L1 - L2) x 1,000 - estimate - 1,000 - Dt: the end must come
 * 1,000 ms plus the step before the next phase-1 close; none under `manual` timing and for the last round.
 */
export function absorberTourDecision(input: AbsorberInput): Decision {
  const fresh =
    !input.halted &&
    input.displayed === input.round - 1 &&
    ageOf(input.estimate, input.appliedAt) <= TOUR_PARAMS.lateMs;
  if (!fresh) return { play: false, reason: 'not-fresh' };
  const candidates = input.candidates;
  if (candidates === undefined || new Set(candidates).size < 2) return { play: false, reason: 'no-candidates' };
  if (!candidates.includes(input.absorber)) return { play: false, reason: 'not-a-candidate' };
  if (input.timing === 'manual' || input.round >= input.totalRounds) return { play: true };
  const gap = (input.timing.i - input.timing.l1 - input.timing.l2) * 1000;
  const budget = input.appliedAt + gap - input.estimate - TOUR_PARAMS.marginMs - LABEL_PARAMS.durationMs;
  const scale = scaleFor(nominalEnd('absorber', candidates.length), budget);
  if (!scale.play) return { play: false, reason: 'too-short' };
  return { play: true, budget };
}
