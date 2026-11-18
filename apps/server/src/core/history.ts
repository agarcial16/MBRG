import type { HistoryAsker, HistoryEntry, HistoryTopRow } from '@mbrg/protocol';
import type { LeaderboardEntry } from './scoring';

// Pure core of the per-community history (spec 024): the history order, the snapshot test and the entry of one counted match.
// No I/O: the store reads the matches and their leaderboards, the service passes them here (plan 4).

/** The position of a counted match in history order (FR-549): its finish instant and its id. */
export interface HistoryKey {
  readonly finishedAt: number;
  readonly matchId: string;
}

/** What the store gives of a counted match: its key, its map and its winning faction. */
export interface HistoryMatch extends HistoryKey {
  readonly mapId: string;
  readonly winner: number;
}

/** The most rows of the top of an entry (FR-550). */
const TOP_ROWS = 5;

/** History order (FR-549): finish instant descending, then match id ascending by code unit (SQLite's BINARY order). */
export function compareHistory(a: HistoryKey, b: HistoryKey): number {
  if (a.finishedAt !== b.finishedAt) return a.finishedAt > b.finishedAt ? -1 : 1;
  if (a.matchId === b.matchId) return 0;
  return a.matchId < b.matchId ? -1 : 1;
}

/** Whether `key` is at or after `head` in history order: the matches a walk anchored at `head` lists and counts (FR-549). */
export function withinSnapshot(key: HistoryKey, head: HistoryKey): boolean {
  return compareHistory(key, head) >= 0;
}

/**
 * The entry of one counted match from its ranked leaderboard (FR-550, FR-551). The top holds the first 5 rows above 0 points in
 * leaderboard order, `more` the rows above 0 left out (ties at the 5th place included), the player count every row, 0-point rows
 * too. `askerId` is the namespaced player id of the asker: the entry carries their row (0 points included) or `{ played: false }`,
 * and no `asker` member when the request named nobody. `names` holds the names stored for this match (022).
 */
export function entryOf(match: HistoryMatch, ranked: readonly LeaderboardEntry[], names: ReadonlyMap<string, string>, askerId?: string): HistoryEntry {
  const scoring = ranked.filter((row) => row.total > 0);
  const top: HistoryTopRow[] = scoring.slice(0, TOP_ROWS).map((row) => {
    const name = names.get(row.playerId);
    return { playerId: row.playerId, ...(name === undefined ? {} : { name }), points: row.total, rank: row.rank };
  });
  const base = {
    matchId: match.matchId,
    mapId: match.mapId,
    finishedAt: match.finishedAt,
    winner: match.winner,
    playerCount: ranked.length,
    top,
    more: scoring.length - top.length,
  };
  if (askerId === undefined) return base;
  const row = ranked.find((r) => r.playerId === askerId);
  const asker: HistoryAsker = row === undefined ? { played: false } : { points: row.total, rank: row.rank };
  return { ...base, asker };
}
