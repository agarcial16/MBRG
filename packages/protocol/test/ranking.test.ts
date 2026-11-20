import { describe, expect, it } from 'vitest';
import {
  CURSOR_LISTS,
  RANKING_ASKER_KEYS,
  RANKING_FIELDS,
  RANKING_ORDERS,
  RANKING_PAGE_KEYS,
  RANKING_ROW_KEYS,
  decodeCursor,
  encodeCursor,
  encodeRankingPage,
  readRankingPage,
  readRankingRequest,
  type RankingPage,
  type RankingRow,
} from '../src/index';

// Spec 025, ranking read of the protocol: the request reader, the `ranking` cursor and the page of rows (encode and decode).
// The key and ids below are planted literals no other text of the repository holds.

const KEY = '5a25ed0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const invalid = (field: string) => ({ ok: false, error: { kind: 'invalid-request', items: [field] } });
const nonOwn = (field: string) => ({ ok: false, error: { kind: 'invalid-player-id', items: [field] } });

const row = (over: Partial<RankingRow> = {}): RankingRow => ({
  playerId: 'discord:101',
  name: 'Ana',
  points: 9,
  correct: 4,
  scored: 6,
  played: 3,
  won: 1,
  ...over,
});
const page = (over: Partial<RankingPage> = {}): RankingPage => ({ items: [row()], total: 5, ...over });

describe('FR-573 (shape part) the ranking request reader', () => {
  it('FR-573 (shape part) reads { community, order?, playerId?, limit?, cursor? } with the order defaulting to points and the limit to 100', () => {
    expect(readRankingRequest({ community: KEY })).toStrictEqual({ ok: true, value: { community: KEY, order: 'points', limit: 100 } });
    expect(readRankingRequest({ community: KEY, order: 'accuracy', playerId: 'u-1.x', limit: 5 })).toStrictEqual({
      ok: true,
      value: { community: KEY, order: 'accuracy', playerId: 'u-1.x', limit: 5 },
    });
    const cursor = encodeCursor('ranking', [0, 20, 'AAAA', 'u1']);
    expect(readRankingRequest({ community: KEY, cursor })).toStrictEqual({ ok: true, value: { community: KEY, order: 'points', limit: 100, after: [0, 20, 'AAAA', 'u1'] } });
    expect([...RANKING_FIELDS]).toStrictEqual(['community', 'order', 'period', 'playerId', 'limit', 'cursor']);
    expect([...RANKING_ORDERS]).toStrictEqual(['points', 'correct', 'wins', 'accuracy']);
  });

  it('FR-573 (shape part) the order is one of the four words; anything else is invalid-request naming order', () => {
    for (const order of RANKING_ORDERS) expect(readRankingRequest({ community: KEY, order }), order).toStrictEqual({ ok: true, value: { community: KEY, order, limit: 100 } });
    for (const order of ['pts', 'Puntos', 'victoria', '', 5, null, true, [], {}]) {
      expect(readRankingRequest({ community: KEY, order }), String(order)).toStrictEqual(invalid('order'));
    }
  });

  it('FR-573 (shape part) the page size is a whole number 1 to 500 (a number, not a text)', () => {
    for (const limit of [1, 5, 100, 500]) expect(readRankingRequest({ community: KEY, limit }), String(limit)).toStrictEqual({ ok: true, value: { community: KEY, order: 'points', limit } });
    for (const limit of [0, 501, 1000, -1, 1.5, '5', null, true, [], {}, Number.NaN]) {
      expect(readRankingRequest({ community: KEY, limit }), JSON.stringify(limit)).toStrictEqual(invalid('limit'));
    }
  });

  it('FR-573 (shape part) a missing or malformed community key, and a body that is not an object, are invalid-request naming the member', () => {
    expect(readRankingRequest({})).toStrictEqual(invalid('community'));
    for (const community of [KEY.toUpperCase(), KEY.slice(1), `${KEY}0`, '', 5, null, undefined, [KEY]]) {
      expect(readRankingRequest({ community }), String(community)).toStrictEqual(invalid('community'));
    }
    for (const body of [null, 5, 'x', [], undefined]) expect(readRankingRequest(body)).toStrictEqual(invalid('body'));
  });

  it('FR-573 (shape part) the player id is a local id: a non-text is invalid-request, a text outside the id rule is invalid-player-id', () => {
    for (const playerId of [5, null, true, []]) expect(readRankingRequest({ community: KEY, playerId }), String(playerId)).toStrictEqual(invalid('playerId'));
    for (const playerId of ['discord:1', '', 'a b', 'x'.repeat(65), 'a\n']) expect(readRankingRequest({ community: KEY, playerId }), playerId).toStrictEqual(nonOwn('playerId'));
    // A structural failure of a later member comes before the player id charset (the FR-301 order).
    expect(readRankingRequest({ community: KEY, playerId: 'a b', limit: 0 })).toStrictEqual(invalid('limit'));
    expect(readRankingRequest({ community: KEY, playerId: 'a b', order: 'puntos' })).toStrictEqual(invalid('order'));
  });

  it('FR-573 (shape part) a cursor of another list, another text or another type is invalid-request naming cursor', () => {
    const matches = encodeCursor('matches', [1, 'AAAA']);
    const history = encodeCursor('history', [20, 'AAAA', 10, 'BBBB']);
    for (const cursor of [matches, history, 'AAAA', '', 5, null, `${encodeCursor('ranking', [0, 20, 'AAAA', 'u1'])}=`]) {
      expect(readRankingRequest({ community: KEY, cursor }), String(cursor)).toStrictEqual(invalid('cursor'));
    }
  });

  it('FR-565 (cursor part) a cursor issued for another order is invalid-request naming cursor', () => {
    const accuracyCursor = encodeCursor('ranking', [3, 20, 'AAAA', 'u1']);
    expect(readRankingRequest({ community: KEY, order: 'points', cursor: accuracyCursor })).toStrictEqual(invalid('cursor'));
    expect(readRankingRequest({ community: KEY, order: 'accuracy', cursor: accuracyCursor })).toMatchObject({ ok: true });
    const pointsCursor = encodeCursor('ranking', [0, 20, 'AAAA', 'u1']);
    for (const order of ['correct', 'wins', 'accuracy'] as const) {
      expect(readRankingRequest({ community: KEY, order, cursor: pointsCursor }), order).toStrictEqual(invalid('cursor'));
    }
    expect(readRankingRequest({ community: KEY, cursor: pointsCursor })).toMatchObject({ ok: true });
  });

  it('FR-573 (shape part) an unknown member is refused naming the first in sorted order, after the known ones; inherited members are ignored', () => {
    expect(readRankingRequest({ community: KEY, zeta: 1, alpha: 2 })).toStrictEqual(invalid('alpha'));
    expect(readRankingRequest({ community: KEY, page: 2 })).toStrictEqual(invalid('page'));
    expect(readRankingRequest({ community: KEY, namespace: 'discord' })).toStrictEqual(invalid('namespace'));
    expect(readRankingRequest({ zeta: 1, limit: 0, community: KEY })).toStrictEqual(invalid('limit'));
    const inherited = Object.create({ community: KEY, order: 'wins', limit: 5 }) as Record<string, unknown>;
    expect(readRankingRequest(inherited)).toStrictEqual(invalid('community'));
    expect(readRankingRequest(Object.assign(Object.create({ limit: 5, cursor: 'x' }) as object, { community: KEY }))).toStrictEqual({ ok: true, value: { community: KEY, order: 'points', limit: 100 } });
  });
});

describe('FR-565 (cursor part) the ranking cursor', () => {
  const key = [3, 1_700_000_009_000, 'RnkMatchHEAD0001', 'u-1.x'] as const;

  it('FR-565 (cursor part) ranking is a cursor list and its key round-trips with the order, the head and the local id of the last row', () => {
    expect(CURSOR_LISTS).toContain('ranking');
    const text = encodeCursor('ranking', key);
    expect(text.length).toBeLessThanOrEqual(256);
    expect(decodeCursor('ranking', text)).toStrictEqual({ ok: true, value: key });
    // The head itself is a valid last key (a page of one row), in any order.
    expect(decodeCursor('ranking', encodeCursor('ranking', [0, 10, 'A', 'a']))).toStrictEqual({ ok: true, value: [0, 10, 'A', 'a'] });
  });

  it('FR-565 (cursor part) the longest key still fits the cursor length', () => {
    expect(() => encodeCursor('ranking', [3, 9_007_199_254_740_991, 'x'.repeat(64), 'y'.repeat(64)])).not.toThrow();
  });

  it('FR-565 (cursor part) a ranking cursor is refused for any other list, and no other cursor for ranking', () => {
    const text = encodeCursor('ranking', key);
    for (const list of CURSOR_LISTS.filter((l) => l !== 'ranking')) expect(decodeCursor(list, text), list).toStrictEqual(invalid('cursor'));
    expect(decodeCursor('ranking', encodeCursor('matches', [1, 'AAAA']))).toStrictEqual(invalid('cursor'));
    expect(decodeCursor('ranking', encodeCursor('records', [3]))).toStrictEqual(invalid('cursor'));
  });

  it('FR-565 (cursor part) a re-encoded text or a bad shape is refused', () => {
    const spaced = Buffer.from(`[ "ranking",${key[0]},${key[1]},"${key[2]}","${key[3]}"]`).toString('base64url');
    expect(decodeCursor('ranking', spaced)).toStrictEqual(invalid('cursor'));
    const raw = (parts: unknown[]): string => Buffer.from(JSON.stringify(['ranking', ...parts])).toString('base64url');
    const bad: unknown[][] = [
      [1, 'A', 'a'],
      [1, 'A', 'a', 'b', 1],
      [4, 1, 'A', 'a'],
      [-1, 1, 'A', 'a'],
      [1.5, 1, 'A', 'a'],
      ['3', 1, 'A', 'a'],
      [0, -1, 'A', 'a'],
      [0, 1.5, 'A', 'a'],
      [0, '1', 'A', 'a'],
      [0, 1, 5, 'a'],
      [0, 1, 'bad id', 'a'],
      [0, 1, 'A', 5],
      [0, 1, 'A', 'discord:1'],
      [0, 1, 'A', 'a b'],
      [0, 1, 'A', 'x'.repeat(65)],
    ];
    for (const parts of bad) expect(decodeCursor('ranking', raw(parts)), JSON.stringify(parts)).toStrictEqual(invalid('cursor'));
    expect(() => encodeCursor('ranking', [4, 1, 'A', 'a'] as never)).toThrow(RangeError);
    expect(() => encodeCursor('ranking', [0, 1, 'A', 'discord:1'] as never)).toThrow(RangeError);
    expect(() => encodeCursor('ranking', [0, 1, 'A'] as never)).toThrow(RangeError);
  });
});

describe('FR-563 (row shape part) and FR-565 (wire part) the ranking row and page: encode and decode', () => {
  it('FR-563 (row shape part) a row encodes with the fixed key order and decodes to the same value', () => {
    expect([...RANKING_ROW_KEYS]).toStrictEqual(['playerId', 'name', 'points', 'correct', 'scored', 'played', 'won', 'rank']);
    expect([...RANKING_PAGE_KEYS]).toStrictEqual(['items', 'total', 'next', 'asker']);
    const text = encodeRankingPage(page({ next: 'abc' }));
    expect(text).toBe(
      '{"items":[{"playerId":"discord:101","name":"Ana","points":9,"correct":4,"scored":6,"played":3,"won":1}],"total":5,"next":"abc"}',
    );
    expect(readRankingPage(JSON.parse(text))).toStrictEqual({ ok: true, value: page({ next: 'abc' }) });
    // The competition rank of the row (FR-565): present for a ranked row, absent in the accuracy tail (FR-566).
    const ranked = encodeRankingPage(page({ items: [row({ rank: 3 })] }));
    expect(ranked).toBe(
      '{"items":[{"playerId":"discord:101","name":"Ana","points":9,"correct":4,"scored":6,"played":3,"won":1,"rank":3}],"total":5}',
    );
    expect(readRankingPage(JSON.parse(ranked))).toStrictEqual({ ok: true, value: page({ items: [row({ rank: 3 })] }) });
    for (const rank of [0, -1, 1.5, '3', null]) {
      expect(() => encodeRankingPage(page({ items: [row({ rank } as never)] })), String(rank)).toThrow(RangeError);
      const wire = JSON.parse(encodeRankingPage(page()));
      wire.items[0].rank = rank;
      expect(readRankingPage(wire).ok, String(rank)).toBe(false);
    }
  });

  it('FR-563 (row shape part) the input key order does not change the bytes, and a row without a name omits it', () => {
    const shuffled = { won: 1, played: 3, scored: 6, correct: 4, points: 9, playerId: 'discord:101', name: 'Ana' };
    expect(encodeRankingPage({ total: 5, items: [shuffled] })).toBe(encodeRankingPage(page()));
    expect(encodeRankingPage(page({ items: [row({ name: undefined })] }))).toBe(
      '{"items":[{"playerId":"discord:101","points":9,"correct":4,"scored":6,"played":3,"won":1}],"total":5}',
    );
  });

  it('FR-567 (wire part) the asker is their statistics with a rank, without a rank, or { played: false }, and only those', () => {
    expect([...RANKING_ASKER_KEYS]).toStrictEqual(['points', 'correct', 'scored', 'played', 'won', 'rank']);
    const withAsker = (asker: unknown): RankingPage => ({ items: [row()], total: 5, asker: asker as RankingPage['asker'] });
    for (const asker of [
      { points: 6, correct: 2, scored: 4, played: 2, won: 0, rank: 3 },
      { points: 6, correct: 2, scored: 4, played: 2, won: 0 },
      { played: false as const },
    ]) {
      const text = encodeRankingPage(withAsker(asker));
      expect(JSON.parse(text).asker).toStrictEqual(asker);
      expect(readRankingPage(JSON.parse(text))).toStrictEqual({ ok: true, value: withAsker(asker) });
    }
    const bad: unknown[] = [
      { played: true },
      { played: false, points: 1 },
      { points: 1 },
      { rank: 1 },
      { points: -1, correct: 0, scored: 0, played: 0, won: 0, rank: 1 },
      { points: 1, correct: -1, scored: 0, played: 0, won: 0, rank: 1 },
      { points: 1, correct: 1, scored: 0, played: 0, won: 0, rank: 1 },
      { points: 1, correct: 1, scored: 2, played: 3, won: 0, rank: 1 },
      { points: 1, correct: 1, scored: 2, played: 2, won: 3, rank: 1 },
      { points: 1, correct: 1, scored: 2, played: 2, won: 1, rank: 0 },
      { points: 1, correct: 1, scored: 2, played: 2, won: 1, rank: 1, extra: 1 },
      {},
      null,
      5,
    ];
    for (const asker of bad) {
      expect(() => encodeRankingPage({ items: [row()], total: 5, asker } as never), JSON.stringify(asker)).toThrow(RangeError);
      const wire = JSON.parse(encodeRankingPage(page()));
      wire.asker = asker;
      expect(readRankingPage(wire).ok, JSON.stringify(asker)).toBe(false);
    }
  });

  it('FR-565 (wire part) total is required, whole and at least the number of items; next is optional', () => {
    expect(() => encodeRankingPage({ items: [] } as never)).toThrow(RangeError);
    expect(encodeRankingPage({ items: [], total: 0 })).toBe('{"items":[],"total":0}');
    expect(() => encodeRankingPage(page({ total: -1 }))).toThrow(RangeError);
    expect(() => encodeRankingPage(page({ total: 1.5 }))).toThrow(RangeError);
    expect(() => encodeRankingPage(page({ items: [row(), row({ playerId: 'discord:102' })], total: 1 }))).toThrow(RangeError);
    expect(readRankingPage({ items: [] })).toStrictEqual({ ok: false, field: 'total' });
    expect(readRankingPage({ items: [row()], total: 0 })).toStrictEqual({ ok: false, field: 'total' });
    expect(readRankingPage({ items: [], total: 0, next: '' })).toStrictEqual({ ok: false, field: 'next' });
    expect(readRankingPage({ items: [], total: 4, next: 'abc' })).toStrictEqual({ ok: true, value: { items: [], total: 4, next: 'abc' } });
  });

  it('FR-563 (row shape part) a row with a member outside the plan is refused by the encoder and the decoder, naming the member', () => {
    for (const extra of ['community', 'namespace', 'secret', 'rank', 'guild']) {
      expect(() => encodeRankingPage(page({ items: [{ ...row(), [extra]: KEY } as never] })), extra).toThrow(RangeError);
      const wire = JSON.parse(encodeRankingPage(page()));
      wire.items[0][extra] = KEY;
      expect(readRankingPage(wire), extra).toStrictEqual({ ok: false, field: `items[0].${extra}` });
    }
    const topExtra = JSON.parse(encodeRankingPage(page()));
    topExtra.items[0].total = 9;
    expect(readRankingPage(topExtra)).toStrictEqual({ ok: false, field: 'items[0].total' });
    expect(() => encodeRankingPage(page({ items: [row({ total: 9 } as never)] }))).toThrow(RangeError);
    expect(readRankingPage({ items: [], total: 0, extra: 1 })).toStrictEqual({ ok: false, field: 'extra' });
    expect(() => encodeRankingPage({ items: [], total: 0, community: KEY } as never)).toThrow(RangeError);
  });

  it('FR-563 (row shape part) the fields are checked: a namespaced player id, whole numbers, the name rule, and won <= played <= scored', () => {
    const bads: Partial<Record<keyof RankingRow, unknown>> = {
      playerId: 'x',
      points: -1,
      correct: -1,
      scored: -1,
      played: -1,
      won: -1,
    };
    for (const [k, v] of Object.entries(bads)) {
      expect(() => encodeRankingPage(page({ items: [row({ [k]: v } as never)] })), k).toThrow(RangeError);
      const wire = JSON.parse(encodeRankingPage(page()));
      wire.items[0][k] = v;
      expect(readRankingPage(wire), k).toStrictEqual({ ok: false, field: `items[0].${k}` });
    }
    // The counts are ordered: a player cannot win more matches than they played, nor play more than they had scored,
    // nor have more correct predictions than scored predictions.
    for (const over of [row({ won: 4 }), row({ played: 7 }), row({ scored: 2 }), row({ correct: 7 })]) {
      expect(() => encodeRankingPage(page({ items: [over] })), JSON.stringify(over)).toThrow(RangeError);
      const wire = JSON.parse(encodeRankingPage(page()));
      wire.items[0] = over;
      expect(readRankingPage(wire).ok, JSON.stringify(over)).toBe(false);
    }
    for (const name of [' Ana ', '', 'a'.repeat(33)]) {
      expect(() => encodeRankingPage(page({ items: [row({ name })] })), JSON.stringify(name)).toThrow(RangeError);
    }
    expect(() => encodeRankingPage(page({ items: [row({ playerId: 5 as never })] }))).toThrow(RangeError);
  });

  it('FR-565 (wire part) a player with every statistic at zero has a row; the decoder returns a fresh copy and never changes its input', () => {
    const zeroRow: RankingRow = { playerId: 'discord:101', points: 0, correct: 0, scored: 0, played: 0, won: 0 };
    const zeros = page({ items: [zeroRow], total: 1 });
    const wire = JSON.parse(encodeRankingPage(zeros));
    const before = JSON.stringify(wire);
    const read = readRankingPage(wire);
    expect(read).toStrictEqual({ ok: true, value: zeros });
    expect(JSON.stringify(wire)).toBe(before);
    expect(read.ok && read.value.items[0]).not.toBe(wire.items[0]);
    expect(readRankingPage(null)).toStrictEqual({ ok: false, field: 'body' });
    expect(readRankingPage({ items: 'x', total: 0 })).toStrictEqual({ ok: false, field: 'items' });
  });
});
