import { describe, expect, it } from 'vitest';
import {
  PERIOD_LENGTH_MS,
  isInPeriod,
  periodFloorOf,
  rankingOf,
  shownNameOf,
  statsOf,
  type RankingNameRow,
  type RankingSourceRow,
} from '../src/core/ranking';

// Spec 027 (M1, pure part): the floor of a period from a clock reading, the membership of a finish instant, and the proof that the
// statistics fold of 025 measures everything inside the period when it is given the rows inside it (the store applies the floor;
// here `isInPeriod` is the oracle that plays the store). Ids are planted literals no other text of the repository holds.

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

describe('NFR-131 (core part) the floor of a period and the membership of an instant', () => {
  it('NFR-131 (core part) the period lengths are 7 and 30 days in whole milliseconds, and all time has none', () => {
    expect(PERIOD_LENGTH_MS).toStrictEqual({ 'last-7-days': 7 * 86_400_000, 'last-30-days': 30 * 86_400_000 });
    expect(PERIOD_LENGTH_MS['last-7-days']).toBe(604_800_000);
    expect(PERIOD_LENGTH_MS['last-30-days']).toBe(2_592_000_000);
    expect('all' in PERIOD_LENGTH_MS).toBe(false);
  });

  it('NFR-131 (core part) the floor of all time is none and the others are the clock minus the length', () => {
    expect(periodFloorOf('all', NOW)).toBeUndefined();
    expect(periodFloorOf('last-7-days', NOW)).toBe(NOW - 7 * DAY);
    expect(periodFloorOf('last-30-days', NOW)).toBe(NOW - 30 * DAY);
    // A test clock near 0 gives a negative floor, and a clock reading of 0 is a clock reading.
    expect(periodFloorOf('last-7-days', 1000)).toBe(1000 - 7 * DAY);
    expect(periodFloorOf('last-30-days', 0)).toBe(-30 * DAY);
    expect(periodFloorOf('all', 0)).toBeUndefined();
  });

  it('NFR-131 (core part) a clock reading that is not a whole number is a RangeError, for every period', () => {
    for (const now of [NOW + 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 9_007_199_254_740_992, '5', null, undefined, 10n]) {
      for (const period of ['all', 'last-7-days', 'last-30-days'] as const) {
        expect(() => periodFloorOf(period, now as never), `${period} ${String(now)}`).toThrow(RangeError);
      }
    }
    expect(() => periodFloorOf('week' as never, NOW)).toThrow(RangeError);
    expect(() => periodFloorOf('window' as never, NOW)).toThrow(RangeError);
  });

  it('NFR-131 (core part) an instant at the floor is in, 1 ms before is out, and with no floor every instant is in', () => {
    const floor = NOW - 7 * DAY;
    expect(isInPeriod(floor, floor)).toBe(true);
    expect(isInPeriod(floor + 1, floor)).toBe(true);
    expect(isInPeriod(floor - 1, floor)).toBe(false);
    expect(isInPeriod(0, floor)).toBe(false);
    for (const at of [0, 1, floor, NOW, 9_007_199_254_740_991]) expect(isInPeriod(at, undefined), String(at)).toBe(true);
    // A negative floor (a test clock near 0) works the same.
    expect(isInPeriod(-7 * DAY, -7 * DAY)).toBe(true);
    expect(isInPeriod(-7 * DAY - 1, -7 * DAY)).toBe(false);
  });

  it('NFR-131 (core part) the membership agrees with the floor of each period at the clock reading', () => {
    for (const period of ['last-7-days', 'last-30-days'] as const) {
      const floor = periodFloorOf(period, NOW);
      expect(isInPeriod(NOW - PERIOD_LENGTH_MS[period], floor), period).toBe(true);
      expect(isInPeriod(NOW - PERIOD_LENGTH_MS[period] - 1, floor), period).toBe(false);
      expect(isInPeriod(NOW, floor), period).toBe(true);
    }
    // 8 days ago is out of the week and in the month.
    expect(isInPeriod(NOW - 8 * DAY, periodFloorOf('last-7-days', NOW))).toBe(false);
    expect(isInPeriod(NOW - 8 * DAY, periodFloorOf('last-30-days', NOW))).toBe(true);
  });
});

describe('FR-577 (core part) the unchanged folds measure only the rows inside the period', () => {
  const FLOOR = NOW - 7 * DAY;
  const row = (matchId: string, at: number, playerId: string, points: number, correct: number, scored: number): RankingSourceRow => ({ matchId, finishedAt: at, playerId, points, correct, scored });
  const nm = (matchId: string, at: number, playerId: string, name: string): RankingNameRow => ({ matchId, finishedAt: at, playerId, name });
  /** The store's job, played by the oracle: keep what is in the period. */
  const inside = <T extends { finishedAt: number }>(rows: readonly T[]): T[] => rows.filter((r) => isInPeriod(r.finishedAt, FLOOR));

  // Four matches: two inside (at the floor and a day later), two outside (1 ms before and long ago).
  const rows: RankingSourceRow[] = [
    // u1: 9 scored predictions inside the period and 40 outside (two matches of 20 outside).
    row('RnkIn1', FLOOR, 'discord:u1', 6, 3, 5),
    row('RnkIn2', FLOOR + DAY, 'discord:u1', 4, 2, 4),
    row('RnkOutA', FLOOR - 1, 'discord:u1', 20, 15, 20),
    row('RnkOutB', FLOOR - 30 * DAY, 'discord:u1', 20, 18, 20),
    // u2: exactly 10 scored inside, and rows outside.
    row('RnkIn1', FLOOR, 'discord:u2', 3, 2, 4),
    row('RnkIn2', FLOOR + DAY, 'discord:u2', 5, 4, 6),
    row('RnkOutA', FLOOR - 1, 'discord:u2', 1, 1, 3),
    // u3: only outside.
    row('RnkOutA', FLOOR - 1, 'discord:u3', 9, 9, 9),
    row('RnkOutB', FLOOR - 30 * DAY, 'discord:u3', 8, 8, 8),
    // u4: only inside, a single row.
    row('RnkIn2', FLOOR + DAY, 'discord:u4', 1, 0, 1),
  ];
  const names: RankingNameRow[] = [
    nm('RnkIn1', FLOOR, 'discord:u1', 'InsideName'),
    nm('RnkOutA', FLOOR - 1, 'discord:u1', 'JustOutName'),
    nm('RnkOutB', FLOOR - 30 * DAY, 'discord:u3', 'OnlyOutName'),
    nm('RnkOutA', FLOOR - 1, 'discord:u2', 'NewestIsOutName'),
    nm('RnkIn2', FLOOR + DAY, 'discord:u2', 'InsideTwoName'),
  ];

  it('FR-577 (core part) the statistics are the sums over the rows inside, and a player whose rows are all outside has no row', () => {
    expect(statsOf(inside(rows))).toStrictEqual([
      { playerId: 'discord:u1', points: 10, correct: 5, scored: 9, played: 2, won: 1 },
      { playerId: 'discord:u2', points: 8, correct: 6, scored: 10, played: 2, won: 1 },
      { playerId: 'discord:u4', points: 1, correct: 0, scored: 1, played: 1, won: 0 },
    ]);
    // Without the oracle the same fold reads everything: the bound is what changes the answer, not the fold.
    expect(statsOf(rows).map((s) => s.playerId)).toStrictEqual(['discord:u1', 'discord:u2', 'discord:u3', 'discord:u4']);
    expect(statsOf(inside(rows)).some((s) => s.playerId === 'discord:u3')).toBe(false);
  });

  it('FR-577 (core part) a player with 9 scored inside the period and 40 outside is in the accuracy tail; with 10 inside is ranked', () => {
    const stats = statsOf(inside(rows));
    const page = rankingOf(stats, new Map(), 'accuracy', 'discord', undefined, 100, 'u1');
    const byId = new Map(page.rows.map((r) => [r.playerId, r]));
    expect(byId.get('discord:u1')).toMatchObject({ scored: 9 });
    expect(byId.get('discord:u1')!.rank).toBeUndefined();
    expect(byId.get('discord:u2')).toMatchObject({ scored: 10, rank: 1 });
    expect(byId.get('discord:u4')!.rank).toBeUndefined();
    // The ranked row first, then the tail by points: u1 (10 points) before u4 (1 point).
    expect(page.rows.map((r) => r.playerId)).toStrictEqual(['discord:u2', 'discord:u1', 'discord:u4']);
    expect(page.total).toBe(3);
    // The asker, unqualified inside the period, has statistics but no rank.
    expect(page.asker).toStrictEqual({ points: 10, correct: 5, scored: 9, played: 2, won: 1 });
    // Over all time the same player has 49 scored and would qualify: the scope is the period, not the history.
    const wide = rankingOf(statsOf(rows), new Map(), 'accuracy', 'discord', undefined, 100);
    expect(wide.rows.find((r) => r.playerId === 'discord:u1')).toMatchObject({ scored: 49, rank: expect.any(Number) });
  });

  it('FR-577 (core part) every order, rank, total and asker is measured inside the period', () => {
    const stats = statsOf(inside(rows));
    for (const order of ['points', 'correct', 'wins'] as const) {
      const page = rankingOf(stats, new Map(), order, 'discord', undefined, 100, 'u3');
      expect(page.total, order).toBe(3);
      expect(page.rows.every((r) => r.playerId !== 'discord:u3'), order).toBe(true);
      // The asker played only outside the period: no row at all.
      expect(page.asker, order).toStrictEqual({ played: false });
    }
    expect(rankingOf(stats, new Map(), 'points', 'discord', undefined, 100).rows.map((r) => [r.playerId, r.rank])).toStrictEqual([
      ['discord:u1', 1],
      ['discord:u2', 2],
      ['discord:u4', 3],
    ]);
  });

  it('FR-577 (core part) a name stored only outside the period is not shown, and the newest name inside wins over a newer one outside', () => {
    const shown = shownNameOf(inside(names));
    expect(shown.get('discord:u1')).toBe('InsideName');
    expect(shown.has('discord:u3')).toBe(false);
    expect(shown.get('discord:u2')).toBe('InsideTwoName');
    const everything = shownNameOf(names);
    expect(everything.get('discord:u3')).toBe('OnlyOutName');
    expect(everything.get('discord:u1')).toBe('InsideName');
    expect(everything.get('discord:u2')).toBe('InsideTwoName');
  });

  it('FR-577 (core part) an empty period folds to an empty ranking with no asker row', () => {
    const none = inside(rows.map((r) => ({ ...r, finishedAt: FLOOR - 1 })));
    expect(none).toStrictEqual([]);
    const page = rankingOf(statsOf(none), shownNameOf([]), 'points', 'discord', undefined, 100, 'u1');
    expect(page).toStrictEqual({ rows: [], total: 0, asker: { played: false } });
  });
});
