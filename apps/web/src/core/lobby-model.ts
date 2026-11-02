// The lobby of a match (spec 013 FR-398 to FR-400): the players list built from the players read and the `player-joined` events,
// when the lobby ends, and where a join leads. Pure: a frame comes in as parsed JSON, the model goes out. The lobby holds no round
// data: there is none to hold (a lobby has no rounds), and this module reads no state, record or victim.
import { readEvent } from '@mbrg/protocol';
import type { PlayerListItem, PublicMatch, Stage } from '@mbrg/protocol';
import { STRINGS } from './strings';

export interface LobbyModel {
  /** In join order. */
  readonly players: readonly PlayerListItem[];
  /** The number of the last event read. */
  readonly lastSeq: number;
}

export const emptyLobby: LobbyModel = { players: [], lastSeq: 0 };

/** What one frame did to the lobby: a player joined, the match started or ended (the lobby is over), or nothing. */
export type LobbyOutcome = 'joined' | 'started' | 'ended' | 'ignored';

const byJoin = (a: PlayerListItem, b: PlayerListItem): number => a.joinedSeq - b.joinedSeq || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);

function withPlayer(model: LobbyModel, player: PlayerListItem): LobbyModel {
  if (model.players.some((p) => p.playerId === player.playerId)) return model;
  return { ...model, players: [...model.players, player].sort(byJoin) };
}

/** The players read merged into the model: nobody listed twice, join order kept. */
export const lobbyAfterPlayers = (model: LobbyModel, items: readonly PlayerListItem[]): LobbyModel => items.reduce(withPlayer, model);

/**
 * One event frame. `player-joined` adds the player and is never a fault; the first `schedule` (the start) and a halted or finished
 * match end the lobby; anything else, a malformed frame included, changes nothing (the stream's own resync is the shell's concern).
 */
export function lobbyAfterFrame(model: LobbyModel, data: unknown): { readonly model: LobbyModel; readonly outcome: LobbyOutcome } {
  const read = readEvent(data);
  if (read.status === 'invalid') return { model, outcome: 'ignored' };
  const seq = read.status === 'unknown' ? read.seq : read.event.seq;
  const seen: LobbyModel = seq > model.lastSeq ? { ...model, lastSeq: seq } : model;
  if (read.status === 'unknown') return { model: seen, outcome: 'ignored' };
  const e = read.event;
  switch (e.type) {
    case 'player-joined': {
      const next = withPlayer(seen, { playerId: e.playerId, name: e.name, joinedSeq: e.seq });
      return { model: next, outcome: next === seen ? 'ignored' : 'joined' };
    }
    case 'schedule':
      return { model: seen, outcome: 'started' };
    case 'match-finished':
    case 'match-halted':
      return { model: seen, outcome: 'ended' };
    default:
      return { model: seen, outcome: 'ignored' };
  }
}

/** Where a public read puts the viewer: still in the lobby, in a running match, in an expired lobby or in a match that is over. */
export function lobbyStageOf(match: PublicMatch): 'lobby' | 'running' | 'expired' | 'ended' {
  switch (match.stage) {
    case 'lobby':
      return 'lobby';
    case 'expired':
      return 'expired';
    case 'finished':
    case 'halted':
      return 'ended';
    default:
      return 'running';
  }
}

export interface LobbyView {
  readonly count: number;
  readonly names: readonly string[];
  /** The host's button (`enabled` from one player), or the wait of everybody else. */
  readonly start: 'enabled' | 'disabled' | 'waiting';
}

/** What the lobby shows (FR-398). `publicCount` is the count of the public read, a floor for the count shown. */
export function lobbyView(model: LobbyModel, input: { readonly host: boolean; readonly publicCount: number | undefined }): LobbyView {
  const count = Math.max(model.players.length, input.publicCount ?? 0);
  return {
    count,
    names: model.players.map((p) => p.name),
    start: !input.host ? 'waiting' : count >= 1 ? 'enabled' : 'disabled',
  };
}

/** After a join: the lobby while the match has not started, otherwise the match, with the notice that predictions start next phase (FR-400). */
export function afterJoin(stage: Stage): { readonly screen: 'lobby' | 'match'; readonly notice: string | undefined } {
  if (stage === 'lobby') return { screen: 'lobby', notice: undefined };
  const running = stage === 'phase-1' || stage === 'phase-2' || stage === 'locked';
  return { screen: 'match', notice: running ? STRINGS.joinLater : undefined };
}
