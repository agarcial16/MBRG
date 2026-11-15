// Progress of a round step (FR-182). Pure: elapsed time and duration in, progress out; this module never
// reads a clock (NFR-33), the part that drives the frames passes the elapsed milliseconds in.
import { smoothstep } from './lines';

/** Forward when the displayed round goes up by one, backward when it goes down by one. */
export type Direction = 'forward' | 'backward';

export interface Progress {
  /** smoothstep(0, 1, t / Dt): 0 at the request, 1 once the step is done. */
  p: number;
  /** True at the first frame with t >= Dt, and at every later one. */
  done: boolean;
}

/** Progress after `elapsedMs` of a step lasting `durationMs`; a negative elapsed time is progress 0 (smoothstep clamps). */
export function progressAt(elapsedMs: number, durationMs: number): Progress {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) throw new RangeError('The duration must be a positive finite number');
  if (Number.isNaN(elapsedMs)) throw new RangeError('The elapsed time must be a number');
  return { p: smoothstep(0, 1, elapsedMs / durationMs), done: elapsedMs >= durationMs };
}

/** Forward progress f: p for a forward step, 1 - p for a backward one (f = 0 is the earlier round). */
export function forwardOf(p: number, direction: Direction): number {
  if (!(p >= 0 && p <= 1)) throw new RangeError('The progress must be a number from 0 to 1');
  return direction === 'forward' ? p : 1 - p;
}
