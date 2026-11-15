// Playback of a sequence of reveal tours (spec 009 FR-342, FR-344): a pure driver. The caller gives the clock
// reading at which the reveal was handled (t = 0, D11) and, on every frame, the frame's own reading; the driver
// answers which tour is on screen, its elapsed time t, and the events of that frame: result hooks, the end of
// the run and the hand-over of the round step. It never reads a clock and never modifies its inputs.
import type { Tour } from './tour';

/** A sequence of one or two tours (victim, then absorber) with the clock reading that started it. */
export interface TourRun {
  /** The clock reading at which the reveal was handled: t = 0 of the first tour. */
  readonly startMs: number;
  readonly tours: readonly Tour[];
  /** A round step follows the last tour (an absorber tour, or the debug chain). */
  readonly step: boolean;
  /** The result hooks of tours 0 .. fired - 1 have been reported. */
  readonly fired: number;
  /** The run has ended: its final state is on screen and the step was handed over. */
  readonly done: boolean;
}

/** What one call answers. `index` and `t` tell which tour to draw at which elapsed time. */
export interface TourTick {
  readonly run: TourRun;
  readonly index: number;
  readonly t: number;
  /** Tours whose result became visible on this call (first frame with t at or above tau_H), in order. */
  readonly results: readonly number[];
  /** True on the one call that ended the run: draw the final state. */
  readonly ended: boolean;
  /** Present on the ending call when a round step follows: the 005 step starts at this reading. */
  readonly step?: { readonly startMs: number };
}

/** Starts a run at the clock reading at which the reveal is handled (FR-342, D11). */
export function startTourRun(handlingMs: number, tours: readonly Tour[], step = false): TourRun {
  if (tours.length === 0) throw new RangeError('a run needs at least one tour');
  return { startMs: handlingMs, tours, step, fired: 0, done: false };
}

const resultInstant = (tour: Tour): number => tour.at[tour.at.length - 1]!;

const startOf = (run: TourRun, index: number): number => {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += run.tours[i]!.end;
  return offset;
};

const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

/**
 * The frame at clock reading `nowMs`. Each tour starts at the end instant of the one before, so a frame draws
 * the t of its own reading whatever frames were dropped; the first frame at or past the end of the last tour
 * ends the run (the step then starts at that frame's reading, FR-342).
 */
export function tourRunAt(run: TourRun, nowMs: number): TourTick {
  const last = run.tours.length - 1;
  const elapsed = Math.max(0, nowMs - run.startMs);
  if (run.done) {
    return { run, index: last, t: Math.max(0, elapsed - startOf(run, last)), results: [], ended: false };
  }
  let index = 0;
  let offset = 0;
  while (index < last && elapsed >= offset + run.tours[index]!.end) {
    offset += run.tours[index]!.end;
    index++;
  }
  const t = elapsed - offset;
  const finished = t >= run.tours[index]!.end;
  const reached = finished ? run.tours.length : index + (t >= resultInstant(run.tours[index]!) ? 1 : 0);
  const next: TourRun = { ...run, fired: Math.max(run.fired, reached), done: finished };
  return {
    run: next,
    index,
    t,
    results: range(run.fired, reached),
    ended: finished,
    ...(finished && run.step ? { step: { startMs: nowMs } } : {}),
  };
}

/**
 * Completes the run at once (a skip, a request, a halt): the final state of the last tour, the hooks not fired
 * yet and the step from `nowMs`. A run that already ended answers nothing more.
 */
export function completeTourRun(run: TourRun, nowMs: number): TourTick {
  const last = run.tours.length - 1;
  const t = run.tours[last]!.end;
  if (run.done) return { run, index: last, t, results: [], ended: false };
  return {
    run: { ...run, fired: run.tours.length, done: true },
    index: last,
    t,
    results: range(run.fired, run.tours.length),
    ended: true,
    ...(run.step ? { step: { startMs: nowMs } } : {}),
  };
}

/** The reduced-motion preference changed during the run: it completes at once (FR-344, 005 FR-184). */
export function motionChangedTourRun(run: TourRun, nowMs: number): TourTick {
  return completeTourRun(run, nowMs);
}
