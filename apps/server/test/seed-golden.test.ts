import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getState, playRoundWithSeed, totalRounds } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { commitment, roundSeed } from '../src/secret';
import { devMap, mapDigest, stateDigest, stateText } from './helpers/digests';

// NFR-48 (seed and record goldens) and the digest definitions of spec 008 (P32).
// golden/dev-secrets.json pins, for three fixed secrets on the dev map, every round seed, victim, absorber,
// transferred territory list and state digest from round 1 to T, chained through playRoundWithSeed with
// roundSeed(secret, k). It was produced by an independent script (not by this test or the server code):
// seeds through node:crypto createHmac, the victim redrawn with its own copy of sfc32 + rejection sampling,
// the digests built from the spec text; only the absorber and the transferred list come from the sim itself.
// Test secrets only; they were never used for a real match.

interface GoldenRound {
  round: number;
  seed: number;
  victim: number;
  absorber: number;
  transferred: number[];
  stateDigest: string;
}
interface Golden {
  map: string;
  mapDigest: string;
  totalRounds: number;
  matches: Record<string, { secret: string; commitment: string; rounds: GoldenRound[] }>;
}

const golden = JSON.parse(readFileSync(new URL('./golden/dev-secrets.json', import.meta.url), 'utf8')) as Golden;
const fromHex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, 'hex'));

function ok<T>(r: { ok: true; value: T } | { ok: false; errors: unknown[] }): T {
  if (!r.ok) throw new Error('unexpected failure: ' + JSON.stringify(r.errors));
  return r.value;
}

/** Chains the round step with the derived seed of each round, from the round-0 state. */
function playMatch(secret: Uint8Array): GoldenRound[] {
  const map = devMap();
  let state: MatchState = ok(getState(map, 0, 0));
  const out: GoldenRound[] = [];
  for (let k = 1; k <= ok(totalRounds(map)); k++) {
    const seed = roundSeed(secret, k);
    const step = ok(playRoundWithSeed(map, state, seed));
    state = step.state;
    out.push({
      round: k,
      seed,
      victim: step.record.eliminated,
      absorber: step.record.absorber,
      transferred: step.record.transferred,
      stateDigest: stateDigest(state),
    });
  }
  return out;
}

describe('NFR-48 dev-map seed goldens', () => {
  it('NFR-48 the golden file holds three distinct secrets and covers rounds 1..T', () => {
    expect(golden.totalRounds).toBe(ok(totalRounds(devMap())));
    expect(Object.keys(golden.matches)).toStrictEqual(['ascending-00-1f', 'ascending-20-3f', 'all-a5']);
    expect(golden.matches['ascending-00-1f']!.secret).toBe(Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('hex'));
    expect(golden.matches['ascending-20-3f']!.secret).toBe(Buffer.from(Array.from({ length: 32 }, (_, i) => 0x20 + i)).toString('hex'));
    expect(golden.matches['all-a5']!.secret).toBe('a5'.repeat(32));
    for (const m of Object.values(golden.matches)) expect(m.rounds.map((r) => r.round)).toStrictEqual([1, 2, 3, 4]);
  });

  for (const [name, m] of Object.entries(golden.matches)) {
    it(`NFR-48 ${name}: commitment, seeds, victims, absorbers, transfers and state digests equal the golden`, () => {
      const secret = fromHex(m.secret);
      expect(commitment(secret)).toBe(m.commitment);
      expect(playMatch(secret)).toStrictEqual(m.rounds);
    });
  }

  it('NFR-48 the three matches differ from each other (a constant seed source would not pass)', () => {
    const seeds = Object.values(golden.matches).map((m) => m.rounds.map((r) => r.seed).join());
    expect(new Set(seeds).size).toBe(3);
    for (const m of Object.values(golden.matches)) expect(new Set(m.rounds.map((r) => r.seed)).size).toBe(m.rounds.length);
  });

  it('NFR-48 the map digest of maps/dev follows the spec definition and is pinned', () => {
    expect(mapDigest()).toBe(golden.mapDigest);
    expect(golden.mapDigest).toBe('4d1698a310b46a6507fd128dad87f20873065d44a71b2ee5a78c062eb5c1e679');
  });

  it('NFR-48 the state digest text is classic;<round>;<t>:<f>,... in map order', () => {
    const state = ok(getState(devMap(), 0, 0));
    const text = stateText(state);
    expect(text.startsWith('classic;0;')).toBe(true);
    expect(text).toBe(`classic;0;${state.owners.map(([t, f]) => `${t}:${f}`).join(',')}`);
    expect(text).not.toMatch(/\s/);
    expect(stateDigest(state)).toMatch(/^[0-9a-f]{64}$/);
  });
});
