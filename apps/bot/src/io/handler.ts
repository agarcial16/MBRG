// Runs an action and gives the reply (spec 012 FR-451, FR-452, FR-454, FR-455, FR-457, FR-458, FR-463). The decisions are in the
// pure core; this only calls the server, the state and the follower. A member's first valid prediction makes them a player: there
// is no join (FR-463), the server creates the `discord:<id>` player from the credential and the local id.
import type { Action } from '../core/actions';
import { lobbyMessage } from '../core/announce';
import type { Reply } from '../core/model';
import { matchCandidates } from '../core/text';
import { paceTiming } from '../core/paces';
import { chosenText, closedSentence, errorSentence, offerFor, openPhaseOf, resolveText, suggestionsFor } from '../core/predict';
import { boardMessages } from '../core/results';
import { STRINGS } from '../core/strings';
import type { Followed } from '../core/state';
import type { NamesProvider, Follower } from './follower';
import type { Failure, ServerClient } from './server-client';
import type { StateStore } from './state-file';

export interface HandlerOptions {
  readonly client: ServerClient;
  readonly store: StateStore;
  readonly follower: Follower;
  readonly names: NamesProvider;
  /** A fresh client request id for a creation (the server remembers it for a retry). */
  readonly newRequestId: () => string;
}

export interface Who {
  readonly channelId: string;
  readonly userId: string;
}

const text = (value: string): Reply => ({ type: 'text', text: value });
const failed = (failure: Failure): Reply => text(failure.type === 'down' ? STRINGS.serverDown : errorSentence(failure.error));

export function createHandler(options: HandlerOptions): (action: Action, who: Who) => Promise<Reply> {
  const { client, store, follower, names } = options;

  async function submit(entry: Followed, userId: string, kind: 'victim' | 'absorber', round: number, faction: number): Promise<Reply> {
    const sent = await client.submit(entry.matchId, { kind, round, faction, playerId: userId });
    if (!sent.ok) return failed(sent.failure);
    return text(chosenText(await names.get(entry.mapId), faction));
  }

  return async (action, who) => {
    const entry = store.get(who.channelId);
    switch (action.do) {
      case 'say':
        return text(action.text);
      case 'create': {
        const config = await client.config();
        if (!config.ok) return failed(config.failure);
        if (!config.value.enabled) return text(STRINGS.createDisabled);
        if (!config.value.maps.includes(action.mapId)) return text(STRINGS.unknownMap);
        const made = await client.create({ mapId: action.mapId, timing: paceTiming(action.pace, config.value), requestId: options.newRequestId() });
        if (!made.ok) return failed(made.failure);
        // Two creations at once in one channel: the second finds the channel taken and creates nothing more.
        if (store.get(who.channelId) !== undefined) return text(STRINGS.alreadyFollowing);
        const { matchId, hostToken, match } = made.value;
        store.set(who.channelId, { matchId, mapId: match.mapId, hostToken, lastSeq: match.lastSeq, appliedRounds: 0, forcedRound: 0 });
        follower.follow(who.channelId);
        return { type: 'channel', messages: [lobbyMessage(matchId, match.mapId)] };
      }
      case 'start': {
        if (entry === undefined) return text(STRINGS.notFollowing);
        const started = await client.start(entry.matchId, entry.hostToken);
        return started.ok ? text(STRINGS.started) : failed(started.failure);
      }
      case 'stop':
        follower.unfollow(who.channelId);
        return { type: 'channel', messages: [{ text: STRINGS.stopped, buttons: [] }] };
      case 'board': {
        if (entry === undefined) return text(STRINGS.notFollowing);
        const rows = await client.leaderboard(entry.matchId, 10);
        return rows.ok ? { type: 'channel', messages: boardMessages(rows.value) } : failed(rows.failure);
      }
      case 'predict-open':
      case 'predict-text':
      case 'find': {
        if (entry === undefined) return text(STRINGS.notFollowing);
        const match = await client.match(entry.matchId);
        if (!match.ok) return failed(match.failure);
        const open = openPhaseOf(match.value);
        if (!open.open) return text(closedSentence(open.reason));
        const book = await names.get(entry.mapId);
        if (action.do === 'predict-open') return offerFor(open, book);
        const typed = action.do === 'find' ? action : action as Extract<Action, { do: 'predict-text' }>;
        // A window typed for another phase than the open one (the phase moved on) finds nothing to choose from.
        if (action.do === 'find' && (open.kind !== action.kind || open.round !== action.round)) return text(STRINGS.errClosed);
        const resolved = resolveText(open, book, typed.text);
        return resolved.type === 'one' ? submit(entry, who.userId, open.kind, open.round, resolved.faction) : resolved.reply;
      }
      case 'choose':
        return entry === undefined ? text(STRINGS.notFollowing) : submit(entry, who.userId, action.kind, action.round, action.faction);
      case 'suggest': {
        if (action.option === 'map') {
          const config = await client.config();
          const maps = config.ok ? config.value.maps.map((id, i) => ({ id: i + 1, name: id })) : [];
          return { type: 'suggest', choices: matchCandidates(action.text, maps).map((m) => ({ name: m.name, value: m.name })) };
        }
        if (entry === undefined) return { type: 'suggest', choices: [] };
        const match = await client.match(entry.matchId);
        const open = match.ok ? openPhaseOf(match.value) : undefined;
        if (open === undefined || !open.open) return { type: 'suggest', choices: [] };
        return suggestionsFor(open.candidates, await names.get(entry.mapId), action.text);
      }
    }
  };
}
