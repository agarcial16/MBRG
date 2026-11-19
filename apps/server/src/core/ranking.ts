import { isNamespace, PAGE_LIMIT_MAX, type RankingAsker, type RankingOrder, type RankingRow } from '@mbrg/protocol';
import { compareHistory, type HistoryKey } from './history';

// Pure core of the per-community ranking (spec 025): the statistics of one player over the counted matches of a snapshot
// and the shown-name rule. No I/O: the store reads the source rows (T1.2), the service passes them here (plan 3).

/** One ranking source row (FR-564): the aggregate of one player in one counted match, as the store reads it. */
export interface RankingSourceRow {
  readonly matchId: string;
  readonly finishedAt: number;
  readonly playerId: string;
  readonly points: number;
  readonly correct: number;
  readonly scored: number;
}

/** One name a counted match stored (FR-563): a source row of the shown-name rule. */
export interface RankingNameRow {
  readonly matchId: string;
  readonly finishedAt: number;
  readonly playerId: string;
  readonly name: string;
}

/** The statistics of one player over the counted matches of a snapshot (FR-564). */
export interface PlayerStats {
  readonly playerId: string;
  /** The sum of the player's points (008 FR-277 totals). */
  readonly points: number;
  /** The player's scored results marked correct (victim, absorber and winner alike). */
  readonly correct: number;
  /** The player's scored results. */
  readonly scored: number;
  /** The counted matches with at least one scored result of the player. */
  readonly played: number;
  /** The counted matches the player won (Definitions: points above 0 and equal to the match's maximum, ties all win). */
  readonly won: number;
}

/** Player ids are ASCII: the code-unit order is the order of `statsOf`'s output. */
const byPlayerId = (a: { readonly playerId: string }, b: { readonly playerId: string }): number => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);

/**
 * The statistics of every player with at least one scored row in the snapshot (FR-563's rows, FR-564's computation),
 * ordered by player id. A source row exists only for a (match, player) with a scored result, so `played` counts the
 * player's rows and a counted match with no scored result contributes nothing. A match is won by every player whose
 * points are above 0 and equal to that match's maximum (a tie at the top gives every tied player a win; a match where
 * nobody has points above 0 is won by nobody, but still counts as played).
 */
export function statsOf(rows: readonly RankingSourceRow[]): readonly PlayerStats[] {
  const maxOfMatch = new Map<string, number>();
  for (const row of rows) {
    const max = maxOfMatch.get(row.matchId);
    if (max === undefined || row.points > max) maxOfMatch.set(row.matchId, row.points);
  }
  const stats = new Map<string, PlayerStats>();
  for (const row of rows) {
    const current = stats.get(row.playerId);
    const won = row.points > 0 && row.points === maxOfMatch.get(row.matchId) ? 1 : 0;
    stats.set(
      row.playerId,
      current === undefined
        ? { playerId: row.playerId, points: row.points, correct: row.correct, scored: row.scored, played: 1, won }
        : {
            playerId: row.playerId,
            points: current.points + row.points,
            correct: current.correct + row.correct,
            scored: current.scored + row.scored,
            played: current.played + 1,
            won: current.won + won,
          },
    );
  }
  return [...stats.values()].sort(byPlayerId);
}

/**
 * The shown name of every player that a counted match of the snapshot stored one for (FR-563): the name of the most
 * recent match in history order (finish instant descending, then match id ascending) that holds one. The names of
 * matches in any other stage never reach this function (the store reads counted matches only, NFR-123).
 */
export function shownNameOf(names: readonly RankingNameRow[]): ReadonlyMap<string, string> {
  const shown = new Map<string, string>();
  const bestOf = new Map<string, HistoryKey>();
  for (const row of names) {
    const key: HistoryKey = { finishedAt: row.finishedAt, matchId: row.matchId };
    const best = bestOf.get(row.playerId);
    if (best === undefined || compareHistory(key, best) < 0) {
      bestOf.set(row.playerId, key);
      shown.set(row.playerId, row.name);
    }
  }
  return shown;
}

/** A player qualified for the accuracy order (FR-566): at least this many scored predictions. */
const QUALIFIED_SCORED = 10;

/** One placed player of the snapshot: their statistics and their competition rank, absent in the unranked tail. */
interface Placed {
  readonly stats: PlayerStats;
  readonly rank?: number;
}

/** Whether `a` is strictly before `b` by the ordering statistic alone (FR-565); ties resolve outside. */
function morePrimary(order: RankingOrder, a: PlayerStats, b: PlayerStats): boolean {
  if (order === 'accuracy') return a.correct * b.scored > b.correct * a.scored;
  const key = order === 'points' ? 'points' : order === 'correct' ? 'correct' : 'won';
  return a[key] > b[key];
}

/** The full order of the snapshot (FR-565, FR-566): the ranked rows by the statistic, then points, then id; the accuracy tail after them. */
const byOrder = (order: RankingOrder, a: PlayerStats, b: PlayerStats): number => {
  if (morePrimary(order, a, b)) return -1;
  if (morePrimary(order, b, a)) return 1;
  if (a.points !== b.points) return a.points > b.points ? -1 : 1;
  return byPlayerId(a, b);
};

/** One page of the ranking of a snapshot, as the service sends it: the wire rows, the snapshot total, the next local id and the asker. */
export interface RankingPageCore {
  readonly rows: readonly RankingRow[];
  readonly total: number;
  /** The local id of the page's last row; the service pairs it with the snapshot head into a `ranking` cursor. */
  readonly next?: string;
  readonly asker?: RankingAsker;
}

/**
 * Orders, ranks and pages the snapshot (FR-565 to FR-567). The order is the statistic descending, then total points
 * descending, then player id ascending; players equal on the ordering statistic share the competition rank. In the
 * accuracy order only qualified players (at least 10 scored predictions) are ranked, by exact fractions
 * (cross-multiplied, never rounded); the rest follow in one unranked tail by points, then id, all counted in the total.
 * The page starts strictly after the row `afterLocalId` names, holds at most `limit` (1 to 500) rows and carries `next`
 * exactly when more follow; a cursor naming a row outside the snapshot is a RangeError. `askerLocalId` adds the asker's
 * own row with their rank (no rank when unqualified in the accuracy order) or the mark that they have no row.
 */
export function rankingOf(
  stats: readonly PlayerStats[],
  names: ReadonlyMap<string, string>,
  order: RankingOrder,
  namespace: string,
  afterLocalId: string | undefined,
  limit: number,
  askerLocalId?: string,
): RankingPageCore {
  if (!isNamespace(namespace)) throw new RangeError('a ranking namespace is 1 to 16 characters of a-z and 0-9');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_LIMIT_MAX) throw new RangeError('a ranking page holds 1 to 500 rows');
  const qualified = (s: PlayerStats): boolean => order !== 'accuracy' || s.scored >= QUALIFIED_SCORED;
  const rankedStats = stats.filter(qualified).sort((a, b) => byOrder(order, a, b));
  const tailStats = order === 'accuracy' ? stats.filter((s) => !qualified(s)).sort((a, b) => byOrder('points', a, b)) : [];
  // Competition ranking (FR-565) in one pass over the sorted rows: a row's rank is 1 plus the rows strictly before it by
  // the ordering statistic alone, so a tie keeps the previous rank instead of the position.
  const all: Placed[] = [];
  let rank = 0;
  for (let i = 0; i < rankedStats.length; i++) {
    const s = rankedStats[i]!;
    if (i === 0 || morePrimary(order, rankedStats[i - 1]!, s)) rank = i + 1;
    all.push({ stats: s, rank });
  }
  for (const s of tailStats) all.push({ stats: s });
  const localOf = (playerId: string): string => {
    if (!playerId.startsWith(`${namespace}:`)) throw new RangeError('a ranking player id is outside the namespace');
    return playerId.slice(namespace.length + 1);
  };
  const localIndexOf = new Map<string, number>();
  all.forEach((p, i) => {
    localIndexOf.set(localOf(p.stats.playerId), i);
  });
  const rowOf = (p: Placed): RankingRow => {
    const name = names.get(p.stats.playerId);
    return {
      playerId: p.stats.playerId,
      ...(name === undefined ? {} : { name }),
      points: p.stats.points,
      correct: p.stats.correct,
      scored: p.stats.scored,
      played: p.stats.played,
      won: p.stats.won,
      ...(p.rank === undefined ? {} : { rank: p.rank }),
    };
  };
  let from = 0;
  if (afterLocalId !== undefined) {
    const at = localIndexOf.get(afterLocalId);
    if (at === undefined) throw new RangeError('the ranking cursor names a row outside the snapshot');
    from = at + 1;
  }
  const slice = all.slice(from, from + limit);
  const last = slice[slice.length - 1];
  const next = from + limit < all.length && last !== undefined ? localOf(last.stats.playerId) : undefined;
  let asker: RankingAsker | undefined;
  if (askerLocalId !== undefined) {
    const at = localIndexOf.get(askerLocalId);
    if (at === undefined) asker = { played: false };
    else {
      const p = all[at]!;
      asker = {
        points: p.stats.points,
        correct: p.stats.correct,
        scored: p.stats.scored,
        played: p.stats.played,
        won: p.stats.won,
        ...(p.rank === undefined ? {} : { rank: p.rank }),
      };
    }
  }
  return {
    rows: slice.map(rowOf),
    total: all.length,
    ...(next === undefined ? {} : { next }),
    ...(asker === undefined ? {} : { asker }),
  };
}
