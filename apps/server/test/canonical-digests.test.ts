import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapDigestBytes, stateText as protocolStateText, type MapFileName } from '@mbrg/protocol';
import { getState, playRoundWithSeed, totalRounds } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { DEV_DIR, devMap, mapDigest, stateDigest, stateText } from './helpers/digests';

// FR-282 (canonical content): the protocol produces the canonical bytes and text of the digests (Definitions);
// SHA-256 is computed here with the platform's crypto. The M1 helper (built from the spec text) is the reference.

interface Golden {
  mapDigest: string;
  matches: Record<string, { rounds: { round: number; seed: number; stateDigest: string }[] }>;
}
const golden = JSON.parse(readFileSync(new URL('./golden/dev-secrets.json', import.meta.url), 'utf8')) as Golden;
const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const ok = <T>(r: { ok: true; value: T } | { ok: false; errors: unknown[] }): T => {
  if (!r.ok) throw new Error('unexpected failure: ' + JSON.stringify(r.errors));
  return r.value;
};

describe('canonical forms against the golden data', () => {
  it('FR-282 (canonical content) the map digest bytes of maps/dev hash to the pinned digest', () => {
    const names: MapFileName[] = ['map.json', 'ids.png', 'presentation.json'];
    const files = Object.fromEntries(names.map((n) => [n, new Uint8Array(readFileSync(DEV_DIR + n))])) as Record<MapFileName, Uint8Array>;
    const digest = sha256(mapDigestBytes(files));
    expect(digest).toBe('4d1698a310b46a6507fd128dad87f20873065d44a71b2ee5a78c062eb5c1e679');
    expect(digest).toBe(golden.mapDigest);
    expect(digest).toBe(mapDigest());
  });

  it('FR-282 (canonical content) the state text equals the M1 helper and hashes to the golden digest for every golden state', () => {
    const map = devMap();
    const states: MatchState[] = [ok(getState(map, 0, 0))];
    const first = Object.values(golden.matches)[0]!;
    for (const [name, m] of Object.entries(golden.matches)) {
      let state = ok(getState(map, 0, 0));
      expect(protocolStateText(state), name).toBe(stateText(state));
      for (const r of m.rounds) {
        state = ok(playRoundWithSeed(map, state, r.seed)).state;
        states.push(state);
        expect(protocolStateText(state), `${name} round ${r.round}`).toBe(stateText(state));
        expect(sha256(protocolStateText(state)), `${name} round ${r.round}`).toBe(r.stateDigest);
        expect(sha256(protocolStateText(state))).toBe(stateDigest(state));
      }
    }
    expect(first.rounds).toHaveLength(ok(totalRounds(map)));
    expect(states.length).toBe(1 + 3 * first.rounds.length);
  });
});
