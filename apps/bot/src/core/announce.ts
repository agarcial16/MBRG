// From a server event to what the channel is told (spec 012 FR-453, FR-456, NFR-88). Pure: the follow state, the names and the
// viewer address come in as parameters. The bot reads only public events; the only data it asks for besides them is named by
// `needOf` and concerns an applied round or a scored phase, never a future one.
import type { MatchEvent } from '@mbrg/protocol';
import { PREDICT_ID, START_ID } from './custom-ids';
import type { ButtonSpec, OutMessage } from './model';
import type { NameBook } from './names';
import { winnersText } from './results';
import type { Winners } from './results';
import type { Followed } from './state';
import { STRINGS, fill } from './strings';

/** The extra public read an event needs before it can be announced. */
export type Need =
  | { readonly type: 'none' }
  | { readonly type: 'left'; readonly round: number }
  | { readonly type: 'winners'; readonly round: number; readonly phase: 1 | 2 };

export interface Extras {
  readonly left?: number;
  readonly winners?: Winners;
}

export interface AnnounceContext {
  readonly follow: Followed;
  readonly names: NameBook;
  /** The viewer's base address; none: no link (FR-462). */
  readonly viewerUrl?: string;
}

const NONE: Need = { type: 'none' };

export function needOf(event: MatchEvent, follow: Followed): Need {
  switch (event.type) {
    case 'round-applied':
      return { type: 'left', round: event.round };
    case 'results':
      // The absorber of a forced round is never scored: its phase 2 has no results to announce.
      if (event.phase === 2 && follow.forcedRound === event.round) return NONE;
      return { type: 'winners', round: event.round, phase: event.phase };
    default:
      return NONE;
  }
}

/** The follow entry after the event is announced: its number, the applied rounds and the forced round. */
export function advanceFollow(follow: Followed, event: MatchEvent | { readonly type: 'unknown'; readonly seq: number }): Followed {
  let next: Followed = { ...follow, lastSeq: Math.max(follow.lastSeq, event.seq) };
  if (event.type === 'round-applied') next = { ...next, appliedRounds: event.round };
  if (event.type === 'victim-revealed' && event.forced === true) next = { ...next, forcedRound: event.round };
  return next;
}

/** The viewer link at a round (FR-462): none without a configured base address. */
export function viewerLink(base: string | undefined, matchId: string, round: number): string | undefined {
  if (base === undefined) return undefined;
  try {
    const url = new URL(base);
    url.searchParams.set('match', matchId);
    url.searchParams.set('round', String(round));
    return url.toString();
  } catch {
    return undefined;
  }
}

const withLink = (buttons: ButtonSpec[], url: string | undefined): ButtonSpec[] => (url === undefined ? buttons : [...buttons, { type: 'link', url, label: STRINGS.viewerButton }]);

const predictButton: ButtonSpec = { type: 'custom', customId: PREDICT_ID, label: STRINGS.predictButton, style: 'primary' };

/** The lobby message of a created match: name (its id), map and the Start button (FR-451). */
export const lobbyMessage = (matchId: string, mapId: string): OutMessage => ({
  text: fill(STRINGS.lobby, { match: matchId, map: mapId }),
  buttons: [{ type: 'custom', customId: START_ID, label: STRINGS.startButton, style: 'success' }],
});

/** The messages of one event, in order (none for an event the channel is not told about). */
export function buildAnnouncement(event: MatchEvent, ctx: AnnounceContext, extras: Extras = {}): OutMessage[] {
  const { follow, names } = ctx;
  switch (event.type) {
    case 'schedule': {
      if (event.stage !== 'phase-1') return [];
      const round = follow.appliedRounds + 1;
      return [{ text: fill(STRINGS.roundOpened, { round }), buttons: withLink([predictButton], viewerLink(ctx.viewerUrl, follow.matchId, round)) }];
    }
    case 'victim-revealed': {
      const victim = names.nameOf(event.victim);
      if (event.forced === true) {
        const only = event.candidates[0];
        return [{ text: fill(STRINGS.victimForced, { round: event.round, victim, absorber: only === undefined ? '' : names.nameOf(only) }), buttons: [] }];
      }
      return [{ text: fill(STRINGS.victimRevealed, { round: event.round, victim }), buttons: withLink([predictButton], viewerLink(ctx.viewerUrl, follow.matchId, event.round)) }];
    }
    case 'round-applied': {
      const left = extras.left === undefined ? '' : extras.left === 1 ? STRINGS.factionsLeftOne : fill(STRINGS.factionsLeftMany, { n: extras.left });
      const text = fill(STRINGS.roundApplied, { round: event.round, victim: names.nameOf(event.record.eliminated), absorber: names.nameOf(event.record.absorber), left });
      return [{ text: text.trim(), buttons: [] }];
    }
    case 'results':
      return extras.winners === undefined ? [] : [{ text: winnersText(event.phase, extras.winners), buttons: [] }];
    case 'match-finished':
      return [{ text: fill(STRINGS.matchFinished, { winner: names.nameOf(event.winner) }), buttons: [] }];
    case 'match-halted':
      return [{ text: fill(STRINGS.matchHalted, { round: event.round }), buttons: [] }];
    default:
      return [];
  }
}

/** Whether announcing this event ends the following (the match is over for the channel). */
export const endsFollowing = (event: MatchEvent): boolean => event.type === 'match-finished' || event.type === 'match-halted';
