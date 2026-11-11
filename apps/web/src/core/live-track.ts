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
  /** The displayed round, compact: "Ronda N" (never with the total), or the start before round 1. */
  readonly label: string;
}

/**
 * The selector of rounds (FR-364, amended by FR-442): the entry for the state before round 1 (round 0, "Inicio", FR-444), the rounds already played (1 to `applied`) and, while a round is in play, that
 * round (`applied + 1`, not a target yet). The rounds beyond it are not listed, so the total is not told before the match is over.
 * `past` is before the round on the map, `ahead` after it up to the live round, `future` the round in play. Always one list: the
 * shell scrolls it sideways, however many rounds there are. The "Primera" control goes to round 0 too.
 */
export function roundTrack(total: number, displayed: number, applied: number, inPlay: boolean): RoundTrack {
  const last = inPlay && applied < total ? applied + 1 : applied;
  const items: Dot[] = [];
  for (let round = 0; round <= last; round++) {
    const state: DotState = round === displayed ? 'current' : round < displayed ? 'past' : round <= applied ? 'ahead' : 'future';
    items.push({ round, state, live: round === applied });
  }
  return { items, label: displayed < 1 ? STRINGS.hudTrackStart : fillTemplate(STRINGS.roundNow, { round: displayed }) };
}

/** The scroll position (px) that centres an item in a strip, kept inside the content. */
export function stripScroll(box: { readonly left: number; readonly width: number; readonly view: number; readonly content: number }): number {
  const centred = box.left - (box.view - box.width) / 2;
  return Math.max(0, Math.min(centred, box.content - box.view));
}

/** Where a dot leads: the jump to its round, or nothing for a round that has not been played. */
export const trackTarget = (dot: Dot): NavAction | undefined => (dot.state === 'future' ? undefined : { to: dot.round });
