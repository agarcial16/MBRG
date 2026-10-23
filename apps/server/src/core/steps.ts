// The stage machine and the three steps of a round (spec 008 FR-240, FR-247, FR-255, FR-256, FR-269).
// Pure: time (`instant`), the map, the round seeds (`seedOf`) and the hash (`sha256`) are parameters.
//
// Secrecy by construction (PD7): the engine's answer for the pending round holds the absorber and the next state. At the
// phase-1 close only the victim is read from it and the rest goes out of scope; at the application the answer is
// recomputed, its victim is checked against the stored one, and it is used once to build the public record and state.
// The core view has no field for an absorber or a pending state, so nothing of them can be stored, sent or logged.

import { stateText } from '@mbrg/protocol';
import type { HaltReason, MatchEvent, PublicState, PublicVictim, Stage, StepKind } from '@mbrg/protocol';
import { VALIDATION_KIND_ORDER, validateMap } from '@mbrg/shared';
import type { FactionId, MapData, Result } from '@mbrg/shared';
import { absorptionCandidatesOf, livingFactions, playRoundWithSeed } from '@mbrg/sim';
import type { MatchError, MatchState, RoundRecord } from '@mbrg/sim';
import { anchorsAfterStep, dueStep, lastStepAfter } from './time';
import type { CoreMatch, StepCause, StepRow } from './view';

export interface StepDeps {
  /** The map as read from the store, or null when it is missing or its digest differs; validated before every step. */
  readonly map: unknown;
  /** The round seed s_k; called only at a phase-1 close and at an application, never for a round whose phase 1 is open. */
  readonly seedOf: (k: number) => number;
  /** SHA-256 of an ASCII text, as 64 lowercase hexadecimal characters (the state digest). */
  readonly sha256: (text: string) => string;
}

export interface StepInput {
  readonly kind: StepKind;
  /** The step instant: the scheduled instant of an on-time clock step, else the effective instant (FR-248, FR-249). */
  readonly instant: number;
  readonly cause: StepCause;
  /** The reported time of the events of this decision (FR-302), computed by the caller. */
  readonly reportedTime: number;
}

/** What an application makes public: the record, the new state and its digest (FR-243). */
export interface Applied {
  readonly record: RoundRecord;
  readonly state: MatchState;
  readonly stateDigest: string;
}

/** A decision's result: the new view, the rows and events to store and publish, in order. */
export interface StepOutcome {
  readonly view: CoreMatch;
  readonly steps: readonly StepRow[];
  readonly events: readonly MatchEvent[];
  readonly applied?: Applied;
}

const NEXT: Partial<Record<Stage, StepKind>> = { 'phase-1': 'phase-1-close', 'phase-2': 'phase-2-close', locked: 'application' };

/** The next step of a running match; null when it is finished or halted. */
export const nextStep = (view: CoreMatch): StepKind | null => NEXT[view.stage] ?? null;

const VALIDATION_KINDS: readonly string[] = VALIDATION_KIND_ORDER;

/**
 * The halt reason for an engine answer that is an error (FR-250 as the spec words it): `isolated-faction`, or
 * `map-changed` when the map no longer validates. Any other error is not a halt (undefined): it means the stored data
 * are inconsistent, which the caller reports as `unavailable`.
 */
export function haltReasonOf(errors: readonly MatchError[]): HaltReason | undefined {
  if (errors.some((e) => e.kind === 'isolated-faction')) return 'isolated-faction';
  if (errors.some((e) => VALIDATION_KINDS.includes(e.kind))) return 'map-changed';
  return undefined;
}

const publicStateOf = (state: MatchState): PublicState => ({ mode: 'classic', round: state.round, owners: state.owners.map(([t, f]) => [t, f] as const) });
const matchStateOf = (state: PublicState): MatchState => ({ mode: 'classic', round: state.round, owners: state.owners.map(([t, f]) => [t, f]) });

/** Halts the match (FR-251 (a)): stage `halted`, the reason, no schedule, one `match-halted` event, no step row. */
export function haltMatch(view: CoreMatch, reason: HaltReason, reportedTime: number): StepOutcome {
  const seq = view.lastSeq + 1;
  return {
    view: { ...view, stage: 'halted', haltReason: reason, anchors: null, lastSeq: seq },
    steps: [],
    events: [{ type: 'match-halted', seq, round: view.appliedRounds + 1, reason, reportedTime }],
  };
}

/** Only the victim of the engine's answer: the absorber and the next state are not returned (PD7, FR-256). */
function victimOf(map: MapData, state: MatchState, seed: number): { ok: true; victim: FactionId } | { ok: false; errors: MatchError[] } {
  const played = playRoundWithSeed(map, state, seed);
  return played.ok ? { ok: true, victim: played.value.record.eliminated } : { ok: false, errors: played.errors };
}

const must = <T>(r: Result<T, MatchError>, what: string): T => {
  if (!r.ok) throw new RangeError(`inconsistent stored data: ${what}`);
  return r.value;
};

function closePhase1(view: CoreMatch, input: StepInput, instant: number, map: MapData, deps: StepDeps): StepOutcome {
  const k = view.appliedRounds + 1;
  const state = matchStateOf(view.state);
  const elected = victimOf(map, state, deps.seedOf(k));
  if (!elected.ok) {
    const reason = haltReasonOf(elected.errors);
    if (reason === undefined) throw new RangeError('inconsistent stored data: the round cannot be played');
    return haltMatch(view, reason, input.reportedTime);
  }
  const anchors = anchorsAfterStep(view.anchors, 'phase-1-close', instant, input.cause, view.timing);
  let seq = view.lastSeq;
  const closed: MatchEvent = { type: 'phase-closed', seq: ++seq, round: k, phase: 1, at: instant };
  const victim: PublicVictim = {
    round: k,
    victim: elected.victim,
    candidates: must(absorptionCandidatesOf(map, state, elected.victim), 'candidates'),
    living: must(livingFactions(map, state), 'living factions'),
    revealedAt: instant,
    c2: anchors === null ? null : anchors.c2,
    a: anchors === null ? null : anchors.a,
    seq: seq + 1,
  };
  seq += 1;
  const revealed: MatchEvent = { type: 'victim-revealed', ...victim, reportedTime: input.reportedTime };
  // The results of phase 1 are announced with the reveal (plan 20.4), also when nobody predicted (G2).
  const results: MatchEvent = { type: 'results', seq: ++seq, round: k, phase: 1 };
  return {
    view: { ...view, stage: 'phase-2', anchors, victim, lastStepMs: instant, lastSeq: seq },
    steps: [{ round: k, kind: 'phase-1-close', instant, cause: input.cause }],
    events: [closed, revealed, results],
  };
}

function closePhase2(view: CoreMatch, input: StepInput, instant: number): StepOutcome {
  const k = view.appliedRounds + 1;
  const anchors = anchorsAfterStep(view.anchors, 'phase-2-close', instant, input.cause, view.timing);
  const seq = view.lastSeq + 1;
  return {
    view: { ...view, stage: 'locked', anchors, lastStepMs: instant, lastSeq: seq },
    steps: [{ round: k, kind: 'phase-2-close', instant, cause: input.cause }],
    events: [{ type: 'phase-closed', seq, round: k, phase: 2, at: instant }],
  };
}

function apply(view: CoreMatch, input: StepInput, instant: number, map: MapData, deps: StepDeps): StepOutcome {
  const k = view.appliedRounds + 1;
  const played = playRoundWithSeed(map, matchStateOf(view.state), deps.seedOf(k));
  if (!played.ok) {
    const reason = haltReasonOf(played.errors);
    if (reason === undefined) throw new RangeError('inconsistent stored data: the round cannot be played');
    return haltMatch(view, reason, input.reportedTime);
  }
  if (view.victim === undefined || played.value.record.eliminated !== view.victim.victim) return haltMatch(view, 'victim-mismatch', input.reportedTime);
  const { record, state } = played.value;
  const published = publicStateOf(state);
  const stateDigest = deps.sha256(stateText(published));
  const finished = k >= view.totalRounds;
  const anchors = finished ? null : anchorsAfterStep(view.anchors, 'application', instant, input.cause, view.timing);
  const { victim: _revealed, ...rest } = view;
  const seq = view.lastSeq + 1;
  // The results of phase 2 follow the application; the winner scoring is announced by `match-finished` (plan 20.4).
  const resultsSeq = seq + 1;
  const next: CoreMatch = {
    ...rest,
    stage: finished ? 'finished' : 'phase-1',
    appliedRounds: k,
    state: published,
    stateDigest,
    anchors,
    lastStepMs: instant,
    lastSeq: resultsSeq,
    ...(finished ? { winner: must(livingFactions(map, state), 'living factions')[0] } : {}),
  };
  return {
    view: next,
    steps: [{ round: k, kind: 'application', instant, cause: input.cause }],
    events: [
      { type: 'round-applied', seq, round: k, record: { round: record.round, eliminated: record.eliminated, absorber: record.absorber, transferred: [...record.transferred] }, stateDigest, appliedAt: instant },
      { type: 'results', seq: resultsSeq, round: k, phase: 2 },
    ],
    applied: { record, state, stateDigest },
  };
}

/** One step, without the follow-up of the L2 = 0 rule and without the schedule event. */
function stepOnce(view: CoreMatch, input: StepInput, deps: StepDeps): StepOutcome {
  if (nextStep(view) !== input.kind) throw new RangeError(`the step ${input.kind} is not the next step of a match in stage ${view.stage}`);
  const instant = lastStepAfter(view.lastStepMs, input.instant);
  // The map check before every step.
  const checked = validateMap(deps.map);
  if (!checked.ok) return haltMatch(view, 'map-changed', input.reportedTime);
  if (input.kind === 'phase-1-close') return closePhase1(view, input, instant, checked.value, deps);
  if (input.kind === 'phase-2-close') return closePhase2(view, input, instant);
  return apply(view, input, instant, checked.value, deps);
}

/**
 * Performs the next step of the match at `input.instant` (FR-247: exactly the next step, never again, never early; any
 * other step is a RangeError, the caller having decided by FR-295 first). With L2 = 0 the application falls due at the
 * instant of the phase-2 close and follows it in the same decision, phase-2 close first, with the same instant (FR-240).
 * The result lists the rows and events in the order to store and publish them (plan 20.4: a
 * phase-1 close gives `phase-closed`, `victim-revealed`, `results`; an application `round-applied`, `results`; a halt only
 * `match-halted`; the `schedule` event comes last while the match runs).
 */
export function performStep(view: CoreMatch, input: StepInput, deps: StepDeps): StepOutcome {
  const first = stepOnce(view, input, deps);
  let { view: current, steps, events, applied } = { ...first, steps: [...first.steps], events: [...first.events] };
  if (input.kind === 'phase-2-close' && current.stage === 'locked') {
    const due = dueStep(current.stage, current.anchors, input.instant);
    if (due !== null && due.instant === input.instant) {
      const second = stepOnce(current, { kind: due.kind, instant: due.instant, cause: due.cause, reportedTime: input.reportedTime }, deps);
      current = second.view;
      steps = [...steps, ...second.steps];
      events = [...events, ...second.events];
      applied = second.applied;
    }
  }
  if (current.stage === 'phase-1' || current.stage === 'phase-2' || current.stage === 'locked') {
    const seq = current.lastSeq + 1;
    current = { ...current, lastSeq: seq };
    events = [
      ...events,
      { type: 'schedule', seq, stage: current.stage, ...(current.anchors === null ? {} : { schedule: { c1: current.anchors.c1, c2: current.anchors.c2, a: current.anchors.a } }), reportedTime: input.reportedTime },
    ];
  }
  return applied === undefined ? { view: current, steps, events } : { view: current, steps, events, applied };
}

/**
 * The one step due at `effective` for a running match with a clock, performed at once (FR-239, FR-269), or null when
 * nothing is due. An overdue step is performed late at the effective instant (cause `late`).
 */
export function runDue(view: CoreMatch, effective: number, reportedTime: number, deps: StepDeps): StepOutcome | null {
  const due = dueStep(view.stage, view.anchors, effective);
  if (due === null) return null;
  return performStep(view, { kind: due.kind, instant: due.instant, cause: due.cause, reportedTime }, deps);
}
