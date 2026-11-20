import { decodeCursor, errorReply } from '@mbrg/protocol';
import type { RankingPeriod } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { ResultRow } from '../src/core/scoring';
import { TOLERANCE_MS } from '../src/core/time';
import { openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import { put } from './helpers/history-rows';
import { serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Spec 027 T2.1: the floor of a ranking walk in the service. The first page reads the injected clock ONCE: the same reading gives
// the settle bound of the head (025) and the floor (now minus the period length); every later page takes head AND floor from its
// cursor and never moves them. A windowed `next` is the 6-part key, an all-time `next` the 025 4-part key. Instants are planted
// around the floors (at the floor, 1 ms before), the clock is the injected fake one, key values and ids are planted literals.

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const F7 = NOW - 7 * DAY;
const F30 = NOW - 30 * DAY;
const NAMESPACE = 'rank';
const KEY_V = '4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e';
const KEY_W = '6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c';
const id = (c: string, n: number): string => `${c.repeat(15)}${String(n)}`;
const victim = (local: string, round: number, correct: boolean, points: number): ResultRow => ({ playerId: `${NAMESPACE}:${local}`, kind: 'victim', round, choice: 3, correct, points });
const putResults = (store: Store, matchId: string, rows: readonly ResultRow[]): void => {
  store.transaction(() => store.putResults(matchId, rows));
};
const putName = (store: Store, matchId: string, local: string, name: string): void => {
  store.transaction(() => store.putClientName(matchId, `${NAMESPACE}:${local}`, name));
};

/**
 * The community of the tests, around the two floors (m1 oldest): m1 out of both windows, m2 AT the 30-day floor, m3 one
 * millisecond before the 7-day floor, m4 AT the 7-day floor, m5 two days old (the head). Names: r3 only in m3, r1 in m3 and m4.
 */
function seed(store: Store): void {
  const at = [F30 - 1, F30, F7 - 1, F7, NOW - 2 * DAY];
  at.forEach((instant, i) => put(store, { id: id('v', i + 1), community: KEY_V, namespace: NAMESPACE, at: instant }));
  putResults(store, id('v', 1), [victim('r6', 1, true, 9), victim('r4', 1, true, 7)]);
  putResults(store, id('v', 2), [victim('r4', 1, true, 1), victim('r5', 1, true, 2)]);
  putResults(store, id('v', 3), [victim('r1', 1, true, 5), victim('r9', 1, true, 100), victim('r3', 1, false, 0)]);
  putResults(store, id('v', 4), [victim('r1', 1, true, 3), victim('r2', 1, true, 2)]);
  putResults(store, id('v', 5), [victim('r2', 1, true, 4), victim('r3', 1, false, 0)]);
  putName(store, id('v', 3), 'r3', 'Name Outside');
  putName(store, id('v', 3), 'r1', 'Name Before');
  putName(store, id('v', 4), 'r1', 'Name Edge');
}

const harness = (build: (store: Store) => void = seed): Harness => {
  const store = openStore(':memory:');
  build(store);
  return serviceHarness({ store, start: NOW });
};

type Read = ReturnType<Harness['service']['ranking']>;
const read = (h: Harness, parts: Record<string, unknown> = {}): Read =>
  h.service.ranking({ namespace: NAMESPACE, community: KEY_V, order: 'points', limit: 500, ...parts } as Parameters<Harness['service']['ranking']>[0]);
const cursorOf = (out: Read): Parameters<Harness['service']['ranking']>[0]['after'] => {
  if (!out.ok || out.reply.next === undefined) throw new Error('no next cursor');
  const decoded = decodeCursor('ranking', out.reply.next);
  if (!decoded.ok) throw new Error('bad cursor');
  return decoded.value;
};
const ids = (out: Read): string[] => (out.ok ? out.reply.items.map((r) => r.playerId.slice(NAMESPACE.length + 1)) : ['<refused>']);
const PERIODS: readonly [Exclude<RankingPeriod, 'all'>, string[]][] = [
  ['last-7-days', ['r2', 'r1', 'r3']],
  ['last-30-days', ['r9', 'r1', 'r2', 'r5', 'r4', 'r3']],
];

describe('FR-576 (service part) the floor of a walk is the first page\'s clock minus the period length', () => {
  it('FR-576 (service part) a period reads only the matches at or after its floor: at the floor in, 1 ms before out, in each period', () => {
    const h = harness();
    for (const [period, expected] of PERIODS) {
      const out = read(h, { period });
      expect(ids(out), period).toStrictEqual(expected);
      expect(out.ok && out.reply.total, period).toBe(expected.length);
    }
    // All time (absent or explicit) reads every counted match.
    for (const parts of [{}, { period: 'all' }]) {
      const out = read(h, parts);
      expect(out.ok && out.reply.total, JSON.stringify(parts)).toBe(7);
      expect(ids(read(h, parts))[0]).toBe('r9');
    }
    h.close();
  });

  it('FR-577 (service part) a statistic of a match outside the period never reaches a windowed row: points, played and the shown name are the inside ones', () => {
    const h = harness();
    const week = read(h, { period: 'last-7-days' });
    expect(week.ok && week.reply.items).toStrictEqual([
      { playerId: `${NAMESPACE}:r2`, points: 6, correct: 2, scored: 2, played: 2, won: 1, rank: 1 },
      // r1: only m4 is in the week (5 points of m3 and the name of m3 are out); the name of m4 is the shown one.
      { playerId: `${NAMESPACE}:r1`, name: 'Name Edge', points: 3, correct: 1, scored: 1, played: 1, won: 1, rank: 2 },
      // r3: its only name sits in m3, one millisecond before the week: no name.
      { playerId: `${NAMESPACE}:r3`, points: 0, correct: 0, scored: 1, played: 1, won: 0, rank: 3 },
    ]);
    // r9 played only m3: no row in the week, a row in the month; the month shows r3's name.
    expect(ids(week)).not.toContain('r9');
    const month = read(h, { period: 'last-30-days' });
    expect(month.ok && month.reply.items.find((r) => r.playerId === `${NAMESPACE}:r3`)?.name).toBe('Name Outside');
    expect(month.ok && month.reply.items.find((r) => r.playerId === `${NAMESPACE}:r1`)?.name).toBe('Name Edge');
    h.close();
  });

  it('FR-576 (service part) the first page reads the clock once, for the settled head and the floor; a later page reads it never', () => {
    const h = harness();
    let reads = 0;
    const real = h.clock.now;
    h.clock.now = () => {
      reads += 1;
      return real();
    };
    for (const period of ['last-7-days', 'last-30-days', 'all'] as const) {
      reads = 0;
      const first = read(h, { period, limit: 1 });
      expect(reads, period).toBe(1);
      reads = 0;
      read(h, { period, limit: 1, after: cursorOf(first) });
      expect(reads, period).toBe(0);
    }
    h.close();
  });

  it('FR-576 (service part) the floor is the first page\'s: a walk across a clock advance of 31 days keeps its rows and its total; a fresh walk moves its floor', () => {
    const h = harness();
    const first = read(h, { period: 'last-7-days', limit: 1 });
    expect(ids(first)).toStrictEqual(['r2']);
    h.clock.advance(31 * DAY);
    // The cursor of the first page carries the floor: the clock moved 31 days and the walk does not notice.
    const second = read(h, { period: 'last-7-days', limit: 1, after: cursorOf(first) });
    expect(ids(second)).toStrictEqual(['r1']);
    expect(second.ok && second.reply.total).toBe(3);
    const third = read(h, { period: 'last-7-days', limit: 1, after: cursorOf(second) });
    expect(ids(third)).toStrictEqual(['r3']);
    expect(third.ok && third.reply.total).toBe(3);
    expect(third.ok && third.reply.next).toBeUndefined();
    // A fresh walk reads the new clock: the head (2 days before the old clock) is now 33 days old, older than both floors.
    for (const [period] of PERIODS) expect(read(h, { period })).toStrictEqual({ ok: true, reply: { items: [], total: 0 } });
    h.close();
  });

  it('FR-576 (service part) a later page takes its floor from the cursor, never from the clock: a cursor floor of its own decides the rows', () => {
    const h = harness();
    // The cursor of a week walk, rebuilt with a floor one millisecond below m3 (so m3 and its r9 are in): the rows follow the
    // cursor's floor, not the clock's week.
    const first = read(h, { period: 'last-7-days', limit: 1 });
    const key = cursorOf(first) as readonly (number | string)[];
    expect(key).toHaveLength(6);
    // The cursor names r9 (a player with rows only in m3): under the clock's own week that row does not exist.
    const widened = [...key.slice(0, 3), 'r9', key[4], F7 - 1] as unknown as Parameters<Harness['service']['ranking']>[0]['after'];
    const out = read(h, { period: 'last-7-days', after: widened });
    expect(out.ok && out.reply.total).toBe(4);
    expect(ids(out)).toStrictEqual(['r1', 'r2', 'r3']);
    h.close();
  });
});

describe('FR-578 (service part) the cursor carries the period and the floor; a walk is held to its period', () => {
  it('FR-578 (service part) a windowed next is [order, head instant, head id, local id, period index, floor]; an all-time next is the 025 4-part key', () => {
    const h = harness();
    const headId = id('v', 5);
    const headAt = NOW - 2 * DAY;
    expect(cursorOf(read(h, { period: 'last-7-days', limit: 1 }))).toStrictEqual([0, headAt, headId, 'r2', 1, F7]);
    expect(cursorOf(read(h, { period: 'last-30-days', limit: 1 }))).toStrictEqual([0, headAt, headId, 'r9', 2, F30]);
    expect(cursorOf(read(h, { period: 'last-30-days', order: 'wins', limit: 2 }))).toHaveLength(6);
    expect(cursorOf(read(h, { limit: 1 }))).toStrictEqual([0, headAt, headId, 'r9']);
    expect(cursorOf(read(h, { period: 'all', limit: 1 }))).toStrictEqual([0, headAt, headId, 'r9']);
    h.close();
  });

  it('FR-578 (service part) a cursor whose period differs from the request\'s is invalid-request naming the cursor, in every direction', () => {
    const h = harness();
    const refused = { ok: false, error: errorReply('invalid-request', ['cursor']) };
    const week = cursorOf(read(h, { period: 'last-7-days', limit: 1 }));
    const month = cursorOf(read(h, { period: 'last-30-days', limit: 1 }));
    const all = cursorOf(read(h, { limit: 1 }));
    expect(read(h, { after: week })).toStrictEqual(refused);
    expect(read(h, { period: 'all', after: week })).toStrictEqual(refused);
    expect(read(h, { period: 'last-30-days', after: week })).toStrictEqual(refused);
    expect(read(h, { period: 'last-7-days', after: month })).toStrictEqual(refused);
    expect(read(h, { period: 'last-7-days', after: all })).toStrictEqual(refused);
    expect(read(h, { period: 'last-30-days', after: all })).toStrictEqual(refused);
    // The same period continues.
    expect(read(h, { period: 'last-7-days', after: week }).ok).toBe(true);
    expect(read(h, { period: 'last-30-days', after: month }).ok).toBe(true);
    expect(read(h, { after: all }).ok).toBe(true);
    h.close();
  });

  it('NFR-129 (cursor part) a cursor of the 025 form continues an all-time walk: the same rows as the walk that issued it', () => {
    const h = harness();
    const first = read(h, { limit: 3 });
    const second = read(h, { limit: 3, after: cursorOf(first) });
    const whole = read(h);
    expect([...ids(first), ...ids(second), ...ids(read(h, { limit: 3, after: cursorOf(second) }))]).toStrictEqual(ids(whole));
    h.close();
  });
});

describe('FR-579 (service part) the empty windowed reply is bare, the empty all-time reply keeps its asker', () => {
  /** A community whose only counted match is 40 days old, with scored rows; and a second one with a recent match holding none. */
  const build = (store: Store): void => {
    put(store, { id: id('w', 1), community: KEY_W, namespace: NAMESPACE, at: NOW - 40 * DAY });
    putResults(store, id('w', 1), [victim('r1', 1, true, 5)]);
    put(store, { id: id('v', 1), community: KEY_V, namespace: NAMESPACE, at: NOW - 2 * DAY });
  };

  it('FR-579 (service part) a head older than the floor, or a window with no scored row, answers {items: [], total: 0} even with a player named', () => {
    const h = harness(build);
    const bare = { ok: true, reply: { items: [], total: 0 } };
    for (const period of ['last-7-days', 'last-30-days'] as const) {
      // KEY_W: the head is 40 days old (older than both floors); KEY_V: a recent head with no scored row.
      expect(read(h, { community: KEY_W, period, playerId: 'r1' }), period).toStrictEqual(bare);
      expect(read(h, { community: KEY_W, period }), period).toStrictEqual(bare);
      expect(read(h, { period, playerId: 'r1' }), period).toStrictEqual(bare);
      expect(read(h, { period }), period).toStrictEqual(bare);
    }
    h.close();
  });

  it('FR-579 (service part) the all-time reply of a snapshot with no scored row keeps the asker: played false, unlike the windowed one', () => {
    const h = harness(build);
    expect(read(h, { playerId: 'r1' })).toStrictEqual({ ok: true, reply: { items: [], total: 0, asker: { played: false } } });
    expect(read(h, { period: 'all', playerId: 'r1' })).toStrictEqual({ ok: true, reply: { items: [], total: 0, asker: { played: false } } });
    expect(read(h, { period: 'last-7-days', playerId: 'r1' })).toStrictEqual({ ok: true, reply: { items: [], total: 0 } });
    // A community the key does not name holds no head at all: the bare reply in every period (025).
    expect(read(h, { community: `${KEY_W.slice(0, 63)}0`, playerId: 'r1' })).toStrictEqual({ ok: true, reply: { items: [], total: 0 } });
    h.close();
  });

  it('FR-579 (service part) a cursor naming a row the windowed snapshot holds none of, and a forged floor later than the head, answer the bare reply', () => {
    const h = harness();
    const week = cursorOf(read(h, { period: 'last-7-days', limit: 1 })) as readonly (number | string)[];
    const bare = { ok: true, reply: { items: [], total: 0 } };
    // The row r9 only has rows outside the week: a week cursor naming it finds none.
    const foreign = [...week.slice(0, 3), 'r9', ...week.slice(4)] as unknown as Parameters<Harness['service']['ranking']>[0]['after'];
    expect(read(h, { period: 'last-7-days', after: foreign })).toStrictEqual(bare);
    const headAt = week[1] as number;
    const later = [...week.slice(0, 5), headAt + 1] as unknown as Parameters<Harness['service']['ranking']>[0]['after'];
    expect(read(h, { period: 'last-7-days', after: later, playerId: 'r2' })).toStrictEqual(bare);
    h.close();
  });
});

describe('FR-579 (service part) a windowed read writes nothing and remembers nothing', () => {
  const recording = (store: Store): { store: Store; calls: () => string[] } => {
    const seen: string[] = [];
    const wrapped: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(store)) {
      wrapped[name] =
        typeof value === 'function'
          ? (...args: unknown[]) => {
              seen.push(name);
              return (value as (...a: unknown[]) => unknown).apply(store, args);
            }
          : value;
    }
    return { store: wrapped as unknown as Store, calls: () => seen.splice(0) };
  };

  it('FR-579 (service part) a first page calls the head read and the two snapshot reads only, a later page the two; the second read of a period is a fresh one', () => {
    const store = openStore(':memory:');
    seed(store);
    const wrapped = recording(store);
    const h = serviceHarness({ store: wrapped.store, start: NOW });
    const first = read(h, { period: 'last-7-days', limit: 1 });
    expect(wrapped.calls().sort()).toStrictEqual(['historyAfter', 'rankingNames', 'rankingResults']);
    read(h, { period: 'last-7-days', limit: 1, after: cursorOf(first) });
    expect(wrapped.calls().sort()).toStrictEqual(['rankingNames', 'rankingResults']);
    // Nothing is memoised: a match finishing between two fresh reads (settled by then) changes the second one.
    const before = read(h, { period: 'last-7-days' });
    put(store, { id: id('v', 6), community: KEY_V, namespace: NAMESPACE, at: NOW - DAY });
    putResults(store, id('v', 6), [victim('r7', 1, true, 1)]);
    const after = read(h, { period: 'last-7-days' });
    expect(before.ok && before.reply.total).toBe(3);
    expect(after.ok && after.reply.total).toBe(4);
    h.close();
    store.close();
  });

  it('FR-579 (service part) a storage failure of the head read or of either snapshot read is unavailable, in a period', () => {
    for (const method of ['historyAfter', 'rankingResults', 'rankingNames'] as const) {
      const store = openStore(':memory:');
      seed(store);
      const h = serviceHarness({
        store: { ...store, [method]: () => { throw new StoreError('store-failure', 'injected'); } } as Store,
        start: NOW,
      });
      expect(read(h, { period: 'last-30-days' }), method).toStrictEqual({ ok: false, error: errorReply('unavailable') });
      h.close();
      store.close();
    }
  });

  it('FR-575 (service part) the settled head is the same with or without a period: a match inside TOLERANCE_MS of the clock is no head', () => {
    const h = harness((store) => {
      seed(store);
      put(store, { id: id('v', 7), community: KEY_V, namespace: NAMESPACE, at: NOW - TOLERANCE_MS });
      putResults(store, id('v', 7), [victim('r8', 1, true, 50)]);
    });
    for (const period of ['last-7-days', 'last-30-days', 'all'] as const) {
      expect(ids(read(h, { period })), period).not.toContain('r8');
    }
    h.clock.advance(1);
    expect(ids(read(h, { period: 'last-7-days' }))[0]).toBe('r8');
    h.close();
  });
});
