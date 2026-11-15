import { getState, playRoundWithSeed } from '@mbrg/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { devMap } from './helpers/digests';
import { advanceSteps, get, makeMatch, publicOf, startReads } from './helpers/http-reads-kit';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';

// Twin matches over HTTP (M3a' T3', FR-257 and FR-258 over HTTP): two servers run matches whose public data are equal and
// whose unrevealed outcomes differ (another victim for round 1). Every read of the same requests must give byte-identical
// replies until the step that reveals the difference, and a round above N must give one identical reply whatever the round.

afterEach(closeAllServers);

const MAP = devMap();
const STATE0 = ((): Parameters<typeof playRoundWithSeed>[1] => {
  const r = getState(MAP, 0, 0);
  if (!r.ok) throw new Error('no round-0 state');
  return r.value;
})();
const victimOf = (seed: number): number => {
  const r = playRoundWithSeed(MAP, STATE0, seed);
  if (!r.ok) throw new Error('the round cannot be played');
  return r.value.record.eliminated;
};

/** Two seeds for round 1 with different victims. */
const SEEDS = ((): [number, number] => {
  const first = 101;
  for (let seed = 102; seed < 5000; seed += 1) if (victimOf(seed) !== victimOf(first)) return [first, seed];
  throw new Error('no seed pair');
})();

const sourceOf = (round1: number) => () => (k: number) => (k === 1 ? round1 : 7000 + k);

/** Every read a viewer may make at this moment, by path: replies as text. */
async function readsOf(h: ServerHarness, id: string, applied: number, total: number): Promise<Map<string, string>> {
  const paths = [
    '/matches',
    `/matches/${id}`,
    `/matches/${id}/records`,
    ...Array.from({ length: applied + 1 }, (_, j) => `/matches/${id}/states/${j}`),
    ...Array.from({ length: applied }, (_, j) => `/matches/${id}/records/${j + 1}`),
  ];
  for (const round of [applied + 1, applied + 2, total, total + 5, 1_000_000]) paths.push(`/matches/${id}/states/${round}`, `/matches/${id}/records/${round}`);
  const out = new Map<string, string>();
  for (const path of paths) {
    const reply = await get(h, path);
    out.set(path, `${reply.status} ${reply.text}`);
  }
  return out;
}

/** The reads of the rounds only (the list and the public data of a match show the revealed victim from the close of phase 1). */
const chainOf = (reads: Map<string, string>, id: string): [string, string][] => [...reads].filter(([path]) => path !== '/matches' && path !== `/matches/${id}`);

describe('http twin matches', () => {
  it('FR-257 (over HTTP) FR-258 (over HTTP) twins differing only in the unrevealed victim give identical replies to every read until the reveal', async () => {
    expect(victimOf(SEEDS[0])).not.toBe(victimOf(SEEDS[1]));
    const a = await startReads({ service: { testSeedSource: sourceOf(SEEDS[0]) } });
    const b = await startReads({ service: { testSeedSource: sourceOf(SEEDS[1]) } });
    const ma = makeMatch(a);
    const mb = makeMatch(b);
    expect(ma.id).toBe(mb.id);
    const total = publicOf(a, ma.id).totalRounds;

    // Phase 1 of round 1: the victim is decided but unrevealed; nothing differs on the wire.
    expect(publicOf(a, ma.id).stage).toBe('phase-1');
    const before = await readsOf(a, ma.id, 0, total);
    expect(await readsOf(b, mb.id, 0, total)).toStrictEqual(before);
    expect(before.size).toBeGreaterThan(10);

    // Round above N: one reply for every such round, in every stage of the first round.
    for (let step = 0; step < 3; step += 1) {
      const n = publicOf(a, ma.id).appliedRounds;
      const replies = new Set<string>();
      for (const h of [a, b]) {
        const id = ma.id;
        for (const round of [n + 1, n + 2, total + 5]) {
          replies.add((await get(h, `/matches/${id}/states/${round}`)).text);
          replies.add((await get(h, `/matches/${id}/records/${round}`)).text);
        }
      }
      expect(replies.size, `step ${step}`).toBe(1);
      expect([...replies][0]).toBe(`{"kind":"round-not-applied","appliedRounds":${n}}`);
      if (step === 0) {
        // The close of phase 1 reveals the victim: from here the public data differ.
        advanceSteps(a, ma.id, 1);
        advanceSteps(b, mb.id, 1);
        expect((await get(a, `/matches/${ma.id}`)).text).not.toBe((await get(b, `/matches/${mb.id}`)).text);
        // Rounds above N = 0 still read the same on both.
        expect(chainOf(await readsOf(a, ma.id, 0, total), ma.id)).toStrictEqual(chainOf(await readsOf(b, mb.id, 0, total), mb.id));
      } else if (step === 1) {
        advanceSteps(a, ma.id, 1);
        advanceSteps(b, mb.id, 1);
        expect(chainOf(await readsOf(a, ma.id, 0, total), ma.id)).toStrictEqual(chainOf(await readsOf(b, mb.id, 0, total), mb.id));
      } else {
        advanceSteps(a, ma.id, 1);
        advanceSteps(b, mb.id, 1);
      }
    }
    // The application reveals the outcome: round 1 now differs, and round 2 is still one identical reply.
    expect((await get(a, `/matches/${ma.id}/records/1`)).text).not.toBe((await get(b, `/matches/${mb.id}/records/1`)).text);
    expect((await get(a, `/matches/${ma.id}/states/2`)).text).toBe((await get(b, `/matches/${mb.id}/states/2`)).text);
    expect((await get(a, `/matches/${ma.id}/states/2`)).text).toBe('{"kind":"round-not-applied","appliedRounds":1}');
  }, 60_000);
});
