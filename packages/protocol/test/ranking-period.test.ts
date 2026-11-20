import { describe, expect, it } from 'vitest';
import { CURSOR_LISTS, RANKING_FIELDS, RANKING_PERIODS, decodeCursor, encodeCursor, readRankingRequest } from '../src/index';

// Spec 027, ranking by time period (M1, protocol part): the `period` member of the request, the windowed form of the
// `ranking` cursor and the compatibility of the all-time forms. The key and ids below are planted literals no other text of
// the repository holds. The identifier `window` never appears: the concept is `period` (plan PD2).

const KEY = '27d0c0123456789abcdef0123456789abcdef0123456789abcdef0123456789a';
const invalid = (field: string) => ({ ok: false, error: { kind: 'invalid-request', items: [field] } });
const nonOwn = (field: string) => ({ ok: false, error: { kind: 'invalid-player-id', items: [field] } });
const raw = (parts: unknown[]): string => Buffer.from(JSON.stringify(['ranking', ...parts])).toString('base64url');

describe('FR-575 (reader part) the period member of the ranking request', () => {
  it('FR-575 (reader part) the periods are all, last-7-days and last-30-days, and period is a member after order', () => {
    expect([...RANKING_PERIODS]).toStrictEqual(['all', 'last-7-days', 'last-30-days']);
    expect([...RANKING_FIELDS]).toStrictEqual(['community', 'order', 'period', 'playerId', 'limit', 'cursor']);
  });

  it('FR-575 (reader part) a windowed period is read as it is and all reads as no member, byte for byte', () => {
    expect(readRankingRequest({ community: KEY, period: 'last-7-days' })).toStrictEqual({
      ok: true,
      value: { community: KEY, order: 'points', period: 'last-7-days', limit: 100 },
    });
    expect(readRankingRequest({ community: KEY, order: 'wins', period: 'last-30-days', playerId: 'u-27.x', limit: 7 })).toStrictEqual({
      ok: true,
      value: { community: KEY, order: 'wins', period: 'last-30-days', playerId: 'u-27.x', limit: 7 },
    });
    const none = readRankingRequest({ community: KEY, order: 'correct', limit: 3 });
    const all = readRankingRequest({ community: KEY, order: 'correct', period: 'all', limit: 3 });
    expect(all).toStrictEqual(none);
    expect(JSON.stringify(all)).toBe(JSON.stringify(none));
    expect(all.ok && 'period' in all.value).toBe(false);
  });

  it('FR-575 (reader part) any other value, a non-text and a list of values are invalid-request naming period; an inherited member is ignored', () => {
    for (const period of ['week', 'month', 'semana', 'ALL', 'All', 'last-1-day', 'last-7-days ', '', 7, 30, null, true, [], ['all'], {}, undefined]) {
      expect(readRankingRequest({ community: KEY, period }), String(period)).toStrictEqual(invalid('period'));
    }
    // A raw JSON text with two `period` members is refused by the body guard at the HTTP layer (as `community` is); the
    // reader only ever sees the parsed object, where a list of values stands in for the duplicate and is refused above.
    expect(readRankingRequest({ community: KEY, period: ['last-7-days', 'last-30-days'] })).toStrictEqual(invalid('period'));
    // An inherited member is ignored, as every other member of the body.
    const inherited = Object.assign(Object.create({ period: 'week' }) as object, { community: KEY });
    expect(readRankingRequest(inherited)).toStrictEqual({ ok: true, value: { community: KEY, order: 'points', limit: 100 } });
  });

  it('FR-575 (reader part) the checks run in the order community, order, period, playerId, limit, cursor, then the unknown member', () => {
    expect(readRankingRequest({ period: 'week' })).toStrictEqual(invalid('community'));
    expect(readRankingRequest({ community: KEY, order: 'puntos', period: 'week' })).toStrictEqual(invalid('order'));
    expect(readRankingRequest({ community: KEY, period: 'week', playerId: 5, limit: 0, cursor: 'x', zeta: 1 })).toStrictEqual(invalid('period'));
    expect(readRankingRequest({ community: KEY, period: 'all', playerId: 5, limit: 0 })).toStrictEqual(invalid('playerId'));
    expect(readRankingRequest({ community: KEY, period: 'last-7-days', limit: 0, cursor: 'x' })).toStrictEqual(invalid('limit'));
    expect(readRankingRequest({ community: KEY, period: 'last-7-days', cursor: 'x', zeta: 1 })).toStrictEqual(invalid('cursor'));
    expect(readRankingRequest({ community: KEY, period: 'last-7-days', zeta: 1, alpha: 2 })).toStrictEqual(invalid('alpha'));
    // A structural failure comes before the player id charset (the FR-301 order), the period included.
    expect(readRankingRequest({ community: KEY, period: 'last-7-days', playerId: 'a b' })).toStrictEqual(nonOwn('playerId'));
    expect(readRankingRequest({ community: KEY, period: 'week', playerId: 'a b' })).toStrictEqual(invalid('period'));
    // The request carries no floor and no instant (FR-575): they are unknown members.
    for (const member of ['floor', 'since', 'from', 'now', 'at']) {
      expect(readRankingRequest({ community: KEY, period: 'last-7-days', [member]: 1_700_000_000_000 }), member).toStrictEqual(invalid(member));
    }
  });
});

describe('FR-578 (cursor part) the windowed ranking cursor', () => {
  const head = 1_700_000_009_000;
  const windowed7 = [3, head, 'RnkMatchHEAD0001', 'u-1.x', 1, 1_699_395_209_000] as const;
  const windowed30 = [0, head, 'RnkMatchHEAD0001', 'u-1.x', 2, 1_697_408_009_000] as const;

  it('FR-578 (cursor part) the 6-part key [order, headAt, headId, localId, periodIndex 1|2, floor] round-trips', () => {
    for (const key of [windowed7, windowed30]) {
      const text = encodeCursor('ranking', key);
      expect(text.length).toBeLessThanOrEqual(256);
      expect(decodeCursor('ranking', text)).toStrictEqual({ ok: true, value: key });
    }
    // The floor may be negative or zero (a test clock near 0) and later than the head (the empty reply, not an error).
    for (const floor of [0, -1, -9_007_199_254_740_991, head + 1, 9_007_199_254_740_991]) {
      const key = [1, head, 'A', 'a', 2, floor] as const;
      expect(decodeCursor('ranking', encodeCursor('ranking', key)), String(floor)).toStrictEqual({ ok: true, value: key });
    }
  });

  it('FR-578 (cursor part) the 4-part all-time key is unchanged: same text, same decoded key', () => {
    const key = [3, head, 'RnkMatchHEAD0001', 'u-1.x'] as const;
    const text = encodeCursor('ranking', key);
    expect(text).toBe(Buffer.from(JSON.stringify(['ranking', ...key])).toString('base64url'));
    expect(decodeCursor('ranking', text)).toStrictEqual({ ok: true, value: key });
  });

  it('NFR-129 (cursor part) a cursor issued before the period existed keeps decoding as the same all-time key', () => {
    // A literal cursor of the 025 form: ["ranking",1,1700000009000,"HeadA","u1"], planted as text.
    const old = Buffer.from('["ranking",1,1700000009000,"HeadA","u1"]').toString('base64url');
    expect(decodeCursor('ranking', old)).toStrictEqual({ ok: true, value: [1, 1_700_000_009_000, 'HeadA', 'u1'] });
    expect(readRankingRequest({ community: KEY, order: 'correct', cursor: old })).toStrictEqual({
      ok: true,
      value: { community: KEY, order: 'correct', limit: 100, after: [1, 1_700_000_009_000, 'HeadA', 'u1'] },
    });
  });

  it('FR-578 (cursor part) the longest windowed cursor (64-character ids, widest numbers, negative floor) fits 256 characters', () => {
    const text = encodeCursor('ranking', [3, 9_007_199_254_740_991, 'x'.repeat(64), 'y'.repeat(64), 2, -9_007_199_254_740_991]);
    expect(text.length).toBeLessThanOrEqual(256);
    expect(decodeCursor('ranking', text).ok).toBe(true);
  });

  it('FR-578 (cursor part) a 6-part key with index 0 or beyond 2, a 5- or 7-part key, a bad floor and a re-encoded text are refused', () => {
    const bad: unknown[][] = [
      [0, 10, 'A', 'a', 0, 5],
      [0, 10, 'A', 'a', 3, 5],
      [0, 10, 'A', 'a', -1, 5],
      [0, 10, 'A', 'a', 1.5, 5],
      [0, 10, 'A', 'a', '1', 5],
      [0, 10, 'A', 'a', 1],
      [0, 10, 'A', 'a', 1, 5, 6],
      [0, 10, 'A', 'a', 1, 1.5],
      [0, 10, 'A', 'a', 1, '5'],
      [0, 10, 'A', 'a', 1, null],
      [0, 10, 'A', 'a', 1, 9_007_199_254_740_992],
      [0, 10, 'A', 'a', 1, Number.MAX_VALUE],
      [4, 10, 'A', 'a', 1, 5],
      [0, 10, 'bad id', 'a', 1, 5],
      [0, 10, 'A', 'discord:1', 1, 5],
    ];
    for (const parts of bad) expect(decodeCursor('ranking', raw(parts)), JSON.stringify(parts)).toStrictEqual(invalid('cursor'));
    const spaced = Buffer.from(`[ "ranking",0,10,"A","a",1,5]`).toString('base64url');
    expect(decodeCursor('ranking', spaced)).toStrictEqual(invalid('cursor'));
    expect(() => encodeCursor('ranking', [0, 10, 'A', 'a', 0, 5] as never)).toThrow(RangeError);
    expect(() => encodeCursor('ranking', [0, 10, 'A', 'a', 3, 5] as never)).toThrow(RangeError);
    expect(() => encodeCursor('ranking', [0, 10, 'A', 'a', 1] as never)).toThrow(RangeError);
    expect(() => encodeCursor('ranking', [0, 10, 'A', 'a', 1, 1.5] as never)).toThrow(RangeError);
    expect(() => encodeCursor('ranking', [0, 10, 'A', 'a', 1, 5, 6] as never)).toThrow(RangeError);
  });

  it('FR-578 (cursor part) a windowed ranking cursor is refused for any other list', () => {
    const text = encodeCursor('ranking', windowed7);
    for (const list of CURSOR_LISTS.filter((l) => l !== 'ranking')) expect(decodeCursor(list, text), list).toStrictEqual(invalid('cursor'));
  });
});

describe('FR-578 (reader part) the request reader holds the walk to its period', () => {
  const head = 1_700_000_009_000;
  const c7 = encodeCursor('ranking', [0, head, 'RnkMatchHEAD0001', 'u-1.x', 1, 1_699_395_209_000]);
  const c30 = encodeCursor('ranking', [0, head, 'RnkMatchHEAD0001', 'u-1.x', 2, 1_697_408_009_000]);
  const allTime = encodeCursor('ranking', [0, head, 'RnkMatchHEAD0001', 'u-1.x']);

  it('FR-578 (reader part) a windowed cursor with its own period is accepted and comes back decoded as after', () => {
    expect(readRankingRequest({ community: KEY, period: 'last-7-days', cursor: c7 })).toStrictEqual({
      ok: true,
      value: { community: KEY, order: 'points', period: 'last-7-days', limit: 100, after: [0, head, 'RnkMatchHEAD0001', 'u-1.x', 1, 1_699_395_209_000] },
    });
    expect(readRankingRequest({ community: KEY, period: 'last-30-days', cursor: c30 })).toMatchObject({ ok: true });
  });

  it('FR-578 (reader part) a windowed cursor with no period, with all, or with the other period is invalid-request naming cursor', () => {
    expect(readRankingRequest({ community: KEY, cursor: c7 })).toStrictEqual(invalid('cursor'));
    expect(readRankingRequest({ community: KEY, period: 'all', cursor: c7 })).toStrictEqual(invalid('cursor'));
    expect(readRankingRequest({ community: KEY, period: 'last-30-days', cursor: c7 })).toStrictEqual(invalid('cursor'));
    expect(readRankingRequest({ community: KEY, period: 'last-7-days', cursor: c30 })).toStrictEqual(invalid('cursor'));
    expect(readRankingRequest({ community: KEY, cursor: c30 })).toStrictEqual(invalid('cursor'));
  });

  it('FR-578 (reader part) an all-time cursor with a period is invalid-request naming cursor, and with no period or all is accepted', () => {
    expect(readRankingRequest({ community: KEY, period: 'last-7-days', cursor: allTime })).toStrictEqual(invalid('cursor'));
    expect(readRankingRequest({ community: KEY, period: 'last-30-days', cursor: allTime })).toStrictEqual(invalid('cursor'));
    expect(readRankingRequest({ community: KEY, cursor: allTime })).toMatchObject({ ok: true });
    expect(readRankingRequest({ community: KEY, period: 'all', cursor: allTime })).toMatchObject({ ok: true });
  });

  it('FR-578 (reader part) the order still travels in a windowed cursor: another order is invalid-request naming cursor', () => {
    expect(readRankingRequest({ community: KEY, order: 'wins', period: 'last-7-days', cursor: c7 })).toStrictEqual(invalid('cursor'));
    expect(readRankingRequest({ community: KEY, order: 'points', period: 'last-7-days', cursor: c7 })).toMatchObject({ ok: true });
  });
});
