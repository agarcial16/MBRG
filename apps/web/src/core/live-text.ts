// The texts of the live panel (FR-305, NFR-56). Pure: every sentence comes from STRINGS (the strings module); the
// instants are parameters, so the same input always gives the same text.
import type { HaltReason, PublicSchedule, Stage, Timing } from '@mbrg/protocol';
import { STRINGS, fillTemplate } from './strings';

/** The error kinds of the live scene: English identifiers shown inside Spanish messages (NFR-28). */
export type LiveErrorKind = 'unknown-match' | 'digest-mismatch' | 'insecure-origin' | 'both' | 'need-match' | 'bad-match' | 'failure';

const STAGE_TEXTS: Readonly<Record<Stage, string>> = {
  'phase-1': STRINGS.liveStagePhase1,
  'phase-2': STRINGS.liveStagePhase2,
  locked: STRINGS.liveStageLocked,
  finished: STRINGS.liveStageFinished,
  halted: STRINGS.liveStageHalted,
};
const HALT_TEXTS: Readonly<Record<HaltReason, string>> = {
  'map-changed': STRINGS.liveHaltMapChanged,
  'isolated-faction': STRINGS.liveHaltIsolatedFaction,
  'victim-mismatch': STRINGS.liveHaltVictimMismatch,
};
const ERROR_TEXTS: Readonly<Record<LiveErrorKind, string>> = {
  'unknown-match': STRINGS.liveErrorUnknownMatch,
  'digest-mismatch': STRINGS.liveErrorDigestMismatch,
  'insecure-origin': STRINGS.liveErrorInsecureOrigin,
  both: STRINGS.liveErrorBoth,
  'need-match': STRINGS.liveErrorNeedMatch,
  'bad-match': STRINGS.liveErrorBadMatch,
  failure: STRINGS.liveErrorFailure,
};

/** The title of the live scene. */
export const liveTitle = (): string => STRINGS.liveTitle;

/** "Ronda N de T" for the displayed round. */
export const roundLine = (round: number, total: number): string => fillTemplate(STRINGS.roundStatus, { round, total });

/** The text of a stage (five texts). */
export const stageText = (stage: Stage): string => STAGE_TEXTS[stage];

/** The Spanish halted notice of a halt reason. */
export const haltText = (reason: HaltReason): string => HALT_TEXTS[reason];

/** The Spanish message of an error that ends the scene. */
export const errorText = (kind: LiveErrorKind): string => ERROR_TEXTS[kind];

/** The instant the countdown of a running stage runs to: C1 in `phase-1`, C2 in `phase-2`, A in `locked` (FR-305). */
export function nextAnchor(stage: Stage, schedule: PublicSchedule | undefined): number | undefined {
  if (schedule === undefined) return undefined;
  if (stage === 'phase-1') return schedule.c1;
  if (stage === 'phase-2') return schedule.c2;
  return stage === 'locked' ? schedule.a : undefined;
}

/** `M:SS` below one hour, `H:MM:SS` from one hour; whole seconds rounded up, never negative. */
export function formatCountdown(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/**
 * The countdown line to the next scheduled step, from the reported-time estimate (FR-302, FR-305): none with timing
 * `manual`, none without a schedule or outside the running stages; never negative.
 */
export function countdownText(stage: Stage, timing: Timing, schedule: PublicSchedule | undefined, estimate: number): string | undefined {
  const time = countdownTime(stage, timing, schedule, estimate);
  return time === undefined ? undefined : fillTemplate(STRINGS.liveCountdown, { time });
}

/** The same countdown as the time alone (`M:SS`), for the figure of the top bar. */
export function countdownTime(stage: Stage, timing: Timing, schedule: PublicSchedule | undefined, estimate: number): string | undefined {
  if (timing === 'manual') return undefined;
  const anchor = nextAnchor(stage, schedule);
  return anchor === undefined ? undefined : formatCountdown(anchor - estimate);
}

/**
 * The victim line: shown at once when the victim is known (D19), in `phase-2` and `locked` and in a halted match whose
 * victim was revealed; never in `phase-1` or `finished`. With `revealing` (a victim tour that has not stopped yet) it says
 * "revelando..." instead of the name.
 */
export function victimLine(
  stage: Stage,
  victim: number | undefined,
  nameOf: (faction: number) => string,
  revealing = false,
): string | undefined {
  const shown = stage === 'phase-2' || stage === 'locked' || stage === 'halted';
  if (!shown || victim === undefined) return undefined;
  // FR-330 (D19): while the victim tour has not stopped on the victim the name is not even looked up.
  if (revealing) return fillTemplate(STRINGS.liveVictimRevealing, { text: STRINGS.liveRevealing });
  return fillTemplate(STRINGS.liveVictim, { name: nameOf(victim) });
}

/** The label of the skip control of a tour (FR-341). */
export const skipLabel = (): string => STRINGS.tourSkip;

/** The development-only line that reports a skipped victim tour in the live panel (FR-320, D13). */
export const revealMismatchLine = (): string => STRINGS.liveRevealMismatch;

/** The winner line, only for a finished match. */
export function winnerLine(stage: Stage, winner: number | undefined, nameOf: (faction: number) => string): string | undefined {
  return stage === 'finished' && winner !== undefined ? fillTemplate(STRINGS.liveWinner, { name: nameOf(winner) }) : undefined;
}

/** The connection notice with the time left until the next attempt (`until` and `now` on the same clock, in ms). */
export const connectionNotice = (until: number, now: number): string =>
  fillTemplate(STRINGS.liveReconnecting, { time: formatCountdown(until - now) });
