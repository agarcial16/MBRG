// The lobby (spec 013 FR-398 to FR-400): the player count, the names (the players read plus the `player-joined` events), the share
// link, "Empezar" for the host and the wait for everybody else. It leaves for the match screen on the first `schedule` event, with
// no reload. No round data is read or shown: a lobby has none. The event stream is reopened after a drop with the usual headers.
import { lobbyAfterFrame, lobbyAfterPlayers, lobbyStageOf, lobbyView, emptyLobby } from '../core/lobby-model';
import type { LobbyModel } from '../core/lobby-model';
import { startFailure } from '../core/play-forms';
import { matchLink } from '../core/play-token';
import type { PlayerCredentials } from '../core/play-token';
import { STRINGS, fillTemplate } from '../core/strings';
import type { LiveNet, PlayNet } from './live-net';
import { personalBlock } from './play-join';
import { button, h, linkRow, openCard } from './play-dom';
import type { After } from './live-timer';

export interface LobbyDeps {
  readonly matchId: string;
  readonly net: PlayNet;
  readonly live: LiveNet;
  readonly after: After;
  readonly player: PlayerCredentials;
  /** The host token when this browser created the match. */
  readonly hostToken: string | undefined;
  readonly pageUrl: string;
  readonly makeId: () => string;
  /** The lobby is over for this viewer: the match runs (or is over). The stream is already closed. */
  readonly onStarted: () => void;
  /** The lobby expired without starting. */
  readonly onExpired: () => void;
}

const RETRY_MS = 3000;

export function showLobby(deps: LobbyDeps): void {
  const card = openCard(STRINGS.lobbyTitle, '');
  card.querySelector('p')?.remove();
  const count = h('div', 'hud-count', card);
  const list = h('ul', 'hud-players', card);
  list.setAttribute('aria-label', STRINGS.lobbyTitle);
  const link = h('div', 'hud-share', card);
  h('div', 'hud-title', link).textContent = STRINGS.shareTitle;
  linkRow(link, STRINGS.shareLabel, matchLink(deps.pageUrl, deps.matchId), STRINGS.shareCopy);
  personalBlock(card, deps.pageUrl, deps.matchId, deps.player);
  const action = h('div', 'hud-form', card);
  const problem = h('div', 'hud-messages', card);
  problem.setAttribute('role', 'alert');
  const notice = h('div', 'hud-note', card);
  notice.setAttribute('role', 'status');

  let model: LobbyModel = emptyLobby;
  let publicCount: number | undefined;
  let finished = false;
  let starting = false;
  let startRequest: string | undefined;
  const control = new AbortController();
  const host = deps.hostToken !== undefined;

  const leave = (then: () => void): void => {
    if (finished) return;
    finished = true;
    control.abort();
    then();
  };

  const render = (): void => {
    const view = lobbyView(model, { host, publicCount });
    count.textContent = view.count === 1 ? STRINGS.lobbyCountOne : fillTemplate(STRINGS.lobbyCount, { count: view.count });
    list.replaceChildren();
    if (view.names.length === 0) h('li', 'hud-note', list).textContent = STRINGS.lobbyNobody;
    for (const player of model.players) {
      h('li', '', list).textContent = player.playerId === deps.player.playerId ? fillTemplate(STRINGS.lobbyYou, { name: player.name }) : player.name;
    }
    action.replaceChildren();
    if (view.start === 'waiting') {
      h('span', 'hud-note', action).textContent = STRINGS.lobbyWaiting;
      return;
    }
    const start = button(action, starting ? STRINGS.lobbyStarting : STRINGS.lobbyStart, () => {
      if (deps.hostToken === undefined || starting) return;
      starting = true;
      problem.textContent = '';
      startRequest = startRequest ?? deps.makeId();
      render();
      void deps.net.start(deps.matchId, deps.hostToken, startRequest).then((read) => {
        starting = false;
        if (read.ok) return leave(deps.onStarted);
        problem.textContent = startFailure(read.outcome);
        render();
      });
    }, 'hud-btn primary');
    start.disabled = view.start === 'disabled' || starting;
    if (view.start === 'disabled') h('span', 'hud-note', action).textContent = STRINGS.lobbyNeedsOne;
  };

  /** One public read: the count, and whether the match is still waiting. */
  const check = async (): Promise<void> => {
    const read = await deps.live.readPublic(deps.matchId);
    if (finished || !read.ok) return;
    publicCount = read.value.playerCount;
    const stage = lobbyStageOf(read.value);
    if (stage === 'expired') return leave(deps.onExpired);
    if (stage !== 'lobby') return leave(deps.onStarted);
  };

  let opened = false;
  const connect = async (): Promise<void> => {
    notice.textContent = '';
    const end = await deps.live.openStream(
      deps.matchId,
      { after: model.lastSeq, via: opened ? 'header' : 'parameter' },
      {
        opened: () => void (opened = true),
        bytes: () => undefined,
        frame: (data) => {
          const next = lobbyAfterFrame(model, data);
          model = next.model;
          if (next.outcome === 'started' || next.outcome === 'ended') return leave(deps.onStarted);
          render();
        },
      },
      control.signal,
    );
    if (finished || end.type === 'aborted') return;
    notice.textContent = STRINGS.lobbyReconnecting;
    deps.after(RETRY_MS, () => {
      void check().then(() => {
        if (!finished) void connect();
      });
    });
  };

  render();
  void deps.net.players(deps.matchId).then((read) => {
    if (read.ok) model = lobbyAfterPlayers(model, read.value);
    render();
  });
  void check();
  void connect();
}
