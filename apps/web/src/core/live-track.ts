// The live and replay marks of the match screen (spec 010 FR-363, FR-364): the "live" mark, the band that says the view is not
// live, and the track of rounds. Pure: the shell draws what these functions return and sends the target they name.
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

export type RoundTrack =
  | { readonly mode: 'dots'; readonly items: readonly Dot[] }
  | { readonly mode: 'slider'; readonly min: number; readonly max: number; readonly value: number; readonly live: number; readonly total: number };

/**
 * The track of rounds. Up to 12 rounds: one dot per round 1 to `total` (round 0 is the "Primera" control), past before the round
 * on the map, ahead of it up to the live round, future beyond it. Above 12 rounds: a slider from 0 to the live round (never beyond N).
 */
export function roundTrack(total: number, displayed: number, applied: number): RoundTrack {
  if (total > MAX_DOTS) return { mode: 'slider', min: 0, max: applied, value: displayed, live: applied, total };
  const items: Dot[] = [];
  for (let round = 1; round <= total; round++) {
    const state: DotState = round === displayed ? 'current' : round < displayed ? 'past' : round <= applied ? 'ahead' : 'future';
    items.push({ round, state, live: round === applied });
  }
  return { mode: 'dots', items };
}

/** Where a dot leads: the jump to its round, or nothing for a round that has not been played. */
export const trackTarget = (dot: Dot): NavAction | undefined => (dot.state === 'future' ? undefined : { to: dot.round });
