import { describe, expect, it } from 'vitest';
import { compareHistory, entryOf, withinSnapshot, type HistoryKey } from '../src/core/history';
import { rankLeaderboard, type PlayerTotals } from '../src/core/scoring';

// Spec 024: the pure core of the history: order, snapshot test, and the entry of one counted match from its ranked leaderboard.

const key = (finishedAt: number, matchId: string): HistoryKey => ({ finishedAt, matchId });
const totals = (rows: readonly (readonly [string, number])[]): PlayerTotals[] =>
  rows.map(([playerId, total]) => ({ playerId, total, correctVictims: total, correctAbsorbers: 0, correctWinner: 0 }));
const match = { matchId: 'CoreHist00000001', mapId: 'dev', finishedAt: 1_700_000_042_000, winner: 4 };
const NO_NAMES = new Map<string, string>();

describe('FR-549 (order part) the history order', () => {
  it('FR-549 (order part) finish instant descending, then match id ascending by code unit', () => {
    const keys = [key(10, 'b'), key(30, 'z'), key(30, 'B'), key(20, 'a'), key(30, 'a'), key(10, 'a')];
    expect([...keys].sort(compareHistory).map((k) => `${k.finishedAt}${k.matchId}`)).toStrictEqual(['30B', '30a', '30z', '20a', '10a', '10b']);
    expect(compareHistory(key(5, 'a'), key(5, 'a'))).toBe(0);
    expect(compareHistory(key(6, 'a'), key(5, 'a'))).toBeLessThan(0);
    expect(compareHistory(key(5, 'b'), key(5, 'a'))).toBeGreaterThan(0);
    // Whatever the input order, the sorted order is the same, and every pair has a strict position unless equal.
    const a = [...keys].sort(compareHistory);
    const b = [...keys].reverse().sort(compareHistory);
    expect(b).toStrictEqual(a);
  });

  it('FR-549 (snapshot part) withinSnapshot keeps exactly the keys at or after the head in history order', () => {
    const head = key(20, 'm5');
    expect(withinSnapshot(head, head)).toBe(true);
    expect(withinSnapshot(key(20, 'm6'), head)).toBe(true);
    expect(withinSnapshot(key(19, 'a'), head)).toBe(true);
    expect(withinSnapshot(key(0, 'a'), head)).toBe(true);
    // Newer than the head: a later finish instant, or the same instant with a lower match id.
    expect(withinSnapshot(key(21, 'z'), head)).toBe(false);
    expect(withinSnapshot(key(20, 'm4'), head)).toBe(false);
    expect(withinSnapshot(key(20, 'M9'), head)).toBe(false);
    const all = [key(30, 'a'), key(20, 'm4'), key(20, 'm5'), key(20, 'm6'), key(10, 'a')];
    expect(all.filter((k) => withinSnapshot(k, head))).toStrictEqual([key(20, 'm5'), key(20, 'm6'), key(10, 'a')]);
  });
});

describe('FR-550 FR-551 (core part) the entry of a counted match', () => {
  it('FR-550 (core part) carries the match data and the top 5 of the rows above 0 points, in leaderboard order, with names where stored', () => {
    const ranked = rankLeaderboard(totals([['discord:3', 5], ['discord:1', 9], ['discord:2', 9], ['discord:4', 2]]));
    const names = new Map([['discord:1', 'Ana'], ['discord:4', 'Dan']]);
    expect(entryOf(match, ranked, names)).toStrictEqual({
      matchId: 'CoreHist00000001',
      mapId: 'dev',
      finishedAt: 1_700_000_042_000,
      winner: 4,
      playerCount: 4,
      top: [
        { playerId: 'discord:1', name: 'Ana', points: 9, rank: 1 },
        { playerId: 'discord:2', points: 9, rank: 1 },
        { playerId: 'discord:3', points: 5, rank: 3 },
        { playerId: 'discord:4', name: 'Dan', points: 2, rank: 4 },
      ],
      more: 0,
    });
  });

  it('FR-550 (core part) with more than 5 rows above 0 the top is the first 5 and `more` counts the rest above 0, ties at the 5th place included', () => {
    const ranked = rankLeaderboard(totals([['d:1', 9], ['d:2', 9], ['d:3', 7], ['d:4', 5], ['d:5', 5], ['d:6', 5], ['d:7', 3], ['d:8', 0], ['d:9', 0]]));
    const entry = entryOf(match, ranked, NO_NAMES);
    expect(entry.top.map((r) => r.playerId)).toStrictEqual(['d:1', 'd:2', 'd:3', 'd:4', 'd:5']);
    expect(entry.top.map((r) => r.rank)).toStrictEqual([1, 1, 3, 4, 4]);
    // d:6 shares the 4th place with the two shown and is counted in `more` with d:7; the two 0-point rows are not.
    expect(entry.more).toBe(2);
    expect(entry.playerCount).toBe(9);
    // Exactly 5 above 0: no `more`; exactly 6: one.
    expect(entryOf(match, rankLeaderboard(totals([['d:1', 5], ['d:2', 4], ['d:3', 3], ['d:4', 2], ['d:5', 1], ['d:6', 0]])), NO_NAMES).more).toBe(0);
    expect(entryOf(match, rankLeaderboard(totals([['d:1', 5], ['d:2', 4], ['d:3', 3], ['d:4', 2], ['d:5', 1], ['d:6', 1]])), NO_NAMES).more).toBe(1);
  });

  it('FR-550 (core part) the player count counts the 0-point rows', () => {
    const ranked = rankLeaderboard(totals([['d:1', 3], ['d:2', 0], ['d:3', 0]]));
    const entry = entryOf(match, ranked, NO_NAMES);
    expect(entry.playerCount).toBe(3);
    expect(entry.top.map((r) => r.playerId)).toStrictEqual(['d:1']);
    expect(entry.more).toBe(0);
  });

  it('FR-550 (core part) a match with only 0-point rows, or no row at all, has an empty top', () => {
    const zeros = entryOf(match, rankLeaderboard(totals([['d:1', 0], ['d:2', 0]])), NO_NAMES);
    expect(zeros).toStrictEqual({ ...match, playerCount: 2, top: [], more: 0 });
    const none = entryOf(match, [], NO_NAMES);
    expect(none).toStrictEqual({ ...match, playerCount: 0, top: [], more: 0 });
  });

  it('FR-551 (core part) the asker gets their row, 0 points included, or { played: false }; no asker leaves the member out', () => {
    const ranked = rankLeaderboard(totals([['discord:1', 9], ['discord:2', 4], ['discord:3', 0]]));
    expect(entryOf(match, ranked, NO_NAMES, 'discord:2').asker).toStrictEqual({ points: 4, rank: 2 });
    expect(entryOf(match, ranked, NO_NAMES, 'discord:3').asker).toStrictEqual({ points: 0, rank: 3 });
    expect(entryOf(match, ranked, NO_NAMES, 'discord:9').asker).toStrictEqual({ played: false });
    // The same local id under another namespace is another player.
    expect(entryOf(match, ranked, NO_NAMES, 'web:1').asker).toStrictEqual({ played: false });
    expect(entryOf(match, [], NO_NAMES, 'discord:1').asker).toStrictEqual({ played: false });
    const without = entryOf(match, ranked, NO_NAMES);
    expect(Object.prototype.hasOwnProperty.call(without, 'asker')).toBe(false);
    // An asker beyond the top still gets their own row.
    const long = rankLeaderboard(totals(Array.from({ length: 8 }, (_, i) => [`discord:${i + 1}`, 10 - i] as const)));
    expect(entryOf(match, long, NO_NAMES, 'discord:8').asker).toStrictEqual({ points: 3, rank: 8 });
    expect(entryOf(match, long, NO_NAMES, 'discord:8').top).toHaveLength(5);
  });

  it('FR-550 (core part) the entry holds no member outside the plan and the input is not changed', () => {
    const ranked = rankLeaderboard(totals([['d:1', 2]]));
    const before = JSON.stringify(ranked);
    const entry = entryOf({ ...match, extra: 'x', community: 'k' } as never, ranked, new Map([['d:1', 'Ana']]), 'd:1');
    expect(Object.keys(entry)).toStrictEqual(['matchId', 'mapId', 'finishedAt', 'winner', 'playerCount', 'top', 'more', 'asker']);
    expect(Object.keys(entry.top[0]!)).toStrictEqual(['playerId', 'name', 'points', 'rank']);
    expect(JSON.stringify(ranked)).toBe(before);
  });
});
