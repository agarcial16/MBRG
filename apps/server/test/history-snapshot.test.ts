import { afterEach, describe, expect, it } from 'vitest';
import { TOLERANCE_MS } from '../src/core/time';
import { DISCORD, KEY_A, createCommunityMatch, playUntil, postHistory, startHistory } from './helpers/history-kit';
import { put } from './helpers/history-rows';
import { closeAllServers } from './helpers/server-harness';

// Spec 024 FR-549 and FR-561 (the snapshot and the settling). The finish instant of a match is the instant of its last step, and a
// step run on time keeps its SCHEDULED instant, up to TOLERANCE_MS before the instant it is committed at. A match that finishes after
// the first page of a walk could therefore carry a finish instant older than the head, sort inside the snapshot and change its total
// (or be skipped). The history lists a match only once it is settled: its finish instant is more than TOLERANCE_MS behind the server
// clock, so every match that finishes after a read sorts newer than everything that read listed.

afterEach(closeAllServers);

interface Page {
  items: { matchId: string }[];
  total: number;
  next?: string;
}
const NS = 'discord';
const at = (n: number): string => `snap-${String(n).padStart(3, '0')}-aaaaaaaa`.slice(0, 16);

describe('FR-549 FR-561 the settling of the history', () => {
  it('FR-561 a finished match is listed once its finish instant is more than TOLERANCE_MS behind the clock, not before, and the same bytes as an empty history until then', async () => {
    const h = await startHistory();
    const empty = await postHistory(h, DISCORD.credential, { community: KEY_A });
    expect(empty.json()).toStrictEqual({ items: [], total: 0 });
    const made = await createCommunityMatch(h, DISCORD, 'settle-1', KEY_A);
    playUntil(h, made, [], true, 12);
    // Finished, the clock at its last step: not settled.
    expect(h.service.readPublicMatch(made.id)).toMatchObject({ ok: true, reply: { stage: 'finished' } });
    const justNow = await postHistory(h, DISCORD.credential, { community: KEY_A });
    expect(justNow.text).toBe(empty.text);
    h.clock.advance(TOLERANCE_MS);
    expect((await postHistory(h, DISCORD.credential, { community: KEY_A })).text).toBe(empty.text);
    h.clock.advance(1);
    const settled = (await postHistory(h, DISCORD.credential, { community: KEY_A })).json() as Page;
    expect(settled.total).toBe(1);
    expect(settled.items.map((i) => i.matchId)).toStrictEqual([made.id]);
  });

  it('FR-549 a match that finishes after the first page, with a finish instant OLDER than the one a naive head would be, is outside the walk: same pages, same total, no skip', async () => {
    const h = await startHistory();
    const C0 = 1_800_000_000_000;
    h.clock.set(C0);
    const store = h.base.store;
    const row = (n: number, instant: number): void => put(store, { id: at(n), at: instant, community: KEY_A, namespace: NS });
    row(1, C0 - 5000);
    row(2, C0 - 4000);
    row(3, C0 - 3000);
    // M finished a moment ago: its instant is inside the tolerance, so it is not settled and not listed yet.
    row(10, C0 - 200);
    const first = (await postHistory(h, DISCORD.credential, { community: KEY_A, limit: 2 })).json() as Page;
    expect(first.items.map((i) => i.matchId)).toStrictEqual([at(3), at(2)]);
    expect(first.total).toBe(3);
    expect(first.next).toBeDefined();

    // N finishes 300 ms later, on time: committed at C0 + 300 with its scheduled instant C0 - 700, older than M's.
    h.clock.set(C0 + 300);
    row(11, C0 - 700);
    // The walk goes on (some time later: everything is settled by now): the snapshot did not move.
    h.clock.set(C0 + 20_000);
    const second = (await postHistory(h, DISCORD.credential, { community: KEY_A, limit: 2, cursor: first.next })).json() as Page;
    expect(second.items.map((i) => i.matchId)).toStrictEqual([at(1)]);
    expect(second.total).toBe(3);
    expect(second.next).toBeUndefined();

    // A new walk lists M and N, newest finish instant first.
    const fresh = (await postHistory(h, DISCORD.credential, { community: KEY_A, limit: 10 })).json() as Page;
    expect(fresh.items.map((i) => i.matchId)).toStrictEqual([at(10), at(11), at(3), at(2), at(1)]);
    expect(fresh.total).toBe(5);
  });

  it('FR-549 a match that finishes after the read with the first instant that was not settled at it (exactly the bound) is outside the walk too', async () => {
    const h = await startHistory();
    const C0 = 1_800_000_000_000;
    h.clock.set(C0);
    const row = (n: number, instant: number): void => put(h.base.store, { id: at(n), at: instant, community: KEY_A, namespace: NS });
    row(1, C0 - 5000);
    row(2, C0 - 4000);
    const first = (await postHistory(h, DISCORD.credential, { community: KEY_A, limit: 1 })).json() as Page;
    expect(first.items.map((i) => i.matchId)).toStrictEqual([at(2)]);
    // A match whose instant equals the head's cannot finish after the read: its instant would be settled-old. The nearest one that can
    // is the first instant that was not settled at the read: C0 - TOLERANCE_MS (not below the bound), newer than the head.
    h.clock.set(C0 + 5);
    row(3, C0 - TOLERANCE_MS);
    h.clock.set(C0 + 20_000);
    const second = (await postHistory(h, DISCORD.credential, { community: KEY_A, limit: 5, cursor: first.next })).json() as Page;
    expect(second.items.map((i) => i.matchId)).toStrictEqual([at(1)]);
    expect(second.total).toBe(2);
  });
});
