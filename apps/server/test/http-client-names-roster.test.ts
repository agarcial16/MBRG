import { afterEach, describe, expect, it } from 'vitest';
import { closeAllServers } from './helpers/server-harness';
import { begin, finish, get, post, predict } from './helpers/client-names';

// Spec 022 FR-532, FR-534: client players are never listed, announced or counted, and never meet `name-taken`.

afterEach(closeAllServers);

const PLANTED = 'Zq Planted Name';

describe('FR-534 FR-532 client names leave the roster and the events alone', () => {
  it('with a stored client name the roster, the match, the list and the events equal a run without names, before and after scoring', async () => {
    const named = await begin(true);
    const plain = await begin(true);
    expect((await predict(named, 'p1', { name: PLANTED })).status).toBe(200);
    expect((await predict(plain, 'p1')).status).toBe(200);
    expect(named.matchId).toBe(plain.matchId);
    const id = named.matchId;
    const paths = [`/matches/${id}`, '/matches', `/matches/${id}/players`];
    const seen = async (): Promise<void> => {
      for (const path of paths) {
        const a = await get(named.h, path);
        const b = await get(plain.h, path);
        expect([path, a.status, a.text]).toStrictEqual([path, b.status, b.text]);
        expect(a.text).not.toContain(PLANTED);
      }
      expect(JSON.stringify(named.h.service.eventsAfter(id, 0))).toBe(JSON.stringify(plain.h.service.eventsAfter(id, 0)));
    };
    await seen();
    const roster = (await get(named.h, `/matches/${id}/players`)).json() as { items: unknown[] };
    expect(roster.items).toStrictEqual([]);
    expect(JSON.stringify(named.h.service.eventsAfter(id, 0))).not.toContain('player-joined');
    finish(named);
    finish(plain);
    expect((await get(named.h, `/matches/${id}/players`)).text).toBe((await get(plain.h, `/matches/${id}/players`)).text);
    expect(JSON.stringify(named.h.service.eventsAfter(id, 0))).not.toContain(PLANTED);
    expect(JSON.stringify(named.h.service.eventsAfter(id, 0))).not.toContain('player-joined');
  });

  it('a client name never meets name-taken and an open player may join with the same text', async () => {
    const rig = await begin(false);
    expect((await predict(rig, 'p1', { name: 'Same Name' })).status).toBe(200);
    expect((await predict(rig, 'p2', { name: 'Same Name' })).status).toBe(200);
    expect((await predict(rig, 'p3', { name: 'same name' })).status).toBe(200);
    const joined = await post(rig.h, `/matches/${rig.matchId}/players`, { name: 'Same Name', requestId: 'j-1' });
    expect(joined.status).toBe(201);
    const second = await post(rig.h, `/matches/${rig.matchId}/players`, { name: 'same name', requestId: 'j-2' });
    expect(second.status).toBe(409);
  });

  it('the players count and the cap do not count client players', async () => {
    const rig = await begin(false);
    for (const local of ['p1', 'p2', 'p3']) expect((await predict(rig, local, { name: `Client ${local}` })).status).toBe(200);
    expect(rig.h.base.store.playerCount(rig.matchId)).toBe(0);
  });
});
