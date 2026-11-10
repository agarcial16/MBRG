// The player's session on the match screen (spec 013 FR-401 to FR-407, FR-397): the calls of predictions and results and the state they
// fill. Thin: every decision (what may be chosen, the body, the sentences, the lines shown) is in `core/predict-model`, `core/results-model`
// and `core/play-view`; this file runs the calls and keeps the state. The player token goes only to `PlayNet` (as `Authorization`) and is
// never logged, put in an address or kept anywhere but the browser storage the door already filled.
import type { LiveModel } from '../core/live-model';
import { noOfferText, pickFor, repeatsPick, submitFailure, type InFlight } from '../core/predict-model';
import {
  initialPlay,
  offerFor,
  pageBoard,
  pageWinners,
  playHud,
  toggleWinners,
  withBoard,
  withJoined,
  withNotice,
  withOwn,
  withPlayers,
  withReply,
  withScores,
  withSending,
  withWinners,
  type PlayHud,
  type PlayState,
} from '../core/play-view';
import type { PlayerCredentials } from '../core/play-token';
import type { FactionName } from '../core/live-view';
import { scoredKey, scoredOf, type Scored } from '../core/results-model';
import { STRINGS } from '../core/strings';
import type { PlayNet } from './live-net';
import type { PlayHandlers } from './live-panel';
import { personalBlock } from './play-join';

export interface PlaySessionDeps {
  readonly matchId: string;
  readonly net: PlayNet;
  /** The joined player of this browser, or undefined for a spectator. */
  readonly player: PlayerCredentials | undefined;
  readonly factions: readonly FactionName[];
  readonly pageUrl: string;
  readonly makeId: () => string;
  /** The state changed outside a panel refresh: the scene shows the panel again. */
  readonly changed: () => void;
}

/** The tour state of the screen: while a victim is revealed or an absorber is shown, scores that would give them away wait. */
export interface TourHold {
  readonly revealing: boolean;
  readonly absorbing: boolean;
  /** FR-409: the finalised beat runs, so the reveal has not started on screen and a read that could name it waits. */
  readonly finalised?: boolean;
}

export interface PlaySession {
  readonly handlers: PlayHandlers;
  /** The data the panel shows for this model and instant; it also starts the reads that are due (never while a reveal is held). */
  view(model: LiveModel, at: number, hold: TourHold): PlayHud;
  /** Every frame of the event stream: a `results` event makes the scores and the winners due. */
  onFrame(data: unknown): void;
  /** FR-401: a tap on the map named this faction (or none). */
  tap(faction: number | undefined): void;
}

export function createPlaySession(deps: PlaySessionDeps): PlaySession {
  let state: PlayState = initialPlay;
  let model: LiveModel | undefined;
  let hold: TourHold = { revealing: false, absorbing: false, finalised: false };
  const due: Scored[] = [];
  const asked = new Set<string>();
  const forcedRounds = new Set<number>();
  let offerKey = '';
  let started = false;
  let inFlight: InFlight | undefined;

  const set = (next: PlayState): void => {
    state = next;
    deps.changed();
  };

  /** FR-406: the player's rows and the board, for the phase `scored` (the panel talks about it). */
  async function readScores(scored: Scored | undefined): Promise<void> {
    if (deps.player !== undefined) {
      const mine = await deps.net.playerResults(deps.matchId, deps.player.playerId);
      if (mine.ok) state = withScores(state, mine.value, scored);
    }
    const board = await deps.net.leaderboard(deps.matchId);
    if (board.ok) state = withBoard(state, board.value);
    deps.changed();
  }

  /** `fresh`: a `results` event just announced the phase, so an earlier refusal no longer counts. */
  async function readWinners(scored: Scored, fresh = false): Promise<void> {
    const key = scoredKey(scored);
    if (asked.has(key) && !fresh) return;
    asked.add(key);
    const read = await deps.net.winners(deps.matchId, scored.round, scored.phase);
    // An unscored or forced phase is refused by the server: no line (FR-407).
    if (read.ok) set(withWinners(state, scored, read.value.map((w) => w.name)));
  }

  /** Reads that are due and allowed: nothing runs while the victim or the absorber is still being revealed (FR-409, FR-322), nor during the finalised beat. */
  function flush(): void {
    if (hold.revealing || hold.absorbing || hold.finalised === true) return;
    const latest = due.splice(0);
    for (const scored of latest) void readWinners(scored, true);
    if (latest.length > 0) void readScores(latest[latest.length - 1]);
    const shown = model?.displayed;
    if (model !== undefined && shown !== undefined && shown >= 1 && shown <= model.applied) {
      for (const phase of [1, 2] as const) void readWinners({ round: shown, phase });
    }
  }

  async function start(): Promise<void> {
    if (deps.player !== undefined) {
      const own = await deps.net.ownPredictions(deps.matchId, deps.player.token, deps.player.playerId.slice(deps.player.playerId.indexOf(':') + 1));
      if (own.ok) state = withOwn(state, own.value);
    }
    // FR-432: the players list, once; later joins arrive as `player-joined` frames (see `onFrame`), with no further read.
    const roster = await deps.net.players(deps.matchId);
    if (roster.ok) state = withPlayers(state, roster.value);
    await readScores(undefined);
  }

  function pick(faction: number | undefined): void {
    if (model === undefined) return;
    const offer = offerFor(model, deps.player !== undefined, hold.revealing);
    const player = deps.player;
    if (player === undefined) return set(withNotice(state, noOfferText('not-joined')));
    const choice = pickFor(offer, faction, player.playerId, deps.makeId());
    if (!choice.ok) return set(withNotice(state, choice.sentence));
    if (repeatsPick(offer, faction, state.book, inFlight)) return;
    if (offer.type !== 'victim' && offer.type !== 'absorber') return;
    const sent: InFlight = { type: offer.type, round: offer.round, faction: choice.body.faction };
    inFlight = sent;
    state = withSending(state, true);
    void deps.net.submit(deps.matchId, player.token, choice.body).then((read) => {
      if (inFlight === sent) inFlight = undefined;
      set(read.ok ? withReply(state, read.value) : withNotice(state, submitFailure(read.outcome, read.retryAfter)));
    });
  }

  return {
    handlers: {
      onPick: (faction) => pick(faction),
      onBoardPage: (delta) => set(pageBoard(state, delta)),
      onWinnersToggle: (key) => set(toggleWinners(state, key)),
      onWinnersPage: (key, delta) => set(pageWinners(state, key, delta)),
      fillPersonal: (parent) => {
        if (deps.player !== undefined) personalBlock(parent, deps.pageUrl, deps.matchId, deps.player);
      },
    },
    view(next, at, tour) {
      model = next;
      hold = tour;
      if (next.victim?.forced === true) forcedRounds.add(next.victim.round);
      if (!started && next.displayed !== undefined) {
        started = true;
        void start();
      }
      // A notice belongs to the phase it was raised in: a new offer clears it.
      const offer = offerFor(next, deps.player !== undefined, tour.revealing);
      const key = offer.type === 'victim' || offer.type === 'absorber' || offer.type === 'forced' ? `${offer.type}:${offer.round}` : offer.type === 'none' ? offer.reason : '';
      if (key !== offerKey) {
        offerKey = key;
        if (state.notice !== undefined) state = withNotice(state, undefined);
      }
      flush();
      return playHud({ state, model: next, player: deps.player, factions: deps.factions, revealing: tour.revealing, at, forcedRounds });
    },
    onFrame(data) {
      const joined = withJoined(state, data);
      if (joined !== state) set(joined);
      const scored = scoredOf(data);
      if (scored === undefined) return;
      due.push(scored);
      flush();
    },
    tap(faction) {
      if (model === undefined) return;
      if (faction === undefined && offerFor(model, deps.player !== undefined, hold.revealing).type !== 'none') return set(withNotice(state, STRINGS.predictTapNothing));
      pick(faction);
    },
  };
}
