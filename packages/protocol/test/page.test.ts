import { describe, expect, it } from 'vitest';
import {
  CURSOR_LISTS,
  CURSOR_MAX_LENGTH,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  compareKeys,
  decodeCursor,
  encodeCursor,
  pageOf,
  readPageQuery,
  type CursorKey,
} from '../src/index';

// Paging of every list read (FR-279, P38, PD20): page size 1..500 (default 100), opaque keyset cursors per list.

const invalid = (field: string) => ({ ok: false, error: { kind: 'invalid-request', items: [field] } });
const q = (text: string): [string, string][] => (text === '' ? [] : text.split('&').map((p) => {
  const i = p.indexOf('=');
  return (i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)]) as [string, string];
}));

/** Deterministic generator for the property tests (no ambient randomness). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

describe('page size and cursor query (FR-279 (a), (e))', () => {
  it('FR-279 (a) the page size is 1 to 500 with default 100, and the limits are the documented numbers', () => {
    expect(PAGE_LIMIT_DEFAULT).toBe(100);
    expect(PAGE_LIMIT_MAX).toBe(500);
    expect(CURSOR_MAX_LENGTH).toBe(256);
    expect(readPageQuery('records', [])).toStrictEqual({ ok: true, value: { limit: 100, extra: {} } });
    for (const n of [1, 7, 99, 100, 101, 499, 500]) {
      expect(readPageQuery('records', q(`limit=${n}`))).toStrictEqual({ ok: true, value: { limit: n, extra: {} } });
    }
  });

  it('FR-279 (e) a page size outside 1 to 500 or not a plain decimal whole number is invalid-request naming limit', () => {
    for (const bad of ['0', '501', '1000', '1.5', 'abc', '', '01', '007', '+5', '-1', ' 5', '5 ', '1e2', '0x10', '５']) {
      expect(readPageQuery('records', [['limit', bad]]), bad).toStrictEqual(invalid('limit'));
    }
    expect(readPageQuery('records', q('limit=5&limit=5'))).toStrictEqual(invalid('limit'));
  });

  it('FR-279 (e) an unknown query parameter is invalid-request naming the first in sorted order, after the known ones', () => {
    expect(readPageQuery('records', q('zeta=1&alpha=2'))).toStrictEqual(invalid('alpha'));
    expect(readPageQuery('records', q('limit=5&page=2'))).toStrictEqual(invalid('page'));
    // A known parameter that fails is named before any unknown one.
    expect(readPageQuery('records', q('alpha=2&limit=0'))).toStrictEqual(invalid('limit'));
    // playerId is known only where the route lists it.
    expect(readPageQuery('records', q('playerId=p1'))).toStrictEqual(invalid('playerId'));
    expect(readPageQuery('predictions', q('playerId=p1'), ['playerId'])).toStrictEqual({ ok: true, value: { limit: 100, extra: { playerId: 'p1' } } });
    expect(readPageQuery('predictions', q('playerId=p1&playerId=p2'), ['playerId'])).toStrictEqual(invalid('playerId'));
  });

  it('FR-279 (e) a cursor must be base64url text of at most 256 characters, given once', () => {
    const ok = encodeCursor('records', [3]);
    expect(readPageQuery('records', [['cursor', ok]])).toStrictEqual({ ok: true, value: { limit: 100, after: [3], extra: {} } });
    for (const bad of ['', 'a b', 'ab+c', 'ab/c', 'abc=', 'é', 'x'.repeat(257), `${ok}%`]) {
      expect(readPageQuery('records', [['cursor', bad]]), bad).toStrictEqual(invalid('cursor'));
    }
    expect(readPageQuery('records', [['cursor', ok], ['cursor', ok]])).toStrictEqual(invalid('cursor'));
    // limit is checked before cursor.
    expect(readPageQuery('records', [['cursor', 'a b'], ['limit', '0']])).toStrictEqual(invalid('limit'));
  });
});

describe('cursors per list (FR-279 (b), (e))', () => {
  const samples: { [L in (typeof CURSOR_LISTS)[number]]: CursorKey<L>[] } = {
    matches: [[0, 'a'], [1_000_001, 'Mx7_q-1AbCdEfGh'], [Number.MAX_SAFE_INTEGER, 'z-_9']],
    records: [[1], [42], [999_999]],
    predictions: [['p1', 0, 'winner'], ['bot.7_x-y', 3, 'victim'], ['p1', 12, 'absorber']],
    'phase-results': [['web:p1'], ['discord:A.b-c_9'], ['web:B']],
    'player-results': [[0, 'winner'], [1, 'victim'], [Number.MAX_SAFE_INTEGER, 'absorber']],
    leaderboard: [[0, 1, 'web:p1'], [12, 3, 'discord:A.b-c_9'], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'web:p1']],
    players: [[1], [42], [Number.MAX_SAFE_INTEGER]],
    'phase-winners': [['player:Ab3_x-9.Qz1k'], ['player:a'], ['player:' + 'Z'.repeat(64)]],
  };

  it('FR-279 (b) the list tags are the three of M3a, the three results lists, the players list and the winners list, and each key round-trips through its cursor', () => {
    expect([...CURSOR_LISTS]).toStrictEqual(['matches', 'records', 'predictions', 'phase-results', 'player-results', 'leaderboard', 'players', 'phase-winners']);
    expect(CURSOR_LISTS).toHaveLength(8);
    for (const list of CURSOR_LISTS) {
      for (const key of samples[list]) {
        const text = encodeCursor(list, key as never);
        expect(text).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
        expect(decodeCursor(list, text)).toStrictEqual({ ok: true, value: key });
      }
    }
  });

  it('FR-279 (e) a cursor of another list is invalid-request naming cursor', () => {
    for (const from of CURSOR_LISTS) {
      for (const to of CURSOR_LISTS) {
        if (from === to) continue;
        for (const key of samples[from]) expect(decodeCursor(to, encodeCursor(from, key as never)), `${from} -> ${to}`).toStrictEqual(invalid('cursor'));
      }
    }
  });

  it('FR-279 (e) a cursor with a wrong tag or key shape, bad base64 or bad JSON is invalid-request', () => {
    const b64 = (s: string): string => {
      // The test builds cursors by hand with the platform encoder of ASCII text.
      const bytes = [...s].map((c) => c.charCodeAt(0));
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      let out = '';
      for (let i = 0; i < bytes.length; i += 3) {
        const [a = 0, b = 0, c = 0] = bytes.slice(i, i + 3);
        const n = (a << 16) | (b << 8) | c;
        const len = Math.min(3, bytes.length - i);
        out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]! + (len > 1 ? abc[(n >> 6) & 63]! : '') + (len > 2 ? abc[n & 63]! : '');
      }
      return out;
    };
    expect(b64('["records",3]')).toBe(encodeCursor('records', [3]));
    for (const raw of [
      '["records"]', '["records",0]', '["records",1.5]', '["records","3"]', '["records",3,4]', '["records",-1]',
      '["matches",1]', '["matches",-1,"a"]', '["matches",1,""]', '["matches",1,"a b"]', '["matches","1","a"]',
      '["predictions","p1",1]', '["predictions","p1",-1,"victim"]', '["predictions","a b",1,"victim"]', '["predictions","p1",1,"loser"]',
      '["predictions","ns:p1",1,"victim"]', '["predictions","p1",0,"victim"]', '["predictions","p1",1,"winner"]','{"records":3}', '"records"', 'records', '[records,3]', '["records", 3]', '',
    ]) {
      const list = raw.includes('matches') ? 'matches' : raw.includes('predictions') ? 'predictions' : 'records';
      expect(decodeCursor(list, b64(raw)), raw).toStrictEqual(invalid('cursor'));
    }
    // A key of the right shape under another tag, an unknown tag or no tag is not a cursor of this list.
    for (const raw of ['["matches",3]', '["predictions",3]', '["teams",3]', '[3]', '[null,3]']) {
      expect(decodeCursor('records', b64(raw)), raw).toStrictEqual(invalid('cursor'));
    }
    expect(decodeCursor('matches', b64('["records",5,"m1"]'))).toStrictEqual(invalid('cursor'));
    expect(decodeCursor('predictions', b64('["matches","p1",1,"victim"]'))).toStrictEqual(invalid('cursor'));
    for (const bad of ['', 'a', 'ab+c', 'ab/c', 'abc=', '!!!!', 'x'.repeat(257)]) expect(decodeCursor('records', bad), bad).toStrictEqual(invalid('cursor'));
    // Only the issued text decodes: a non-canonical spelling of the same bytes (extra trailing bits) is refused.
    const issued = encodeCursor('records', [3]);
    const last = issued.at(-1)!;
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const twin = issued.slice(0, -1) + abc[abc.indexOf(last) + 1]!;
    expect(decodeCursor('records', twin)).toStrictEqual(invalid('cursor'));
  });

  it('FR-279 (results lists) the results cursors are accepted only with their key shape: the player id, the round and kind, the generation', () => {
    const b64 = (s: string): string => {
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      let out = '';
      for (let i = 0; i < s.length; i += 3) {
        const n = (s.charCodeAt(i) << 16) | ((s.charCodeAt(i + 1) || 0) << 8) | (s.charCodeAt(i + 2) || 0);
        const len = Math.min(3, s.length - i);
        out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]! + (len > 1 ? abc[(n >> 6) & 63]! : '') + (len > 2 ? abc[n & 63]! : '');
      }
      return out;
    };
    expect(b64('["records",3]')).toBe(encodeCursor('records', [3]));
    const refused = (list: 'phase-results' | 'player-results' | 'leaderboard', raws: string[]): void => {
      for (const raw of raws) expect(decodeCursor(list, b64(raw)), raw).toStrictEqual(invalid('cursor'));
    };
    refused('phase-results', [
      '["phase-results"]', '["phase-results","p1"]', '["phase-results","web:"]', '["phase-results",":a"]', '["phase-results","web:a:b"]',
      '["phase-results","Web:a"]', '["phase-results",3]', '["phase-results","web:a","web:b"]', `["phase-results","web:${'x'.repeat(65)}"]`,
    ]);
    refused('player-results', [
      '["player-results"]', '["player-results",0]', '["player-results",0,"victim"]', '["player-results",1,"winner"]', '["player-results",-1,"victim"]',
      '["player-results",1.5,"victim"]', '["player-results","1","victim"]', '["player-results",1,"loser"]', '["player-results","victim",1]',
      '["player-results",1,"victim","web:a"]',
    ]);
    // A leaderboard cursor without the generation (or with a generation below 0 or a rank below 1) is refused.
    refused('leaderboard', [
      '["leaderboard",1,"web:a"]', '["leaderboard","web:a"]', '["leaderboard",-1,1,"web:a"]', '["leaderboard",0,0,"web:a"]', '["leaderboard",0,-2,"web:a"]',
      '["leaderboard",0,1.5,"web:a"]', '["leaderboard",0,1,"p1"]', '["leaderboard","0",1,"web:a"]', '["leaderboard",0,1,"web:a",4]',
    ]);
    expect(decodeCursor('leaderboard', b64('["leaderboard",0,1,"web:a"]'))).toStrictEqual({ ok: true, value: [0, 1, 'web:a'] });
    expect(decodeCursor('player-results', b64('["player-results",0,"winner"]'))).toStrictEqual({ ok: true, value: [0, 'winner'] });
    for (const [list, key] of [['phase-results', ['web:a:b']], ['player-results', [0, 'victim']], ['leaderboard', [0, 0, 'web:a']], ['leaderboard', [1, 'web:a']]] as const) {
      expect(() => encodeCursor(list, key as never), `${list} ${JSON.stringify(key)}`).toThrow(RangeError);
    }
  });

  it('FR-279 (results lists) the winners cursor is the joined player id alone: nothing else is a key', () => {
    const issued = encodeCursor('phase-winners', ['player:Ab3']);
    expect(readPageQuery('phase-winners', [['cursor', issued], ['limit', '2']])).toStrictEqual({ ok: true, value: { limit: 2, after: ['player:Ab3'], extra: {} } });
    for (const key of [[], ['p1'], ['web:a'], ['player:'], ['player:a:b'], [3], ['player:a', 'player:b'], ['Player:a'], [`player:${'x'.repeat(65)}`]]) {
      expect(() => encodeCursor('phase-winners', key as never), JSON.stringify(key)).toThrow(RangeError);
    }
    // The other lists refuse it and it refuses theirs (the cross-list matrix above covers every pair).
    expect(readPageQuery('phase-results', [['cursor', issued]])).toStrictEqual(invalid('cursor'));
    expect(readPageQuery('phase-winners', [['cursor', encodeCursor('phase-results', ['player:Ab3'])]])).toStrictEqual(invalid('cursor'));
  });

  it('FR-384 the players cursor is the join sequence number alone: a whole number from 1, nothing else', () => {
    const issued = encodeCursor('players', [7]);
    expect(issued).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readPageQuery('players', [['cursor', issued], ['limit', '2']])).toStrictEqual({ ok: true, value: { limit: 2, after: [7], extra: {} } });
    for (const key of [[0], [-1], [1.5], ['7'], [], [1, 2], [Number.MAX_SAFE_INTEGER + 1]]) {
      expect(() => encodeCursor('players', key as never), JSON.stringify(key)).toThrow(RangeError);
    }
    // A cursor of every other list is refused on the players list, and a players cursor on every other list.
    for (const other of CURSOR_LISTS) {
      if (other === 'players') continue;
      expect(readPageQuery(other, [['cursor', issued]]), other).toStrictEqual(invalid('cursor'));
      expect(readPageQuery('players', [['cursor', encodeCursor(other, samples[other][0] as never)]]), other).toStrictEqual(invalid('cursor'));
    }
  });

  it('NFR-51 (protocol) the results cursors of every list stay under the cursor limit', () => {
    const longest = `${'a'.repeat(16)}:${'Z'.repeat(64)}`;
    const big = Number.MAX_SAFE_INTEGER;
    for (const text of [encodeCursor('phase-results', [longest]), encodeCursor('leaderboard', [big, big, longest]), encodeCursor('player-results', [big, 'absorber'])]) {
      expect(text.length).toBeLessThanOrEqual(CURSOR_MAX_LENGTH);
    }
  });

  it('FR-279 (e) encodeCursor refuses a key of the wrong shape (the server never issues one)', () => {
    expect(() => encodeCursor('records', [0] as never)).toThrow(RangeError);
    expect(() => encodeCursor('matches', [1, ''] as never)).toThrow(RangeError);
    expect(() => encodeCursor('predictions', ['p1', 1, 'loser'] as never)).toThrow(RangeError);
    expect(() => encodeCursor('teams' as never, [1] as never)).toThrow(RangeError);
  });
});

describe('keyset pages (FR-279 (b), (c))', () => {
  it('FR-279 (b) keys compare by their parts in order: numbers by value, texts by code unit', () => {
    expect(compareKeys([1, 'b'], [1, 'b'])).toBe(0);
    expect(compareKeys([1, 'b'], [2, 'a'])).toBeLessThan(0);
    expect(compareKeys([2, 'a'], [1, 'z'])).toBeGreaterThan(0);
    expect(compareKeys([1, 'a'], [1, 'b'])).toBeLessThan(0);
    expect(compareKeys([9], [10])).toBeLessThan(0);
    expect(compareKeys(['p1', 0, 'winner'], ['p1', 1, 'absorber'])).toBeLessThan(0);
    expect(compareKeys(['B'], ['a'])).toBeLessThan(0);
  });

  it('FR-279 (a) a page holds at most limit items and carries next exactly when it is not the last', () => {
    const items = [1, 2, 3, 4, 5].map((r) => ({ round: r }));
    const keyOf = (i: { round: number }): readonly [number] => [i.round];
    expect(pageOf(items, keyOf, undefined, 2)).toStrictEqual({ items: [{ round: 1 }, { round: 2 }], next: [2] });
    expect(pageOf(items, keyOf, [2], 2)).toStrictEqual({ items: [{ round: 3 }, { round: 4 }], next: [4] });
    expect(pageOf(items, keyOf, [4], 2)).toStrictEqual({ items: [{ round: 5 }] });
    expect(pageOf(items, keyOf, undefined, 5)).toStrictEqual({ items });
    expect(pageOf(items, keyOf, [5], 2)).toStrictEqual({ items: [] });
    expect(pageOf([], keyOf, undefined, 100)).toStrictEqual({ items: [] });
    for (const bad of [0, 501, 1.5]) expect(() => pageOf(items, keyOf, undefined, bad)).toThrow(RangeError);
  });

  it('FR-279 (c) following cursors never repeats or skips an item, also with items inserted ahead of the cursor between pages', () => {
    type Row = { createdAt: number; matchId: string };
    const keyOf = (r: Row): readonly [number, string] => [r.createdAt, r.matchId];
    const sorted = (rows: Row[]): Row[] => [...rows].sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = lcg(seed * 7919);
      const id = (): string => `m${Math.floor(rnd() * 1e9).toString(36)}`;
      let rows: Row[] = sorted(Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => ({ createdAt: Math.floor(rnd() * 20), matchId: id() })));
      const original = rows.map((r) => r.matchId);
      const limit = 1 + Math.floor(rnd() * 7);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 1_000; guard++) {
        const after = cursor === undefined ? undefined : (decodeCursor('matches', cursor) as { ok: true; value: readonly [number, string] }).value;
        const page = pageOf(rows, keyOf, after, limit);
        expect(page.items.length).toBeLessThanOrEqual(limit);
        seen.push(...page.items.map((r) => r.matchId));
        if (page.next === undefined) break;
        cursor = encodeCursor('matches', page.next);
        // Between pages: rows inserted ahead of the cursor (at or before it) and some anywhere.
        const extra = Math.floor(rnd() * 3);
        for (let k = 0; k < extra; k++) rows.push({ createdAt: Math.floor(rnd() * (page.next[0] + 1)), matchId: id() });
        if (rnd() < 0.3) rows.push({ createdAt: Math.floor(rnd() * 20), matchId: id() });
        rows = sorted(rows);
      }
      // No repeat; every item that existed when the first page was read is seen, in order.
      expect(new Set(seen).size, `seed ${seed}`).toBe(seen.length);
      expect(seen.filter((m) => original.includes(m)), `seed ${seed}`).toStrictEqual(original);
    }
  });
});
