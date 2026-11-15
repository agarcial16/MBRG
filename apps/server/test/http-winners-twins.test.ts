import { getState, playRoundWithSeed } from '@mbrg/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { credentialDigest } from '../src/service/ids';
import type { PlayerCaller } from '../src/service/matches';
import { SECRETS } from './helpers/core-timelines';
import { encodingsOf } from './helpers/db-scan';
import { devMap } from './helpers/digests';
import { get, makeMatch, publicOf, startReads } from './helpers/http-reads-kit';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR } from './helpers/service-harness';

// Twin matches for the who-guessed-right route (spec 011 M5 T4, P12): two servers run matches with the same public data and the
// same named players and predictions whose only difference is the ABSORBER of round 1 (same victim, another absorber). Until
// the application every winners reply must be byte-identical, in phase 1, phase 2 and locked, for every request, and none holds
// the secret or a round seed in any encoding.

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

interface Named {
  readonly playerId: string;
  readonly caller: PlayerCaller;
}
const joinAs = (h: ServerHarness, id: string, name: string): Named => {
  const out = h.service.join({ source: `src-${name}`, matchId: id, body: { name, requestId: `j-${name}` } });
  if (!out.ok) throw new Error(`join refused: ${JSON.stringify(out.error)}`);
  return { playerId: out.reply.playerId, caller: { tokenDigest: credentialDigest(out.reply.playerToken), playerId: out.reply.playerId } };
};
const submit = (h: ServerHarness, id: string, p: Named, body: Record<string, unknown>): void => {
  const out = h.service.submit({ client: p.caller, matchId: id, body: { ...body, playerId: p.playerId.slice('player:'.length) } });
  if (!out.ok) throw new Error(`refused: ${JSON.stringify(out.error)}`);
};
const advance = (h: ServerHarness, id: string, step: string): void => {
  const out = h.service.advance({ credential: OPERATOR, matchId: id, body: { round: 1, step } });
  if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
};

/** Every winners request a viewer may make, as `status text`. */
async function readsOf(h: ServerHarness, id: string): Promise<Map<string, string>> {
  const paths = [0, 1, 2, 3, 99].flatMap((round) => [1, 2].flatMap((phase) => [`/matches/${id}/results/${round}/${phase}/winners`, `/matches/${id}/results/${round}/${phase}/winners?limit=1`]));
  const out = new Map<string, string>();
  for (const path of paths) {
    const reply = await get(h, path);
    out.set(path, `${reply.status} ${reply.text}`);
  }
  return out;
}

describe('http winners twins', () => {
  it('FR-386 P12 twins differing only in the absorber give byte-identical winners replies in phase 1, phase 2 and locked, and no reply holds the secret or a round seed', async () => {
    expect(played(SEEDS[0]).victim).toBe(played(SEEDS[1]).victim);
    expect(played(SEEDS[0]).absorber).not.toBe(played(SEEDS[1]).absorber);
    const a = await startReads({ service: { secret: SECRET, testSeedSource: sourceOf(SEEDS[0]) } });
    const b = await startReads({ service: { secret: SECRET, testSeedSource: sourceOf(SEEDS[1]) } });
    const ma = makeMatch(a, 'c-1', { timing: 'manual' });
    const mb = makeMatch(b, 'c-1', { timing: 'manual' });
    expect(ma.id).toBe(mb.id);
    const id = ma.id;
    const seen: string[] = [];
    const same = async (stage: string): Promise<void> => {
      const ra = await readsOf(a, id);
      const rb = await readsOf(b, id);
      expect(rb, stage).toStrictEqual(ra);
      expect(publicOf(a, id), stage).toStrictEqual(publicOf(b, id));
      seen.push(...ra.values());
    };

    const players = new Map<ServerHarness, { ana: Named; bea: Named }>();
    for (const h of [a, b]) players.set(h, { ana: joinAs(h, id, 'Ana'), bea: joinAs(h, id, 'Bea') });
    expect(players.get(a)!.ana.playerId).toBe(players.get(b)!.ana.playerId);
    const victim = played(SEEDS[0]).victim;
    const living = [...new Set(publicOf(a, id).state.owners.map(([, f]) => f))].sort((x, y) => x - y);
    const wrong = living.find((f) => f !== victim)!;
    for (const h of [a, b]) {
      submit(h, id, players.get(h)!.ana, { kind: 'victim', round: 1, faction: victim });
      submit(h, id, players.get(h)!.bea, { kind: 'victim', round: 1, faction: wrong });
    }
    await same('phase-1');
    for (const h of [a, b]) advance(h, id, 'phase-1-close');
    expect(publicOf(a, id).stage).toBe('phase-2');
    await same('phase-2, victim revealed');
    // The phase 1 winners are readable now: Ana, not Bea.
    expect((await readsOf(a, id)).get(`/matches/${id}/results/1/1/winners`)).toMatch(/^200 \{"round":1,"phase":1,"items":\[\{"playerId":"player:[^"]+","name":"Ana"\}\]\}$/);
    const candidates = publicOf(a, id).victim!.candidates;
    for (const h of [a, b]) {
      submit(h, id, players.get(h)!.ana, { kind: 'absorber', round: 1, faction: candidates[0] });
      submit(h, id, players.get(h)!.bea, { kind: 'absorber', round: 1, faction: candidates[candidates.length - 1] });
    }
    await same('phase-2 with absorber predictions');
    for (const h of [a, b]) advance(h, id, 'phase-2-close');
    expect(publicOf(a, id).stage).toBe('locked');
    await same('locked');
    expect((await readsOf(a, id)).get(`/matches/${id}/results/1/2/winners`)).toMatch(/^404 /);

    for (const text of seen) for (const needle of NEEDLES) expect(holds(text, needle), String(needle).slice(0, 12)).toBe(false);

    // After the application the phase 2 winners may differ: one of the twins' players guessed the absorber.
    for (const h of [a, b]) advance(h, id, 'application');
    const afterA = await get(a, `/matches/${id}/results/1/2/winners`);
    const afterB = await get(b, `/matches/${id}/results/1/2/winners`);
    expect([afterA.status, afterB.status]).toStrictEqual([200, 200]);
    const abs = [played(SEEDS[0]).absorber, played(SEEDS[1]).absorber];
    const guessed = (absorber: number): string[] => [candidates[0], candidates[candidates.length - 1]].flatMap((c, i) => (c === absorber ? [i === 0 ? 'Ana' : 'Bea'] : []));
    expect(afterA.text.includes('"Ana"')).toBe(guessed(abs[0]!).includes('Ana'));
    expect(afterB.text.includes('"Bea"')).toBe(guessed(abs[1]!).includes('Bea'));
  });
});
