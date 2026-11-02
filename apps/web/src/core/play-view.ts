// What the match screen shows for the player (spec 013 FR-401 to FR-407, FR-397): one immutable state of the player's session and one
// pure function from that state and the live model to the data the panel draws. The shell (`ui/play-session.ts`) owns the calls and
// the timers; every transition of the state and every sentence is here. No DOM, no network, no token.
import type { LeaderboardRow, OwnPrediction, PlayerResult, PredictionReply } from '@mbrg/protocol';
import { estimateAt, type LiveModel } from './live-model';
import { countdownTime, scheduleOf } from './live-text';
import type { FactionName } from './live-view';
import { bookAfterReply, bookFromOwn, emptyBook, offerOf, offerText, sentFor, sentText, type Book, type Offer } from './predict-model';
import {
  boardPage,
  chipText,
  latestScored,
  rankOf,
  resultFor,
  resultView,
  scoredKey,
  winnersView,
  type BoardPage,
  type ResultView,
  type Scored,
  type WinnersView,
} from './results-model';

export interface PlayState {
  readonly book: Book;
  readonly sending: boolean;
  readonly notice: string | undefined;
  /** The player's scored rows and total as last read; undefined before the first read. */
  readonly scores: { readonly total: number; readonly items: readonly PlayerResult[]; readonly name: string | undefined } | undefined;
  /** The scored phase the results panel talks about. */
  readonly scored: Scored | undefined;
  readonly rows: readonly LeaderboardRow[] | undefined;
  readonly boardPage: number;
  /** The names that guessed a scored phase right, by `round:phase`. */
  readonly winners: ReadonlyMap<string, readonly string[]>;
  readonly expanded: ReadonlySet<string>;
  readonly winnersPage: ReadonlyMap<string, number>;
}

export const initialPlay: PlayState = {
  book: emptyBook,
  sending: false,
  notice: undefined,
  scores: undefined,
  scored: undefined,
  rows: undefined,
  boardPage: 0,
  winners: new Map(),
  expanded: new Set(),
  winnersPage: new Map(),
};

export const withOwn = (state: PlayState, items: readonly OwnPrediction[]): PlayState => ({ ...state, book: bookFromOwn(items) });
/** FR-401: the server stored the choice; FR-404 the notice of an earlier failure goes away. */
export const withReply = (state: PlayState, reply: PredictionReply): PlayState => ({ ...state, book: bookAfterReply(state.book, reply), sending: false, notice: undefined });
export const withSending = (state: PlayState, sending: boolean): PlayState => ({ ...state, sending });
export const withNotice = (state: PlayState, notice: string | undefined): PlayState => ({ ...state, notice, sending: false });

/** FR-406: the player's scored rows; the panel talks about `scored` when given, else about the latest scored phase of the rows. */
export function withScores(state: PlayState, scores: NonNullable<PlayState['scores']>, scored?: Scored): PlayState {
  return { ...state, scores, scored: scored ?? latestScored(scores.items) ?? state.scored };
}
export const withBoard = (state: PlayState, rows: readonly LeaderboardRow[]): PlayState => ({ ...state, rows });
export const withWinners = (state: PlayState, scored: Scored, names: readonly string[]): PlayState => ({ ...state, winners: new Map(state.winners).set(scoredKey(scored), names) });
export function toggleWinners(state: PlayState, key: string): PlayState {
  const expanded = new Set(state.expanded);
  if (!expanded.delete(key)) expanded.add(key);
  return { ...state, expanded, winnersPage: new Map(state.winnersPage).set(key, 0) };
}
export const pageWinners = (state: PlayState, key: string, delta: number): PlayState => ({ ...state, winnersPage: new Map(state.winnersPage).set(key, Math.max(0, (state.winnersPage.get(key) ?? 0) + delta)) });
export const pageBoard = (state: PlayState, delta: number): PlayState => ({ ...state, boardPage: Math.max(0, state.boardPage + delta) });

export interface ChoiceView {
  readonly faction: number;
  readonly name: string;
  readonly selected: boolean;
}

export interface PredictView {
  readonly title: string;
  readonly line: string;
  /** The factions to choose from, in order; empty when nothing can be chosen. */
  readonly choices: readonly ChoiceView[];
  /** The "already predicted" seal, or undefined. */
  readonly seal: string | undefined;
  readonly notice: string | undefined;
  readonly sending: boolean;
  /** The countdown of the open phase (`M:SS`), from the server clock offset. */
  readonly countdown: string | undefined;
}

export interface WinnersLine {
  readonly key: string;
  readonly phase: 1 | 2;
  readonly view: WinnersView;
}

export interface PlayHud {
  /** The player chip of the top bar; undefined for a viewer who did not join. */
  readonly chip: string | undefined;
  readonly predict: PredictView | undefined;
  readonly result: ResultView | undefined;
  readonly board: BoardPage | undefined;
  /** FR-407: the lines under the chronicle entry of each round. */
  readonly winners: ReadonlyMap<number, readonly WinnersLine[]>;
}

export interface PlayInput {
  readonly state: PlayState;
  readonly model: LiveModel;
  /** The joined player, or undefined for a spectator. */
  readonly player: { readonly playerId: string } | undefined;
  readonly factions: readonly FactionName[];
  /** A victim reveal tour is running (FR-409): no choice is offered for the absorber yet. */
  readonly revealing: boolean;
  readonly at: number;
}

const localName = (playerId: string): string => playerId.slice(playerId.indexOf(':') + 1);

/** The offer of the screen for the model and the player (the one place that combines the live model with `predict-model`). */
export const offerFor = (model: LiveModel, joined: boolean, revealing: boolean): Offer => offerOf(model, { joined, revealing });

export function playHud(input: PlayInput): PlayHud {
  const { state, model, player, factions } = input;
  const nameOf = (faction: number): string => factions.find((f) => f.id === faction)?.name ?? String(faction);
  const rank = player === undefined || state.rows === undefined ? undefined : rankOf(state.rows, player.playerId);
  const myName = player === undefined ? undefined : (state.scores?.name ?? state.rows?.find((r) => r.playerId === player.playerId)?.name ?? localName(player.playerId));
  const chip = player === undefined || myName === undefined ? undefined : chipText(myName, state.scored === undefined ? undefined : state.scores?.total, rank);

  const offer = offerFor(model, player !== undefined, input.revealing);
  let predict: PredictView | undefined;
  if (player !== undefined || state.notice !== undefined) {
    const text = offerText(offer, nameOf);
    const choiceList = offer.type === 'victim' || offer.type === 'absorber' ? offer.choices : [];
    const chosen = sentFor(state.book, offer);
    const open = offer.type === 'victim' || offer.type === 'absorber' || offer.type === 'forced';
    predict = {
      title: text.title,
      line: text.line,
      choices: choiceList.map((faction) => ({ faction, name: nameOf(faction), selected: faction === chosen })),
      seal: chosen === undefined ? undefined : sentText(nameOf(chosen)),
      notice: state.notice,
      sending: state.sending,
      countdown: open ? countdownTime(model.stage, model.timing, scheduleOf(model.stage, model.schedule, model.victim), estimateAt(model, input.at)) : undefined,
    };
  }

  const result =
    player === undefined || state.scored === undefined || state.scores === undefined
      ? undefined
      : resultView({ scored: state.scored, item: resultFor(state.scores.items, state.scored), total: state.scores.total, rank, nameOf, forced: model.victim?.round === state.scored.round && model.victim.forced === true });

  const lines = new Map<number, WinnersLine[]>();
  for (const [key, names] of state.winners) {
    const [round, phase] = key.split(':').map(Number) as [number, 1 | 2];
    const view = winnersView(phase, names, state.expanded.has(key), state.winnersPage.get(key) ?? 0);
    lines.set(round, [...(lines.get(round) ?? []), { key, phase, view }].sort((a, b) => a.phase - b.phase));
  }
  const board = state.rows === undefined ? undefined : boardPage(state.rows, player?.playerId ?? '', state.boardPage);
  return { chip, predict, result, board, winners: lines };
}

