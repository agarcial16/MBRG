import { describe, expect, it } from 'vitest';
import { READ_SQL } from '../src/store/sqlite';
import { expectedBoard, expectedRows, openScript, phaseRows, runScript } from './helpers/results-script';

// The results reads of the store (spec 008 M4' T3'): keyset reads over the result rows, a player's total and the leaderboard
// aggregate. The expected values come from the script's own arithmetic (helpers/results-script.ts), not from the scorer.

const play = (done: number) => {
  const r = openScript();
  runScript(r, done);
  return r;
};

describe('the results reads of the store', () => {
  it('FR-275 (store) phaseResultsAfter lists one phase by player id in code unit order, strictly after the key, and no other phase', () => {
    const r = play(12);
    const store = r.h.store;
    const expected = phaseRows(expectedRows(r), 'victim', 1);
    expect(expected.map((x) => x.playerId)).toStrictEqual(['discord:p1', 'web:p1', 'web:p2', 'web:p3', 'web:p4', 'web:p6']);
    const all = store.phaseResultsAfter(r.id, 'victim', 1, undefined, 100);
    expect(all).toStrictEqual(expected.map((x) => ({ playerId: x.playerId, choice: x.choice, correct: x.correct, points: x.points })));
    // Strictly after: the key itself is not repeated; a limit cuts the page; a key past the last player gives nothing.
    expect(store.phaseResultsAfter(r.id, 'victim', 1, 'web:p2', 100).map((x) => x.playerId)).toStrictEqual(['web:p3', 'web:p4', 'web:p6']);
    expect(store.phaseResultsAfter(r.id, 'victim', 1, undefined, 2).map((x) => x.playerId)).toStrictEqual(['discord:p1', 'web:p1']);
    expect(store.phaseResultsAfter(r.id, 'victim', 1, 'web:p6', 100)).toStrictEqual([]);
    expect(store.phaseResultsAfter(r.id, 'victim', 1, 'web:p', 100)[0]!.playerId).toBe('web:p1');
    // Other phases and rounds are separate lists; an unknown match is empty.
    expect(store.phaseResultsAfter(r.id, 'absorber', 1, undefined, 100).map((x) => x.playerId)).toStrictEqual(['discord:p1', 'web:p1', 'web:p2']);
    expect(store.phaseResultsAfter(r.id, 'victim', 4, undefined, 100).map((x) => x.playerId)).toStrictEqual(['web:p5']);
    expect(store.phaseResultsAfter(r.id, 'victim', 5, undefined, 100)).toStrictEqual([]);
    expect(store.phaseResultsAfter('m-unknown', 'victim', 1, undefined, 100)).toStrictEqual([]);
    r.h.close();
  });

  it('FR-275 (store) phaseResultsAfter refuses a kind other than victim and absorber, a round below 1, a bad key and a bad limit', () => {
    const r = play(0);
    const s = r.h.store;
    expect(() => s.phaseResultsAfter(r.id, 'winner' as never, 1, undefined, 10)).toThrow(RangeError);
    expect(() => s.phaseResultsAfter(r.id, 'victim', 0, undefined, 10)).toThrow(RangeError);
    expect(() => s.phaseResultsAfter(r.id, 'victim', 1.5, undefined, 10)).toThrow(RangeError);
    expect(() => s.phaseResultsAfter(r.id, 'victim', 1, 5 as never, 10)).toThrow(RangeError);
    expect(() => s.phaseResultsAfter(r.id, 'victim', 1, undefined, 0)).toThrow(RangeError);
    r.h.close();
  });

  it('FR-276 (store) playerResultsAfter lists one player by round then kind, the winner (round 0) first, strictly after the key', () => {
    const r = play(12);
    const store = r.h.store;
    const mine = expectedRows(r)
      .filter((x) => x.playerId === 'web:p1')
      .sort((a, b) => a.round - b.round || (a.kind < b.kind ? -1 : 1));
    expect(mine.map((x) => `${x.round}${x.kind}`)).toStrictEqual(['0winner', '1absorber', '1victim', '2absorber', '2victim', '3absorber', '3victim']);
    const all = store.playerResultsAfter(r.id, 'web:p1', undefined, 100);
    expect(all).toStrictEqual(mine.map((x) => ({ kind: x.kind, round: x.round, choice: x.choice, correct: x.correct, points: x.points })));
    expect(store.playerResultsAfter(r.id, 'web:p1', [0, 'winner'], 100).map((x) => `${x.round}${x.kind}`)).toStrictEqual(['1absorber', '1victim', '2absorber', '2victim', '3absorber', '3victim']);
    expect(store.playerResultsAfter(r.id, 'web:p1', [1, 'absorber'], 2).map((x) => `${x.round}${x.kind}`)).toStrictEqual(['1victim', '2absorber']);
    expect(store.playerResultsAfter(r.id, 'web:p1', [3, 'victim'], 100)).toStrictEqual([]);
    // The id is matched as a whole: another namespace's same local id is another player.
    expect(store.playerResultsAfter(r.id, 'discord:p1', undefined, 100).map((x) => x.kind)).toStrictEqual(['absorber', 'victim', 'absorber', 'victim']);
    expect(store.playerResultsAfter(r.id, 'web:nobody', undefined, 100)).toStrictEqual([]);
    expect(store.playerResultsAfter(r.id, 'p1', undefined, 100)).toStrictEqual([]);
    expect(() => store.playerResultsAfter(r.id, 'web:p1', [-1, 'victim'], 10)).toThrow(RangeError);
    expect(() => store.playerResultsAfter(r.id, 'web:p1', [1, 'loser' as never], 10)).toThrow(RangeError);
    expect(() => store.playerResultsAfter(r.id, 'web:p1', undefined, 0)).toThrow(RangeError);
    r.h.close();
  });

  it('FR-276 (store) playerTotal sums every stored result of the player and is 0 for a player with none', () => {
    const r = play(12);
    const rows = expectedRows(r);
    for (const player of ['web:p1', 'web:p2', 'web:p3', 'web:p5', 'web:p6', 'discord:p1']) {
      expect(r.h.store.playerTotal(r.id, player), player).toBe(rows.filter((x) => x.playerId === player).reduce((sum, x) => sum + x.points, 0));
    }
    expect(r.h.store.playerTotal(r.id, 'web:p1')).toBeGreaterThan(20);
    expect(r.h.store.playerTotal(r.id, 'web:p2')).toBe(0);
    expect(r.h.store.playerTotal(r.id, 'web:nobody')).toBe(0);
    expect(r.h.store.playerTotal('m-unknown', 'web:p1')).toBe(0);
    r.h.close();
  });

  it('FR-277 (store) leaderboardTotals gives one aggregate per player with a result row, all-zero players included, with the correct counts per kind', () => {
    const r = play(12);
    const rows = expectedRows(r);
    const totals = r.h.store.leaderboardTotals(r.id);
    const board = expectedBoard(rows);
    expect(totals.map((t) => t.playerId)).toStrictEqual(board.map((b) => b.playerId).sort());
    for (const t of totals) {
      const b = board.find((x) => x.playerId === t.playerId)!;
      expect(t, t.playerId).toStrictEqual({ playerId: b.playerId, total: b.total, correctVictims: b.correctVictims, correctAbsorbers: b.correctAbsorbers, correctWinner: b.correctWinner });
    }
    expect(totals.find((t) => t.playerId === 'web:p2')).toMatchObject({ total: 0, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0 });
    expect(totals.find((t) => t.playerId === 'web:p1')!.correctWinner).toBe(1);
    expect(r.h.store.leaderboardTotals('m-unknown')).toStrictEqual([]);
    r.h.close();
  });

  it('FR-277 (store) before anything is scored the reads are empty, and a victim row of the revealed round shows up at the phase-1 close', () => {
    const r = play(0);
    expect(r.h.store.leaderboardTotals(r.id)).toStrictEqual([]);
    expect(r.h.store.phaseResultsAfter(r.id, 'victim', 1, undefined, 10)).toStrictEqual([]);
    runScript(r, 1);
    expect(r.h.store.phaseResultsAfter(r.id, 'victim', 1, undefined, 10)).toHaveLength(6);
    expect(r.h.store.leaderboardTotals(r.id)).toHaveLength(6);
    expect(r.h.store.phaseResultsAfter(r.id, 'absorber', 1, undefined, 10)).toStrictEqual([]);
    r.h.close();
  });

  it('FR-275 (store) the read statements are keyset and aggregate selects on the results table only', () => {
    for (const text of [READ_SQL.phaseResultsAfter, READ_SQL.playerResultsAfter, READ_SQL.playerTotal, READ_SQL.leaderboardTotals]) {
      expect(text).toMatch(/^\s*SELECT\b/);
      expect(text).toMatch(/FROM results WHERE match_id = \?/);
      expect(text).not.toMatch(/predictions|matches|secret|INSERT|UPDATE|DELETE/i);
    }
    expect(READ_SQL.phaseResultsAfter).toContain('player_id > ?');
    expect(READ_SQL.playerResultsAfter).toContain('(round, kind) > (?, ?)');
  });
});
