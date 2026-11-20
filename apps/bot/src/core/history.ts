// The history of the finished matches of a Discord server (spec 024 FR-554 to FR-556, FR-559; presentation pass: spec 026). Pure: a page of the history
// comes in, the embed, its plain-text fallback and the empty sentence come out. Names come only from Discord (mentions) or the server's own row
// (as the leaderboard, 017 FR-483); everything shown is already public data of a finished match (008 FR-246).
import type { HistoryEntry, HistoryPage, HistoryTopRow } from '@mbrg/protocol';
import { clampPage } from './board';
import { historyId } from './custom-ids';
import type { ButtonSpec, EmbedField, HistoryTag, OutMessage } from './model';
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

/** The podium templates: the first three rows of a top show their medal, the rest their position number (spec 026). */
const MEDALS = [STRINGS.historyGold, STRINGS.historySilver, STRINGS.historyBronze] as const;

/** The top of an entry on one line: `🥇 <@a> 12 · 🥈 <@b> 9 · 🥉 <@c> 7 · 4. <@d> 5 · 5. <@e> 3`, with ` · y N más` at the end when
 * rows above 0 were left out. The position is shown, not the server rank: equal points keep ties visible and the rank stays in the
 * asker's line. Embeds stretch to the client width, so nothing is shortened for narrow clients. */
function topLine(entry: HistoryEntry): string {
  const cells = entry.top.map((row, index) => fill(MEDALS[index] ?? STRINGS.historyTopRow, { n: index + 1, who: whoOf(row), points: row.points }));
  const more = entry.more > 0 ? [fill(STRINGS.historyMore, { n: entry.more })] : [];
  return [...cells, ...more].join(STRINGS.historySep);
}

function askerLine(entry: HistoryEntry): string | undefined {
  const asker = entry.asker;
  if (asker === undefined) return undefined;
  return 'played' in asker ? STRINGS.historyNotPlayed : fill(STRINGS.historyOwn, { points: asker.points, rank: asker.rank });
}

interface Shown {
  readonly name: string;
  /** The lines of the entry other than the asker's line and the viewer link. */
  readonly lines: readonly string[];
  readonly own: string | undefined;
  readonly link: string | undefined;
}

function shown(entry: HistoryEntry, ctx: HistoryContext, ordinal: number): Shown {
  const map = ctx.mapName?.(entry.mapId) ?? entry.mapId;
  const name = fill(STRINGS.historyEntry, { n: ordinal, date: `<t:${Math.floor(entry.finishedAt / 1000)}:d>`, map });
  const winner = fill(STRINGS.historyWinner, { winner: ctx.book(entry.mapId).nameOf(entry.winner), players: playersOf(entry.playerCount) });
  const top = entry.top.length === 0 ? STRINGS.historyNobody : topLine(entry);
  return { name, lines: [winner, top], own: askerLine(entry), link: historyLink(ctx.viewerUrl, entry.matchId) };
}

/** The viewer link as it renders: a markdown link in the embed, the bare address in the plain-text fallback (FR-475). */
const linkOf = (url: string, embed: boolean): string => (embed ? `[${STRINGS.viewerButton}](${url})` : url);

/** The lines of an entry as rendered: the link rides the asker's line; an entry without an asker keeps the link as its own last
 * line (spec 026). */
function valueLines(entry: Shown, embed: boolean): readonly string[] {
  const link = entry.link === undefined ? undefined : linkOf(entry.link, embed);
  return [...entry.lines, ...(entry.own === undefined ? (link === undefined ? [] : [link]) : [entry.own + (link === undefined ? '' : `${STRINGS.historySep}${link}`)])];
}

/** The reply for a community with no counted match: one sentence, no embed, no buttons (FR-556). */
export const historyEmpty = (): OutMessage => ({ text: STRINGS.historyEmpty, buttons: [] });

/**
 * One page of the history as an embed with its plain-text twin (FR-475). The field name of an entry carries its ordinal in the
 * whole history, newest first, computed from the walk's snapshot total and the page offset (spec 026). The message has no buttons
 * here: the paging buttons are added by the paging of the message (FR-555).
 */
export function historyEmbed(page: HistoryPage, ctx: HistoryContext): OutMessage {
  if (page.items.length === 0) return historyEmpty();
  const pages = historyPageCount(page.total);
  const shownPage = clampPage(ctx.page, pages);
  const footer = fill(STRINGS.boardPage, { page: shownPage, pages });
  const entries = page.items.map((entry, index) => shown(entry, ctx, page.total - (shownPage - 1) * HISTORY_PAGE_SIZE - index));
  const fields: EmbedField[] = entries.map((e) => ({ name: e.name, value: valueLines(e, true).join('\n') }));
  const text = [STRINGS.historyTitle, ...entries.flatMap((e) => [e.name, ...valueLines(e, false)]), footer].join('\n');
  return { text, buttons: [], embed: { color: COLOR, title: STRINGS.historyTitle, fields, footer } };
}

const buttonsOf = (page: number, pages: number): ButtonSpec[] => [
  { type: 'custom', customId: historyId('p', Math.max(1, page - 1)), label: STRINGS.boardPrev, style: 'primary', ...(page <= 1 ? { disabled: true } : {}) },
  { type: 'custom', customId: historyId('n', Math.min(pages, page + 1)), label: STRINGS.boardNext, style: 'primary', ...(page >= pages ? { disabled: true } : {}) },
];

/**
 * The history message of a page: the embed with Previous and Next (disabled on the first and the last page, as the leaderboard's) and,
 * when there is more than one page, the walk the shell remembers to page it (FR-555). An empty history is the one sentence alone.
 */
export function historyMessage(page: HistoryPage, ctx: HistoryContext, walk: HistoryTag): OutMessage {
  const view = historyEmbed(page, ctx);
  if (page.items.length === 0) return view;
  const pages = historyPageCount(page.total);
  return { ...view, buttons: buttonsOf(clampPage(ctx.page, pages), pages), ...(pages > 1 ? { history: walk } : {}) };
}

/** The pages shown after showing page `page`: a page fetched replaces the stack from its place on; a page shown again changes nothing. */
export const stackAfter = <T>(pages: readonly T[], page: number, fetched: T | undefined): readonly T[] =>
  fetched === undefined ? pages : [...pages.slice(0, page - 1), fetched];
