// The leaderboard and history messages the bot posted and still pages (spec 017 FR-480, FR-481; spec 024 FR-555): by message id, in
// memory only. After 5 minutes the buttons of a message are disabled with one edit (a failed edit is ignored); after a restart the
// registry is empty, so an old button is answered as expired (edge cases of the specs). Time and timers are injected, so the tests run
// without waiting.
import { BOARD_TTL_MS } from '../core/board';
import type { BoardEntryView, HistoryWalkView, RankingWalkView } from '../core/actions';
import { HISTORY_TTL_MS } from '../core/history';
import type { BoardTag, HistoryTag, OutMessage, RankingTag } from '../core/model';
import { RANKING_TTL_MS } from '../core/ranking';

export interface BoardsOptions {
  readonly now: () => number;
  /** Runs `fn` once after `ms`; the returned function cancels it. */
  readonly after: (ms: number, fn: () => void) => () => void;
  /** Disables the buttons of a posted message (the shell edits it); it throws when it cannot. */
  readonly disable: (channelId: string, messageId: string) => Promise<void>;
}

export interface Boards {
  register(channelId: string, messageId: string, tag: BoardTag): void;
  lookup(messageId: string): BoardEntryView | undefined;
  /** A history message that pages: its walk (asker, key, pages shown) lives here for 5 minutes. */
  registerHistory(channelId: string, messageId: string, tag: HistoryTag): void;
  lookupHistory(messageId: string): HistoryWalkView | undefined;
  /** The page stack after a press; the expiry stays the one of the posting. A message no longer remembered is ignored. */
  updateHistory(messageId: string, pages: HistoryTag['pages']): void;
  /** A ranking message that pages: its walk (asker, key, order, pages shown) lives here for 5 minutes (spec 025 FR-569). */
  registerRanking(channelId: string, messageId: string, tag: RankingTag): void;
  lookupRanking(messageId: string): RankingWalkView | undefined;
  updateRanking(messageId: string, pages: RankingTag['pages']): void;
  /** Cancels every pending timer (shutdown). */
  stopAll(): void;
}

export const afterMs = (ms: number, fn: () => void): (() => void) => {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

export function createBoards(options: BoardsOptions): Boards {
  const entries = new Map<string, { readonly view: BoardEntryView; readonly cancel: () => void }>();
  const walks = new Map<string, { view: HistoryWalkView; readonly cancel: () => void }>();
  const rankingWalks = new Map<string, { view: RankingWalkView; readonly cancel: () => void }>();
  const expire = (channelId: string, messageId: string, forget: () => void): void => {
    forget();
    options.disable(channelId, messageId).catch(() => {
      // a failed edit is ignored: a press is still refused as expired
    });
  };
  return {
    register(channelId, messageId, tag) {
      entries.get(messageId)?.cancel();
      const view: BoardEntryView = { matchId: tag.matchId, ...(tag.askerId === undefined ? {} : { askerId: tag.askerId }), expiresAt: options.now() + BOARD_TTL_MS };
      const cancel = options.after(BOARD_TTL_MS, () => expire(channelId, messageId, () => entries.delete(messageId)));
      entries.set(messageId, { view, cancel });
    },
    lookup: (messageId) => entries.get(messageId)?.view,
    registerHistory(channelId, messageId, tag) {
      walks.get(messageId)?.cancel();
      const view: HistoryWalkView = { askerId: tag.askerId, community: tag.community, pages: tag.pages, expiresAt: options.now() + HISTORY_TTL_MS };
      const cancel = options.after(HISTORY_TTL_MS, () => expire(channelId, messageId, () => walks.delete(messageId)));
      walks.set(messageId, { view, cancel });
    },
    lookupHistory: (messageId) => walks.get(messageId)?.view,
    updateHistory(messageId, pages) {
      const known = walks.get(messageId);
      if (known !== undefined) known.view = { ...known.view, pages };
    },
    registerRanking(channelId, messageId, tag) {
      rankingWalks.get(messageId)?.cancel();
      const view: RankingWalkView = { askerId: tag.askerId, community: tag.community, order: tag.order, pages: tag.pages, expiresAt: options.now() + RANKING_TTL_MS };
      const cancel = options.after(RANKING_TTL_MS, () => expire(channelId, messageId, () => rankingWalks.delete(messageId)));
      rankingWalks.set(messageId, { view, cancel });
    },
    lookupRanking: (messageId) => rankingWalks.get(messageId)?.view,
    updateRanking(messageId, pages) {
      const known = rankingWalks.get(messageId);
      if (known !== undefined) known.view = { ...known.view, pages };
    },
    stopAll() {
      for (const { cancel } of entries.values()) cancel();
      for (const { cancel } of walks.values()) cancel();
      for (const { cancel } of rankingWalks.values()) cancel();
      entries.clear();
      walks.clear();
      rankingWalks.clear();
    },
  };
}

/** After the shell sent the first part of a message: when it is a leaderboard or a history that pages, remember it. */
export function registerSent(boards: Boards, channelId: string, messageId: string | undefined, message: OutMessage | undefined): void {
  if (messageId === undefined) return;
  if (message?.board !== undefined) boards.register(channelId, messageId, message.board);
  if (message?.history !== undefined) boards.registerHistory(channelId, messageId, message.history);
  if (message?.ranking !== undefined) boards.registerRanking(channelId, messageId, message.ranking);
}

/** After the shell edited a history message in place: its stack of pages is the one of the new message. */
export function updateSent(boards: Boards, messageId: string, message: OutMessage | undefined): void {
  if (message?.history !== undefined) boards.updateHistory(messageId, message.history.pages);
  if (message?.ranking !== undefined) boards.updateRanking(messageId, message.ranking.pages);
}
