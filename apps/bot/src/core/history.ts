// The history of the finished matches of a Discord server (spec 024 FR-554 to FR-556, FR-559). Pure: a page of the history comes in,
// the embed, its plain-text fallback and the empty sentence come out. Names come only from Discord (mentions) or the server's own row
// (as the leaderboard, 017 FR-483); everything shown is already public data of a finished match (008 FR-246).
import type { HistoryEntry, HistoryPage, HistoryTopRow } from '@mbrg/protocol';
import { clampPage } from './board';
import type { EmbedField, OutMessage } from './model';
import type { NameBook } from './names';
import { mentionOf, userIdOf } from './results';
import { STRINGS, fill } from './strings';

/** A history page holds 5 entries (NFR-121). */
export const HISTORY_PAGE_SIZE = 5;
/** A history message pages for 5 minutes after it was posted (FR-555), as a leaderboard (017 FR-481). */
export const HISTORY_TTL_MS = 5 * 60 * 1000;
const COLOR = 0x3498db;

export interface HistoryContext {
  /** The page number shown, from 1. */
  readonly page: number;
  /** The faction names of the map of an entry; a map whose package is no longer served has an empty book (the faction shows its number). */
  readonly book: (mapId: string) => NameBook;
  /** The name of a map when one is known; none: the map id stands for it (FR-559). */
  readonly mapName?: (mapId: string) => string | undefined;
  /** The viewer's base address for the link of each match; none: no link. */
  readonly viewerUrl?: string | undefined;
}

export const historyPageCount = (total: number): number => Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

/** The viewer link of a finished match: spectator-marked (no door, no player), opened on its last round (spec 021, 016 FR-469). */
export function historyLink(base: string | undefined, matchId: string): string | undefined {
  if (base === undefined) return undefined;
  try {
    const url = new URL(base);
    url.searchParams.set('match', matchId);
    url.searchParams.set('spectate', '1');
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Who a row is: a Discord member is a mention; any other player shows the server's name, else "Jugador". */
function whoOf(row: HistoryTopRow): string {
  const userId = userIdOf(row.playerId);
  return userId !== undefined ? mentionOf(userId) : (row.name ?? STRINGS.playerFallback);
}

const playersOf = (n: number): string => (n === 1 ? STRINGS.historyPlayersOne : fill(STRINGS.historyPlayersMany, { n }));

function askerLine(entry: HistoryEntry): string | undefined {
  const asker = entry.asker;
  if (asker === undefined) return undefined;
  return 'played' in asker ? STRINGS.historyNotPlayed : fill(STRINGS.historyOwn, { points: asker.points, rank: asker.rank });
}

interface Shown {
  readonly name: string;
  /** The lines of the entry other than the viewer link. */
  readonly lines: readonly string[];
  readonly link: string | undefined;
}

function shown(entry: HistoryEntry, ctx: HistoryContext): Shown {
  const map = ctx.mapName?.(entry.mapId) ?? entry.mapId;
  const name = fill(STRINGS.historyEntry, { date: `<t:${Math.floor(entry.finishedAt / 1000)}:d>`, map });
  const winner = fill(STRINGS.historyWinner, { winner: ctx.book(entry.mapId).nameOf(entry.winner), players: playersOf(entry.playerCount) });
  const rows = entry.top.length === 0 ? [STRINGS.historyNobody] : entry.top.map((row) => fill(STRINGS.boardRow, { rank: row.rank, who: whoOf(row), points: row.points }));
  const more = entry.more > 0 ? [fill(STRINGS.historyMore, { n: entry.more })] : [];
  const own = askerLine(entry);
  return { name, lines: [winner, ...rows, ...more, ...(own === undefined ? [] : [own])], link: historyLink(ctx.viewerUrl, entry.matchId) };
}

/** The reply for a community with no counted match: one sentence, no embed, no buttons (FR-556). */
export const historyEmpty = (): OutMessage => ({ text: STRINGS.historyEmpty, buttons: [] });

/**
 * One page of the history as an embed with its plain-text twin (FR-475). The message has no buttons here: the paging buttons are added
 * by the paging of the message (FR-555).
 */
export function historyEmbed(page: HistoryPage, ctx: HistoryContext): OutMessage {
  if (page.items.length === 0) return historyEmpty();
  const pages = historyPageCount(page.total);
  const footer = fill(STRINGS.boardPage, { page: clampPage(ctx.page, pages), pages });
  const entries = page.items.map((entry) => shown(entry, ctx));
  const fields: EmbedField[] = entries.map((e) => ({ name: e.name, value: [...e.lines, ...(e.link === undefined ? [] : [`[${STRINGS.viewerButton}](${e.link})`])].join('\n') }));
  const text = [STRINGS.historyTitle, ...entries.flatMap((e) => [e.name, ...e.lines, ...(e.link === undefined ? [] : [e.link])]), footer].join('\n');
  return { text, buttons: [], embed: { color: COLOR, title: STRINGS.historyTitle, fields, footer } };
}
