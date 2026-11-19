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
