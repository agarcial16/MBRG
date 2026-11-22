import type { HistoryEntry, HistoryPage } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { decide, deliveryOf } from '../src/core/actions';
import type { HistoryWalkView, Interaction } from '../src/core/actions';
import { historyId, parseCustomId } from '../src/core/custom-ids';
import { HISTORY_TTL_MS, historyMessage, stackAfter } from '../src/core/history';
import type { HistoryContext } from '../src/core/history';
import type { ButtonSpec, OutMessage } from '../src/core/model';
import { nameBook } from '../src/core/names';
import { createBoards, registerSent } from '../src/io/boards';
import { fromHistoryButton } from '../src/discord/translate';
import { KEY_A } from './helpers/harness';

const ASKER = '900000000000000001';
const CURSOR_1 = 'planted-cursor-page-1-0123456789abcdef';
const CURSOR_2 = 'planted-cursor-page-2-0123456789abcdef';

const entry = (n: number): HistoryEntry => ({ matchId: `match-${n}`, mapId: 'europe', finishedAt: 1_800_000_000_000 - n * 1000, winner: 1, playerCount: 1, top: [{ playerId: 'discord:111', points: 3, rank: 1 }], more: 0 });
/** The page `n` (from 1) of a history of `total` matches: 5 entries, a cursor to the next page unless it is the last. */
const pageOf = (n: number, total = 12): HistoryPage => {
  const first = (n - 1) * 5;
  const items = Array.from({ length: Math.max(0, Math.min(5, total - first)) }, (_, i) => entry(first + i));
  return { items, total, ...(first + 5 < total ? { next: n === 1 ? CURSOR_1 : CURSOR_2 } : {}) };
};
const ctx = (page: number): HistoryContext => ({ page, book: () => nameBook([{ id: 1, name: 'Alemania' }]), viewerUrl: 'https://viewer.example/' });
const customs = (buttons: readonly ButtonSpec[]) => buttons.filter((b): b is Extract<ButtonSpec, { type: 'custom' }> => b.type === 'custom');
const message = (n: number, pages: readonly HistoryPage[] = [pageOf(1), pageOf(2), pageOf(3)].slice(0, n), total = 12): OutMessage =>
  historyMessage(pages[n - 1] ?? pageOf(n, total), ctx(n), { askerId: ASKER, community: KEY_A, pages });

describe('FR-555 the ids of the history buttons', () => {
  it('FR-555 an id is the kind of press and the target page, and parses back; anything else is not a history id', () => {
    expect(historyId('n', 3)).toBe('mbrg:hs:n:3');
    expect(historyId('p', 1)).toBe('mbrg:hs:p:1');
    expect(parseCustomId('mbrg:hs:n:3')).toEqual({ type: 'history', page: 3 });
    expect(parseCustomId('mbrg:hs:p:12')).toEqual({ type: 'history', page: 12 });
    for (const bad of ['mbrg:hs:n:0', 'mbrg:hs:x:1', 'mbrg:hs:n:', 'mbrg:hs:n:01', 'mbrg:hs:n:1:extra', 'mbrg:hs:n:9999999', 'mbrg:hs:n:-1']) expect(parseCustomId(bad), bad).toBeUndefined();
    // The ids of the other paged messages stay as they were.
    expect(parseCustomId('mbrg:bd:n:2')).toEqual({ type: 'board', page: 2 });
  });

  it('FR-555 no id of any button holds a cursor, the community key or a user id', () => {
    for (const n of [1, 2, 3]) {
      for (const button of customs(message(n).buttons)) {
        expect(button.customId.length).toBeLessThanOrEqual(100);
        expect(button.customId).toMatch(/^mbrg:hs:[pn]:[1-9][0-9]{0,5}$/);
        for (const secret of [CURSOR_1, CURSOR_2, KEY_A, ASKER]) expect(button.customId).not.toContain(secret);
      }
    }
  });
});

describe('FR-555 the buttons of a history page', () => {
  it('FR-555 Previous is disabled on page 1 and Next on the last page; the ids name the target page', () => {
    expect(customs(message(1).buttons).map((b) => [b.label, b.customId, b.disabled === true])).toEqual([['Anterior', 'mbrg:hs:p:1', true], ['Siguiente', 'mbrg:hs:n:2', false]]);
    expect(customs(message(2).buttons).map((b) => [b.customId, b.disabled === true])).toEqual([['mbrg:hs:p:1', false], ['mbrg:hs:n:3', false]]);
    expect(customs(message(3).buttons).map((b) => [b.customId, b.disabled === true])).toEqual([['mbrg:hs:p:2', false], ['mbrg:hs:n:3', true]]);
  });

  it('FR-555 a history of one page has both buttons disabled and is not registered for paging', () => {
    const one = historyMessage(pageOf(1, 4), ctx(1), { askerId: ASKER, community: KEY_A, pages: [pageOf(1, 4)] });
    expect(customs(one.buttons).every((b) => b.disabled === true)).toBe(true);
    expect(new Set(customs(one.buttons).map((b) => b.customId)).size).toBe(2);
    expect(one.history).toBeUndefined();
  });

  it('FR-555 a page carries the walk the shell remembers: its asker, the key and the pages shown so far', () => {
    const pages = [pageOf(1), pageOf(2)];
    expect(message(2, pages).history).toEqual({ askerId: ASKER, community: KEY_A, pages });
  });

  it('FR-556 an empty history keeps no buttons and no walk', () => {
    const empty = historyMessage({ items: [], total: 0 }, ctx(1), { askerId: ASKER, community: KEY_A, pages: [{ items: [], total: 0 }] });
    expect(empty.buttons).toEqual([]);
    expect(empty.history).toBeUndefined();
  });
});

describe('FR-555 NFR-122 the stack of shown pages is a pure function', () => {
  it('NFR-122 a fetched page replaces everything from its place on; showing a stored page changes nothing', () => {
    const p1 = pageOf(1);
    const p2 = pageOf(2);
    const p3 = pageOf(3);
    expect(stackAfter([p1], 2, p2)).toEqual([p1, p2]);
    expect(stackAfter([p1, p2], 3, p3)).toEqual([p1, p2, p3]);
    expect(stackAfter([p1, p2, p3], 2, undefined)).toEqual([p1, p2, p3]);
    // A page fetched again from page 2 drops what followed it: nothing stale stays on the stack.
    expect(stackAfter([p1, p2, p3], 2, p3)).toEqual([p1, p3]);
    const input = [p1, p2];
    stackAfter(input, 3, p3);
    expect(input).toEqual([p1, p2]);
  });
});

describe('FR-555 who may press, and what a press does', () => {
  const walk = (over: Partial<HistoryWalkView> = {}): HistoryWalkView => ({ askerId: ASKER, community: KEY_A, expiresAt: 5000, pages: [pageOf(1)], ...over });
  const press = (customId: string, userId: string, entry: HistoryWalkView | undefined, now = 1000): Interaction => ({ type: 'history-press', customId, userId, entry, now });

  it('FR-555 Next follows the cursor of the page shown: a fetch of the next page of the same walk', () => {
    expect(decide(press('mbrg:hs:n:2', ASKER, walk()), true)).toEqual({ do: 'history-page', community: KEY_A, page: 2, pages: [pageOf(1)], cursor: CURSOR_1 });
    const two = walk({ pages: [pageOf(1), pageOf(2)] });
    expect(decide(press('mbrg:hs:n:3', ASKER, two), true)).toEqual({ do: 'history-page', community: KEY_A, page: 3, pages: [pageOf(1), pageOf(2)], cursor: CURSOR_2 });
  });

  it('FR-555 Previous (and a Next to a page already shown) returns to the stored page: no cursor, nothing to ask the server', () => {
    const two = walk({ pages: [pageOf(1), pageOf(2)] });
    expect(decide(press('mbrg:hs:p:1', ASKER, two), true)).toEqual({ do: 'history-page', community: KEY_A, page: 1, pages: [pageOf(1), pageOf(2)] });
    expect(decide(press('mbrg:hs:n:2', ASKER, walk({ pages: [pageOf(1), pageOf(2)] })), true)).toMatchObject({ page: 2 });
    expect(decide(press('mbrg:hs:n:2', ASKER, two), true)).not.toHaveProperty('cursor');
  });

  it('FR-555 another member changes nothing and gets a private sentence', () => {
    expect(decide(press('mbrg:hs:n:2', '77', walk()), true)).toEqual({ do: 'say', text: 'Solo quien pidió el historial puede cambiar de página. Usa /ff history para ver el tuyo.' });
  });

  it('FR-555 after the 5 minutes, or for a message the bot does not know (restart), a private sentence says it expired', () => {
    const expired = { do: 'say', text: 'Este historial caducó. Usa /ff history para verlo de nuevo.' };
    expect(HISTORY_TTL_MS).toBe(300_000);
    expect(decide(press('mbrg:hs:n:2', ASKER, walk(), 5000), true)).toEqual(expired);
    expect(decide(press('mbrg:hs:n:2', ASKER, walk(), 9000), true)).toEqual(expired);
    expect(decide(press('mbrg:hs:n:2', ASKER, undefined), true)).toEqual(expired);
    // The expiry is told before the asker is: a stranger on an expired message is told it expired too.
    expect(decide(press('mbrg:hs:n:2', '77', undefined), true)).toEqual(expired);
  });

  it('FR-555 a page the walk cannot reach (forged id, no cursor on the last page) and an unknown id are answered with the generic sentence', () => {
    const generic = { do: 'say', text: 'Algo falló. Inténtalo de nuevo.' };
    expect(decide(press('mbrg:hs:n:3', ASKER, walk()), true)).toEqual(generic);
    expect(decide(press('mbrg:hs:n:4', ASKER, walk({ pages: [pageOf(1), pageOf(2), pageOf(3)] })), true)).toEqual(generic);
    expect(decide(press('mbrg:hs:n:9', ASKER, walk({ pages: [pageOf(1), pageOf(2), pageOf(3)] })), true)).toEqual(generic);
    expect(decide(press('mbrg:other', ASKER, walk()), true)).toEqual(generic);
  });

  it('FR-555 the page is edited in place: the delivery of a history page is the update of the message pressed', () => {
    expect(deliveryOf({ do: 'history-page', community: KEY_A, page: 1, pages: [pageOf(1)] })).toBe('update');
  });

  it('FR-555 a press as the shell reads it carries the user, what the bot knows of the message and the time', () => {
    const known = walk();
    expect(fromHistoryButton('mbrg:hs:n:2', ASKER, known, 9)).toEqual({ type: 'history-press', customId: 'mbrg:hs:n:2', userId: ASKER, entry: known, now: 9 });
    expect(fromHistoryButton('mbrg:hs:n:2', ASKER, undefined, 9)).toMatchObject({ entry: undefined });
  });
});

describe('FR-555 the walks the bot keeps (memory only)', () => {
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

  it('FR-555 a posted history is remembered by message id with its asker, key, pages and expiry, and its buttons are disabled after 5 minutes', () => {
    const w = world();
    registerSent(w.boards, 'chan', 'msg-1', message(1));
    const known = w.boards.lookupHistory('msg-1');
    expect(known).toEqual({ askerId: ASKER, community: KEY_A, pages: [pageOf(1)], expiresAt: w.now() + HISTORY_TTL_MS });
    expect(w.boards.lookupHistory('msg-2')).toBeUndefined();
    w.elapse(HISTORY_TTL_MS - 1);
    expect(w.boards.lookupHistory('msg-1')).toBeDefined();
    expect(w.disabled).toEqual([]);
    w.elapse(1);
    expect(w.boards.lookupHistory('msg-1')).toBeUndefined();
    expect(w.disabled).toEqual(['msg-1']);
  });

  it('FR-555 an update keeps the first expiry: paging does not extend the five minutes', () => {
    const w = world();
    registerSent(w.boards, 'chan', 'msg-1', message(1));
    const first = w.boards.lookupHistory('msg-1')!.expiresAt;
    w.elapse(100_000);
    w.boards.updateHistory('msg-1', [pageOf(1), pageOf(2)]);
    expect(w.boards.lookupHistory('msg-1')).toEqual({ askerId: ASKER, community: KEY_A, pages: [pageOf(1), pageOf(2)], expiresAt: first });
    w.elapse(HISTORY_TTL_MS - 100_000);
    expect(w.boards.lookupHistory('msg-1')).toBeUndefined();
    expect(w.disabled).toEqual(['msg-1']);
  });

  it('FR-555 a message that is not a history, or a history of one page, is not remembered; stopping forgets every walk and cancels the timers', () => {
    const w = world();
    registerSent(w.boards, 'chan', 'msg-1', { text: 'x', buttons: [] });
    registerSent(w.boards, 'chan', 'msg-2', historyMessage(pageOf(1, 3), ctx(1), { askerId: ASKER, community: KEY_A, pages: [pageOf(1, 3)] }));
    registerSent(w.boards, 'chan', undefined, message(1));
    registerSent(w.boards, 'chan', 'msg-3', message(1));
    w.boards.stopAll();
    expect(w.boards.lookupHistory('msg-3')).toBeUndefined();
    w.elapse(HISTORY_TTL_MS * 2);
    expect(w.disabled).toEqual([]);
    expect(w.boards.lookupHistory('msg-1')).toBeUndefined();
    expect(w.boards.lookupHistory('msg-2')).toBeUndefined();
  });

  it('FR-555 an update of a message that is no longer remembered is ignored', () => {
    const w = world();
    w.boards.updateHistory('gone', [pageOf(1)]);
    expect(w.boards.lookupHistory('gone')).toBeUndefined();
  });
});
