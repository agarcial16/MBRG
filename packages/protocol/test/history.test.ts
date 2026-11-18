import { describe, expect, it } from 'vitest';
import {
  CURSOR_LISTS,
  HISTORY_ENTRY_KEYS,
  HISTORY_FIELDS,
  HISTORY_PAGE_KEYS,
  decodeCursor,
  encodeCursor,
  encodeHistoryPage,
  readHistoryPage,
  readHistoryRequest,
  type HistoryEntry,
  type HistoryPage,
} from '../src/index';

// Spec 024, history read of the protocol: the request reader, the `history` cursor and the page of entries (encode and decode).
// The key and ids below are planted literals no other text of the repository holds.

const KEY = '5a17ed0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const invalid = (field: string) => ({ ok: false, error: { kind: 'invalid-request', items: [field] } });
const nonOwn = (field: string) => ({ ok: false, error: { kind: 'invalid-player-id', items: [field] } });

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  matchId: 'HstMatchAAAA0001',
  mapId: 'dev',
  finishedAt: 1_700_000_005_000,
  winner: 3,
  playerCount: 7,
  top: [
    { playerId: 'discord:1001', name: 'Ana', points: 9, rank: 1 },
    { playerId: 'discord:1002', points: 4, rank: 2 },
  ],
  more: 1,
  ...over,
});
const page = (over: Partial<HistoryPage> = {}): HistoryPage => ({ items: [entry()], total: 1, ...over });

describe('FR-573 (shape part) the history request reader', () => {
  it('FR-573 (shape part) reads { community, playerId?, limit?, cursor? } with the limit defaulting to 100', () => {
    expect(readHistoryRequest({ community: KEY })).toStrictEqual({ ok: true, value: { community: KEY, limit: 100 } });
    expect(readHistoryRequest({ community: KEY, playerId: 'u-1.x', limit: 5 })).toStrictEqual({ ok: true, value: { community: KEY, playerId: 'u-1.x', limit: 5 } });
    const cursor = encodeCursor('history', [20, 'AAAA', 10, 'BBBB']);
    expect(readHistoryRequest({ community: KEY, cursor })).toStrictEqual({ ok: true, value: { community: KEY, limit: 100, after: [20, 'AAAA', 10, 'BBBB'] } });
    expect([...HISTORY_FIELDS]).toStrictEqual(['community', 'playerId', 'limit', 'cursor']);
  });

  it('FR-573 (shape part) the page size is a whole number 1 to 500 (a number, not a text)', () => {
    for (const limit of [1, 5, 100, 500]) expect(readHistoryRequest({ community: KEY, limit }), String(limit)).toStrictEqual({ ok: true, value: { community: KEY, limit } });
    for (const limit of [0, 501, 1000, -1, 1.5, '5', null, true, [], {}, Number.NaN]) {
      expect(readHistoryRequest({ community: KEY, limit }), JSON.stringify(limit)).toStrictEqual(invalid('limit'));
    }
  });

  it('FR-573 (shape part) a missing or malformed community key, and a body that is not an object, are invalid-request naming the member', () => {
    expect(readHistoryRequest({})).toStrictEqual(invalid('community'));
    for (const community of [KEY.toUpperCase(), KEY.slice(1), `${KEY}0`, '', 5, null, undefined, [KEY]]) {
      expect(readHistoryRequest({ community }), String(community)).toStrictEqual(invalid('community'));
    }
    for (const body of [null, 5, 'x', [], undefined]) expect(readHistoryRequest(body)).toStrictEqual(invalid('body'));
  });

  it('FR-573 (shape part) the player id is a local id: a non-text is invalid-request, a text outside the id rule is invalid-player-id', () => {
    for (const playerId of [5, null, true, []]) expect(readHistoryRequest({ community: KEY, playerId }), String(playerId)).toStrictEqual(invalid('playerId'));
    for (const playerId of ['discord:1', '', 'a b', 'x'.repeat(65), 'a\n']) expect(readHistoryRequest({ community: KEY, playerId }), playerId).toStrictEqual(nonOwn('playerId'));
    // A structural failure of a later member comes before the player id charset (the FR-301 order).
    expect(readHistoryRequest({ community: KEY, playerId: 'a b', limit: 0 })).toStrictEqual(invalid('limit'));
  });

  it('FR-573 (shape part) a cursor of another list, another text or another type is invalid-request naming cursor', () => {
    const matches = encodeCursor('matches', [1, 'AAAA']);
    for (const cursor of [matches, 'AAAA', '', 5, null, `${encodeCursor('history', [20, 'AAAA', 10, 'BBBB'])}=`]) {
      expect(readHistoryRequest({ community: KEY, cursor }), String(cursor)).toStrictEqual(invalid('cursor'));
    }
  });

  it('FR-573 (shape part) an unknown member is refused naming the first in sorted order, after the known ones; inherited members are ignored', () => {
    expect(readHistoryRequest({ community: KEY, zeta: 1, alpha: 2 })).toStrictEqual(invalid('alpha'));
    expect(readHistoryRequest({ community: KEY, page: 2 })).toStrictEqual(invalid('page'));
    expect(readHistoryRequest({ community: KEY, namespace: 'discord' })).toStrictEqual(invalid('namespace'));
    expect(readHistoryRequest({ zeta: 1, limit: 0, community: KEY })).toStrictEqual(invalid('limit'));
    const inherited = Object.create({ community: KEY, playerId: 'u1', limit: 5 }) as Record<string, unknown>;
    expect(readHistoryRequest(inherited)).toStrictEqual(invalid('community'));
    expect(readHistoryRequest(Object.assign(Object.create({ limit: 5, cursor: 'x' }) as object, { community: KEY }))).toStrictEqual({ ok: true, value: { community: KEY, limit: 100 } });
  });
});

describe('FR-549 (cursor part) the history cursor', () => {
  const key = [1_700_000_009_000, 'HstMatchHEAD0001', 1_700_000_005_000, 'HstMatchLAST0002'] as const;

  it('FR-549 (cursor part) history is a cursor list and its key round-trips with the head and the last key', () => {
    expect(CURSOR_LISTS).toContain('history');
    const text = encodeCursor('history', key);
    expect(text.length).toBeLessThanOrEqual(256);
    expect(decodeCursor('history', text)).toStrictEqual({ ok: true, value: key });
    // The head itself is a valid last key (a page of one entry), and so is a tie on the finish instant after the head in match id order.
    expect(decodeCursor('history', encodeCursor('history', [10, 'A', 10, 'A']))).toStrictEqual({ ok: true, value: [10, 'A', 10, 'A'] });
    expect(decodeCursor('history', encodeCursor('history', [10, 'A', 10, 'B']))).toStrictEqual({ ok: true, value: [10, 'A', 10, 'B'] });
  });

  it('FR-549 (cursor part) the longest key still fits the cursor length', () => {
    const id = 'x'.repeat(64);
    expect(() => encodeCursor('history', [9_007_199_254_740_991, id, 9_007_199_254_740_991, id])).not.toThrow();
  });

  it('FR-549 (cursor part) a history cursor is refused for any other list, and no other cursor for history', () => {
    const text = encodeCursor('history', key);
    for (const list of CURSOR_LISTS.filter((l) => l !== 'history')) expect(decodeCursor(list, text), list).toStrictEqual(invalid('cursor'));
    expect(decodeCursor('history', encodeCursor('matches', [1, 'AAAA']))).toStrictEqual(invalid('cursor'));
    expect(decodeCursor('history', encodeCursor('records', [3]))).toStrictEqual(invalid('cursor'));
  });

  it('FR-549 (cursor part) a re-encoded text, a bad shape or a last key before the head is refused', () => {
    const spaced = Buffer.from(`[ "history",${key[0]},"${key[1]}",${key[2]},"${key[3]}"]`).toString('base64url');
    expect(decodeCursor('history', spaced)).toStrictEqual(invalid('cursor'));
    const raw = (parts: unknown[]): string => Buffer.from(JSON.stringify(['history', ...parts])).toString('base64url');
    const bad: unknown[][] = [
      [1, 'A', 1],
      [1, 'A', 1, 'B', 1],
      [-1, 'A', 1, 'B'],
      [1.5, 'A', 1, 'B'],
      ['1', 'A', 1, 'B'],
      [2, 'A', 1, ''],
      [2, 'bad id', 1, 'B'],
      [2, 'A', 1, 'bad id'],
      [2, 'A', 1, 'x'.repeat(65)],
      // The last key is newer than the head (finish instant later), or a tie that sorts before it (match id lower).
      [1, 'A', 2, 'B'],
      [5, 'B', 5, 'A'],
    ];
    for (const parts of bad) expect(decodeCursor('history', raw(parts)), JSON.stringify(parts)).toStrictEqual(invalid('cursor'));
    expect(() => encodeCursor('history', [1, 'A', 2, 'B'] as never)).toThrow(RangeError);
    expect(() => encodeCursor('history', [1, 'A', 1] as never)).toThrow(RangeError);
  });
});

describe('FR-550 (wire part) the history entry and page: encode and decode', () => {
  it('FR-550 (wire part) an entry encodes with the fixed key order and decodes to the same value', () => {
    expect([...HISTORY_ENTRY_KEYS]).toStrictEqual(['matchId', 'mapId', 'finishedAt', 'winner', 'playerCount', 'top', 'more', 'asker']);
    expect([...HISTORY_PAGE_KEYS]).toStrictEqual(['items', 'total', 'next']);
    const text = encodeHistoryPage(page({ next: 'abc' }));
    expect(text).toBe(
      '{"items":[{"matchId":"HstMatchAAAA0001","mapId":"dev","finishedAt":1700000005000,"winner":3,"playerCount":7,' +
        '"top":[{"playerId":"discord:1001","name":"Ana","points":9,"rank":1},{"playerId":"discord:1002","points":4,"rank":2}],"more":1}],"total":1,"next":"abc"}',
    );
    expect(readHistoryPage(JSON.parse(text))).toStrictEqual({ ok: true, value: page({ next: 'abc' }) });
  });

  it('FR-550 (wire part) the input key order does not change the bytes', () => {
    const shuffled = { more: 1, top: entry().top, winner: 3, mapId: 'dev', matchId: 'HstMatchAAAA0001', playerCount: 7, finishedAt: 1_700_000_005_000 };
    expect(encodeHistoryPage({ total: 1, items: [shuffled] })).toBe(encodeHistoryPage(page()));
  });

  it('FR-551 (wire part) the asker is { points, rank } or { played: false }, and only those', () => {
    for (const asker of [{ points: 6, rank: 3 }, { points: 0, rank: 7 }, { played: false as const }]) {
      const text = encodeHistoryPage(page({ items: [entry({ asker })] }));
      expect(JSON.parse(text).items[0].asker).toStrictEqual(asker);
      expect(readHistoryPage(JSON.parse(text))).toStrictEqual({ ok: true, value: page({ items: [entry({ asker })] }) });
    }
    const bad: unknown[] = [{ played: true }, { played: false, points: 1 }, { points: 1 }, { rank: 1 }, { points: -1, rank: 1 }, { points: 1, rank: 0 }, { points: 1, rank: 1, played: false }, {}, null, 5];
    for (const asker of bad) {
      expect(() => encodeHistoryPage(page({ items: [entry({ asker } as never)] })), JSON.stringify(asker)).toThrow(RangeError);
      const wire = JSON.parse(encodeHistoryPage(page()));
      wire.items[0].asker = asker;
      expect(readHistoryPage(wire).ok, JSON.stringify(asker)).toBe(false);
    }
  });

  it('FR-550 (wire part) total is required, whole and at least the number of items; next is optional', () => {
    expect(() => encodeHistoryPage({ items: [] } as never)).toThrow(RangeError);
    expect(encodeHistoryPage({ items: [], total: 0 })).toBe('{"items":[],"total":0}');
    expect(() => encodeHistoryPage(page({ total: -1 }))).toThrow(RangeError);
    expect(() => encodeHistoryPage(page({ total: 1.5 }))).toThrow(RangeError);
    expect(() => encodeHistoryPage(page({ items: [entry(), entry({ matchId: 'HstMatchAAAA0002' })], total: 1 }))).toThrow(RangeError);
    expect(readHistoryPage({ items: [] })).toStrictEqual({ ok: false, field: 'total' });
    expect(readHistoryPage({ items: [entry()], total: 0 })).toStrictEqual({ ok: false, field: 'total' });
    expect(readHistoryPage({ items: [], total: 0, next: '' })).toStrictEqual({ ok: false, field: 'next' });
    expect(readHistoryPage({ items: [], total: 4, next: 'abc' })).toStrictEqual({ ok: true, value: { items: [], total: 4, next: 'abc' } });
  });

  it('FR-550 (wire part) an entry with a member outside the plan is refused by the encoder and the decoder, naming the member', () => {
    for (const extra of ['community', 'namespace', 'secret', 'createdAt', 'guild']) {
      expect(() => encodeHistoryPage(page({ items: [{ ...entry(), [extra]: KEY } as never] })), extra).toThrow(RangeError);
      const wire = JSON.parse(encodeHistoryPage(page()));
      wire.items[0][extra] = KEY;
      expect(readHistoryPage(wire), extra).toStrictEqual({ ok: false, field: `items[0].${extra}` });
    }
    const topExtra = JSON.parse(encodeHistoryPage(page()));
    topExtra.items[0].top[0].total = 9;
    expect(readHistoryPage(topExtra)).toStrictEqual({ ok: false, field: 'items[0].top[0].total' });
    expect(() => encodeHistoryPage(page({ items: [entry({ top: [{ playerId: 'discord:1', points: 1, rank: 1, total: 9 } as never] })] }))).toThrow(RangeError);
    expect(readHistoryPage({ items: [], total: 0, extra: 1 })).toStrictEqual({ ok: false, field: 'extra' });
    expect(() => encodeHistoryPage({ items: [], total: 0, community: KEY } as never)).toThrow(RangeError);
  });

  it('FR-550 (wire part) the fields are checked: ids, whole numbers, names, the top of at most 5 rows above 0 points, and the counts', () => {
    const bads: Partial<Record<keyof HistoryEntry, unknown>> = {
      matchId: '',
      mapId: 'Bad Map',
      finishedAt: -1,
      winner: 0,
      playerCount: -1,
      more: -1,
    };
    for (const [k, v] of Object.entries(bads)) {
      expect(() => encodeHistoryPage(page({ items: [entry({ [k]: v } as never)] })), k).toThrow(RangeError);
      const wire = JSON.parse(encodeHistoryPage(page()));
      wire.items[0][k] = v;
      expect(readHistoryPage(wire), k).toStrictEqual({ ok: false, field: `items[0].${k}` });
    }
    const six = Array.from({ length: 6 }, (_, i) => ({ playerId: `discord:${i + 1}`, points: 9 - i, rank: i + 1 }));
    expect(() => encodeHistoryPage(page({ items: [entry({ top: six, playerCount: 9, more: 0 })] }))).toThrow(RangeError);
    const five = six.slice(0, 5);
    expect(readHistoryPage(JSON.parse(encodeHistoryPage(page({ items: [entry({ top: five, playerCount: 9, more: 4 })] })))).ok).toBe(true);
    const wire6 = JSON.parse(encodeHistoryPage(page()));
    wire6.items[0].top = six;
    expect(readHistoryPage(wire6)).toStrictEqual({ ok: false, field: 'items[0].top' });
    // A row with 0 points never belongs to the top; the player id is namespaced; the name follows the name rule.
    for (const row of [{ playerId: 'discord:1', points: 0, rank: 1 }, { playerId: 'x', points: 1, rank: 1 }, { playerId: 'discord:1', points: 1, rank: 0 }, { playerId: 'discord:1', name: ' Ana ', points: 1, rank: 1 }, { playerId: 'discord:1', name: '', points: 1, rank: 1 }]) {
      expect(() => encodeHistoryPage(page({ items: [entry({ top: [row] })] })), JSON.stringify(row)).toThrow(RangeError);
      const wire = JSON.parse(encodeHistoryPage(page()));
      wire.items[0].top = [row];
      expect(readHistoryPage(wire).ok, JSON.stringify(row)).toBe(false);
    }
    // The top and the rows left out cannot exceed the player count.
    expect(() => encodeHistoryPage(page({ items: [entry({ playerCount: 2, more: 1 })] }))).toThrow(RangeError);
    const wireCount = JSON.parse(encodeHistoryPage(page()));
    wireCount.items[0].playerCount = 2;
    expect(readHistoryPage(wireCount)).toStrictEqual({ ok: false, field: 'items[0].more' });
  });

  it('FR-550 (wire part) a match with nobody above 0 points has an empty top; the decoder returns a fresh copy and never changes its input', () => {
    const empty = page({ items: [entry({ top: [], more: 0, playerCount: 3 })] });
    const wire = JSON.parse(encodeHistoryPage(empty));
    const before = JSON.stringify(wire);
    const read = readHistoryPage(wire);
    expect(read).toStrictEqual({ ok: true, value: empty });
    expect(JSON.stringify(wire)).toBe(before);
    expect(read.ok && read.value.items[0]).not.toBe(wire.items[0]);
    expect(readHistoryPage(null)).toStrictEqual({ ok: false, field: 'body' });
    expect(readHistoryPage({ items: 'x', total: 0 })).toStrictEqual({ ok: false, field: 'items' });
  });
});
