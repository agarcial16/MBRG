// The results side of the player interface (spec 013 FR-406, FR-407). Pure: the replies of the server in, the lines the screen shows out.
// A `results` event only says that a phase was scored; the numbers come from the reads, and a wrong guess of another player is never
// part of any input (the winners read carries names of right guesses only).
import { readEvent } from '@mbrg/protocol';
import type { LeaderboardRow, PlayerListItem, PlayerResult } from '@mbrg/protocol';
import { STRINGS, fillTemplate } from './strings';

/** A scored phase: round k, phase 1 (victim) or 2 (absorber). */
export interface Scored {
  readonly round: number;
  readonly phase: 1 | 2;
}

export const scoredKey = (scored: Scored): string => `${scored.round}:${scored.phase}`;

/** The phase a `results` event announces, or undefined for any other frame. */
export function scoredOf(data: unknown): Scored | undefined {
  const read = readEvent(data);
  return read.status === 'known' && read.event.type === 'results' ? { round: read.event.round, phase: read.event.phase } : undefined;
}

const kindOf = (phase: 1 | 2): 'victim' | 'absorber' => (phase === 1 ? 'victim' : 'absorber');

/** The player's scored row of a phase, or undefined when the player predicted nothing there. */
export const resultFor = (items: readonly PlayerResult[], scored: Scored): PlayerResult | undefined =>
  items.find((item) => item.kind === kindOf(scored.phase) && item.round === scored.round);

/** The last scored phase among the player's rows: the highest round, the absorber before the victim within it. */
export function latestScored(items: readonly PlayerResult[]): Scored | undefined {
  let best: Scored | undefined;
  for (const item of items) {
    if ((item.kind !== 'victim' && item.kind !== 'absorber') || item.round === undefined) continue;
    const phase: 1 | 2 = item.kind === 'victim' ? 1 : 2;
    if (best === undefined || item.round > best.round || (item.round === best.round && phase > best.phase)) best = { round: item.round, phase };
  }
  return best;
}

/** FR-406: the competition rank of a player on the leaderboard rows read, or undefined when the player is not listed. */
export const rankOf = (rows: readonly LeaderboardRow[], playerId: string): number | undefined => rows.find((row) => row.playerId === playerId)?.rank;

/** FR-427: the chip in two parts: the name (the screen may shorten it) and the points (always whole, 0 before any score); no rank. */
export function chipParts(name: string, total: number | undefined): { readonly name: string; readonly stats: string } {
  return { name: fillTemplate(STRINGS.chipName, { name }), stats: fillTemplate(STRINGS.chipStats, { total: total ?? 0 }) };
}

/** The accessible label of the chip: the visible text plus the rank when the leaderboard lists the player. */
export function chipText(name: string, total: number | undefined, rank: number | undefined): string {
  const parts = chipParts(name, total);
  return parts.name + parts.stats + (rank === undefined ? '' : fillTemplate(STRINGS.chipRank, { rank }));
}

export interface ResultView {
  readonly title: string;
  readonly lines: readonly string[];
  /** True right, false wrong, undefined when the player did not predict that phase. */
  readonly right: boolean | undefined;
}

/** FR-406: the results panel: right or wrong with the points of the phase, then the total and the rank. */
export function resultView(input: {
  readonly scored: Scored;
  readonly item: PlayerResult | undefined;
  readonly total: number;
  readonly rank: number | undefined;
  readonly nameOf: (faction: number) => string;
  /** The absorber of this round was forced (a single candidate): there was nothing to predict, and the server applied it. */
  readonly forced?: boolean;
}): ResultView {
  const { scored, item, total, rank } = input;
  const what = scored.phase === 1 ? STRINGS.resultVictim : STRINGS.resultAbsorber;
  const head = fillTemplate(what, { round: scored.round });
  const totals = rank === undefined ? fillTemplate(STRINGS.resultTotal, { total }) : fillTemplate(STRINGS.resultTotalRank, { total, rank });
  if (item === undefined) return { title: STRINGS.resultTitle, lines: [head, input.forced === true && scored.phase === 2 ? STRINGS.resultForced : STRINGS.resultNone, totals], right: undefined };
  const verdict = item.correct ? STRINGS.resultRight : STRINGS.resultWrong;
  const points = fillTemplate(STRINGS.resultPoints, { value: item.points });
  const chosen = fillTemplate(STRINGS.resultYourChoice, { name: input.nameOf(item.choice) });
  return { title: STRINGS.resultTitle, lines: [`${head} ${chosen}`, `${verdict} ${points}`, totals], right: item.correct };
}

export interface BoardRow {
  readonly rank: number;
  readonly name: string;
  readonly total: number;
  readonly me: boolean;
}

export interface PinnedRow {
  /** Undefined when the leaderboard does not list the player yet. */
  readonly rank: number | undefined;
  readonly name: string;
  readonly total: number;
  readonly me: true;
}

export interface BoardPage {
  readonly rows: readonly BoardRow[];
  readonly page: number;
  readonly pages: number;
  /** The own row, pinned under the list when the shown page does not hold it. */
  readonly mine?: PinnedRow;
}

/**
 * FR-432: the server's leaderboard lists only players with scores. Every joined player missing from it is added with 0 points; rows are
 * ordered by points (the server order kept for ties, the newcomers after) and ranked as 1 + the players with more points.
 */
export function completeBoard(rows: readonly LeaderboardRow[], roster: readonly PlayerListItem[]): LeaderboardRow[] {
  const listed = new Set(rows.map((row) => row.playerId));
  const added: LeaderboardRow[] = roster
    .filter((p) => !listed.has(p.playerId))
    .map((p) => ({ rank: 0, playerId: p.playerId, total: 0, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0, name: p.name }));
  const ordered = [...rows, ...added].sort((a, b) => b.total - a.total);
  // Sorted by points, so a row's rank is its index unless the row before it has the same points.
  const out: LeaderboardRow[] = [];
  ordered.forEach((row, i) => {
    const before = out[i - 1];
    out.push({ ...row, rank: before !== undefined && before.total === row.total ? before.rank : i + 1 });
  });
  return out;
}

/** The local part of a namespaced player id: what shows for a player the server gave no name. */
const localName = (playerId: string): string => playerId.slice(playerId.indexOf(':') + 1);

/** FR-406: the leaderboard with names, paged, the player highlighted. A page outside the range is clamped. */
export function boardPage(rows: readonly LeaderboardRow[], myId: string, page: number, size = 10, own?: { readonly name: string; readonly total: number }): BoardPage {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  const shown = rows.slice(at * size, at * size + size).map((row) => ({ rank: row.rank, name: row.name ?? localName(row.playerId), total: row.total, me: row.playerId === myId }));
  if (myId === '' || shown.some((row) => row.me)) return { rows: shown, page: at, pages };
  const listed = rows.find((row) => row.playerId === myId);
  if (listed !== undefined) return { rows: shown, page: at, pages, mine: { rank: listed.rank, name: listed.name ?? localName(listed.playerId), total: listed.total, me: true } };
  return own === undefined ? { rows: shown, page: at, pages } : { rows: shown, page: at, pages, mine: { rank: undefined, name: own.name, total: own.total, me: true } };
}

/** The names shown before "ver todos" (FR-407). */
export const WINNERS_HEAD = 3;
/** The names per page once expanded. */
export const WINNERS_PAGE = 10;

export interface WinnersView {
  /** The line of the chronicle; undefined when nobody is to be shown (the line is hidden). */
  readonly line: string | undefined;
  /** "ver todos" is offered. */
  readonly expandable: boolean;
  readonly page: number;
  readonly pages: number;
  /** The names of the page when expanded. */
  readonly names: readonly string[];
}

/**
 * FR-407: the "who guessed right" line for a scored phase: the first names and a count, then the full paged list. `names` are the
 * players who guessed right (the read carries no other); the line says so for the victim or the absorber.
 */
export function winnersView(phase: 1 | 2, names: readonly string[], expanded: boolean, page: number): WinnersView {
  const label = phase === 1 ? STRINGS.winnersVictim : STRINGS.winnersAbsorber;
  const pages = Math.max(1, Math.ceil(names.length / WINNERS_PAGE));
  const at = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  if (names.length === 0) return { line: fillTemplate(label, { names: STRINGS.winnersNobody }), expandable: false, page: 0, pages: 1, names: [] };
  if (expanded) return { line: fillTemplate(label, { names: '' }).trimEnd(), expandable: true, page: at, pages, names: names.slice(at * WINNERS_PAGE, at * WINNERS_PAGE + WINNERS_PAGE) };
  const head = names.slice(0, WINNERS_HEAD).join(', ');
  const more = names.length > WINNERS_HEAD ? fillTemplate(STRINGS.winnersMore, { count: names.length - WINNERS_HEAD }) : '';
  return { line: fillTemplate(label, { names: `${head}${more}` }), expandable: names.length > WINNERS_HEAD, page: 0, pages, names: [] };
}
