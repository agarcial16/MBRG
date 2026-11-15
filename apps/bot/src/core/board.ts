// The paged leaderboard (spec 017 FR-477 to FR-483). Pure: the rows come in, the embed, its plain-text fallback and its paging buttons
// come out. Names come only from Discord (mentions) or the server's own row (FR-483). The title, sentences and labels are in strings.ts.
import type { LeaderboardRow } from '@mbrg/protocol';
import { boardId, mineId } from './custom-ids';
import type { BoardTag, ButtonSpec, OutMessage } from './model';
import { mentionOf, userIdOf } from './results';
import { STRINGS, fill } from './strings';

export const PAGE_SIZE = 10;
/** A leaderboard message pages for 5 minutes after it was posted (FR-481). */
export const BOARD_TTL_MS = 5 * 60 * 1000;
const COLOR = 0x9b59b6;

/**
 * The three leaderboard messages:
 * - asker: the public reply of `/mbrg board`; only the member who ran it pages it, in place.
 * - final: the public post at the end of a match; no asker, each presser gets a private page.
 * - private: such a private page; it carries its match in its button ids and shows the presser's own line.
 */
export type BoardKind = 'asker' | 'final' | 'private';

export interface BoardOptions {
  readonly matchId: string;
  readonly kind: BoardKind;
  /** The Discord user id whose "Tu puesto" line is shown (the asker, or the member who pressed); none: no line. */
  readonly viewerId?: string;
}

export interface BoardView {
  /** The page shown, after clamping. */
  readonly page: number;
  readonly pages: number;
  readonly message: OutMessage;
}

export const pageCount = (rows: number): number => Math.max(1, Math.ceil(rows / PAGE_SIZE));

/** A page number into 1..pages (anything not a number is page 1). */
export function clampPage(page: number, pages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), pages);
}

/** Who a row is: a Discord member is a mention; any other row shows the server's name, else "Jugador" (FR-483). */
function whoOf(row: LeaderboardRow): string {
  const userId = userIdOf(row.playerId);
  return userId !== undefined ? mentionOf(userId) : (row.name ?? STRINGS.playerFallback);
}

const lineOf = (row: LeaderboardRow): string => fill(STRINGS.boardRow, { rank: row.rank, who: whoOf(row), points: row.total });

function pagingButtons(page: number, pages: number, kind: BoardKind, matchId: string): ButtonSpec[] {
  const id = (dir: 'p' | 'n', target: number): string => (kind === 'private' ? mineId(dir, target, matchId) : boardId(dir, target));
  return [
    { type: 'custom', customId: id('p', Math.max(1, page - 1)), label: STRINGS.boardPrev, style: 'primary', ...(page <= 1 ? { disabled: true } : {}) },
    { type: 'custom', customId: id('n', Math.min(pages, page + 1)), label: STRINGS.boardNext, style: 'primary', ...(page >= pages ? { disabled: true } : {}) },
  ];
}

/** One page of the leaderboard, ranked by points (ties keep the server's order and rank). */
export function boardView(rows: readonly LeaderboardRow[], requestedPage: number, options: BoardOptions): BoardView {
  const title = STRINGS.boardTitle;
  if (rows.length === 0) {
    return { page: 1, pages: 1, message: { text: `${title}\n${STRINGS.boardEmpty}`, buttons: [], embed: { color: COLOR, title, description: STRINGS.boardEmpty, fields: [] } } };
  }
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const pages = pageCount(sorted.length);
  const page = clampPage(requestedPage, pages);
  const lines = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(lineOf);
  const footer = fill(STRINGS.boardPage, { page, pages });
  let own: string | undefined;
  if (options.viewerId !== undefined) {
    const mine = sorted.find((r) => r.playerId === `discord:${options.viewerId}`);
    own = mine === undefined ? STRINGS.boardOwnNone : lineOf(mine);
  }
  const text = [title, ...lines, footer, ...(own === undefined ? [] : [`${STRINGS.boardOwnField}: ${own}`])].join('\n');
  const tag: BoardTag | undefined =
    options.kind === 'private' || pages === 1 ? undefined : options.kind === 'asker' && options.viewerId !== undefined ? { matchId: options.matchId, askerId: options.viewerId } : { matchId: options.matchId };
  return {
    page,
    pages,
    message: {
      text,
      buttons: pagingButtons(page, pages, options.kind, options.matchId),
      embed: { color: COLOR, title, description: lines.join('\n'), fields: own === undefined ? [] : [{ name: STRINGS.boardOwnField, value: own }], footer },
      ...(tag === undefined ? {} : { board: tag }),
    },
  };
}
