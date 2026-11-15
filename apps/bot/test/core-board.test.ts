import type { LeaderboardRow } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { decide } from '../src/core/actions';
import type { Interaction } from '../src/core/actions';
import { BOARD_TTL_MS, PAGE_SIZE, boardView, clampPage, pageCount } from '../src/core/board';
import { boardId, mineId, parseCustomId } from '../src/core/custom-ids';
import type { ButtonSpec } from '../src/core/model';

const row = (rank: number, playerId: string, total: number, name?: string): LeaderboardRow =>
  ({ rank, playerId, total, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0, ...(name === undefined ? {} : { name }) });
const rows = (n: number): LeaderboardRow[] => Array.from({ length: n }, (_, i) => row(i + 1, `discord:${800 + i}`, 100 - i));
const custom = (buttons: readonly ButtonSpec[]) => buttons.filter((b): b is Extract<ButtonSpec, { type: 'custom' }> => b.type === 'custom');
const lines = (description: string | undefined): string[] => (description ?? '').split('\n');

describe('FR-477 paged leaderboard', () => {
  it('FR-477 10 rows per page: rank, mention and points, with "Página N/M"', () => {
    const v = boardView(rows(25), 1, { matchId: 'm1', kind: 'asker', viewerId: '999' });
    expect(PAGE_SIZE).toBe(10);
    expect(v.pages).toBe(3);
    expect(lines(v.message.embed?.description)).toHaveLength(10);
    expect(lines(v.message.embed?.description)[0]).toBe('1. <@800> - 100 pts');
    expect(lines(v.message.embed?.description)[9]).toBe('10. <@809> - 91 pts');
    expect(v.message.embed?.footer).toBe('Página 1/3');
    const last = boardView(rows(25), 3, { matchId: 'm1', kind: 'asker', viewerId: '999' });
    expect(lines(last.message.embed?.description)).toEqual(['21. <@820> - 80 pts', '22. <@821> - 79 pts', '23. <@822> - 78 pts', '24. <@823> - 77 pts', '25. <@824> - 76 pts']);
    expect(last.message.embed?.footer).toBe('Página 3/3');
  });

  it('FR-477 ranked by points, ties share the rank the server gave', () => {
    const tied = [row(1, 'discord:1', 9), row(3, 'discord:3', 5), row(1, 'discord:2', 9), row(3, 'discord:4', 5)];
    const out = lines(boardView(tied, 1, { matchId: 'm1', kind: 'asker' }).message.embed?.description);
    expect(out).toEqual(['1. <@1> - 9 pts', '1. <@2> - 9 pts', '3. <@3> - 5 pts', '3. <@4> - 5 pts']);
  });

  it('FR-477 Previous and Next buttons; Previous is disabled on page 1 and Next on the last page (FR-481)', () => {
    const first = custom(boardView(rows(25), 1, { matchId: 'm1', kind: 'asker' }).message.buttons);
    expect(first.map((b) => [b.label, b.disabled === true])).toEqual([['Anterior', true], ['Siguiente', false]]);
    const mid = custom(boardView(rows(25), 2, { matchId: 'm1', kind: 'asker' }).message.buttons);
    expect(mid.map((b) => b.disabled === true)).toEqual([false, false]);
    expect(mid.map((b) => b.customId)).toEqual([boardId('p', 1), boardId('n', 3)]);
    const end = custom(boardView(rows(25), 3, { matchId: 'm1', kind: 'asker' }).message.buttons);
    expect(end.map((b) => b.disabled === true)).toEqual([false, true]);
    // The ids of one message are all different, even with a single page.
    const one = custom(boardView(rows(4), 1, { matchId: 'm1', kind: 'asker' }).message.buttons);
    expect(new Set(one.map((b) => b.customId)).size).toBe(2);
    expect(one.every((b) => b.disabled === true)).toBe(true);
  });

  it('FR-477 a page out of range is clamped', () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(9, 3)).toBe(3);
    expect(clampPage(2.7, 3)).toBe(2);
    expect(clampPage(Number.NaN, 3)).toBe(1);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(10)).toBe(1);
    expect(pageCount(11)).toBe(2);
    expect(boardView(rows(25), 99, { matchId: 'm1', kind: 'asker' }).page).toBe(3);
  });

  it('FR-477 an empty board is one embed that says there are no points yet, with no buttons', () => {
    const v = boardView([], 1, { matchId: 'm1', kind: 'asker', viewerId: '5' });
    expect(v.message.embed?.description).toBe('Todavía no hay puntos.');
    expect(v.message.buttons).toEqual([]);
    expect(v.message.board).toBeUndefined();
    expect(v.message.text).toContain('Todavía no hay puntos.');
  });

  it('FR-477 the plain-text fallback carries the same page', () => {
    const v = boardView(rows(12), 2, { matchId: 'm1', kind: 'asker', viewerId: '801' });
    expect(v.message.text).toContain('11. <@810> - 90 pts');
    expect(v.message.text).toContain('Página 2/2');
    expect(v.message.text).toContain('Tu puesto');
  });
});

describe('FR-479 Tu puesto', () => {
  it('FR-479 the asker sees their rank and points on every page, also when they are on the current page', () => {
    for (const page of [1, 2, 3]) {
      const v = boardView(rows(25), page, { matchId: 'm1', kind: 'asker', viewerId: '803' });
      expect(v.message.embed?.fields).toEqual([{ name: 'Tu puesto', value: '4. <@803> - 97 pts' }]);
    }
  });

  it('FR-479 a member with no points gets a sentence saying so', () => {
    const v = boardView(rows(25), 1, { matchId: 'm1', kind: 'asker', viewerId: '123' });
    expect(v.message.embed?.fields).toEqual([{ name: 'Tu puesto', value: 'Todavía no tienes puntos en esta partida.' }]);
  });

  it('FR-479 the public final post has no asker and no Tu puesto line; the private pages do', () => {
    const pub = boardView(rows(25), 1, { matchId: 'm1', kind: 'final' });
    expect(pub.message.embed?.fields).toEqual([]);
    expect(pub.message.text).not.toContain('Tu puesto');
    const mine = boardView(rows(25), 2, { matchId: 'm1', kind: 'private', viewerId: '812' });
    expect(mine.message.embed?.fields).toEqual([{ name: 'Tu puesto', value: '13. <@812> - 88 pts' }]);
  });
});

describe('FR-483 names', () => {
  it('FR-483 a Discord row is a mention; another namespace shows the server name, else "Jugador"', () => {
    const v = boardView([row(1, 'discord:7', 9), row(2, 'player:abc', 5, 'Eva'), row(3, 'player:def', 1)], 1, { matchId: 'm1', kind: 'asker' });
    expect(lines(v.message.embed?.description)).toEqual(['1. <@7> - 9 pts', '2. Eva - 5 pts', '3. Jugador - 1 pts']);
  });

  it('FR-483 the Tu puesto line of a row of another namespace is never offered: the asker is always a Discord member', () => {
    const v = boardView([row(1, 'player:abc', 5, 'Eva')], 1, { matchId: 'm1', kind: 'asker', viewerId: '5' });
    expect(v.message.embed?.fields[0]?.value).toBe('Todavía no tienes puntos en esta partida.');
  });
});

describe('FR-480 tags and ids', () => {
  it('FR-480 the asker board is tagged with its match and asker (only with more than one page); the final post only with its match', () => {
    expect(boardView(rows(25), 1, { matchId: 'm1', kind: 'asker', viewerId: '42' }).message.board).toEqual({ matchId: 'm1', askerId: '42' });
    expect(boardView(rows(25), 1, { matchId: 'm1', kind: 'final' }).message.board).toEqual({ matchId: 'm1' });
    expect(boardView(rows(4), 1, { matchId: 'm1', kind: 'final' }).message.board).toBeUndefined();
    expect(boardView(rows(25), 1, { matchId: 'm1', kind: 'private', viewerId: '42' }).message.board).toBeUndefined();
  });

  it('FR-480 the private pages carry the match in their button ids, and ids parse back', () => {
    const b = custom(boardView(rows(25), 2, { matchId: 'match-1', kind: 'private', viewerId: '42' }).message.buttons);
    expect(b.map((x) => x.customId)).toEqual([mineId('p', 1, 'match-1'), mineId('n', 3, 'match-1')]);
    expect(parseCustomId(boardId('n', 4))).toEqual({ type: 'board', page: 4 });
    expect(parseCustomId(mineId('p', 2, 'match-1'))).toEqual({ type: 'mine', page: 2, matchId: 'match-1' });
    expect(parseCustomId('mbrg:bd:n:0')).toBeUndefined();
    expect(parseCustomId('mbrg:bd:x:2')).toBeUndefined();
    expect(parseCustomId('mbrg:bm:n:2:bad id')).toBeUndefined();
    for (const id of [boardId('n', 999999), mineId('n', 999999, 'm'.repeat(64))]) expect(id.length).toBeLessThanOrEqual(100);
  });
});

describe('FR-480 and FR-481 who may press', () => {
  const press = (customId: string, userId: string, entry: { askerId?: string; expiresAt: number; matchId: string } | undefined, now = 1000): Interaction => ({ type: 'board-press', customId, userId, entry, now });
  const live = { askerId: '42', expiresAt: 5000, matchId: 'm1' };

  it('FR-480 the asker pages the public message in place', () => {
    expect(decide(press(boardId('n', 2), '42', live), true)).toEqual({ do: 'board-page', matchId: 'm1', page: 2, mode: 'asker' });
  });

  it('FR-480 another member changes nothing and gets a private sentence', () => {
    expect(decide(press(boardId('n', 2), '77', live), true)).toEqual({ do: 'say', text: 'Solo quien pidió la clasificación puede cambiar de página. Usa /mbrg board para ver la tuya.' });
  });

  it('FR-480 on the final post (no asker) every member gets their own private page', () => {
    expect(decide(press(boardId('n', 2), '77', { expiresAt: 5000, matchId: 'm1' }), false)).toEqual({ do: 'board-page', matchId: 'm1', page: 2, mode: 'new-private' });
  });

  it('FR-480 a press on a private page updates that private message', () => {
    expect(decide({ type: 'board-press', customId: mineId('n', 3, 'm1'), userId: '77', entry: undefined, now: 1000 }, false)).toEqual({ do: 'board-page', matchId: 'm1', page: 3, mode: 'update-private' });
  });

  it('FR-481 after the 5 minutes, or for an unknown message (restart), a private sentence says it expired', () => {
    const expired = { do: 'say', text: 'Esta clasificación caducó. Usa /mbrg board para verla de nuevo.' };
    expect(BOARD_TTL_MS).toBe(300_000);
    expect(decide(press(boardId('n', 2), '42', live, 5000), true)).toEqual(expired);
    expect(decide(press(boardId('n', 2), '42', live, 9000), true)).toEqual(expired);
    expect(decide(press(boardId('n', 2), '42', undefined), true)).toEqual(expired);
  });

  it('FR-480 a press with an id the bot does not know is answered with the generic sentence', () => {
    expect(decide(press('mbrg:other', '42', live), true)).toEqual({ do: 'say', text: 'Algo falló. Inténtalo de nuevo.' });
  });
});
