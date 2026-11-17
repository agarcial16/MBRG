// From a server event to what the channel is told (spec 012 FR-453, FR-456, NFR-88). Pure: the follow state, the names and the
// viewer address come in as parameters. The bot reads only public events; the only data it asks for besides them is named by
// `needOf` and concerns an applied round or a scored phase, never a future one.
import type { MatchEvent } from '@mbrg/protocol';
import { boardView } from './board';
import { PREDICT_ID, START_ID } from './custom-ids';
import { appliedEmbed, finishedEmbed, forcedEmbed, haltedEmbed, openedEmbed, scoredEmbed, victimEmbed } from './embeds';
import type { ButtonSpec, OutMessage } from './model';
import type { NameBook } from './names';
import { winnersText } from './results';
import type { Winners } from './results';
import type { LeaderboardRow } from '@mbrg/protocol';
import type { Followed } from './state';
import { STRINGS, fill } from './strings';

/** The extra public read an event needs before it can be announced. */
export type Need =
  | { readonly type: 'none' }
  | { readonly type: 'left'; readonly round: number }
  | { readonly type: 'winners'; readonly round: number; readonly phase: 1 | 2 }
  | { readonly type: 'board' };

export interface Extras {
  readonly left?: number;
  readonly winners?: Winners;
  /** Every row of the final leaderboard (FR-467, FR-478): the first page is posted, the rest is paged. */
  readonly board?: readonly LeaderboardRow[];
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
    case 'match-finished':
      return { type: 'board' };
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
    url.searchParams.set('spectate', '1');
    return url.toString();
  } catch {
    return undefined;
  }
}

const withLink = (buttons: ButtonSpec[], url: string | undefined): ButtonSpec[] => (url === undefined ? buttons : [...buttons, { type: 'link', url, label: STRINGS.viewerButton }]);

const predictButton: ButtonSpec = { type: 'custom', customId: PREDICT_ID, label: STRINGS.predictButton, style: 'primary' };

/** The lobby link (spec 021 FR-527): only the match id, NOT spectator-marked, so the viewer shows its waiting screen. */
export function lobbyLink(base: string | undefined, matchId: string): string | undefined {
  if (base === undefined) return undefined;
  try {
    const url = new URL(base);
    url.searchParams.set('match', matchId);
    return url.toString();
  } catch {
    return undefined;
  }
}

/** The lobby message of a created match: name (its id), map, the Start button (FR-451) and the viewer link (spec 021 FR-526). */
export const lobbyMessage = (matchId: string, mapId: string, viewerUrl?: string): OutMessage => ({
  text: fill(STRINGS.lobby, { match: matchId, map: mapId }),
  buttons: withLink([{ type: 'custom', customId: START_ID, label: STRINGS.startButton, style: 'success' }], lobbyLink(viewerUrl, matchId)),
});

/** The messages of one event, in order (none for an event the channel is not told about). */
export function buildAnnouncement(event: MatchEvent, ctx: AnnounceContext, extras: Extras = {}): OutMessage[] {
  const { follow, names } = ctx;
  switch (event.type) {
    case 'schedule': {
      if (event.stage !== 'phase-1') return [];
      const round = follow.appliedRounds + 1;
      return [{ text: fill(STRINGS.roundOpened, { round }), embed: openedEmbed(round), buttons: withLink([predictButton], viewerLink(ctx.viewerUrl, follow.matchId, round)) }];
    }
    case 'victim-revealed': {
      const victim = names.nameOf(event.victim);
      if (event.forced === true) {
        const only = event.candidates[0];
        const absorber = only === undefined ? undefined : names.nameOf(only);
        return [{ text: fill(STRINGS.victimForced, { round: event.round, victim, absorber: absorber ?? '' }), embed: forcedEmbed(event.round, victim, absorber), buttons: [] }];
      }
      return [{ text: fill(STRINGS.victimRevealed, { round: event.round, victim }), embed: victimEmbed(event.round, victim), buttons: withLink([predictButton], viewerLink(ctx.viewerUrl, follow.matchId, event.round)) }];
    }
    case 'round-applied': {
      const left = extras.left === undefined ? '' : extras.left === 1 ? STRINGS.factionsLeftOne : fill(STRINGS.factionsLeftMany, { n: extras.left });
      const victim = names.nameOf(event.record.eliminated);
      const absorber = names.nameOf(event.record.absorber);
      const text = fill(STRINGS.roundApplied, { round: event.round, victim, absorber, left });
      return [{ text: text.trim(), embed: appliedEmbed(event.round, victim, absorber, extras.left), buttons: [] }];
    }
    case 'results':
      return extras.winners === undefined ? [] : [{ text: winnersText(event.phase, extras.winners), embed: scoredEmbed(event.round, event.phase, extras.winners), buttons: [] }];
    case 'match-finished': {
      const name = names.nameOf(event.winner);
      const winner: OutMessage = { text: fill(STRINGS.matchFinished, { winner: name }), embed: finishedEmbed(name), buttons: [] };
      // The public leaderboard, page 1, follows the winner (FR-478): no asker, so each presser pages for themselves (FR-480).
      return extras.board === undefined ? [winner] : [winner, boardView(extras.board, 1, { matchId: follow.matchId, kind: 'final' }).message];
    }
    case 'match-halted':
      return [{ text: fill(STRINGS.matchHalted, { round: event.round }), embed: haltedEmbed(event.round), buttons: [] }];
    default:
      return [];
  }
}

const secondsUntil = (anchor: number, reportedTime: number): number | undefined => {
  const left = Math.ceil((anchor - reportedTime) / 1000);
  return left > 0 ? left : undefined;
};

/**
 * Seconds left in the phase an event opens, from the server's own schedule (FR-465): the anchor C1 of a phase-1 schedule or
 * C2 of a free victim reveal, minus the server time the event reports. None for any other event, a forced reveal, a manual
 * timing (no anchors) or an anchor already past.
 */
export function openPhaseSeconds(event: MatchEvent): number | undefined {
  if (event.type === 'schedule' && event.stage === 'phase-1' && event.schedule !== undefined) return secondsUntil(event.schedule.c1, event.reportedTime);
  if (event.type === 'victim-revealed' && event.forced !== true && event.c2 !== null) return secondsUntil(event.c2, event.reportedTime);
  return undefined;
}

/** Whether this event ends the open phase whose message counts down (the phase closes, the round or the match moves on). */
export const closesPhase = (event: MatchEvent): boolean =>
  event.type === 'phase-closed' ||
  event.type === 'victim-revealed' ||
  event.type === 'round-applied' ||
  event.type === 'match-finished' ||
  event.type === 'match-halted' ||
  (event.type === 'schedule' && event.stage !== 'phase-2');

/** The seconds between two edits of the countdown. */
export const COUNTDOWN_STEP = 1;

/** The open-phase message with the seconds left in the label of its Predict button; the text and the other buttons stay (FR-465). */
export const countdownMessage = (base: OutMessage, secondsLeft: number): OutMessage => ({
  ...base,
  buttons: base.buttons.map((b) => (b.type === 'custom' && b.customId === PREDICT_ID ? { ...b, label: fill(STRINGS.predictCountdown, { n: secondsLeft }) } : b)),
});

/** The open-phase message once the phase is over: its Predict button is disabled and says so; the link button stays (FR-465). */
export const closedMessage = (base: OutMessage): OutMessage => ({
  ...base,
  buttons: base.buttons.map((b) => (b.type === 'custom' && b.customId === PREDICT_ID ? { ...b, label: STRINGS.predictClosed, disabled: true } : b)),
});

/** Whether announcing this event ends the following (the match is over for the channel). */
export const endsFollowing = (event: MatchEvent): boolean => event.type === 'match-finished' || event.type === 'match-halted';
