import { afterEach, describe, expect, it } from 'vitest';
import { DISCORD, KEY_A, createCommunityMatch, playMatch, startHistory } from './helpers/history-kit';
import type { Player } from './helpers/history-kit';
import { get } from './helpers/http-reads-kit';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';

// Spec 024 NFR-120 (last part: public reads and match state): a community key changes no byte a public read returns and no byte of
// the stored match state. Two servers run the same flow with the same draws (so the same match ids and instants); in one the matches
// carry the community key, in the other none. Every public read, whole, and the stored state of each match are the same. The goldens,
// the creation digest and the protected paths are pinned by their own tests and by the protected-path diff of the milestone.

afterEach(closeAllServers);

const ANA: Player = { client: DISCORD, local: 'u1', name: 'Ana', victim: 'right', absorber: 'right', winner: 'right' };
const BEA: Player = { client: DISCORD, local: 'u2', name: 'Bea', victim: 'right', absorber: 'wrong', winner: 'wrong' };

async function flow(h: ServerHarness, key: string | undefined): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const made = await createCommunityMatch(h, DISCORD, `cmp-${i}`, key);
    playMatch(h, made, [ANA, BEA], i === 0);
    ids.push(made.id);
  }
  // A running one and a lobby, so the list holds every stage.
  await createCommunityMatch(h, DISCORD, 'cmp-lobby', key);
  return ids;
}

/** Status, content and every header but the wall-clock date of a public read. */
async function snapshot(h: ServerHarness, path: string): Promise<string> {
  const reply = await get(h, path);
  return `${reply.status}\n${JSON.stringify({ ...reply.headers, date: undefined })}\n${reply.text}`;
}

describe('NFR-120 (public reads and state) a community key changes no public byte and no state byte', () => {
  it('NFR-120 (part: public reads and stored state) the lists, a match, its leaderboard and records, the config and the stored match are the same with and without the key', async () => {
    const withKey = await startHistory();
    const without = await startHistory();
    const ids = await flow(withKey, KEY_A);
    expect(await flow(without, undefined)).toStrictEqual(ids);
    const paths = ['/matches?limit=500', '/matches?limit=2', '/config', ...ids.flatMap((id) => [`/matches/${id}`, `/matches/${id}/leaderboard?limit=500`, `/matches/${id}/records`])];
    for (const path of paths) expect(await snapshot(withKey, path), path).toBe(await snapshot(without, path));
    for (const id of ids) {
      const a = withKey.base.store.getMatch(id)!;
      const b = without.base.store.getMatch(id)!;
      expect(JSON.stringify(a.match), id).toBe(JSON.stringify(b.match));
      expect(JSON.stringify(a.match.state), id).toBe(JSON.stringify(b.match.state));
    }
  }, 60_000);
});
