// Runs an action and gives the reply (spec 012 FR-451, FR-452, FR-454, FR-455, FR-457, FR-458, FR-463). The decisions are in the
// pure core; this only calls the server, the state and the follower. A member's first valid prediction makes them a player: there
// is no join (FR-463), the server creates the `discord:<id>` player from the credential and the local id.
import type { Action } from '../core/actions';
import { lobbyMessage } from '../core/announce';
import { boardView } from '../core/board';
import { historyMessage, stackAfter } from '../core/history';
import { rankingMessage, rankingUnavailable } from '../core/ranking';
import { nameBook } from '../core/names';
import type { HistoryPage, RankingOrder, RankingPage } from '@mbrg/protocol';
import { cleanDisplayName } from '../core/display-name';
import type { Reply, TimePeriod } from '../core/model';
import { matchCandidates } from '../core/text';
import { paceTiming } from '../core/paces';
import { chosenText, closedSentence, errorSentence, offerFor, openPhaseOf, resolveText, suggestionsFor } from '../core/predict';
import { STRINGS } from '../core/strings';
import type { Followed } from '../core/state';
import type { NameBook } from '../core/names';
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
  /** The viewer's base address for the lobby link (spec 021); none: no link. */
  readonly viewerUrl?: string | undefined;
}

export interface Who {
  readonly channelId: string;
  readonly userId: string;
  /** What Discord shows for the member in this server (spec 022 FR-537); the handler cleans it before it leaves. Never logged or stored. */
  readonly displayName?: string;
}

const text = (value: string): Reply => ({ type: 'text', text: value });
/**
 * The reply to a failure. For a creation (`creating`), a server that does not know `joinPolicy` or `community` (an older one:
 * `invalid-request` naming it) is "the server is unavailable": the bot never retries as an open match (spec 018 FR-505) nor without the
 * community key (spec 024 PD6).
 */
const failed = (failure: Failure, creating = false): Reply => {
  if (failure.type === 'down') return text(STRINGS.serverDown);
  if (creating && failure.error.kind === 'invalid-request' && (failure.error.items?.includes('joinPolicy') === true || failure.error.items?.includes('community') === true)) return text(STRINGS.serverDown);
  return text(errorSentence(failure.error));
};

export function createHandler(options: HandlerOptions): (action: Action, who: Who) => Promise<Reply> {
  const { client, store, follower, names } = options;

  async function submit(entry: Followed, who: Who, kind: 'victim' | 'absorber', round: number, faction: number): Promise<Reply> {
    // The display name goes with every prediction so a change is picked up (spec 022 FR-537, FR-539); nothing valid left: none is sent.
    const name = cleanDisplayName(who.displayName);
    const sent = await client.submit(entry.matchId, { kind, round, faction, playerId: who.userId, ...(name === undefined ? {} : { name }) });
    if (!sent.ok) return failed(sent.failure);
    return text(chosenText(await names.get(entry.mapId), faction));
  }

  /** A history page as the public message: the faction names of each map shown (a map no longer served has none: the number shows). */
  async function historyReply(page: HistoryPage, number: number, pages: readonly HistoryPage[], community: string, who: Who): Promise<Reply> {
    const books = new Map<string, NameBook>();
    for (const mapId of new Set(page.items.map((item) => item.mapId))) books.set(mapId, await names.get(mapId));
    const message = historyMessage(page, { page: number, book: (mapId) => books.get(mapId) ?? nameBook([]), viewerUrl: options.viewerUrl }, { askerId: who.userId, community, pages });
    return { type: 'channel', messages: [message] };
  }

  /** A ranking page as the public message; the last row of the page before it (from the stack) tells where the unranked tail begins. */
  function rankingReply(page: RankingPage, number: number, pages: readonly RankingPage[], order: RankingOrder, period: TimePeriod | undefined, community: string, who: Who): Reply {
    const previous = pages[number - 2]?.items.at(-1);
    const message = rankingMessage(page, order, { page: number, ...(previous === undefined ? {} : { previous }) }, { askerId: who.userId, community, order, ...(period === undefined ? {} : { period }), pages });
    return { type: 'channel', messages: [message] };
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
        const made = await client.create({ mapId: action.mapId, timing: paceTiming(action.pace, config.value), requestId: options.newRequestId(), community: action.community });
        if (!made.ok) return failed(made.failure, true);
        // Two creations at once in one channel: the second finds the channel taken and creates nothing more.
        if (store.get(who.channelId) !== undefined) return text(STRINGS.alreadyFollowing);
        const { matchId, hostToken, match } = made.value;
        store.set(who.channelId, { matchId, mapId: match.mapId, hostToken, lastSeq: match.lastSeq, appliedRounds: 0, forcedRound: 0, creatorId: who.userId });
        follower.follow(who.channelId);
        return { type: 'channel', messages: [lobbyMessage(matchId, match.mapId, options.viewerUrl)] };
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
        // The followed match, or else the last one the channel had (FR-466).
        const shown = entry ?? store.last(who.channelId);
        if (shown === undefined) return text(STRINGS.notFollowing);
        const rows = await client.leaderboard(shown.matchId);
        if (!rows.ok) return failed(rows.failure);
        // Page 1 for the member who asked: only they page it (FR-477, FR-480).
        return { type: 'channel', messages: [boardView(rows.value, 1, { matchId: shown.matchId, kind: 'asker', viewerId: who.userId }).message] };
      }
      case 'board-page': {
        // Every press reads the board again: the page is clamped if it changed meanwhile (edge case of the spec).
        const rows = await client.leaderboard(action.matchId);
        if (!rows.ok) return failed(rows.failure);
        const kind = action.mode === 'asker' ? 'asker' : 'private';
        return { type: 'channel', messages: [boardView(rows.value, action.page, { matchId: action.matchId, kind, viewerId: who.userId }).message] };
      }
      case 'history': {
        // One request, whatever the answer: an outage or a refusal is "unavailable" for the member alone, never retried (FR-558).
        const first = await client.history({ community: action.community, playerId: who.userId });
        return first.ok ? historyReply(first.value, 1, [first.value], action.community, who) : text(STRINGS.historyUnavailable);
      }
      case 'ranking': {
        // One request, whatever the answer: an outage or a refusal (an older server included) is "unavailable" for the member alone, never retried (FR-571).
        const first = await client.ranking({ community: action.community, order: action.order, ...(action.period === undefined ? {} : { period: action.period }), playerId: who.userId });
        return first.ok ? rankingReply(first.value, 1, [first.value], action.order, action.period, action.community, who) : rankingUnavailable();
      }
      case 'ranking-page': {
        // Back to a page already shown (no cursor): the same data, the same snapshot, nothing asked of the server.
        if (action.cursor === undefined) {
          const shown = action.pages[action.page - 1];
          return shown === undefined ? text(STRINGS.errUnexpected) : rankingReply(shown, action.page, action.pages, action.order, action.period, action.community, who);
        }
        const next = await client.ranking({ community: action.community, order: action.order, ...(action.period === undefined ? {} : { period: action.period }), playerId: who.userId, cursor: action.cursor });
        if (!next.ok) return rankingUnavailable();
        return rankingReply(next.value, action.page, stackAfter(action.pages, action.page, next.value), action.order, action.period, action.community, who);
      }
      case 'history-page': {
        // Back to a page already shown (no cursor): the same data, the same snapshot, nothing asked of the server.
        if (action.cursor === undefined) {
          const shown = action.pages[action.page - 1];
          return shown === undefined ? text(STRINGS.errUnexpected) : historyReply(shown, action.page, action.pages, action.community, who);
        }
        const next = await client.history({ community: action.community, playerId: who.userId, cursor: action.cursor });
        if (!next.ok) return text(STRINGS.historyUnavailable);
        return historyReply(next.value, action.page, stackAfter(action.pages, action.page, next.value), action.community, who);
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
        return resolved.type === 'one' ? submit(entry, who, open.kind, open.round, resolved.faction) : resolved.reply;
      }
      case 'choose':
        return entry === undefined ? text(STRINGS.notFollowing) : submit(entry, who, action.kind, action.round, action.faction);
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
