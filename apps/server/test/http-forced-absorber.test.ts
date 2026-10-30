import { getState, playRoundWithSeed } from '@mbrg/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { devMap } from './helpers/digests';
import { postJson, request } from './helpers/http-client';
import { get, makeMatch, publicOf, startReads } from './helpers/http-reads-kit';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody, goldSeeds, seedSourceOf } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { START_MS } from './helpers/service-harness';

// The forced absorber over a real listener (spec 011 M1 T8): a victim with one candidate has a forced absorber. The dev secret
// 'ascending-00-1f' gives non-forced rounds 1 to 3 (d = 3, 3, 2) and a forced round 4 (d = 1). The fake clock drives the steps
// (I = 120, L1 = 30, L2 = 10 s, F = 5 s): round k starts at +120 (k - 1) s, so round 4 closes phase 1 at +440 s; the forced
// reveal shortens phase 2 to close at +445 s and moves the application to +455 s.

afterEach(closeAllServers);

const S = 1000;
const SEEDS = goldSeeds();
const MAP = devMap();
const stateBeforeRound4 = (() => {
  let state = getState(MAP, 0, 0);
  if (!state.ok) throw new Error('no round-0 state');
  let s = state.value;
  for (const seed of SEEDS.slice(0, 3)) {
    const played = playRoundWithSeed(MAP, s, seed);
    if (!played.ok) throw new Error('round cannot be played');
    s = played.value.state;
  }
  return s;
})();
const victimOf = (seed: number): number => {
  const played = playRoundWithSeed(MAP, stateBeforeRound4, seed);
  if (!played.ok) throw new Error('round cannot be played');
  return played.value.record.eliminated;
};
/** Another round-4 seed with the same victim (the forced absorber leaves nothing else for the seed to decide on the wire). */
const OTHER_LAST = ((): number => {
  for (let seed = 1; seed < 5000; seed += 1) if (seed !== SEEDS[3] && victimOf(seed) === victimOf(SEEDS[3]!)) return seed;
  throw new Error('no twin seed');
})();

/** The only faction alive after round 4 (computed with the sim). */
const WINNER = ((): number => {
  const played = playRoundWithSeed(MAP, stateBeforeRound4, SEEDS[3]!);
  if (!played.ok) throw new Error('round cannot be played');
  return played.value.state.owners[0]![1];
})();

const runTo = (h: ServerHarness, offsetS: number): void => void h.base.scheduler!.runTo(START_MS + offsetS * S);
const body = (h: ServerHarness, path: string) => get(h, path).then((r) => r.json() as Record<string, any>);
const submit = (h: ServerHarness, id: string, payload: Record<string, unknown>) => postJson(h.port, `/matches/${id}/predictions`, payload, CLIENT_CREDENTIAL);

async function forcedMatch(last = SEEDS[3]!): Promise<{ h: ServerHarness; id: string }> {
  const h = await startReads({ service: { scheduler: true, testSeedSource: seedSourceOf([...SEEDS.slice(0, 3), last]) } });
  return { h, id: makeMatch(h).id };
}

describe('the forced absorber over HTTP', () => {
  it('FR-387 (HTTP) an absorber prediction in a non-forced round is accepted and stored, and its public victim has no forced mark', async () => {
    const { h, id } = await forcedMatch();
    runTo(h, 80);
    const shown = await body(h, `/matches/${id}`);
    expect(shown.stage).toBe('phase-2');
    expect(shown.victim.candidates.length).toBeGreaterThanOrEqual(2);
    expect('forced' in shown.victim).toBe(false);
    const sent = await submit(h, id, { kind: 'absorber', round: 1, faction: shown.victim.candidates[0], playerId: 'alice' });
    expect(sent.status).toBe(200);
    const own = await get(h, `/matches/${id}/predictions?playerId=alice`, { authorization: `Bearer ${CLIENT_CREDENTIAL}` });
    expect(own.status).toBe(200);
    expect((own.json() as { items: { kind: string }[] }).items.map((x) => x.kind)).toStrictEqual(['absorber']);
  }, 30_000);

  it('FR-387 (HTTP) FR-388 (HTTP) in a forced round the absorber is refused with 409 forced-absorber and the exact bytes, nothing is stored, and the reveal shows forced with the shortened schedule', async () => {
    const { h, id } = await forcedMatch();
    runTo(h, 440);
    const shown = await body(h, `/matches/${id}`);
    expect(shown.appliedRounds).toBe(3);
    expect(shown.stage).toBe('phase-2');
    expect(shown.victim.round).toBe(4);
    expect(shown.victim.candidates).toHaveLength(1);
    expect(shown.victim.forced).toBe(true);
    // C2 = t + min(L1, F) = +445 s and A = C2 + L2 = +455 s, in the victim and in the schedule.
    expect(shown.schedule).toStrictEqual({ c1: START_MS + 440 * S, c2: START_MS + 445 * S, a: START_MS + 455 * S });
    expect([shown.victim.c2, shown.victim.a]).toStrictEqual([START_MS + 445 * S, START_MS + 455 * S]);

    const refused = await submit(h, id, { kind: 'absorber', round: 4, faction: shown.victim.candidates[0], playerId: 'bob' });
    expect(refused.status).toBe(409);
    expect(refused.text).toBe(errorBody('forced-absorber'));
    expect(refused.text).toBe('{"kind":"forced-absorber"}');
    const own = await get(h, `/matches/${id}/predictions?playerId=bob`, { authorization: `Bearer ${CLIENT_CREDENTIAL}` });
    expect((own.json() as { items: unknown[] }).items).toStrictEqual([]);
    expect(h.base.store.predictionsOf(id, 'web:bob')).toStrictEqual([]);
  }, 30_000);

  it('FR-388 (HTTP) the shortened phase 2 closes exactly at the fake-clock instant, and the match finishes at the shortened application', async () => {
    const { h, id } = await forcedMatch();
    runTo(h, 440);
    runTo(h, 445 - 1);
    expect(publicOf(h, id).stage).toBe('phase-2');
    expect((await body(h, `/matches/${id}`)).schedule.c2).toBe(START_MS + 445 * S);
    runTo(h, 445);
    const locked = await body(h, `/matches/${id}`);
    expect(locked.stage).toBe('locked');
    expect(locked.schedule.a).toBe(START_MS + 455 * S);
    runTo(h, 455 - 1);
    expect(publicOf(h, id).stage).toBe('locked');
    runTo(h, 455);
    const done = await body(h, `/matches/${id}`);
    expect(done.stage).toBe('finished');
    expect(done.appliedRounds).toBe(4);
  }, 30_000);

  it('FR-387 (HTTP) the phase results and the leaderboard of the finished match have no absorber row for the forced round', async () => {
    const { h, id } = await forcedMatch();
    const winner = WINNER;
    expect((await submit(h, id, { kind: 'winner', faction: winner, playerId: 'alice' })).status).toBe(200);
    runTo(h, 80);
    const first = await body(h, `/matches/${id}`);
    expect((await submit(h, id, { kind: 'absorber', round: 1, faction: first.victim.candidates[0], playerId: 'alice' })).status).toBe(200);
    runTo(h, 440);
    const refused = await submit(h, id, { kind: 'absorber', round: 4, faction: publicOf(h, id).victim!.candidates[0], playerId: 'alice' });
    expect(refused.status).toBe(409);
    runTo(h, 455);
    expect(publicOf(h, id).stage).toBe('finished');
    // The non-forced round has its absorber row; the forced round has none (the page exists and is empty).
    const round1 = await body(h, `/matches/${id}/results/1/2?limit=50`);
    expect(round1.items).toHaveLength(1);
    const round4 = await get(h, `/matches/${id}/results/4/2?limit=50`);
    expect(round4.status).toBe(200);
    expect((round4.json() as { items: unknown[] }).items).toStrictEqual([]);
    // The player's rows: the round-1 absorber and the winner; no absorber item of round 4.
    const rows = await body(h, `/matches/${id}/players/web:alice/results?limit=50`);
    const absorbers = (rows.items as { kind: string; round: number }[]).filter((x) => x.kind === 'absorber');
    expect(absorbers.map((x) => x.round)).toStrictEqual([1]);
    expect(rows.items.some((x: { kind: string }) => x.kind === 'winner')).toBe(true);
    const board = await get(h, `/matches/${id}/leaderboard?limit=50`);
    expect(board.status).toBe(200);
    expect((board.json() as { items: { playerId: string }[] }).items.map((x) => x.playerId)).toStrictEqual(['web:alice']);
  }, 60_000);

  it('FR-387 (HTTP) FR-388 (HTTP) twins with the same public data and another unrevealed round-4 seed give identical bytes on every one of these reads', async () => {
    expect(victimOf(OTHER_LAST)).toBe(victimOf(SEEDS[3]!));
    expect(OTHER_LAST).not.toBe(SEEDS[3]);
    const twins = [await forcedMatch(SEEDS[3]), await forcedMatch(OTHER_LAST)];
    const sample = async (): Promise<string[][]> => {
      const out: string[][] = [];
      for (const { h, id } of twins) {
        const paths = [`/matches/${id}`, `/matches`, `/matches/${id}/records`, `/matches/${id}/results/4/1?limit=50`, `/matches/${id}/results/4/2?limit=50`, `/matches/${id}/leaderboard?limit=50`];
        const texts: string[] = [];
        for (const path of paths) {
          const r = await get(h, path);
          texts.push(`${r.status} ${r.text}`);
        }
        const refused = await submit(h, id, { kind: 'absorber', round: 4, faction: publicOf(h, id).victim?.candidates[0] ?? 1, playerId: 'bob' });
        texts.push(`${refused.status} ${refused.text}`);
        texts.push(`${(await request(h.port, { path: `/matches/${id}/predictions?playerId=bob`, headers: { authorization: `Bearer ${CLIENT_CREDENTIAL}` } })).text}`);
        out.push(texts);
      }
      return out;
    };
    for (const { h } of twins) runTo(h, 440);
    let [a, b] = await sample();
    expect(a).toStrictEqual(b);
    expect(a![0]).toContain('"forced":true');
    for (const t of [445, 455]) {
      for (const { h } of twins) runTo(h, t);
      // The stage reads are equal at the locked point; after the application the public data of the finished match differ only by what the secret reveals.
      if (t === 445) {
        [a, b] = await sample();
        expect(a).toStrictEqual(b);
      }
    }
  }, 60_000);
});
