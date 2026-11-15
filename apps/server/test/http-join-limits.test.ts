import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { closeAllServers, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { creationBody } from './helpers/service-harness';

// The join rates on the wire (spec 011 M4 T5): one limit per source and one per match, on a sliding window of 60 s read from the
// fake clock. A refused request is counted nowhere; a malformed body costs no slot; a join the service refuses for its name or
// its stage did pass the shape stage, so it holds its own slot.

afterEach(closeAllServers);

const start = (limits: { joinSource?: number; joinMatch?: number }, hops = 0): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    trustedProxyHops: hops,
    service: { publicCreation: { maps: ['dev'], maxOpenLobbies: 1000 } },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, ...limits },
  });
const lobbyOf = (h: ServerHarness, requestId: string): string => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody(requestId) });
  if (!out.ok) throw new Error('public creation failed');
  return out.reply.matchId;
};
const join = (h: ServerHarness, matchId: string, body: unknown, from?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path: `/matches/${matchId}/players`, body, headers: from === undefined ? {} : { 'x-forwarded-for': from } });
const named = (name: string, requestId = name): Record<string, unknown> => ({ name, requestId });

describe('http join limits: per source', () => {
  it('FR-381 the per-source limit is exact (limit - 1, limit, limit + 1 requests), reports the wait and slides on the fake clock', async () => {
    const h = await start({ joinSource: 3, joinMatch: 1000 });
    const m = lobbyOf(h, 'c-1');
    expect((await join(h, m, named('a1'))).status).toBe(201); // limit - 2 held
    h.clock.advance(10_000);
    expect((await join(h, m, named('a2'))).status).toBe(201); // limit - 1 held
    h.clock.advance(10_000);
    expect((await join(h, m, named('a3'))).status).toBe(201); // the limit
    const over = await join(h, m, named('a4')); // limit + 1
    expect([over.status, over.headers['retry-after'], over.json()]).toStrictEqual([429, '40', { kind: 'rate-limited', retryAfter: 40 }]);
    h.clock.advance(39_999);
    expect((await join(h, m, named('a4'))).headers['retry-after']).toBe('1');
    h.clock.advance(1);
    expect((await join(h, m, named('a4'))).status).toBe(201);
    expect((await join(h, m, named('a5'))).status).toBe(429);
    expect(h.base.store.playerCount(m)).toBe(4);
  });

  it('FR-381 a refused request is counted nowhere: it holds no slot of the source and none of the match', async () => {
    const h = await start({ joinSource: 2, joinMatch: 3 }, 1);
    const m = lobbyOf(h, 'c-1');
    expect((await join(h, m, named('a1'), '203.0.113.1')).status).toBe(201);
    expect((await join(h, m, named('a2'), '203.0.113.1')).status).toBe(201);
    expect((await join(h, m, named('a3'), '203.0.113.1')).status).toBe(429); // the source limit; the match holds 2
    h.clock.advance(30_000);
    expect((await join(h, m, named('a4'), '203.0.113.1')).status).toBe(429);
    // The match holds two joins, not four: another source still has its third slot.
    expect((await join(h, m, named('b1'), '203.0.113.2')).status).toBe(201);
    expect((await join(h, m, named('b2'), '203.0.113.2')).status).toBe(429); // the match limit now
    h.clock.advance(30_000); // the first source's two instants leave the window
    expect((await join(h, m, named('a5'), '203.0.113.1')).status).toBe(201);
  });

  it('FR-381 a join the service refuses for its name holds its own slot, and a malformed body holds none', async () => {
    const h = await start({ joinSource: 3, joinMatch: 1000 });
    const m = lobbyOf(h, 'c-1');
    expect((await join(h, m, named('Ana'))).status).toBe(201);
    expect((await join(h, m, named('ANA', 'j-2'))).status).toBe(409); // a slot used
    expect((await join(h, m, named('', 'j-3'))).status).toBe(400); // none used
    expect((await join(h, m, { name: 'Bea' })).status).toBe(400); // none used
    expect((await join(h, m, named('Bea'))).status).toBe(201); // the third slot
    expect((await join(h, m, named('Cy'))).status).toBe(429);
  });
});

describe('http join limits: per match', () => {
  it('FR-381 the per-match limit is shared by every source and is exact at limit - 1, limit and limit + 1', async () => {
    const h = await start({ joinSource: 1000, joinMatch: 3 }, 1);
    const m = lobbyOf(h, 'c-1');
    expect((await join(h, m, named('a1'), '203.0.113.1')).status).toBe(201);
    expect((await join(h, m, named('b1'), '203.0.113.2')).status).toBe(201);
    expect((await join(h, m, named('c1'), '203.0.113.3')).status).toBe(201);
    const over = await join(h, m, named('d1'), '203.0.113.4');
    expect([over.status, over.headers['retry-after']]).toStrictEqual([429, '60']);
    h.clock.advance(60_000);
    expect((await join(h, m, named('d1'), '203.0.113.4')).status).toBe(201);
  });

  it('FR-381 the per-match key is its own: another match of the same source still has its slots', async () => {
    const h = await start({ joinSource: 1000, joinMatch: 2 });
    const m1 = lobbyOf(h, 'c-1');
    const m2 = lobbyOf(h, 'c-2');
    expect((await join(h, m1, named('a1'))).status).toBe(201);
    expect((await join(h, m1, named('a2'))).status).toBe(201);
    expect((await join(h, m1, named('a3'))).status).toBe(429);
    expect((await join(h, m2, named('a1'))).status).toBe(201);
    expect((await join(h, m2, named('a2'))).status).toBe(201);
    expect((await join(h, m2, named('a3'))).status).toBe(429);
  });
});

describe('http join limits: the source', () => {
  it('FR-381 a forged X-Forwarded-For at hops 0 gives no new source', async () => {
    const h = await start({ joinSource: 2, joinMatch: 1000 });
    const m = lobbyOf(h, 'c-1');
    expect((await join(h, m, named('a1'), '203.0.113.1')).status).toBe(201);
    expect((await join(h, m, named('a2'), '203.0.113.2')).status).toBe(201);
    expect((await join(h, m, named('a3'), '203.0.113.3')).status).toBe(429);
  });
});
