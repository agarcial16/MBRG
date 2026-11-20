import { get } from './http-reads-kit';
import type { Made } from './history-kit';
import type { ServerHarness } from './server-harness';

// The oracle of the ranking tests of spec 027 (the same model as the one inside `http-ranking.test.ts`, a copy because that
// 025 test file is pinned byte for byte): the statistics of every player over a GIVEN set of counted matches, from the public
// reads of those matches alone (the leaderboard for the points, the correct counts and the names; a player's results for the
// scored count; the match maximum for the won rule), and the rows each order must answer. The caller decides which matches
// are in a window (`isInPeriod`); nothing here knows a window or the ranking code.

export interface OracleRow {
  readonly playerId: string;
  readonly name?: string;
  readonly points: number;
  readonly correct: number;
  readonly scored: number;
  readonly played: number;
  readonly won: number;
  readonly rank?: number;
}

interface BoardRow {
  readonly playerId: string;
  readonly total: number;
  readonly correctVictims: number;
  readonly correctAbsorbers: number;
  readonly correctWinner: number;
  readonly name?: string;
}

/** The statistics of every player of `matches` (any order of the array: the shown name follows the NEWEST match that stored one, so the order is by `finishedAt` descending in the caller). */
export async function oracleOf(h: ServerHarness, matchesNewestFirst: readonly Made[]): Promise<Map<string, OracleRow>> {
  const byPlayer = new Map<string, OracleRow & { nameSet: boolean }>();
  // The oldest first, so that a later (newer) name overrides: walk oldest to newest and keep the last name seen.
  for (const made of [...matchesNewestFirst].reverse()) {
    const board = ((await get(h, `/matches/${made.id}/leaderboard?limit=500`)).json() as { items: BoardRow[] }).items;
    const max = board.reduce((top, row) => Math.max(top, row.total), 0);
    for (const row of board) {
      const results = (await get(h, `/matches/${made.id}/players/${row.playerId}/results?limit=500`)).json() as { items: unknown[] };
      const current = byPlayer.get(row.playerId);
      const won = row.total > 0 && row.total === max ? 1 : 0;
      const correct = row.correctVictims + row.correctAbsorbers + row.correctWinner;
      byPlayer.set(row.playerId, {
        playerId: row.playerId,
        points: (current?.points ?? 0) + row.total,
        correct: (current?.correct ?? 0) + correct,
        scored: (current?.scored ?? 0) + results.items.length,
        played: (current?.played ?? 0) + 1,
        won: (current?.won ?? 0) + won,
        // A later match that stored a name replaces it; one that stored none leaves the earlier name.
        ...(row.name !== undefined ? { name: row.name } : current?.name !== undefined ? { name: current.name } : {}),
        nameSet: row.name !== undefined || current?.nameSet === true,
      });
    }
  }
  const out = new Map<string, OracleRow>();
  for (const [playerId, v] of byPlayer) out.set(playerId, { playerId, ...(v.name === undefined ? {} : { name: v.name }), points: v.points, correct: v.correct, scored: v.scored, played: v.played, won: v.won });
  return out;
}

/** The rows one order must answer, derived from the oracle alone: order, competition ranks, the accuracy tail. */
export function expectedRows(oracle: ReadonlyMap<string, OracleRow>, order: string): OracleRow[] {
  const all = [...oracle.values()];
  const morePrimary = (a: OracleRow, b: OracleRow): boolean =>
    order === 'accuracy' ? a.correct * b.scored > b.correct * a.scored : order === 'points' ? a.points > b.points : order === 'correct' ? a.correct > b.correct : a.won > b.won;
  const byOrder = (a: OracleRow, b: OracleRow): number => {
    if (morePrimary(a, b)) return -1;
    if (morePrimary(b, a)) return 1;
    if (a.points !== b.points) return a.points > b.points ? -1 : 1;
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  };
  const qualified = (o: OracleRow): boolean => order !== 'accuracy' || o.scored >= 10;
  const ranked = all.filter(qualified).sort(byOrder);
  const tail = order === 'accuracy' ? all.filter((o) => !qualified(o)).sort((a, b) => byOrder({ ...a, correct: 0, scored: 1 }, { ...b, correct: 0, scored: 1 })) : [];
  const rows: OracleRow[] = [];
  let rank = 0;
  ranked.forEach((o, i) => {
    if (i === 0 || morePrimary(ranked[i - 1]!, o)) rank = i + 1;
    rows.push({ ...o, rank });
  });
  for (const o of tail) rows.push(o);
  return rows;
}
