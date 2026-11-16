// The leaderboard messages the bot posted and still pages (spec 017 FR-480, FR-481): by message id, in memory only. After 5 minutes the
// buttons of a message are disabled with one edit (a failed edit is ignored); after a restart the registry is empty, so an old
// button is answered as expired (edge cases of the spec). Time and timers are injected, so the tests run without waiting.
import { BOARD_TTL_MS } from '../core/board';
import type { BoardEntryView } from '../core/actions';
import type { BoardTag, OutMessage } from '../core/model';

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
  return {
    register(channelId, messageId, tag) {
      entries.get(messageId)?.cancel();
      const view: BoardEntryView = { matchId: tag.matchId, ...(tag.askerId === undefined ? {} : { askerId: tag.askerId }), expiresAt: options.now() + BOARD_TTL_MS };
      const cancel = options.after(BOARD_TTL_MS, () => {
        entries.delete(messageId);
        options.disable(channelId, messageId).catch(() => {
          // a failed edit is ignored: a press is still refused as expired
        });
      });
      entries.set(messageId, { view, cancel });
    },
    lookup: (messageId) => entries.get(messageId)?.view,
    stopAll() {
      for (const { cancel } of entries.values()) cancel();
      entries.clear();
    },
  };
}

/** After the shell sent the first part of a message: when it is a leaderboard that pages, remember it. */
export function registerSent(boards: Boards, channelId: string, messageId: string | undefined, message: OutMessage | undefined): void {
  if (messageId !== undefined && message?.board !== undefined) boards.register(channelId, messageId, message.board);
}
