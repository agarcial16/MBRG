import { getState, playRoundWithSeed } from '@mbrg/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { SECRETS } from './helpers/core-timelines';
import { encodingsOf } from './helpers/db-scan';
import { devMap } from './helpers/digests';
import { get, makeMatch, publicOf, startReads } from './helpers/http-reads-kit';
import { CLIENT_CREDENTIAL, closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR } from './helpers/service-harness';

// Twin matches over HTTP for the results reads (spec 008 M4' T4', FR-257 results twins over HTTP, NFR-47 (c) results replies):
// two servers run matches with the same public data and the same predictions whose only difference is the ABSORBER of round 1
// (same victim, another absorber). Until the application every results reply must be byte-identical, and none holds the
// match secret or a round seed in any encoding.

afterEach(closeAllServers);

const MAP = devMap();
const STATE0 = ((): Parameters<typeof playRoundWithSeed>[1] => {
  const r = getState(MAP, 0, 0);
  if (!r.ok) throw new Error('no round-0 state');
  return r.value;
})();
const played = (seed: number): { victim: number; absorber: number } => {
  const r = playRoundWithSeed(MAP, STATE0, seed);
  if (!r.ok) throw new Error('the round cannot be played');
  return { victim: r.value.record.eliminated, absorber: r.value.record.absorber };
};

/** Large seeds, so that no encoding of one is a short digit string that a reply could hold by chance. */
const SEEDS = ((): [number, number] => {
  const base = 3_000_000_011;
  for (let first = base; first < base + 200; first += 1) {
    const a = played(first);
    for (let seed = first + 1; seed < first + 400; seed += 1) {
      const b = played(seed);
      if (b.victim === a.victim && b.absorber !== a.absorber) return [first, seed];
    }
  }
  throw new Error('no seed pair with the same victim and another absorber');
})();
const sourceOf = (round1: number) => () => (k: number) => (k === 1 ? round1 : 3_100_000_000 + k);

const SECRET = SECRETS['ascending-00-1f'];
const NEEDLES = [...encodingsOf(SECRET), ...SEEDS.flatMap((s) => encodingsOf(s)), ...encodingsOf(3_100_000_002), ...encodingsOf(3_100_000_003)];
const holds = (text: string, needle: string | Uint8Array): boolean => (typeof needle === 'string' ? text.includes(needle) : Buffer.from(text, 'utf8').includes(Buffer.from(needle)));

const submit = (h: ServerHarness, id: string, local: string, body: Record<string, unknown>): void => {
  const out = h.service.submit({ client: { credential: CLIENT_CREDENTIAL, namespace: 'web' }, matchId: id, body: { playerId: local, ...body } });
  if (!out.ok) throw new Error(`refused: ${JSON.stringify(out.error)}`);
};
const advance = (h: ServerHarness, id: string, step: string): void => {
  const out = h.service.advance({ credential: OPERATOR, matchId: id, body: { round: 1, step } });
  if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
};

/** Every results read a viewer may make, as `status text`. */
async function readsOf(h: ServerHarness, id: string): Promise<Map<string, string>> {
  const paths = [
    ...[0, 1, 2, 3, 99].flatMap((round) => [`/matches/${id}/results/${round}/1`, `/matches/${id}/results/${round}/2`]),
    ...['web:p1', 'web:p2', 'web:p3', 'web:nobody'].map((p) => `/matches/${id}/players/${p}/results`),
    `/matches/${id}/leaderboard`,
    `/matches/${id}/leaderboard?limit=1`,
  ];
  const out = new Map<string, string>();
  for (const path of paths) {
    const reply = await get(h, path);
    out.set(path, `${reply.status} ${reply.text}`);
  }
  return out;
}

describe('http results twins', () => {
  it('FR-257 (results twins over HTTP) NFR-47 (c) (results replies) twins differing only in the absorber give byte-identical results replies in phase 2 and locked, and no reply holds the secret or a round seed', async () => {
    expect(played(SEEDS[0]).victim).toBe(played(SEEDS[1]).victim);
    expect(played(SEEDS[0]).absorber).not.toBe(played(SEEDS[1]).absorber);
    const a = await startReads({ service: { secret: SECRET, testSeedSource: sourceOf(SEEDS[0]) } });
    const b = await startReads({ service: { secret: SECRET, testSeedSource: sourceOf(SEEDS[1]) } });
    const ma = makeMatch(a, 'c-1', { timing: 'manual' });
    const mb = makeMatch(b, 'c-1', { timing: 'manual' });
    expect(ma.id).toBe(mb.id);
    const id = ma.id;
    const seen: string[] = [];
    const same = async (stage: string): Promise<number> => {
      const ra = await readsOf(a, id);
      const rb = await readsOf(b, id);
      expect(rb, stage).toStrictEqual(ra);
      expect(publicOf(a, id), stage).toStrictEqual(publicOf(b, id));
      seen.push(...ra.values());
      return ra.size;
    };

    // Predictions of both twins are identical: victims by two players, then absorbers after the reveal.
    const alive = publicOf(a, id).state.owners.map(([, f]) => f);
    const living = [...new Set(alive)].sort((x, y) => x - y);
    for (const h of [a, b]) {
      submit(h, id, 'p1', { kind: 'victim', round: 1, faction: living[0] });
      submit(h, id, 'p2', { kind: 'victim', round: 1, faction: living[1] });
      submit(h, id, 'p3', { kind: 'winner', faction: living[2] });
    }
    expect(await same('phase-1')).toBe(16);
    for (const h of [a, b]) advance(h, id, 'phase-1-close');
    expect(publicOf(a, id).stage).toBe('phase-2');
    await same('phase-2, victim revealed');
    const candidates = publicOf(a, id).victim!.candidates;
    for (const h of [a, b]) {
      submit(h, id, 'p1', { kind: 'absorber', round: 1, faction: candidates[0] });
      submit(h, id, 'p3', { kind: 'absorber', round: 1, faction: candidates[candidates.length - 1] });
    }
    await same('phase-2 with absorber predictions');
    for (const h of [a, b]) advance(h, id, 'phase-2-close');
    expect(publicOf(a, id).stage).toBe('locked');
    await same('locked');

    // The reads did carry something: the victim phase is scored and the board lists the predictors.
    const sample = await readsOf(a, id);
    expect(sample.get(`/matches/${id}/results/1/1`)).toMatch(/^200 \{"round":1,"phase":1,"victim":/);
    expect(sample.get(`/matches/${id}/results/1/2`)).toMatch(/^404 /);
    expect(sample.get(`/matches/${id}/leaderboard`)).toMatch(/web:p1/);

    // Nothing sent until now holds the secret or a seed in any encoding.
    for (const text of seen) for (const needle of NEEDLES) expect(holds(text, needle), String(needle).slice(0, 12)).toBe(false);

    // After the application the twins differ (the record of phase 2 shows the absorber) and the scored phase appears.
    for (const h of [a, b]) advance(h, id, 'application');
    const afterA = await get(a, `/matches/${id}/results/1/2`);
    const afterB = await get(b, `/matches/${id}/results/1/2`);
    expect([afterA.status, afterB.status]).toStrictEqual([200, 200]);
    expect(afterA.text).not.toBe(afterB.text);
    expect(afterA.text).toContain(`"absorber":${played(SEEDS[0]).absorber}`);
    expect(afterB.text).toContain(`"absorber":${played(SEEDS[1]).absorber}`);
  });
});
