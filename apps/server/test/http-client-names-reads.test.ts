import { afterEach, describe, expect, it } from 'vitest';
import { closeAllServers } from './helpers/server-harness';
import { begin, finish, get, leaderboard, post, predict } from './helpers/client-names';
import type { Rig } from './helpers/client-names';

// Spec 022 FR-533, FR-535: leaderboard rows, phase results rows, phase winners and the own-player read carry the stored name of a
// client player, the member present only when known, and only once the player has a result row.

afterEach(closeAllServers);

const PLANTED = 'Zq Planted Name';
const livingFactions = (rig: Rig): number[] => [...new Set(rig.h.service.publicMatch(rig.matchId)!.state.owners.map(([, f]) => f))];

/** Every living faction is predicted as the victim of round 1 by its own member, so exactly one of them is right. */
const everyone = async (rig: Rig, names: boolean): Promise<string[]> => {
  const locals: string[] = [];
  for (const [i, faction] of livingFactions(rig).entries()) {
    const local = `m${i}`;
    locals.push(local);
    const out = await predict({ ...rig, faction }, local, names ? { name: `Member ${i}` } : {});
    expect(out.status).toBe(200);
  }
  return locals;
};

describe('reads carry the display name of a scored client player', () => {
  it('the leaderboard, the phase results, the winners and the own-player read show the name after scoring', async () => {
    const rig = await begin(true);
    const locals = await everyone(rig, true);
    finish(rig);
    const rows = await leaderboard(rig);
    expect(rows).toHaveLength(locals.length);
    for (const [i] of locals.entries()) expect(rows.find((r) => r.playerId === `web:m${i}`)?.name, `m${i}`).toBe(`Member ${i}`);
    const results = (await get(rig.h, `/matches/${rig.matchId}/results/1/1`)).json() as { items: { playerId: string; name?: string }[] };
    expect(results.items.map((r) => [r.playerId, r.name])).toStrictEqual(locals.map((l, i) => [`web:${l}`, `Member ${i}`]));
    const wr = await get(rig.h, `/matches/${rig.matchId}/results/1/1/winners`);
    expect(wr.status).toBe(200);
    const winners = wr.json() as { items: { playerId: string; name: string }[] };
    expect(winners.items).toHaveLength(1);
    const won = winners.items[0]!;
    expect(won.name).toBe(`Member ${locals.indexOf(won.playerId.slice(4))}`);
    const own = (await get(rig.h, `/matches/${rig.matchId}/players/web:m1/results`)).json() as { name?: string };
    expect(own.name).toBe('Member 1');
  });

  it('a client player without a name has no name member in any read, as before the feature', async () => {
    const rig = await begin(true);
    await everyone(rig, false);
    finish(rig);
    const paths = [`/matches/${rig.matchId}/leaderboard`, `/matches/${rig.matchId}/results/1/1`, `/matches/${rig.matchId}/results/1/1/winners`, `/matches/${rig.matchId}/players/web:m0/results`];
    for (const path of paths) {
      const out = await get(rig.h, path);
      expect(out.status, path).toBe(200);
      expect(out.text, path).not.toContain('"name"');
    }
    // the winners read lists only named players (011): nobody here
    expect(((await get(rig.h, paths[2]!)).json() as { items: unknown[] }).items).toStrictEqual([]);
  });

  it('players who joined by name and client players are named side by side on an open match', async () => {
    const rig = await begin(false);
    const joined = await post(rig.h, `/matches/${rig.matchId}/players`, { name: 'Pat', requestId: 'j-1' });
    const { playerToken, playerId } = joined.json() as { playerToken: string; playerId: string };
    expect((await predict(rig, playerId.slice(7), {}, playerToken)).status).toBe(200);
    expect((await predict(rig, 'c1', { name: 'Ana Client' })).status).toBe(200);
    finish(rig);
    const names = Object.fromEntries((await leaderboard(rig)).map((r) => [r.playerId, r.name]));
    expect(names).toStrictEqual({ [playerId]: 'Pat', 'web:c1': 'Ana Client' });
  });

  it('before the first scoring no read names a client player, and the own-player probe equals the probe of an id that never predicted', async () => {
    const rig = await begin(true);
    expect((await predict(rig, 'p1', { name: PLANTED })).status).toBe(200);
    const unscored = await get(rig.h, `/matches/${rig.matchId}/players/web:p1/results`);
    const never = await get(rig.h, `/matches/${rig.matchId}/players/web:never/results`);
    expect(unscored.status).toBe(200);
    expect(unscored.text.replace('web:p1', 'web:never')).toBe(never.text);
    expect(unscored.text).not.toContain(PLANTED);
    const board = await get(rig.h, `/matches/${rig.matchId}/leaderboard`);
    expect(board.text).not.toContain(PLANTED);
    expect(JSON.stringify(rig.h.service.eventsAfter(rig.matchId, 0))).not.toContain(PLANTED);
    finish(rig);
    expect((await get(rig.h, `/matches/${rig.matchId}/players/web:p1/results`)).text).toContain(PLANTED);
  });
});
