// The door of a match link (spec 013 FR-394, FR-396 to FR-399): reads where the match stands and this browser's player, then shows the
// join screen, the lobby or the match scene. A personal link's fragment is adopted into the storage and removed from the address.
// The storage and the clock are the browser's; the decisions are the pure modules'.
import { lobbyStageOf } from '../core/lobby-model';
import { entryScreen } from '../core/play-entry';
import { adoptFragment, loadHost, loadPlayer } from '../core/play-token';
import type { PlayerCredentials } from '../core/play-token';
import { errorText } from '../core/live-text';
import { STRINGS } from '../core/strings';
import { pageServerOrigin } from './live-config';
import { startLiveScene } from './live-main';
import { createLiveNet, createPlayNet } from './live-net';
import type { LiveNet, PlayNet } from './live-net';
import { after } from './live-timer';
import { showMessage } from './message';
import { showMap } from './play-dom';
import { showJoin, showClosed } from './play-join';
import { showLobby } from './play-lobby';
import { requestId } from './web-crypto';

/** The network objects of the player screens, bound to the page's server origin. */
export function playNets(): { readonly net: PlayNet; readonly live: LiveNet } {
  const base = pageServerOrigin();
  const bound = fetch.bind(globalThis);
  return { net: createPlayNet({ base, fetch: bound }), live: createLiveNet({ base, fetch: bound }) };
}

/** The page address without query or fragment (the links are built from it). */
const pageUrl = (): string => `${window.location.origin}${window.location.pathname}`;

export function startMatchEntry(matchId: string): void {
  const storage = window.localStorage;
  // A personal link: the player is stored and the fragment leaves the address (it is never sent, and it is not kept in the history).
  adoptFragment(storage, matchId, window.location.hash);
  if (window.location.hash !== '') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  const { net, live } = playNets();
  const watch = (): void => {
    showMap();
    startLiveScene(matchId);
  };
  void (async () => {
    const read = await live.readPublic(matchId);
    if (!read.ok) {
      // A transport failure or a missing digest function: the match scene has its own retry and messages for these.
      if (read.outcome === 'fatal' || read.outcome === 'retry') return watch();
      return showMessage(errorText('unknown-match'));
    }
    const player = loadPlayer(storage, matchId);
    const host = loadHost(storage, matchId);
    const stage = lobbyStageOf(read.value);
    const screen = entryScreen(stage, player !== undefined);
    const toLobby = (who: PlayerCredentials): void =>
      showLobby({
        matchId, net, live, after, player: who, hostToken: host, pageUrl: pageUrl(), makeId: requestId,
        onStarted: watch,
        onExpired: () => showClosed(STRINGS.joinExpired, undefined),
      });
    switch (screen) {
      case 'match':
        return watch();
      case 'lobby':
        return toLobby(player as PlayerCredentials);
      case 'closed-ended':
        return showClosed(STRINGS.joinFinished, watch);
      case 'closed-expired':
        return showClosed(STRINGS.joinExpired, undefined);
      case 'join':
        return showJoin({ matchId, net, storage, pageUrl: pageUrl(), makeId: requestId, host: host !== undefined, onLobby: toLobby, onMatch: () => watch() });
    }
  })();
}

/** A match was just created here: the address becomes its link and the door opens (the host joins with a name like anyone). */
export function enterCreated(matchId: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}?match=${matchId}`);
  startMatchEntry(matchId);
}
