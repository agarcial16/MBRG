// The live and replay marks of the match screen (spec 010 FR-363, FR-364): the "live" mark, the band that says the view is not
// live, and the selector of rounds. Pure: the shell draws what these functions return and sends the target they name.
import { hudState } from './live-hud';
import type { LiveModel } from './live-model';
import type { NavAction } from './navigation';
import { STRINGS, fillTemplate } from './strings';

/** From this many rounds the track is a slider instead of one dot per round (FR-364). */
export const MAX_DOTS = 12;

/** "En directo" while the live round is on the map; none in a replay, while reconnecting, or when the match is over. */
export const liveMark = (model: LiveModel): string | undefined => (hudState(model) === 'live' ? STRINGS.hudLive : undefined);

export interface ReplayBand {
  readonly text: string;
  readonly action: string;
  /** The way back: the jump to the live round. */
  readonly target: NavAction;
}

/** The band of a replay: the round on the map, the live round and the way back. None when the view is not an earlier round. */
export function replayBand(model: LiveModel): ReplayBand | undefined {
  if (hudState(model) !== 'replay' || model.displayed === undefined) return undefined;
  return { text: fillTemplate(STRINGS.hudReplay, { round: model.displayed, live: model.applied }), action: STRINGS.hudBackToLive, target: 'last' };
}

export type DotState = 'past' | 'current' | 'ahead' | 'future';

export interface Dot {
  readonly round: number;
  readonly state: DotState;
  /** This is the live round. */
  readonly live: boolean;
}

export interface RoundTrack {
  readonly items: readonly Dot[];
}

/**
 * The selector of rounds (FR-364, amended by FR-442): the entry for the state before round 1 (round 0, "Inicio", FR-444), the rounds already played (1 to `applied`) and, while a round is in play, that
 * round (`applied + 1`, not a target yet). The rounds beyond it are not listed, so the total is not told before the match is over.
 * `past` is before the round on the map, `ahead` after it up to the live round, `future` the round in play. The "Primera" control goes to round 0 too.
 */
export function roundTrack(total: number, displayed: number, applied: number, inPlay: boolean): RoundTrack {
  const last = inPlay && applied < total ? applied + 1 : applied;
  const items: Dot[] = [];
  for (let round = 0; round <= last; round++) {
    const state: DotState = round === displayed ? 'current' : round < displayed ? 'past' : round <= applied ? 'ahead' : 'future';
    items.push({ round, state, live: round === applied });
  }
  return { items };
}

/** Where a dot leads: the jump to its round, or nothing for a round that has not been played. */
export const trackTarget = (dot: Dot): NavAction | undefined => (dot.state === 'future' ? undefined : { to: dot.round });

export interface TrackMetrics {
  readonly slotPx: number;
  readonly gapPx: number;
  readonly threeDigitExtraPx: number;
}

/** Button width and gap metrics used to compute dynamic window capacity N (spec 034 FR-660). */
export const TRACK_METRICS = {
  desk: { slotPx: 26, gapPx: 4, threeDigitExtraPx: 8 },
  phone: { slotPx: 36, gapPx: 4, threeDigitExtraPx: 6 },
} as const satisfies Record<'desk' | 'phone', TrackMetrics>;

/** Dynamic window capacity N: how many numbered round buttons fit in `availablePx` without overflow (FR-660). */
export function windowCapacity(availablePx: number, metrics: TrackMetrics, maxRound = 0): number {
  if (!Number.isFinite(availablePx) || availablePx <= 0) return 1;
  const slot = metrics.slotPx + (maxRound >= 100 ? metrics.threeDigitExtraPx : 0);
  const step = slot + metrics.gapPx;
  if (step <= 0) return 1;
  return Math.max(1, Math.floor((availablePx + metrics.gapPx) / step));
}

/** How many rounds a single window-pager arrow click shifts (keeps 1 overlap round when possible). */
export const windowPageStep = (capacity: number): number => Math.max(1, Math.floor(capacity) - 1);

/** Shifts the 1-based window offset by `delta` rounds, clamped to `[1, maxStart]` (FR-662). */
export function shiftWindow(offset: number, count: number, capacity: number, delta: number): number {
  if (count <= 0) return 0;
  const cap = Math.max(1, Math.floor(capacity));
  const maxStart = Math.max(1, count - cap + 1);
  const base = Number.isFinite(offset) && offset >= 1 ? Math.floor(offset) : maxStart;
  return Math.max(1, Math.min(maxStart, base + Math.trunc(delta)));
}

/** Converts a horizontal touch drag delta (px) into a round-window shift (negative dx = swipe left = newer rounds). */
export function swipeShift(dx: number, stepPx: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(stepPx) || stepPx <= 0) return 0;
  const threshold = Math.max(18, stepPx * 0.5);
  if (Math.abs(dx) < threshold) return 0;
  const rounds = Math.max(1, Math.round(Math.abs(dx) / stepPx));
  return dx < 0 ? rounds : -rounds;
}

export interface RoundWindow {
  /** Pinned round 0 ("Inicio") dot, always visible on the left (FR-661). */
  readonly start: Dot;
  /** Numbered round dots (1..last) currently visible in the sliding window (at most `capacity`). */
  readonly items: readonly Dot[];
  /** First numbered round shown (1-based), or 0 when there are no numbered rounds yet. */
  readonly offset: number;
  /** Total numbered rounds available (1..last, including in-play if active). */
  readonly count: number;
  readonly canShiftLeft: boolean;
  readonly canShiftRight: boolean;
  /** Compact label ("Ronda N"), "Ronda 0" at Inicio when applied >= 1, or "" when applied === 0. */
  readonly label: string;
  readonly canJump: boolean;
  /** Maximum jumpable round (`applied`), never `total` (FR-666). */
  readonly maxJump: number;
}

/**
 * Computes the sliding round window (spec 034 FR-660..FR-662, FR-666): round 0 ("Inicio") is pinned separately;
 * numbered rounds 1..last are sliced to at most `capacity` entries. When `followDisplayed` is true (default),
 * the window slides automatically if `displayed >= 1` falls outside it.
 */
export function roundWindow(
  total: number,
  displayed: number,
  applied: number,
  inPlay: boolean,
  capacity: number,
  currentOffset?: number,
  followDisplayed = true,
): RoundWindow {
  const safeApplied = Math.max(0, Math.floor(applied));
  const safeDisplayed = Math.max(0, Math.min(safeApplied, Math.floor(displayed)));
  const last = inPlay && safeApplied < total ? safeApplied + 1 : safeApplied;
  const cap = Math.max(1, Math.floor(capacity));
  const startDot: Dot = {
    round: 0,
    state: safeDisplayed === 0 ? 'current' : 'past',
    live: safeApplied === 0,
  };
  const label = safeApplied < 1 ? '' : fillTemplate(STRINGS.roundNow, { round: safeDisplayed });
  if (last <= 0) {
    return {
      start: startDot,
      items: [],
      offset: 0,
      count: 0,
      canShiftLeft: false,
      canShiftRight: false,
      label,
      canJump: false,
      maxJump: 0,
    };
  }
  const maxStart = Math.max(1, last - cap + 1);
  let offset = currentOffset === undefined || currentOffset < 1 ? maxStart : Math.max(1, Math.min(maxStart, Math.floor(currentOffset)));
  if (followDisplayed && safeDisplayed >= 1 && safeDisplayed <= last) {
    if (safeDisplayed < offset) offset = safeDisplayed;
    else if (safeDisplayed > offset + cap - 1) offset = safeDisplayed - cap + 1;
    offset = Math.max(1, Math.min(maxStart, offset));
  }
  const end = Math.min(last, offset + cap - 1);
  const items: Dot[] = [];
  for (let round = offset; round <= end; round++) {
    const state: DotState = round === safeDisplayed ? 'current' : round < safeDisplayed ? 'past' : round <= safeApplied ? 'ahead' : 'future';
    items.push({ round, state, live: round === safeApplied });
  }
  return {
    start: startDot,
    items,
    offset,
    count: last,
    canShiftLeft: offset > 1,
    canShiftRight: end < last,
    label,
    canJump: safeApplied >= 1,
    maxJump: safeApplied,
  };
}

export type JumpResult =
  | { readonly outcome: 'ok'; readonly round: number }
  | { readonly outcome: 'close' };

const JUMP_INT = /^[+-]?[0-9]+$/;

/** Strips all non-digit characters from a jump-to-round input string (FR-663). */
export const sanitizeJumpInput = (raw: string): string => raw.replace(/[^0-9]/g, '');

/**
 * Parses and clamps a jump-to-round input to `[0, applied]` (FR-663, FR-666):
 * below round 1 (0 or less) jumps to Inicio (0); above `applied` jumps to `applied`;
 * empty or non-numeric input closes without jumping.
 */
export function parseJumpRound(raw: string, applied: number): JumpResult {
  const max = Math.max(0, Math.floor(applied));
  const trimmed = raw.trim();
  if (!JUMP_INT.test(trimmed)) {
    return { outcome: 'close' };
  }
  const value = Number(trimmed);
  if (Number.isNaN(value)) {
    return { outcome: 'close' };
  }
  const round = value <= 0 ? 0 : value >= max ? max : Math.floor(value);
  return { outcome: 'ok', round };
}
