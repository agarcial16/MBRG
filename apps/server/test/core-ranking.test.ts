import { describe, expect, it } from 'vitest';
import { shownNameOf, statsOf, rankingOf, type PlayerStats, type RankingNameRow, type RankingSourceRow } from '../src/core/ranking';

// Spec 025, pure core of the ranking: the statistics of one player over the snapshot's counted matches (FR-564) and the
// shown-name rule (FR-563). Ids are planted literals no other text of the repository holds.

const T0 = 1_700_000_000_000;
/** One source row: one player's aggregate in one counted match, as the store reads it (FR-564). */
const row = (matchId: string, playerId: string, points: number, correct: number, scored: number): RankingSourceRow => ({
  matchId,
  finishedAt: T0 + 1000,
  playerId,
  points,
  correct,
  scored,
});
const name = (matchId: string, playerId: string, text: string, at = T0 + 1000): RankingNameRow => ({
  matchId,
  finishedAt: at,
  playerId,
  name: text,
});

describe('FR-564 (core part) the statistics of the players of a snapshot', () => {
  // Four counted matches: m3 first so the row order is not the player order, m1 and m2 with u1 and u2 or u3, m3 where
  // everyone has 0 points, m4 with a tie at the top.
  const rows: RankingSourceRow[] = [
    row('RnkM3', 'discord:u3', 0, 0, 1),
    row('RnkM3', 'discord:u1', 0, 0, 1),
    row('RnkM1', 'discord:u2', 2, 1, 2),
    row('RnkM1', 'discord:u1', 3, 1, 2),
    row('RnkM2', 'discord:u3', 0, 0, 1),
    row('RnkM2', 'discord:u1', 3, 1, 1),
    row('RnkM4', 'discord:u3', 1, 0, 2),
    row('RnkM4', 'discord:u2', 5, 1, 2),
    row('RnkM4', 'discord:u1', 5, 1, 3),
  ];

  it('FR-564 (core part) sums the points, the correct rows and the scored rows, and counts the matches played', () => {
    expect(statsOf(rows)).toStrictEqual([
      { playerId: 'discord:u1', points: 11, correct: 3, scored: 7, played: 4, won: 3 },
      { playerId: 'discord:u2', points: 7, correct: 2, scored: 4, played: 2, won: 1 },
      { playerId: 'discord:u3', points: 1, correct: 0, scored: 4, played: 3, won: 0 },
    ]);
  });

  it('FR-564 (core part) a match is won by every player tied at its top points above 0, and by nobody when all have 0', () => {
    // m4: u1 and u2 tie at 5, both win it; u3 at 1 does not. m3: everyone at 0, nobody wins but all played it.
    const stats = new Map(statsOf(rows).map((s) => [s.playerId, s]));
    expect(stats.get('discord:u1')!.won).toBe(3); // m1 (3 beats 2), m2 (alone above 0), m4 (tie at the top)
    expect(stats.get('discord:u2')!.won).toBe(1); // m4 only: m1's 2 loses to u1's 3
    expect(stats.get('discord:u3')!.won).toBe(0); // 0 in m2 and m3, 1 under the tie in m4
    // The all-0 match still counts as played for those with a scored result.
    expect(stats.get('discord:u1')!.played).toBe(4);
    expect(stats.get('discord:u3')!.played).toBe(3);
  });

  it('FR-564 (core part) the input order does not change the statistics, and an empty snapshot has no rows', () => {
    const shuffled = [...rows].reverse();
    expect(statsOf(shuffled)).toStrictEqual(statsOf(rows));
    expect(statsOf([])).toStrictEqual([]);
  });
});

describe('FR-563 (name part) the shown name of a player', () => {
  const names: RankingNameRow[] = [
    name('RnkM1', 'discord:u1', 'Old', T0 + 1000),
    name('RnkM2', 'discord:u1', 'Ana', T0 + 2000),
    name('RnkM4', 'discord:u2', 'Bea', T0 + 4000),
    name('RnkTa', 'discord:u3', 'TieA', T0 + 3000),
    name('RnkTz', 'discord:u3', 'TieZ', T0 + 3000),
  ];

  it('FR-563 (name part) the shown name is the one of the most recent counted match in history order that stored one', () => {
    const shown = shownNameOf(names);
    expect(shown.get('discord:u1')).toBe('Ana');
    expect(shown.get('discord:u2')).toBe('Bea');
    // A tie on the finish instant resolves in history order: the smaller match id is the more recent one.
    expect(shown.get('discord:u3')).toBe('TieA');
    // A player with no stored name has no shown name.
    expect(shown.has('discord:u4')).toBe(false);
    expect([...shown.keys()].sort()).toStrictEqual(['discord:u1', 'discord:u2', 'discord:u3']);
  });

  it('FR-563 (name part) the input order does not change the shown names, and no name means an empty map', () => {
    const shuffled = [...names].reverse();
    expect(shownNameOf(shuffled)).toStrictEqual(shownNameOf(names));
    expect(shownNameOf([]).size).toBe(0);
  });
});

describe('FR-565 (core part) the order and the ranks of the ranking', () => {
  /** One player's statistics, by local id; the match bookkeeping is already folded. */
  const stat = (localId: string, points: number, correct: number, scored: number, played: number, won: number): PlayerStats => ({
    playerId: `discord:${localId}`,
    points,
    correct,
    scored,
    played,
    won,
  });
  const names = new Map([
    ['discord:u1', 'Ana'],
    ['discord:u2', 'Bea'],
  ]);
  const noAfter: string | undefined = undefined;

  it('FR-565 (core part) the points order ranks by points descending, ties share the rank, the rest by player id', () => {
    const stats = [stat('u3', 5, 0, 0, 0, 0), stat('u1', 9, 0, 0, 0, 0), stat('u2', 9, 0, 0, 0, 0), stat('u4', 1, 0, 0, 0, 0)];
    const page = rankingOf(stats, names, 'points', 'discord', noAfter, 10);
    expect(page.rows).toStrictEqual([
      { playerId: 'discord:u1', name: 'Ana', points: 9, correct: 0, scored: 0, played: 0, won: 0, rank: 1 },
      { playerId: 'discord:u2', name: 'Bea', points: 9, correct: 0, scored: 0, played: 0, won: 0, rank: 1 },
      { playerId: 'discord:u3', points: 5, correct: 0, scored: 0, played: 0, won: 0, rank: 3 },
      { playerId: 'discord:u4', points: 1, correct: 0, scored: 0, played: 0, won: 0, rank: 4 },
    ]);
    expect(page.total).toBe(4);
    expect(page.next).toBeUndefined();
  });

  it('FR-565 (core part) the correct and wins orders rank by their statistic, ties on it sharing the rank', () => {
    const stats = [
      stat('u1', 3, 2, 4, 1, 0),
      stat('u2', 9, 2, 4, 1, 1),
      stat('u3', 1, 5, 4, 1, 2),
    ];
    // Correct: u3 (5) first; u1 and u2 tie at 2 and share rank 2, ordered by points then id (u2 has more points).
    expect(rankingOf(stats, names, 'correct', 'discord', noAfter, 10).rows.map((r) => [r.playerId, r.rank])).toStrictEqual([
      ['discord:u3', 1],
      ['discord:u2', 2],
      ['discord:u1', 2],
    ]);
    // Wins: u3 (2) first, u2 (1) second, u1 (0) third.
    expect(rankingOf(stats, names, 'wins', 'discord', noAfter, 10).rows.map((r) => [r.playerId, r.rank])).toStrictEqual([
      ['discord:u3', 1],
      ['discord:u2', 2],
      ['discord:u1', 3],
    ]);
  });

  it('FR-565 (walk part) the page starts strictly after the row the cursor names, and never repeats or skips', () => {
    const stats = [stat('u1', 9, 0, 0, 0, 0), stat('u2', 7, 0, 0, 0, 0), stat('u3', 5, 0, 0, 0, 0), stat('u4', 3, 0, 0, 0, 0)];
    const seen: string[] = [];
    let after: string | undefined;
    for (let round = 0; round < 5; round++) {
      const page = rankingOf(stats, new Map(), 'points', 'discord', after, 2);
      seen.push(...page.rows.map((r) => r.playerId));
      if (page.next === undefined) break;
      after = page.next;
    }
    expect(seen).toStrictEqual(['discord:u1', 'discord:u2', 'discord:u3', 'discord:u4']);
    // A page that ends exactly on the last row carries no cursor: no empty trailing page ever shows.
    const boundary = rankingOf(stats, new Map(), 'points', 'discord', 'u2', 2);
    expect(boundary.rows.map((r) => r.playerId)).toStrictEqual(['discord:u3', 'discord:u4']);
    expect(boundary.next).toBeUndefined();
    // A page past the last row is empty and carries no cursor: no empty trailing page ever shows.
    const past = rankingOf(stats, new Map(), 'points', 'discord', 'u4', 2);
    expect(past.rows).toStrictEqual([]);
    expect(past.next).toBeUndefined();
    expect(past.total).toBe(4);
  });

  it('FR-565 (walk part) the cursor must name a row of the snapshot and the limit is 1 to 500', () => {
    const stats = [stat('u1', 9, 0, 0, 0, 0)];
    expect(() => rankingOf(stats, new Map(), 'points', 'discord', 'uX', 2)).toThrow(RangeError);
    for (const limit of [0, -1, 1.5, 501, Number.NaN]) {
      expect(() => rankingOf(stats, new Map(), 'points', 'discord', noAfter, limit), String(limit)).toThrow(RangeError);
    }
    expect(rankingOf(stats, new Map(), 'points', 'discord', noAfter, 500).rows).toHaveLength(1);
  });
});

describe('FR-566 the accuracy order ranks only the qualified', () => {
  const stat = (localId: string, points: number, correct: number, scored: number): PlayerStats => ({
    playerId: `discord:${localId}`,
    points,
    correct,
    scored,
    played: 1,
    won: 0,
  });
  const noAfter: string | undefined = undefined;

  it('FR-566 ranks by exact fraction the players with at least 10 scored predictions; 1/2 equals 5/10, 199/200 beats 99/100', () => {
    const stats = [
      stat('u1', 20, 10, 20), // 10/20 = 1/2, qualified
      stat('u2', 9, 1, 2), // 1/2 but only 2 scored: not qualified
      stat('u3', 30, 5, 10), // 5/10 = 1/2, qualified
      stat('u4', 40, 199, 200), // 99.5 %
      stat('u5', 1, 99, 100), // 99 %
      stat('u6', 2, 9, 9), // 100 % but only 9 scored: not qualified
    ];
    const page = rankingOf(stats, new Map(), 'accuracy', 'discord', noAfter, 10);
    expect(page.rows).toStrictEqual([
      { playerId: 'discord:u4', points: 40, correct: 199, scored: 200, played: 1, won: 0, rank: 1 },
      { playerId: 'discord:u5', points: 1, correct: 99, scored: 100, played: 1, won: 0, rank: 2 },
      // Equal accuracy of different fractions (10/20 and 5/10): the same rank, ordered by total points.
      { playerId: 'discord:u3', points: 30, correct: 5, scored: 10, played: 1, won: 0, rank: 3 },
      { playerId: 'discord:u1', points: 20, correct: 10, scored: 20, played: 1, won: 0, rank: 3 },
      // The unqualified follow every ranked row, without a rank, by total points then id.
      { playerId: 'discord:u2', points: 9, correct: 1, scored: 2, played: 1, won: 0 },
      { playerId: 'discord:u6', points: 2, correct: 9, scored: 9, played: 1, won: 0 },
    ]);
    expect(page.total).toBe(6);
  });

  it('FR-566 the unranked tail follows every ranked row by total points, then player id, without a rank, counted in the total', () => {
    const stats = [
      stat('u1', 4, 1, 10), // qualified, 10 %
      stat('u2', 9, 1, 9), // tail, more points than u3
      stat('u3', 9, 2, 9), // tail, tied points with u2, id decides
      stat('u4', 1, 1, 9), // tail
    ];
    const page = rankingOf(stats, new Map(), 'accuracy', 'discord', noAfter, 10);
    expect(page.rows.map((r) => [r.playerId, r.rank])).toStrictEqual([
      ['discord:u1', 1],
      ['discord:u2', undefined],
      ['discord:u3', undefined],
      ['discord:u4', undefined],
    ]);
    expect(page.total).toBe(4);
  });
});

describe('FR-567 (core part) the asker row', () => {
  const stat = (localId: string, points: number, correct: number, scored: number): PlayerStats => ({
    playerId: `discord:${localId}`,
    points,
    correct,
    scored,
    played: 1,
    won: 0,
  });
  const noAfter: string | undefined = undefined;

  it('FR-567 (core part) the asker gets their row with their rank, without it when unqualified in the accuracy order, or played false', () => {
    const stats = [stat('u1', 9, 5, 10), stat('u2', 3, 1, 9)];
    const points = rankingOf(stats, new Map(), 'points', 'discord', noAfter, 10, 'u2');
    expect(points.asker).toStrictEqual({ points: 3, correct: 1, scored: 9, played: 1, won: 0, rank: 2 });
    const accuracy = rankingOf(stats, new Map(), 'accuracy', 'discord', noAfter, 10, 'u2');
    expect(accuracy.asker).toStrictEqual({ points: 3, correct: 1, scored: 9, played: 1, won: 0 });
    const absent = rankingOf(stats, new Map(), 'points', 'discord', noAfter, 10, 'u9');
    expect(absent.asker).toStrictEqual({ played: false });
    // No asker named: no asker member.
    expect(rankingOf(stats, new Map(), 'points', 'discord', noAfter, 10).asker).toBeUndefined();
  });
});
