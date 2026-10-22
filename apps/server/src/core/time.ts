// Core time rules (spec 008 FR-239, FR-249, FR-302, NFR-50). Pure: time enters only as a number argument
// (a clock reading in ms); nothing here reads a clock, a timer or a random source (FR-314).

import type { Stage, StepKind, Timing } from '@mbrg/protocol';
import type { StepCause } from './view';

/** The scheduling tolerance of NFR-50 and of "on time / overdue" (spec Definitions), in ms. */
export const TOLERANCE_MS = 1000;

/** The schedule anchors of the pending round, instants in whole ms (spec Definitions "Schedule anchors"). */
export interface Anchors {
  readonly t0: number;
  readonly c1: number;
  readonly c2: number;
  readonly a: number;
}

/** Timing values are whole seconds; instants are whole milliseconds. */
export const toMs = (seconds: number): number => seconds * 1000;

/** An instant as a whole number of ms: a finite clock reading is floored; anything else is rejected. */
export function wholeMs(reading: number): number {
  if (typeof reading !== 'number' || !Number.isFinite(reading)) throw new RangeError('an instant must be a finite number');
  return Math.floor(reading);
}

/** C1 = t0 + I - L1 - L2, C2 = C1 + L1, A = C2 + L2 = t0 + I (host settings only; `manual` has no anchors). */
export function anchorsFrom(t0: number, timing: Timing): Anchors | null {
  if (timing === 'manual') return null;
  const start = wholeMs(t0);
  const c1 = start + toMs(timing.i - timing.l1 - timing.l2);
  const c2 = c1 + toMs(timing.l1);
  return { t0: start, c1, c2, a: c2 + toMs(timing.l2) };
}

/**
 * The anchors after a step performed at `instant` (FR-244, FR-248). An on-time clock step keeps the anchors, except an
 * application, which anchors the next round at its instant; a manual or late step shifts them from `instant`:
 * (a) phase-1 close: C2 = t + L1, A = t + L1 + L2; (b) phase-2 close: A = t + L2; (c) application: t0 = t.
 */
export function anchorsAfterStep(current: Anchors | null, step: StepKind, instant: number, cause: StepCause, timing: Timing): Anchors | null {
  if (timing === 'manual' || current === null) return null;
  const t = wholeMs(instant);
  if (step === 'application') return anchorsFrom(t, timing);
  if (cause === 'clock') return current;
  if (step === 'phase-1-close') return { ...current, c2: t + toMs(timing.l1), a: t + toMs(timing.l1 + timing.l2) };
  return { ...current, a: t + toMs(timing.l2) };
}

/** Effective instant of a match: max(clock reading, last step instant) (FR-249); a backward clock never lowers it. */
export function effectiveInstant(reading: number, lastStepMs: number): number {
  return Math.max(wholeMs(reading), lastStepMs);
}

/**
 * Reported time (FR-302, Definitions): max(effective instant, the largest reported time already sent). The caller
 * keeps `sentMax` per match (0 before the first reply); the result becomes the new `sentMax`.
 */
export function reportedTime(effective: number, sentMax: number): number {
  return Math.max(effective, sentMax);
}

/** On time: performed at most TOLERANCE_MS after the scheduled instant; overdue otherwise (NFR-50). */
export const isOnTime = (scheduled: number, performed: number): boolean => performed - scheduled <= TOLERANCE_MS;

export interface DueStep {
  readonly kind: StepKind;
  readonly scheduled: number;
  /** The instant the step is stored with: its scheduled instant when on time, else the effective instant (FR-248). */
  readonly instant: number;
  readonly cause: 'clock' | 'late';
}

const NEXT_STEP: Partial<Record<Stage, { kind: StepKind; anchor: 'c1' | 'c2' | 'a' }>> = {
  'phase-1': { kind: 'phase-1-close', anchor: 'c1' },
  'phase-2': { kind: 'phase-2-close', anchor: 'c2' },
  locked: { kind: 'application', anchor: 'a' },
};

/**
 * The one step due at `effective`, or null (FR-239): never before its scheduled instant, exactly the next step of the
 * stage, never several. Only for a running match with a clock.
 */
export function dueStep(stage: Stage, anchors: Anchors | null, effective: number): DueStep | null {
  const next = NEXT_STEP[stage];
  if (next === undefined || anchors === null) return null;
  const scheduled = anchors[next.anchor];
  if (effective < scheduled) return null;
  const onTime = isOnTime(scheduled, effective);
  return { kind: next.kind, scheduled, instant: onTime ? scheduled : effective, cause: onTime ? 'clock' : 'late' };
}

/** The last step instant after storing a step row at `instant`; it never decreases (FR-249). */
export function lastStepAfter(lastStepMs: number, instant: number): number {
  const t = wholeMs(instant);
  if (t < lastStepMs) throw new RangeError('a step instant must not be below the last step instant');
  return t;
}
