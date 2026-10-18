// Playback of round steps (FR-176 to FR-178, FR-182 to FR-186, FR-191, FR-194): a pure state machine.
// It holds the displayed round, the running step or the frozen progress, and reacts to a round request,
// a frame and a reduced-motion change. The caller feeds it the clock reading (NFR-33) and draws what
// `frame` returns. It never sees the camera (FR-185), a seed or the sim.
import { forwardOf, progressAt } from './progress';
import type { Direction } from './progress';

/** A step in progress: from the round shown before the request to the requested round (one apart). */
export interface RunningStep {
  from: number;
  to: number;
  /** The smaller and the larger of the two rounds (the earlier and the later round of the transition). */
  earlier: number;
  later: number;
  direction: Direction;
  /** Clock reading at the request (t = 0). */
  startMs: number;
}

export interface PlaybackState {
  /** The displayed round N: the panel, the controls, the address and the pointer readout use it (FR-186). */
  displayed: number;
  running: RunningStep | undefined;
  /** Frozen forward progress of the address parameter `transition`, between rounds N - 1 and N (FR-191). */
  frozen: number | undefined;
}

/** The state after load (FR-178): round `displayed`, optionally frozen at a forward progress (FR-191). */
export function startPlayback(displayed: number, frozen?: number): PlaybackState {
  if (!Number.isInteger(displayed) || displayed < 0) throw new RangeError('The displayed round must be a whole number from 0');
  if (frozen !== undefined) {
    if (displayed < 1) throw new RangeError('A frozen progress needs a displayed round of at least 1');
    if (!(frozen >= 0 && frozen <= 1)) throw new RangeError('The frozen progress must be a number from 0 to 1');
  }
  return { displayed, running: undefined, frozen };
}

export interface RequestOutcome {
  state: PlaybackState;
  /** 'none': nothing changes; 'instant': draw the new round at once; 'step': a step has started. */
  change: 'none' | 'instant' | 'step';
  /** A running step was completed at once before the request was handled (FR-183). */
  completed: boolean;
  /** The frozen progress was left for the full state of round N: the address drops `transition` (FR-194). */
  unfroze: boolean;
}

/**
 * Handles a request for round `target` at clock reading `nowMs`. A request for the displayed round is no
 * change, whatever is running (FR-178, decision U4). Otherwise a running step completes (FR-183), a frozen
 * progress is left (FR-194), and a change of one round plays unless `reduced` (FR-176, FR-177); any other
 * change is instant (FR-178). The displayed round is the target in the returned state (FR-186).
 */
export function request(state: PlaybackState, target: number, nowMs: number, reduced: boolean): RequestOutcome {
  if (!Number.isInteger(target) || target < 0) throw new RangeError('The requested round must be a whole number from 0');
  if (target === state.displayed) return { state, change: 'none', completed: false, unfroze: false };
  const completed = state.running !== undefined;
  const unfroze = state.frozen !== undefined;
  const from = state.displayed;
  if (reduced || Math.abs(target - from) !== 1) {
    return { state: { displayed: target, running: undefined, frozen: undefined }, change: 'instant', completed, unfroze };
  }
  const running: RunningStep = {
    from,
    to: target,
    earlier: Math.min(from, target),
    later: Math.max(from, target),
    direction: target > from ? 'forward' : 'backward',
    startMs: nowMs,
  };
  return { state: { displayed: target, running, frozen: undefined }, change: 'step', completed, unfroze };
}

/** What a frame draws: the displayed round as it is, or the step between two rounds at forward progress f. */
export type Drawing =
  | { shape: 'whole' }
  | { shape: 'step'; earlier: number; later: number; forward: number };

export interface FrameOutcome {
  state: PlaybackState;
  drawing: Drawing;
  /** True only on the frame that ended the running step: the caller releases the step data (FR-187). */
  finished: boolean;
}

/**
 * The drawing at clock reading `nowMs`. A running step draws f from t = nowMs - startMs and, at the first
 * frame with t >= Dt, ends and draws the whole displayed round (FR-182); a frozen progress draws its
 * f with no clock (FR-191); otherwise the whole round.
 */
export function frame(state: PlaybackState, nowMs: number, durationMs: number): FrameOutcome {
  const run = state.running;
  if (run !== undefined) {
    const { p, done } = progressAt(nowMs - run.startMs, durationMs);
    if (done) {
      return { state: { displayed: state.displayed, running: undefined, frozen: undefined }, drawing: { shape: 'whole' }, finished: true };
    }
    return {
      state,
      drawing: { shape: 'step', earlier: run.earlier, later: run.later, forward: forwardOf(p, run.direction) },
      finished: false,
    };
  }
  if (state.frozen !== undefined) {
    return { state, drawing: { shape: 'step', earlier: state.displayed - 1, later: state.displayed, forward: state.frozen }, finished: false };
  }
  return { state, drawing: { shape: 'whole' }, finished: false };
}

/** The reduced-motion preference changed: a running step completes at once (FR-184). */
export function motionChanged(state: PlaybackState): { state: PlaybackState; completed: boolean } {
  if (state.running === undefined) return { state, completed: false };
  return { state: { displayed: state.displayed, running: undefined, frozen: undefined }, completed: true };
}
