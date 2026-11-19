// The ranking of the members of a Discord server (spec 025 FR-569 to FR-571). Pure: a page of the ranking comes in, the embed with its
// plain-text twin, the empty sentence and the unavailable reply come out. Names come only from Discord (mentions) or the server's own row
// (as the leaderboard, 017 FR-483); everything shown is already public data of finished matches (008 FR-246). The order words of the command
// live in the strings module (PD4): the wire takes the enum, only the bot speaks Spanish.
import type { RankingOrder, RankingPage, RankingRow } from '@mbrg/protocol';
import { clampPage } from './board';
import { rankingId } from './custom-ids';
import type { ButtonSpec, OutMessage, RankingTag, Reply } from './model';
import { mentionOf, userIdOf } from './results';
import { STRINGS, fill } from './strings';

/** A ranking page holds 10 rows (NFR-125). */
export const RANKING_PAGE_SIZE = 10;
/** A ranking message pages for 5 minutes after it was posted (FR-569), as a history's. */
export const RANKING_TTL_MS = 5 * 60 * 1000;
const COLOR = 0xe67e22;

/** The order words, in the order the command offers them, each with the wire order it asks for. */
export const ORDER_WORDS: readonly (readonly [string, RankingOrder])[] = [
  [STRINGS.orderPoints, 'points'],
  [STRINGS.orderCorrect, 'correct'],
  [STRINGS.orderWins, 'wins'],
  [STRINGS.orderAccuracy, 'accuracy'],
];

/** The wire order of a word as typed (case and surrounding spaces ignored); no word means points, a word that is not an order none. */
export function orderOf(word: string | undefined): RankingOrder | undefined {
  if (word === undefined) return 'points';
  const typed = word.trim().toLowerCase();
  return ORDER_WORDS.find(([known]) => known === typed)?.[1];
}

/** What the shell knows of the page it shows: its number and the last row of the page before it (none on page 1), which tells where the unranked tail begins. */
export interface RankingContext {
  /** The page number shown, from 1. */
  readonly page: number;
  readonly previous?: RankingRow;
}

/** The statistics of a player, as a row or the asker's own line carries them. */
interface Statistics {
  readonly points: number;
  readonly correct: number;
  readonly scored: number;
  readonly played: number;
  readonly won: number;
}

export const rankingPageCount = (total: number): number => Math.max(1, Math.ceil(total / RANKING_PAGE_SIZE));

/**
 * The whole percent of correct predictions among the scored ones, rounded down (FR-569): exact in integers, so 199 of 200 is 99 and
 * 100 means every scored prediction was right. No scored prediction, no percent.
 */
export function floorPercent(correct: number, scored: number): number | undefined {
  if (scored <= 0) return undefined;
  return Number((100n * BigInt(correct)) / BigInt(scored));
}

/** The statistics as text, the ordering statistic first and the others in one fixed order (FR-569). */
function statsText(stats: Statistics, order: RankingOrder): string {
  const percent = floorPercent(stats.correct, stats.scored);
  const parts: Record<RankingOrder | 'played', string | undefined> = {
    points: fill(STRINGS.rankingPoints, { n: stats.points }),
    correct: fill(STRINGS.rankingCorrect, { correct: stats.correct, scored: stats.scored }),
    wins: fill(STRINGS.rankingWins, { n: stats.won }),
    played: fill(STRINGS.rankingPlayed, { n: stats.played }),
    accuracy: percent === undefined ? undefined : fill(STRINGS.rankingAccuracy, { n: percent }),
  };
  const rest = (['points', 'correct', 'wins', 'played', 'accuracy'] as const).filter((key) => key !== order);
  return [parts[order], ...rest.map((key) => parts[key])].filter((part): part is string => part !== undefined).join(STRINGS.rankingSep);
}

/** Who a row is: a Discord member is a mention; any other player shows the server's name, else "Jugador". */
function whoOf(row: RankingRow): string {
  const userId = userIdOf(row.playerId);
  return userId !== undefined ? mentionOf(userId) : (row.name ?? STRINGS.playerFallback);
}

const lineOf = (row: RankingRow, order: RankingOrder): string =>
  fill(STRINGS.rankingRow, { rank: row.rank === undefined ? STRINGS.rankingNoRank : fill(STRINGS.rankingRank, { n: row.rank }), who: whoOf(row), stats: statsText(row, order) });

/**
 * The place of the note "Menos de 10 predicciones": before the first unranked row of the page when the row before it is ranked, and at the
 * top of a page that starts with unranked rows only when the page before ended with a ranked one (the first page where they appear).
 */
function noteAt(items: readonly RankingRow[], previous: RankingRow | undefined): number {
  const first = items.findIndex((row) => row.rank === undefined);
  if (first === -1) return -1;
  if (first > 0) return first;
  return previous === undefined || previous.rank !== undefined ? 0 : -1;
}

/** The "Tu puesto" value of the asker; none in the accuracy order for an asker who is not qualified (their row is in the tail). */
function askerValue(page: RankingPage, order: RankingOrder): string | undefined {
  const asker = page.asker;
  if (asker === undefined) return undefined;
  if ('played' in asker && asker.played === false) return STRINGS.rankingNotPlayed;
  if (typeof asker.played !== 'number' || !('points' in asker) || asker.rank === undefined) return undefined;
  return fill(STRINGS.rankingOwn, { rank: asker.rank, stats: statsText(asker, order) });
}

/** The reply for a community with no counted match: one sentence, no embed, no buttons (FR-570). */
export const rankingEmpty = (): OutMessage => ({ text: STRINGS.rankingEmpty, buttons: [] });

/** The reply when the server refuses or cannot answer: one sentence the member alone sees (FR-571). */
export const rankingUnavailable = (): Reply => ({ type: 'text', text: STRINGS.rankingUnavailable });

/**
 * One page of the ranking as an embed with its plain-text twin (FR-475, FR-569). The message has no buttons here: the paging buttons are
 * added by the paging of the message.
 */
export function rankingEmbed(page: RankingPage, order: RankingOrder, ctx: RankingContext): OutMessage {
  if (page.items.length === 0) return rankingEmpty();
  const pages = rankingPageCount(page.total);
  const footer = fill(STRINGS.boardPage, { page: clampPage(ctx.page, pages), pages });
  const lines = page.items.map((row) => lineOf(row, order));
  const note = noteAt(page.items, ctx.previous);
  if (note !== -1) lines.splice(note, 0, STRINGS.rankingUnrankedNote);
  const own = askerValue(page, order);
  const title = STRINGS.rankingTitle;
  const text = [title, ...lines, footer, ...(own === undefined ? [] : [`${STRINGS.boardOwnField}: ${own}`])].join('\n');
  return {
    text,
    buttons: [],
    embed: { color: COLOR, title, description: lines.join('\n'), fields: own === undefined ? [] : [{ name: STRINGS.boardOwnField, value: own }], footer },
  };
}

const buttonsOf = (page: number, pages: number): ButtonSpec[] => [
  { type: 'custom', customId: rankingId('p', Math.max(1, page - 1)), label: STRINGS.boardPrev, style: 'primary', ...(page <= 1 ? { disabled: true } : {}) },
  { type: 'custom', customId: rankingId('n', Math.min(pages, page + 1)), label: STRINGS.boardNext, style: 'primary', ...(page >= pages ? { disabled: true } : {}) },
];

/**
 * The ranking message of a page: the embed with Previous and Next (disabled on the first and the last page, as the history's) and, when
 * there is more than one page, the walk the shell remembers to page it (FR-569). An empty ranking is the one sentence alone (FR-570).
 */
export function rankingMessage(page: RankingPage, order: RankingOrder, ctx: RankingContext, walk: RankingTag): OutMessage {
  const view = rankingEmbed(page, order, ctx);
  if (page.items.length === 0) return view;
  const pages = rankingPageCount(page.total);
  return { ...view, buttons: buttonsOf(clampPage(ctx.page, pages), pages), ...(pages > 1 ? { ranking: walk } : {}) };
}
