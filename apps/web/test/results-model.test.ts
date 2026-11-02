import { describe, expect, it } from 'vitest';
import { encodeEvent } from '@mbrg/protocol';
import type { LeaderboardRow, PlayerResult } from '@mbrg/protocol';
import {
  WINNERS_HEAD,
  WINNERS_PAGE,
  boardPage,
  chipParts,
  chipText,
  latestScored,
  rankOf,
  resultFor,
  resultView,
  scoredKey,
  scoredOf,
  winnersView,
} from '../src/core/results-model';

const names = (id: number): string => `F${id}`;
const row = (rank: number, playerId: string, total: number, name?: string): LeaderboardRow => ({
  rank, playerId, total, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0, ...(name === undefined ? {} : { name }),
});

describe('FR-406 the scored phase', () => {
  it('FR-406 a results event names the round and the phase; any other frame names nothing', () => {
    expect(scoredOf(JSON.parse(encodeEvent({ type: 'results', seq: 9, round: 3, phase: 2 })))).toStrictEqual({ round: 3, phase: 2 });
    expect(scoredOf(JSON.parse(encodeEvent({ type: 'phase-closed', seq: 8, round: 3, phase: 2, at: 1 })))).toBeUndefined();
    expect(scoredOf({ type: 'results', seq: 1 })).toBeUndefined();
    expect(scoredOf(null)).toBeUndefined();
    expect(scoredKey({ round: 3, phase: 1 })).toBe('3:1');
  });

  const items: PlayerResult[] = [
    { kind: 'victim', round: 2, choice: 4, correct: true, points: 10 },
    { kind: 'absorber', round: 2, choice: 5, correct: false, points: 0 },
    { kind: 'victim', round: 3, choice: 6, correct: false, points: 0 },
    { kind: 'winner', choice: 7, correct: false, points: 0 },
  ];

  it('FR-406 the row of a phase is the victim row for phase 1 and the absorber row for phase 2', () => {
    expect(resultFor(items, { round: 2, phase: 1 })?.choice).toBe(4);
    expect(resultFor(items, { round: 2, phase: 2 })?.choice).toBe(5);
    expect(resultFor(items, { round: 3, phase: 2 })).toBeUndefined();
    expect(resultFor(items, { round: 9, phase: 1 })).toBeUndefined();
  });

  it('FR-406 the latest scored phase is the highest round, the absorber before the victim', () => {
    expect(latestScored(items)).toStrictEqual({ round: 3, phase: 1 });
    expect(latestScored(items.slice(0, 2))).toStrictEqual({ round: 2, phase: 2 });
    expect(latestScored([items[3] as PlayerResult])).toBeUndefined();
    expect(latestScored([])).toBeUndefined();
  });
});

describe('FR-406 the chip and the results panel', () => {
  it('FR-406 the chip shows the name, and the total and rank once scored', () => {
    expect(chipText('Ana', undefined, undefined)).toBe('Tú: Ana');
    expect(chipText('Ana', 20, undefined)).toBe('Tú: Ana');
    expect(chipText('Ana', 20, 3)).toBe('Tú: Ana · 20 pts · puesto 3');
    expect(chipText('Ana', 0, 1)).toBe('Tú: Ana · 0 pts · puesto 1');
  });

  it('FR-406 the chip splits into the name and the score so the screen can shorten the name only', () => {
    expect(chipParts('Ana', undefined, undefined)).toStrictEqual({ name: 'Tú: Ana', stats: '' });
    expect(chipParts('Ana', 20, 3)).toStrictEqual({ name: 'Tú: Ana', stats: ' · 20 pts · puesto 3' });
    expect(chipParts('Ana', 20, 3).name + chipParts('Ana', 20, 3).stats).toBe(chipText('Ana', 20, 3));
  });

  it('FR-406 a right guess says right with its points, the total and the rank', () => {
    const view = resultView({ scored: { round: 2, phase: 1 }, item: { kind: 'victim', round: 2, choice: 4, correct: true, points: 10 }, total: 30, rank: 2, nameOf: names });
    expect(view.right).toBe(true);
    expect(view.lines.join(' ')).toContain('Acertaste');
    expect(view.lines.join(' ')).toContain('10 puntos');
    expect(view.lines.join(' ')).toContain('F4');
    expect(view.lines.join(' ')).toContain('Total: 30');
    expect(view.lines.join(' ')).toContain('puesto 2');
    expect(view.lines[0]).toContain('víctima');
  });

  it('FR-406 a wrong guess and a phase with no prediction are said plainly', () => {
    const wrong = resultView({ scored: { round: 5, phase: 2 }, item: { kind: 'absorber', round: 5, choice: 8, correct: false, points: 0 }, total: 0, rank: undefined, nameOf: names });
    expect(wrong.right).toBe(false);
    expect(wrong.lines.join(' ')).toContain('Fallaste');
    expect(wrong.lines[0]).toContain('absorbente');
    expect(wrong.lines[2]).not.toContain('puesto');
    const none = resultView({ scored: { round: 5, phase: 1 }, item: undefined, total: 4, rank: 7, nameOf: names });
    expect(none.right).toBeUndefined();
    expect(none.lines.join(' ')).toContain('No predijiste');
    expect(none.lines.join(' ')).toContain('puesto 7');
  });

  it('FR-406 a forced absorber is said to be applied without a prediction, not as a missed prediction', () => {
    const forced = resultView({ scored: { round: 3, phase: 2 }, item: undefined, total: 4, rank: 1, nameOf: names, forced: true });
    expect(forced.lines.join(' ')).toContain('forzado');
    expect(forced.lines.join(' ')).not.toContain('No predijiste');
    const victimNone = resultView({ scored: { round: 3, phase: 1 }, item: undefined, total: 4, rank: 1, nameOf: names, forced: true });
    expect(victimNone.lines.join(' ')).toContain('No predijiste');
  });

  it('FR-406 the rank is the competition rank of the player row', () => {
    const rows = [row(1, 'player:a', 9, 'A'), row(2, 'player:b', 5, 'B'), row(2, 'player:c', 5, 'C')];
    expect(rankOf(rows, 'player:c')).toBe(2);
    expect(rankOf(rows, 'player:zz')).toBeUndefined();
  });
});

describe('FR-406 the leaderboard', () => {
  const rows = Array.from({ length: 23 }, (_, i) => row(i + 1, `player:p${i}`, 100 - i, i === 4 ? undefined : `N${i}`));

  it('FR-406 is paged by ten with names, the player highlighted', () => {
    const first = boardPage(rows, 'player:p4', 0);
    expect(first.rows).toHaveLength(10);
    expect(first.pages).toBe(3);
    expect(first.rows[0]).toStrictEqual({ rank: 1, name: 'N0', total: 100, me: false });
    expect(first.rows[4]).toStrictEqual({ rank: 5, name: 'p4', total: 96, me: true });
    expect(boardPage(rows, 'x', 2).rows).toHaveLength(3);
  });

  it('FR-406 the own row is pinned when it is not on the shown page, or not listed at all', () => {
    expect(boardPage(rows, 'player:p4', 0).mine).toBeUndefined();
    expect(boardPage(rows, 'x', 0).mine).toBeUndefined();
    expect(boardPage(rows, 'player:p15', 0).mine).toStrictEqual({ rank: 16, name: 'N15', total: 85, me: true });
    expect(boardPage(rows, 'player:me', 0, 10, { name: 'Ana', total: 7 }).mine).toStrictEqual({ rank: undefined, name: 'Ana', total: 7, me: true });
    expect(boardPage(rows, '', 0, 10, { name: 'Ana', total: 7 }).mine).toBeUndefined();
    expect(boardPage([], 'player:me', 0, 10, { name: 'Ana', total: 0 }).mine?.name).toBe('Ana');
  });

  it('FR-406 a page outside the range is clamped and an empty board has one empty page', () => {
    expect(boardPage(rows, 'x', 9).page).toBe(2);
    expect(boardPage(rows, 'x', -3).page).toBe(0);
    expect(boardPage([], 'x', 0)).toStrictEqual({ rows: [], page: 0, pages: 1 });
    expect(boardPage(rows, 'x', 1, 5).rows[0]?.rank).toBe(6);
  });
});

describe('FR-407 who guessed right', () => {
  const many = Array.from({ length: 25 }, (_, i) => `N${i}`);

  it('FR-407 shows the first names and a count of the rest', () => {
    const view = winnersView(1, many, false, 0);
    expect(view.line).toBe(`Acertaron la víctima: ${many.slice(0, WINNERS_HEAD).join(', ')} y ${many.length - WINNERS_HEAD} más`);
    expect(view.expandable).toBe(true);
    expect(view.names).toStrictEqual([]);
  });

  it('FR-407 names the absorber for phase 2 and lists few names whole with no "ver todos"', () => {
    const view = winnersView(2, ['Ana', 'Beto'], false, 0);
    expect(view.line).toBe('Acertaron el absorbente: Ana, Beto');
    expect(view.expandable).toBe(false);
    expect(winnersView(1, ['A', 'B', 'C'], false, 0).expandable).toBe(false);
    expect(winnersView(1, ['A', 'B', 'C'], false, 0).line).toBe('Acertaron la víctima: A, B, C');
    expect(winnersView(1, ['A', 'B', 'C', 'D'], false, 0).line).toContain('y 1 más');
  });

  it('FR-407 the expanded list is paged', () => {
    const first = winnersView(1, many, true, 0);
    expect(first.names).toHaveLength(WINNERS_PAGE);
    expect(first.pages).toBe(3);
    expect(winnersView(1, many, true, 2).names).toStrictEqual(many.slice(20));
    expect(winnersView(1, many, true, 99).page).toBe(2);
    expect(winnersView(1, many, true, -1).page).toBe(0);
  });

  it('FR-407 nobody right says so and holds no wrong guess', () => {
    const view = winnersView(1, [], false, 0);
    expect(view.line).toBe('Acertaron la víctima: nadie');
    expect(view.expandable).toBe(false);
  });
});
