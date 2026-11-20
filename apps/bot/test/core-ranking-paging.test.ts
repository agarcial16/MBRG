import type { RankingOrder, RankingPage, RankingRow } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { decide, deliveryOf } from '../src/core/actions';
import type { Interaction, RankingWalkView } from '../src/core/actions';
import { parseCustomId, rankingId } from '../src/core/custom-ids';
import { stackAfter } from '../src/core/history';
import type { ButtonSpec, OutMessage } from '../src/core/model';
import { RANKING_TTL_MS, rankingMessage } from '../src/core/ranking';
import { createBoards, registerSent } from '../src/io/boards';
import { fromRankingButton } from '../src/discord/translate';
import { KEY_A } from './helpers/harness';

// Spec 025 FR-569 (the paging part of 024 FR-555): the ids, the buttons, the walk the bot remembers per message and who may press.

const ASKER = '900000000000000001';
const CURSOR_1 = 'planted-ranking-cursor-1-0123456789abcdef';
const CURSOR_2 = 'planted-ranking-cursor-2-0123456789abcdef';

const row = (n: number): RankingRow => ({ playerId: `discord:${1000 + n}`, points: 100 - n, correct: 5, scored: 10, played: 2, won: 1, rank: n + 1 });
/** The page `n` (from 1) of a ranking of `total` rows: 10 rows, a cursor to the next page unless it is the last. */
const pageOf = (n: number, total = 25): RankingPage => {
  const first = (n - 1) * 10;
  const items = Array.from({ length: Math.max(0, Math.min(10, total - first)) }, (_, i) => row(first + i));
  return { items, total, ...(first + 10 < total ? { next: n === 1 ? CURSOR_1 : CURSOR_2 } : {}) };
};
const customs = (buttons: readonly ButtonSpec[]) => buttons.filter((b): b is Extract<ButtonSpec, { type: 'custom' }> => b.type === 'custom');
const message = (n: number, pages: readonly RankingPage[] = [pageOf(1), pageOf(2), pageOf(3)].slice(0, n), order: RankingOrder = 'wins'): OutMessage =>
  rankingMessage(pages[n - 1] ?? pageOf(n), order, { page: n, ...(n > 1 && pages[n - 2]?.items.at(-1) !== undefined ? { previous: pages[n - 2]!.items.at(-1)! } : {}) }, { askerId: ASKER, community: KEY_A, order, pages });

describe('FR-569 the ids of the ranking buttons', () => {
  it('FR-569 an id is the kind of press and the target page, and parses back; anything else is not a ranking id', () => {
    expect(rankingId('n', 3)).toBe('mbrg:rk:n:3');
    expect(rankingId('p', 1)).toBe('mbrg:rk:p:1');
    expect(parseCustomId('mbrg:rk:n:3')).toEqual({ type: 'ranking', page: 3 });
    expect(parseCustomId('mbrg:rk:p:12')).toEqual({ type: 'ranking', page: 12 });
    for (const bad of ['mbrg:rk:n:0', 'mbrg:rk:x:1', 'mbrg:rk:n:', 'mbrg:rk:n:01', 'mbrg:rk:n:1:extra', 'mbrg:rk:n:9999999', 'mbrg:rk:n:-1']) expect(parseCustomId(bad), bad).toBeUndefined();
    // The ids of the other paged messages stay as they were.
    expect(parseCustomId('mbrg:bd:n:2')).toEqual({ type: 'board', page: 2 });
    expect(parseCustomId('mbrg:hs:n:2')).toEqual({ type: 'history', page: 2 });
  });

  it('FR-569 no id of any button holds a cursor, the community key, a user id or the order', () => {
    for (const n of [1, 2, 3]) {
      for (const button of customs(message(n).buttons)) {
        expect(button.customId.length).toBeLessThanOrEqual(100);
        expect(button.customId).toMatch(/^mbrg:rk:[pn]:[1-9][0-9]{0,5}$/);
        for (const secret of [CURSOR_1, CURSOR_2, KEY_A, ASKER, 'wins']) expect(button.customId).not.toContain(secret);
      }
    }
  });
});

describe('FR-569 the buttons of a ranking page', () => {
  it('FR-569 Previous is disabled on page 1 and Next on the last page; the ids name the target page', () => {
    expect(customs(message(1).buttons).map((b) => [b.label, b.customId, b.disabled === true])).toEqual([['Anterior', 'mbrg:rk:p:1', true], ['Siguiente', 'mbrg:rk:n:2', false]]);
    expect(customs(message(2).buttons).map((b) => [b.customId, b.disabled === true])).toEqual([['mbrg:rk:p:1', false], ['mbrg:rk:n:3', false]]);
    expect(customs(message(3).buttons).map((b) => [b.customId, b.disabled === true])).toEqual([['mbrg:rk:p:2', false], ['mbrg:rk:n:3', true]]);
  });

  it('FR-569 a ranking of one page has both buttons disabled and is not registered for paging', () => {
    const one = rankingMessage(pageOf(1, 4), 'points', { page: 1 }, { askerId: ASKER, community: KEY_A, order: 'points', pages: [pageOf(1, 4)] });
    expect(customs(one.buttons).every((b) => b.disabled === true)).toBe(true);
    expect(new Set(customs(one.buttons).map((b) => b.customId)).size).toBe(2);
    expect(one.ranking).toBeUndefined();
  });

  it('FR-569 a page carries the walk the shell remembers: its asker, the key, the order and the pages shown so far', () => {
    const pages = [pageOf(1), pageOf(2)];
    expect(message(2, pages, 'accuracy').ranking).toEqual({ askerId: ASKER, community: KEY_A, order: 'accuracy', pages });
  });

  it('FR-570 an empty ranking keeps no buttons and no walk: the one sentence alone', () => {
    const empty = rankingMessage({ items: [], total: 0 }, 'points', { page: 1 }, { askerId: ASKER, community: KEY_A, order: 'points', pages: [{ items: [], total: 0 }] });
    expect(empty).toEqual({ text: 'Este servidor todavía no tiene ranking.', buttons: [] });
  });

  it('FR-569 the page the walk reads from the stack is the last row of the page before (the place of the accuracy note)', () => {
    const tail: RankingRow = { playerId: 'discord:555', points: 1, correct: 1, scored: 2, played: 1, won: 0 };
    const first: RankingPage = { items: Array.from({ length: 10 }, (_, i) => row(i)), total: 20, next: CURSOR_1 };
    const second: RankingPage = { items: Array.from({ length: 10 }, () => tail), total: 20 };
    expect(message(2, [first, second], 'accuracy').embed?.description?.split('\n')[0]).toBe('Menos de 10 predicciones: sin puesto en precisión');
    // Shown again from a stack whose page before already ended unranked: no note.
    const third: RankingPage = { items: [tail], total: 21 };
    expect(rankingMessage(third, 'accuracy', { page: 3, previous: tail }, { askerId: ASKER, community: KEY_A, order: 'accuracy', pages: [first, second, third] }).embed?.description).not.toContain('Menos de');
  });
});

describe('FR-569 the stack of shown pages is the one of the history', () => {
  it('FR-569 a fetched page replaces everything from its place on; showing a stored page changes nothing', () => {
    const p1 = pageOf(1);
    const p2 = pageOf(2);
    const p3 = pageOf(3);
    expect(stackAfter([p1], 2, p2)).toEqual([p1, p2]);
    expect(stackAfter([p1, p2, p3], 2, undefined)).toEqual([p1, p2, p3]);
    expect(stackAfter([p1, p2, p3], 2, p3)).toEqual([p1, p3]);
  });
});

describe('FR-569 who may press, and what a press does', () => {
  const walk = (over: Partial<RankingWalkView> = {}): RankingWalkView => ({ askerId: ASKER, community: KEY_A, order: 'wins', expiresAt: 5000, pages: [pageOf(1)], ...over });
  const press = (customId: string, userId: string, entry: RankingWalkView | undefined, now = 1000): Interaction => ({ type: 'ranking-press', customId, userId, entry, now });

  it('FR-569 Next follows the cursor of the page shown, in the order of the walk', () => {
    expect(decide(press('mbrg:rk:n:2', ASKER, walk()), true)).toEqual({ do: 'ranking-page', community: KEY_A, order: 'wins', page: 2, pages: [pageOf(1)], cursor: CURSOR_1 });
    const two = walk({ pages: [pageOf(1), pageOf(2)], order: 'accuracy' });
    expect(decide(press('mbrg:rk:n:3', ASKER, two), true)).toEqual({ do: 'ranking-page', community: KEY_A, order: 'accuracy', page: 3, pages: [pageOf(1), pageOf(2)], cursor: CURSOR_2 });
  });

  it('FR-569 Previous (and a Next to a page already shown) returns to the stored page: no cursor, nothing to ask the server', () => {
    const two = walk({ pages: [pageOf(1), pageOf(2)] });
    expect(decide(press('mbrg:rk:p:1', ASKER, two), true)).toEqual({ do: 'ranking-page', community: KEY_A, order: 'wins', page: 1, pages: [pageOf(1), pageOf(2)] });
    expect(decide(press('mbrg:rk:n:2', ASKER, two), true)).not.toHaveProperty('cursor');
  });

  it('FR-569 another member changes nothing and gets a private sentence', () => {
    expect(decide(press('mbrg:rk:n:2', '77', walk()), true)).toEqual({ do: 'say', text: 'Solo quien pidió el ranking puede cambiar de página. Usa /mbrg ranking para ver el tuyo.' });
  });

  it('FR-569 after the 5 minutes, or for a message the bot does not know (restart), a private sentence says it expired, whoever presses', () => {
    const expired = { do: 'say', text: 'Este ranking caducó. Usa /mbrg ranking para verlo de nuevo.' };
    expect(RANKING_TTL_MS).toBe(300_000);
    expect(decide(press('mbrg:rk:n:2', ASKER, walk(), 5000), true)).toEqual(expired);
    expect(decide(press('mbrg:rk:n:2', ASKER, walk(), 9000), true)).toEqual(expired);
    expect(decide(press('mbrg:rk:n:2', ASKER, undefined), true)).toEqual(expired);
    expect(decide(press('mbrg:rk:n:2', '77', undefined), true)).toEqual(expired);
  });

  it('FR-569 a page the walk cannot reach (forged id, no cursor on the last page) and an unknown id are answered with the generic sentence', () => {
    const generic = { do: 'say', text: 'Algo falló. Inténtalo de nuevo.' };
    expect(decide(press('mbrg:rk:n:3', ASKER, walk()), true)).toEqual(generic);
    expect(decide(press('mbrg:rk:n:9', ASKER, walk({ pages: [pageOf(1), pageOf(2), pageOf(3)] })), true)).toEqual(generic);
    expect(decide(press('mbrg:other', ASKER, walk()), true)).toEqual(generic);
    // A history id on a ranking walk is not a ranking id.
    expect(decide(press('mbrg:hs:n:2', ASKER, walk()), true)).toEqual(generic);
  });

  it('FR-569 the page is edited in place: the delivery of a ranking page is the update of the message pressed', () => {
    expect(deliveryOf({ do: 'ranking-page', community: KEY_A, order: 'points', page: 1, pages: [pageOf(1)] })).toBe('update');
  });

  it('FR-569 a press as the shell reads it carries the user, what the bot knows of the message and the time', () => {
    const known = walk();
    expect(fromRankingButton('mbrg:rk:n:2', ASKER, known, 9)).toEqual({ type: 'ranking-press', customId: 'mbrg:rk:n:2', userId: ASKER, entry: known, now: 9 });
    expect(fromRankingButton('mbrg:rk:n:2', ASKER, undefined, 9)).toMatchObject({ entry: undefined });
  });
});

describe('FR-569 the ranking walks the bot keeps (memory only)', () => {
  function world() {
    const timers = new Map<number, { at: number; fn: () => void }>();
    let id = 0;
    let clock = 1_000_000;
    const disabled: string[] = [];
    const boards = createBoards({
      now: () => clock,
      after: (ms, fn) => {
        const mine = (id += 1);
        timers.set(mine, { at: clock + ms, fn });
        return () => timers.delete(mine);
      },
      disable: async (_channel, messageId) => {
        disabled.push(messageId);
      },
    });
    const elapse = (ms: number): void => {
      clock += ms;
      for (const [key, t] of [...timers]) if (t.at <= clock) { timers.delete(key); t.fn(); }
    };
    return { boards, elapse, disabled, now: () => clock };
  }

  it('FR-569 a posted ranking is remembered by message id with its asker, key, order, pages and expiry, and its buttons are disabled after 5 minutes', () => {
    const w = world();
    registerSent(w.boards, 'chan', 'msg-1', message(1));
    expect(w.boards.lookupRanking('msg-1')).toEqual({ askerId: ASKER, community: KEY_A, order: 'wins', pages: [pageOf(1)], expiresAt: w.now() + RANKING_TTL_MS });
    expect(w.boards.lookupRanking('msg-2')).toBeUndefined();
    // A ranking message is not a history one: each registry answers only for its own.
    expect(w.boards.lookupHistory('msg-1')).toBeUndefined();
    w.elapse(RANKING_TTL_MS - 1);
    expect(w.boards.lookupRanking('msg-1')).toBeDefined();
    expect(w.disabled).toEqual([]);
    w.elapse(1);
    expect(w.boards.lookupRanking('msg-1')).toBeUndefined();
    expect(w.disabled).toEqual(['msg-1']);
  });

  it('FR-569 an update keeps the first expiry: paging does not extend the five minutes', () => {
    const w = world();
    registerSent(w.boards, 'chan', 'msg-1', message(1));
    const first = w.boards.lookupRanking('msg-1')!.expiresAt;
    w.elapse(100_000);
    w.boards.updateRanking('msg-1', [pageOf(1), pageOf(2)]);
    expect(w.boards.lookupRanking('msg-1')).toEqual({ askerId: ASKER, community: KEY_A, order: 'wins', pages: [pageOf(1), pageOf(2)], expiresAt: first });
    w.elapse(RANKING_TTL_MS - 100_000);
    expect(w.boards.lookupRanking('msg-1')).toBeUndefined();
    expect(w.disabled).toEqual(['msg-1']);
  });

  it('FR-569 a message that is not a ranking, or a ranking of one page, is not remembered; stopping forgets every walk and cancels the timers', () => {
    const w = world();
    registerSent(w.boards, 'chan', 'msg-1', { text: 'x', buttons: [] });
    registerSent(w.boards, 'chan', 'msg-2', rankingMessage(pageOf(1, 3), 'points', { page: 1 }, { askerId: ASKER, community: KEY_A, order: 'points', pages: [pageOf(1, 3)] }));
    registerSent(w.boards, 'chan', undefined, message(1));
    registerSent(w.boards, 'chan', 'msg-3', message(1));
    w.boards.stopAll();
    expect(w.boards.lookupRanking('msg-3')).toBeUndefined();
    w.elapse(RANKING_TTL_MS * 2);
    expect(w.disabled).toEqual([]);
    expect(w.boards.lookupRanking('msg-1')).toBeUndefined();
    expect(w.boards.lookupRanking('msg-2')).toBeUndefined();
  });

  it('FR-569 an update of a message that is no longer remembered is ignored', () => {
    const w = world();
    w.boards.updateRanking('gone', [pageOf(1)]);
    expect(w.boards.lookupRanking('gone')).toBeUndefined();
  });
});
