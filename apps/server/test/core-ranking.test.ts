import { describe, expect, it } from 'vitest';
import { shownNameOf, statsOf, type RankingNameRow, type RankingSourceRow } from '../src/core/ranking';

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
