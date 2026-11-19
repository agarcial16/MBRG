// The ids written on buttons, menus and windows, and their reading (spec 012 FR-454). They hold a kind and a round, never a user id
// or a token (NFR-89). Pure.
import type { PhaseKind } from './model';

export const START_ID = 'mbrg:start';
export const PREDICT_ID = 'mbrg:predict';
export const pickId = (kind: PhaseKind, round: number): string => `mbrg:pick:${kind}:${round}`;
export const findId = (kind: PhaseKind, round: number): string => `mbrg:find:${kind}:${round}`;
/** Leaderboard paging (spec 017 FR-477): the TARGET page; p and n keep the two ids of one message different. */
export const boardId = (dir: 'p' | 'n', page: number): string => `mbrg:bd:${dir}:${page}`;
/** History paging (spec 024 FR-555): the TARGET page only. The cursors, the key and the asker live in the bot's memory, never in an id. */
export const historyId = (dir: 'p' | 'n', page: number): string => `mbrg:hs:${dir}:${page}`;
/** Ranking paging (spec 025 FR-569): the TARGET page only, as the history's. The cursors, the key, the order and the asker live in the bot's memory, never in an id. */
export const rankingId = (dir: 'p' | 'n', page: number): string => `mbrg:rk:${dir}:${page}`;
/** The same on a private page: it also carries the match, because a private message is not registered. */
export const mineId = (dir: 'p' | 'n', page: number, matchId: string): string => `mbrg:bm:${dir}:${page}:${matchId}`;

export type ParsedId =
  | { readonly type: 'start' }
  | { readonly type: 'predict' }
  | { readonly type: 'pick'; readonly kind: PhaseKind; readonly round: number }
  | { readonly type: 'find'; readonly kind: PhaseKind; readonly round: number }
  | { readonly type: 'board'; readonly page: number }
  | { readonly type: 'mine'; readonly page: number; readonly matchId: string }
  | { readonly type: 'history'; readonly page: number }
  | { readonly type: 'ranking'; readonly page: number };

const BOARD = /^mbrg:bd:[pn]:([1-9][0-9]{0,5})$/;
const MINE = /^mbrg:bm:[pn]:([1-9][0-9]{0,5}):([A-Za-z0-9_.-]{1,64})$/;
const HISTORY = /^mbrg:hs:[pn]:([1-9][0-9]{0,5})$/;
const RANKING = /^mbrg:rk:[pn]:([1-9][0-9]{0,5})$/;
const PHASED =/^mbrg:(pick|find):(victim|absorber):([1-9][0-9]{0,15})$/;

export function parseCustomId(id: string): ParsedId | undefined {
  if (id === START_ID) return { type: 'start' };
  if (id === PREDICT_ID) return { type: 'predict' };
  const board = BOARD.exec(id);
  if (board !== null) return { type: 'board', page: Number(board[1]) };
  const mine = MINE.exec(id);
  if (mine !== null) return { type: 'mine', page: Number(mine[1]), matchId: mine[2] as string };
  const history = HISTORY.exec(id);
  if (history !== null) return { type: 'history', page: Number(history[1]) };
  const ranking = RANKING.exec(id);
  if (ranking !== null) return { type: 'ranking', page: Number(ranking[1]) };
  const found = PHASED.exec(id);
  if (found === null) return undefined;
  const round = Number(found[3]);
  if (!Number.isSafeInteger(round)) return undefined;
  return { type: found[1] as 'pick' | 'find', kind: found[2] as PhaseKind, round };
}
