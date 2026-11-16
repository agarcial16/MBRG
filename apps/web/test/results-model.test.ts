import { describe, expect, it } from 'vitest';
import { encodeEvent } from '@mbrg/protocol';
import type { LeaderboardRow, PlayerResult } from '@mbrg/protocol';
import { STRINGS } from '../src/core/strings';
import {
  WINNERS_HEAD,
  WINNERS_PAGE,
  chipParts,
  chipText,
  championLine,
  latestScored,
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
  it('FR-427 the accessible label has the name, the points (0 before any score) and the rank when known', () => {
    expect(chipText('Ana', undefined, undefined)).toBe('Ana · 0 pts');
    expect(chipText('Ana', 20, undefined)).toBe('Ana · 20 pts');
    expect(chipText('Ana', 20, 3)).toBe('Ana · 20 pts · 3.º');
    expect(chipText('Ana', 0, 1)).toBe('Ana · 0 pts · 1.º');
  });

  it('FR-449 the chip adds the place when the board lists the player', () => {
    expect(chipParts('Ana', 20, 2)).toStrictEqual({ name: 'Ana', stats: ' · 20 pts · 2.º' });
  });

  it('FR-427 the visible chip without a place is the name and the points, without "Tú:"', () => {
    expect(chipParts('Ana', undefined)).toStrictEqual({ name: 'Ana', stats: ' · 0 pts' });
    expect(chipParts('Ana', 20)).toStrictEqual({ name: 'Ana', stats: ' · 20 pts' });
    const parts = chipParts('Ana', 0);
    expect(parts.name + parts.stats).toBe('Ana · 0 pts');
    expect(parts.name + parts.stats).not.toContain('Tú');
  });

  it('FR-406 a right guess says right with its points (the total and the place are in the chip)', () => {
    const view = resultView({ scored: { round: 2, phase: 1 }, item: { kind: 'victim', round: 2, choice: 4, correct: true, points: 10 }, nameOf: names });
    expect(view.right).toBe(true);
    expect(view.lines.join(' ')).toContain('Acertaste');
    expect(view.lines.join(' ')).toContain('10 puntos');
    expect(view.lines.join(' ')).toContain('F4');
    expect(view.lines.join(' ')).not.toContain('Total');
    expect(view.lines.join(' ')).not.toContain('puesto');
    expect(view.lines[0]).toContain('víctima');
  });

  it('FR-406 a wrong guess and a phase with no prediction are said plainly', () => {
    const wrong = resultView({ scored: { round: 5, phase: 2 }, item: { kind: 'absorber', round: 5, choice: 8, correct: false, points: 0 }, nameOf: names });
    expect(wrong.right).toBe(false);
    expect(wrong.lines.join(' ')).toContain('Fallaste');
    expect(wrong.lines[0]).toContain('absorbente');
    expect(wrong.lines).toHaveLength(2);
    const none = resultView({ scored: { round: 5, phase: 1 }, item: undefined, nameOf: names });
    expect(none.right).toBeUndefined();
    expect(none.lines.join(' ')).toContain('No predijiste');
  });

  it('FR-406 a forced absorber is said to be applied without a prediction, not as a missed prediction', () => {
    const forced = resultView({ scored: { round: 3, phase: 2 }, item: undefined, nameOf: names, forced: true });
    expect(forced.lines.join(' ')).toContain('forzado');
    expect(forced.lines.join(' ')).not.toContain('No predijiste');
    const victimNone = resultView({ scored: { round: 3, phase: 1 }, item: undefined, nameOf: names, forced: true });
    expect(victimNone.lines.join(' ')).toContain('No predijiste');
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

describe('FR-448 the player who wins the match', () => {
  const board = (...rows: LeaderboardRow[]): LeaderboardRow[] => rows;
  it('is the first of the board, with points and the name', () => {
    const line = championLine(board(row(1, 'p:a', 7, 'Ana'), row(2, 'p:b', 3, 'Bea')), 'p:z');
    expect(line).toEqual({ text: 'Gana la partida: Ana · 7 pts', you: false });
  });
  it('lists players tied for the first place', () => {
    expect(championLine(board(row(1, 'p:a', 7, 'Ana'), row(1, 'p:b', 7, 'Bea'), row(3, 'p:c', 1, 'Cleo')), 'p:z')?.text).toBe('Ganan la partida: Ana, Bea · 7 pts');
  });
  it('shortens a long tie to three names and a count', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((n) => row(1, `p:${n}`, 4, n.toUpperCase()));
    expect(championLine(rows, 'p:z')?.text).toBe('Ganan la partida: A, B, C y 2 más · 4 pts');
  });
  it('speaks to the viewer who won', () => {
    expect(championLine(board(row(1, 'p:a', 7, 'Ana'), row(2, 'p:b', 3, 'Bea')), 'p:a')).toEqual({ text: '¡Has ganado la partida! · 7 pts', you: true });
    expect(championLine(board(row(1, 'p:a', 7, 'Ana'), row(1, 'p:b', 7, 'Bea')), 'p:b')?.text).toBe('¡Has ganado la partida con Ana! · 7 pts');
  });
  it('is nothing when nobody scored or the board is empty', () => {
    expect(championLine(board(row(1, 'p:a', 0, 'Ana')), 'p:a')).toBeUndefined();
    expect(championLine([], 'p:a')).toBeUndefined();
  });
});
