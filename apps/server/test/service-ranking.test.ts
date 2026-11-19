import { errorReply } from '@mbrg/protocol';
import { decodeCursor } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { PublicState } from '@mbrg/protocol';
import type { CoreMatch } from '../src/core/view';
import type { ResultRow } from '../src/core/scoring';
import { openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import { serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Spec 025 T2.1: the ranking read of the service over a real store (community rows, results and names seeded directly, as the
// store tests seed them). The service folds the counted matches of the snapshot head into statistics, orders, ranks and pages
// them through the pure core, and answers the empty page for an unknown key, another namespace or a foreign cursor. Key values
// and ids are planted literals no other text of the repository holds.

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);
// The harness clock starts at START_MS (1.7e12): the seeded finishes sit safely in the past, more than TOLERANCE_MS behind it,
// so every counted match is settled when the service reads (024 FR-549).
const T0 = 1_699_000_000_000;
const KEY_V = '4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e';
const KEY_W = '6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c';
const KEY_U = '8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a4f5e6d7c8b9a';
const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 10], [3, 10]] });
const id = (c: string, n = 1): string => `${c.repeat(15)}${String(n)}`;
const NAMESPACE = 'rank';

interface Spec {
  readonly id: string;
  readonly stage?: CoreMatch['stage'];
  readonly at?: number;
  readonly community?: string;
  readonly namespace?: string;
}

/** One stored match as the creation (client row, community row) and the steps leave it, in any stage. */
const put = (store: Store, spec: Spec): void => {
  const stage = spec.stage ?? 'finished';
  const finished = stage === 'finished';
  const applied = finished ? 5 : stage === 'halted' || stage === 'phase-1' || stage === 'phase-2' || stage === 'locked' ? 2 : 0;
  const at = spec.at ?? T0 + 1000;
  const match: CoreMatch = {
    matchId: spec.id,
    mapId: 'dev',
    mapDigest: DIGEST('a'),
    totalRounds: 5,
    timing: { i: 120, l1: 30, l2: 10 },
    commitment: DIGEST('c'),
    stage,
    appliedRounds: applied,
    state: state(applied),
    stateDigest: DIGEST('d'),
    lastSeq: 1,
    createdAt: T0,
    lastStepMs: at,
    anchors: null,
    ...(finished ? { winner: 10 } : {}),
    ...(stage === 'halted' ? { haltReason: 'map-changed' as const } : {}),
  };
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    if (spec.namespace !== undefined) store.insertClientMatch(spec.id, spec.namespace);
    if (spec.community !== undefined) store.insertCommunity(spec.id, spec.community);
  });
};

const victim = (playerId: string, round: number, correct: boolean, points: number): ResultRow => ({ playerId, kind: 'victim', round, choice: 3, correct, points });
const absorber = (playerId: string, round: number, correct: boolean, points: number): ResultRow => ({ playerId, kind: 'absorber', round, choice: 2, correct, points });
const winner = (playerId: string, correct: boolean, points: number): ResultRow => ({ playerId, kind: 'winner', round: 0, choice: 4, correct, points });

/** The scored results of one match, in one transaction. */
const putResults = (store: Store, matchId: string, rows: readonly ResultRow[]): void => {
  store.transaction(() => store.putResults(matchId, rows));
};

/** A stored 022 name of one match, in one transaction. */
const putName = (store: Store, matchId: string, playerId: string, name: string): void => {
  store.transaction(() => store.putClientName(matchId, playerId, name));
};

/** A service over a fresh in-memory store, seeded by `body` and closed with the harness. */
const rankingHarness = (body: (store: Store) => void): Harness => {
  const store = openStore(':memory:');
  body(store);
  return serviceHarness({ store });
};

/** A ranking read of the KEY_V community under the `rank` namespace, with the parts the caller overrides. */
const read = (h: Harness, parts: Record<string, unknown> = {}): ReturnType<Harness['service']['ranking']> =>
  h.service.ranking({ namespace: NAMESPACE, community: KEY_V, order: 'points', limit: 500, ...parts } as Parameters<Harness['service']['ranking']>[0]);

describe('FR-564 (service part) the ranking read of the service', () => {
  it('FR-564 (service part) folds the counted matches of the community and namespace into one row per player, and nothing else', () => {
    const h = rankingHarness((store) => {
      put(store, { id: id('v', 1), community: KEY_V, namespace: NAMESPACE, at: T0 + 1000 });
      put(store, { id: id('v', 2), community: KEY_V, namespace: NAMESPACE, at: T0 + 2000 });
      putResults(store, id('v', 1), [
        victim(`${NAMESPACE}:r1`, 1, true, 3),
        absorber(`${NAMESPACE}:r1`, 2, false, 0),
        winner(`${NAMESPACE}:r1`, true, 4),
        victim(`${NAMESPACE}:r2`, 1, false, 0),
        absorber(`${NAMESPACE}:r2`, 2, true, 2),
      ]);
      putResults(store, id('v', 2), [victim(`${NAMESPACE}:r1`, 1, true, 3), winner(`${NAMESPACE}:r3`, false, 0)]);
      putName(store, id('v', 1), `${NAMESPACE}:r1`, 'Ana Una');
      putName(store, id('v', 1), `${NAMESPACE}:r2`, 'Bea Dos');
      putName(store, id('v', 2), `${NAMESPACE}:r1`, 'Ana Renamed');
      // A running match, a halted one, another key and another namespace: none of them is counted.
      put(store, { id: id('x'), stage: 'phase-1', community: KEY_V, namespace: NAMESPACE, at: T0 + 3000 });
      putResults(store, id('x'), [victim(`${NAMESPACE}:r1`, 1, true, 999)]);
      putName(store, id('x'), `${NAMESPACE}:r1`, 'Running Name');
      put(store, { id: id('h'), stage: 'halted', community: KEY_V, namespace: NAMESPACE, at: T0 + 4000 });
      putResults(store, id('h'), [victim(`${NAMESPACE}:r2`, 1, true, 888)]);
      put(store, { id: id('w'), community: KEY_W, namespace: NAMESPACE, at: T0 + 5000 });
      putResults(store, id('w'), [victim(`${NAMESPACE}:r1`, 1, true, 777)]);
      put(store, { id: id('o'), community: KEY_V, namespace: 'other', at: T0 + 6000 });
      putResults(store, id('o'), [victim('other:r9', 1, true, 666)]);
    });
    const out = read(h);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.reply).toStrictEqual({
      items: [
        { playerId: `${NAMESPACE}:r1`, name: 'Ana Renamed', points: 10, correct: 3, scored: 4, played: 2, won: 2, rank: 1 },
        { playerId: `${NAMESPACE}:r2`, name: 'Bea Dos', points: 2, correct: 1, scored: 2, played: 1, won: 0, rank: 2 },
        { playerId: `${NAMESPACE}:r3`, points: 0, correct: 0, scored: 1, played: 1, won: 0, rank: 3 },
      ],
      total: 3,
    });
    h.close();
  });

  it('FR-565 (walk part) the first page takes its head from the newest counted match, even one with no scored results', () => {
    const h = rankingHarness((store) => {
      put(store, { id: id('v', 1), community: KEY_V, namespace: NAMESPACE, at: T0 + 1000 });
      put(store, { id: id('v', 2), community: KEY_V, namespace: NAMESPACE, at: T0 + 2000 });
      put(store, { id: id('v', 3), community: KEY_V, namespace: NAMESPACE, at: T0 + 3000 });
      putResults(store, id('v', 1), [victim(`${NAMESPACE}:r1`, 1, true, 3), victim(`${NAMESPACE}:r2`, 1, false, 0)]);
      putResults(store, id('v', 2), [victim(`${NAMESPACE}:r1`, 1, true, 3)]);
      // The newest counted match holds no scored result, only a name: it is the head, and the name is the shown one.
      putName(store, id('v', 1), `${NAMESPACE}:r1`, 'Old One');
      putName(store, id('v', 2), `${NAMESPACE}:r1`, 'Middle One');
      putName(store, id('v', 3), `${NAMESPACE}:r1`, 'Newest One');
    });
    const first = read(h, { limit: 1 });
    expect(first.ok && first.reply.items).toStrictEqual([
      { playerId: `${NAMESPACE}:r1`, name: 'Newest One', points: 6, correct: 2, scored: 2, played: 2, won: 2, rank: 1 },
    ]);
    // The cursor carries the newest counted match as the walk's head.
    const next = first.ok ? first.reply.next : undefined;
    expect(next).toBeTypeOf('string');
    const decoded = decodeCursor('ranking', next!);
    expect(decoded.ok && decoded.value).toStrictEqual([0, T0 + 3000, id('v', 3), 'r1']);
    // The rest of the walk pages after the cursor row, under the same head.
    const second = read(h, { limit: 1, after: decoded.ok ? decoded.value : undefined });
    expect(second.ok && second.reply).toStrictEqual({
      items: [{ playerId: `${NAMESPACE}:r2`, points: 0, correct: 0, scored: 1, played: 1, won: 0, rank: 2 }],
      total: 2,
    });
    h.close();
  });

  it('FR-565 (walk part) pages keep the walk\'s snapshot: a match that finishes in between never enters the pages or the total', () => {
    const h = rankingHarness((store) => {
      for (const n of [1, 2, 3]) {
        put(store, { id: id('v', n), community: KEY_V, namespace: NAMESPACE, at: T0 + 1000 * n });
        putResults(store, id('v', n), [victim(`${NAMESPACE}:r${n}`, 1, true, n)]);
      }
    });
    const first = read(h, { limit: 2 });
    expect(first.ok && first.reply.total).toBe(3);
    expect(first.ok && first.reply.items.map((r) => r.playerId)).toStrictEqual([`${NAMESPACE}:r3`, `${NAMESPACE}:r2`]);
    // A match finishes in between: the walk keeps its pages and its total; a fresh walk counts it.
    put(h.store, { id: id('v', 4), community: KEY_V, namespace: NAMESPACE, at: T0 + 4000 });
    putResults(h.store, id('v', 4), [victim(`${NAMESPACE}:r4`, 1, true, 4)]);
    const cursor = first.ok ? decodeCursor('ranking', first.reply.next!) : undefined;
    const second = read(h, { limit: 2, after: cursor !== undefined && cursor.ok ? cursor.value : undefined });
    expect(second.ok && second.reply.total).toBe(3);
    expect(second.ok && second.reply.items.map((r) => r.playerId)).toStrictEqual([`${NAMESPACE}:r1`]);
    expect(second.ok && second.reply.next).toBeUndefined();
    const fresh = read(h);
    expect(fresh.ok && fresh.reply.total).toBe(4);
    expect(fresh.ok && fresh.reply.items.map((r) => r.playerId)).toStrictEqual([`${NAMESPACE}:r4`, `${NAMESPACE}:r3`, `${NAMESPACE}:r2`, `${NAMESPACE}:r1`]);
    h.close();
  });

  it('FR-565 (walk part) every order pages with the cursor of its own order word', () => {
    const h = rankingHarness((store) => {
      for (const n of [1, 2]) {
        put(store, { id: id('v', n), community: KEY_V, namespace: NAMESPACE, at: T0 + 1000 * n });
        putResults(store, id('v', n), [victim(`${NAMESPACE}:r${n}`, 1, true, n), victim(`${NAMESPACE}:s${n}`, 1, false, 0)]);
      }
    });
    for (const [order, index] of [['points', 0], ['correct', 1], ['wins', 2], ['accuracy', 3]] as const) {
      const page = read(h, { order, limit: 1 });
      const next = page.ok ? page.reply.next : undefined;
      expect(next, order).toBeTypeOf('string');
      const decoded = decodeCursor('ranking', next!);
      expect(decoded.ok && decoded.value![0], order).toBe(index);
    }
    h.close();
  });

  it('FR-566 (service part) the accuracy order ranks only the qualified; a better accuracy below 10 scored stays unranked', () => {
    const h = rankingHarness((store) => {
      put(store, { id: id('v', 1), community: KEY_V, namespace: NAMESPACE, at: T0 + 1000 });
      put(store, { id: id('v', 2), community: KEY_V, namespace: NAMESPACE, at: T0 + 2000 });
      // rq: 10 scored, 9 correct. rn: 9 scored, 9 correct (a better fraction, but not qualified).
      putResults(store, id('v', 1), [
        victim(`${NAMESPACE}:rq`, 1, true, 1), victim(`${NAMESPACE}:rq`, 2, true, 1), victim(`${NAMESPACE}:rq`, 3, true, 1), victim(`${NAMESPACE}:rq`, 4, true, 1),
        absorber(`${NAMESPACE}:rq`, 1, true, 1), absorber(`${NAMESPACE}:rq`, 2, true, 1), absorber(`${NAMESPACE}:rq`, 3, true, 1), absorber(`${NAMESPACE}:rq`, 4, true, 1),
      ]);
      putResults(store, id('v', 2), [victim(`${NAMESPACE}:rq`, 1, true, 1), absorber(`${NAMESPACE}:rq`, 1, false, 0)]);
      putResults(store, id('v', 2), [
        victim(`${NAMESPACE}:rn`, 1, true, 1), victim(`${NAMESPACE}:rn`, 2, true, 1), victim(`${NAMESPACE}:rn`, 3, true, 1), victim(`${NAMESPACE}:rn`, 4, true, 1), victim(`${NAMESPACE}:rn`, 5, true, 1),
        absorber(`${NAMESPACE}:rn`, 1, true, 1), absorber(`${NAMESPACE}:rn`, 2, true, 1), absorber(`${NAMESPACE}:rn`, 3, true, 1), absorber(`${NAMESPACE}:rn`, 4, true, 1),
      ]);
    });
    const out = read(h, { order: 'accuracy', playerId: 'rn' });
    expect(out.ok && out.reply).toStrictEqual({
      items: [
        // rq wins the first match alone (its only player) but not the second (rn's 5 points top it).
        { playerId: `${NAMESPACE}:rq`, points: 9, correct: 9, scored: 10, played: 2, won: 1, rank: 1 },
        { playerId: `${NAMESPACE}:rn`, points: 9, correct: 9, scored: 9, played: 1, won: 1 },
      ],
      total: 2,
      asker: { points: 9, correct: 9, scored: 9, played: 1, won: 1 },
    });
    const asker = read(h, { order: 'accuracy', playerId: 'rq' });
    expect(asker.ok && asker.reply.asker).toStrictEqual({ points: 9, correct: 9, scored: 10, played: 2, won: 1, rank: 1 });
    h.close();
  });

  it('FR-567 (service part) the asker is their row with their rank, or played false, and absent when nobody asked', () => {
    const h = rankingHarness((store) => {
      put(store, { id: id('v', 1), community: KEY_V, namespace: NAMESPACE, at: T0 + 1000 });
      putResults(store, id('v', 1), [victim(`${NAMESPACE}:r1`, 1, true, 3), victim(`${NAMESPACE}:r2`, 1, false, 0)]);
    });
    const askerRow = read(h, { playerId: 'r2' });
    expect(askerRow.ok && askerRow.reply.asker).toMatchObject({ points: 0, correct: 0, scored: 1, played: 1, won: 0, rank: 2 });
    const stranger = read(h, { playerId: 'asker-zz-7' });
    expect(stranger.ok && stranger.reply.asker).toMatchObject({ played: false });
    const nobody = read(h);
    expect(nobody.ok && Object.prototype.hasOwnProperty.call(nobody.reply, 'asker')).toBe(false);
    h.close();
  });

  it('FR-568 (defence part) the service rechecks what the route checked: the community key, the local id, the namespace and the page size', () => {
    const h = rankingHarness((store) => {
      put(store, { id: id('v', 1), community: KEY_V, namespace: NAMESPACE, at: T0 + 1000 });
      putResults(store, id('v', 1), [victim(`${NAMESPACE}:r1`, 1, true, 3)]);
    });
    expect(read(h, { community: `${KEY_V}x` })).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['community']) });
    expect(read(h, { community: KEY_V.toUpperCase() })).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['community']) });
    expect(read(h, { playerId: `${NAMESPACE}:r1` })).toStrictEqual({ ok: false, error: errorReply('invalid-player-id', ['playerId']) });
    expect(read(h, { playerId: 'bad id' })).toStrictEqual({ ok: false, error: errorReply('invalid-player-id', ['playerId']) });
    expect(() => read(h, { namespace: 'Rank' })).toThrow(RangeError);
    expect(() => read(h, { limit: 0 })).toThrow(RangeError);
    expect(() => read(h, { limit: 501 })).toThrow(RangeError);
    h.close();
  });

  it('FR-568 (isolation part) an unknown key, another namespace and a cursor naming a foreign row answer the same empty page, asker included', () => {
    const h = rankingHarness((store) => {
      put(store, { id: id('v', 1), community: KEY_V, namespace: NAMESPACE, at: T0 + 1000 });
      putResults(store, id('v', 1), [victim(`${NAMESPACE}:r1`, 1, true, 3)]);
      // Another key with its own rows: never seen under KEY_V, and KEY_U holds nothing at all.
      put(store, { id: id('w'), community: KEY_W, namespace: NAMESPACE, at: T0 + 2000 });
      putResults(store, id('w'), [victim(`${NAMESPACE}:r9`, 1, true, 9)]);
    });
    const empty = { ok: true, reply: { items: [], total: 0 } };
    expect(read(h, { community: KEY_U, playerId: 'r1' })).toStrictEqual(empty);
    expect(read(h, { namespace: 'other', playerId: 'r1' })).toStrictEqual(empty);
    // A cursor naming a row this snapshot holds none of (another community's walk, or a crafted one).
    expect(read(h, { after: [0, T0 + 2000, id('w'), 'r9'] })).toStrictEqual(empty);
    expect(read(h, { after: [0, T0 + 1000, id('v', 1), 'stranger-99'], playerId: 'r1' })).toStrictEqual(empty);
    h.close();
  });

  it('FR-568 (fault part) a storage failure of the head read or of either snapshot read is unavailable', () => {
    const seed = (store: Store): void => {
      put(store, { id: id('v', 1), community: KEY_V, namespace: NAMESPACE, at: T0 + 1000 });
      putResults(store, id('v', 1), [victim(`${NAMESPACE}:r1`, 1, true, 3)]);
    };
    const unavailable = { ok: false, error: errorReply('unavailable') };
    for (const method of ['historyAfter', 'rankingResults', 'rankingNames'] as const) {
      const store = openStore(':memory:');
      seed(store);
      const h = serviceHarness({
        store: { ...store, [method]: () => { throw new StoreError('store-failure', 'injected'); } } as Store,
      });
      expect(read(h), method).toStrictEqual(unavailable);
      h.close();
      store.close();
    }
  });
});

describe('NFR-125 (service part) one page reads the head and the two snapshot statements, whatever the stored matches', () => {
  /** A store wrapper that records the name of every method the service calls. */
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

  /** `count` counted matches of KEY_V, each with two scored players and no name. */
  const seedMany = (store: Store, count: number): void => {
    for (let i = 0; i < count; i += 1) {
      const matchId = `m${String(i).padStart(4, '0')}`.padEnd(16, 'z');
      put(store, { id: matchId, community: KEY_V, namespace: NAMESPACE, at: T0 + i });
      putResults(store, matchId, [
        victim(`${NAMESPACE}:p${i}a`, 1, true, 3),
        victim(`${NAMESPACE}:p${i}b`, 1, false, 0),
      ]);
    }
  };

  it('NFR-125 (service part) the first page calls the head read and the two snapshot reads, and nothing else, with 10 and with 1,000 counted matches', () => {
    for (const count of [10, 1000]) {
      const store = openStore(':memory:');
      seedMany(store, count);
      const wrapped = recording(store);
      const h = serviceHarness({ store: wrapped.store });
      const out = read(h, { limit: 10 });
      expect(out.ok && out.reply.total, String(count)).toBe(2 * count);
      expect(wrapped.calls().sort(), String(count)).toStrictEqual(['historyAfter', 'rankingNames', 'rankingResults']);
      // A cursor page skips the head read: the cursor carries the head.
      const next = out.ok ? out.reply.next : undefined;
      expect(next, String(count)).toBeTypeOf('string');
      const after = decodeCursor('ranking', next!);
      read(h, { limit: 10, ...(after.ok ? { after: after.value } : {}) });
      expect(wrapped.calls().sort(), String(count)).toStrictEqual(['rankingNames', 'rankingResults']);
      h.close();
      store.close();
    }
    // Seeds 1,000 matches with 2,000 result rows: explicit headroom against the default 5 s under the suite's load.
  }, 30_000);
});
