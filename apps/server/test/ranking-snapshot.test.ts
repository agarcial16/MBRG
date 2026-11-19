import { afterEach, describe, expect, it } from 'vitest';
import type { ResultRow } from '../src/core/scoring';
import { TOLERANCE_MS } from '../src/core/time';
import type { Store } from '../src/store/store';
import { put } from './helpers/history-rows';
import { DISCORD, KEY_A, postRanking, startHistory } from './helpers/ranking-kit';
import { closeAllServers } from './helpers/server-harness';

// Spec 025 FR-565 and FR-568 (of 024 FR-549 and FR-561): the snapshot of a ranking walk and the settle edge. The head of a walk is the newest
// SETTLED counted match: its finish instant is more than TOLERANCE_MS behind the server clock at the first read. A match that finishes after
// that read is committed at a clock reading r' >= r, and a step run on time keeps its scheduled instant, at most TOLERANCE_MS behind the
// commit, while an overdue step takes the clock instant (core/time.ts `dueStep`; `lastStepAfter` never lowers it): its finish instant is at
// least r - TOLERANCE_MS, and the head is strictly below that bound (`last_step_ms < ?`). So a later finish sorts STRICTLY newer than the head:
// it can never tie with it (same instant, a match id at or after the head's) and join a walk half way. These tests place the tightest
// possible cases in the store with exact instants, as the history's snapshot test does.

afterEach(closeAllServers);

interface Page {
  items: { playerId: string; points: number; rank?: number }[];
  total: number;
  next?: string;
  asker?: { points?: number; rank?: number; played?: number | false };
}
const NS = 'discord';
const C0 = 1_800_000_000_000;
const at = (n: number): string => `snap-${String(n).padStart(3, '0')}-aaaaaaaa`.slice(0, 16);

/** A counted match with chosen finish instant and scored players: one victim result per player, `points` each (all correct). */
const row = (store: Store, n: number, instant: number, players: readonly (readonly [string, number])[]): void => {
  put(store, { id: at(n), at: instant, community: KEY_A, namespace: NS });
  const rows: ResultRow[] = players.map(([local, points]) => ({ playerId: `${NS}:${local}`, kind: 'victim', round: 1, choice: 3, correct: true, points }));
  store.transaction(() => store.putResults(at(n), rows));
};

describe('FR-565 FR-568 the settling of the ranking', () => {
  it('FR-568 a finished match counts in the ranking once its finish instant is more than TOLERANCE_MS behind the clock, not before, and the same bytes as an empty ranking until then', async () => {
    const h = await startHistory();
    h.clock.set(C0);
    const empty = await postRanking(h, DISCORD.credential, { community: KEY_A });
    expect(empty.json()).toStrictEqual({ items: [], total: 0 });
    // Finished, at the clock's own instant: not settled.
    row(h.base.store, 1, C0, [['u1', 5]]);
    expect((await postRanking(h, DISCORD.credential, { community: KEY_A })).text).toBe(empty.text);
    h.clock.advance(TOLERANCE_MS);
    expect((await postRanking(h, DISCORD.credential, { community: KEY_A })).text).toBe(empty.text);
    h.clock.advance(1);
    const settled = (await postRanking(h, DISCORD.credential, { community: KEY_A, playerId: 'u1' })).json() as Page;
    expect(settled.total).toBe(1);
    expect(settled.items.map((i) => [i.playerId, i.points])).toStrictEqual([[`${NS}:u1`, 5]]);
  }, 120_000);
});

describe('FR-565 the snapshot holds across a match that finishes mid-walk, down to the settle edge', () => {
  /** The three players of three counted matches: u1 3 pts (oldest), u2 2 pts, u3 1 pt in the newest settled match, which is the head. */
  function seedThree(store: Store): void {
    row(store, 1, C0 - 5000, [['u1', 3]]);
    row(store, 2, C0 - 4000, [['u2', 2]]);
    // The head: the newest instant that is settled at a read of the clock C0 (1 ms below the bound C0 - TOLERANCE_MS).
    row(store, 3, C0 - TOLERANCE_MS - 1, [['u3', 1]]);
  }

  it('FR-565 a match with the OLDEST instant a later finish can carry (the first one not settled at the read, exactly the bound) is outside the walk: same later page, same total, same asker line', async () => {
    const h = await startHistory();
    h.clock.set(C0);
    seedThree(h.base.store);
    // A match that finished a moment ago is inside the tolerance at the first read: not settled, not counted, and not the head.
    row(h.base.store, 5, C0 - 200, [['u5', 9]]);
    const first = (await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 2, playerId: 'u1' })).json() as Page;
    expect(first.items.map((i) => i.playerId)).toStrictEqual([`${NS}:u1`, `${NS}:u2`]);
    expect(first.total).toBe(3);
    expect(first.asker).toMatchObject({ points: 3, rank: 1 });
    expect(first.next).toBeDefined();

    // The match finishes right after that read, on time at the earliest clock reading it can be committed at (C0, the same ms): its scheduled
    // instant is C0 - TOLERANCE_MS, the bound, 1 ms newer than the head. It pays u1 100 points and brings a new player u4.
    row(h.base.store, 4, C0 - TOLERANCE_MS, [['u1', 100], ['u4', 50]]);
    // Another finishes 300 ms later on time: committed at C0 + 300 with its scheduled instant C0 - 700, OLDER than the match of a moment ago,
    // which a naive head (the newest finished match) would be: it would sort inside the snapshot. Newer than the settled head, it does not.
    h.clock.set(C0 + 300);
    row(h.base.store, 6, C0 - 700, [['u6', 8]]);
    // The walk goes on some time later, everything settled by now: the snapshot did not move.
    h.clock.set(C0 + 20_000);
    const second = (await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 2, playerId: 'u1', cursor: first.next })).json() as Page;
    expect(second.items.map((i) => [i.playerId, i.points])).toStrictEqual([[`${NS}:u3`, 1]]);
    expect(second.total).toBe(3);
    expect(second.next).toBeUndefined();
    expect(second.asker).toStrictEqual(first.asker);

    // A new walk counts it.
    const fresh = (await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 10, playerId: 'u1' })).json() as Page;
    expect(fresh.total).toBe(6);
    expect(fresh.items.map((i) => [i.playerId, i.points])).toStrictEqual([[`${NS}:u1`, 103], [`${NS}:u4`, 50], [`${NS}:u5`, 9], [`${NS}:u6`, 8], [`${NS}:u2`, 2], [`${NS}:u3`, 1]]);
    expect(fresh.asker).toMatchObject({ points: 103, rank: 1 });
  }, 120_000);

  it('FR-565 a match that finishes with an instant at or after the clock of the read (an overdue step takes the clock instant) is outside the walk too', async () => {
    const h = await startHistory();
    h.clock.set(C0);
    seedThree(h.base.store);
    const first = (await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 1 })).json() as Page;
    expect(first.items.map((i) => i.playerId)).toStrictEqual([`${NS}:u1`]);
    row(h.base.store, 4, C0 + 7, [['u1', 100]]);
    row(h.base.store, 5, C0, [['u5', 9]]);
    h.clock.set(C0 + 20_000);
    const second = (await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 5, cursor: first.next })).json() as Page;
    expect(second.items.map((i) => i.playerId)).toStrictEqual([`${NS}:u2`, `${NS}:u3`]);
    expect(second.total).toBe(3);
  }, 120_000);

  it('FR-565 matches that already tie on the head instant at the first read belong to the snapshot from its first page: the walk counts them on every page, the same total', async () => {
    const h = await startHistory();
    h.clock.set(C0);
    const store = h.base.store;
    row(store, 1, C0 - 5000, [['u1', 3]]);
    // Two settled matches with the very same finish instant, the head and one with a match id after it: both are in the snapshot.
    const tie = C0 - TOLERANCE_MS - 1;
    row(store, 3, tie, [['u3', 1]]);
    row(store, 4, tie, [['u4', 7]]);
    const first = (await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 1 })).json() as Page;
    expect(first.total).toBe(3);
    expect(first.items.map((i) => i.playerId)).toStrictEqual([`${NS}:u4`]);
    // A later finish cannot tie: the nearest instant it can carry is the bound, newer than the tie.
    row(store, 2, C0 - TOLERANCE_MS, [['u2', 40]]);
    h.clock.set(C0 + 20_000);
    const seen = [first.items[0]!.playerId];
    let cursor = first.next;
    while (cursor !== undefined) {
      const page = (await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 1, cursor })).json() as Page;
      expect(page.total).toBe(3);
      seen.push(...page.items.map((i) => i.playerId));
      cursor = page.next;
    }
    expect(seen).toStrictEqual([`${NS}:u4`, `${NS}:u1`, `${NS}:u3`]);
  }, 120_000);
});
