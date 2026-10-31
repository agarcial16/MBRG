import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { credentialDigest } from '../src/service/ids';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { closeAllServers, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, creationBody } from './helpers/service-harness';

// The creation rates of public creation on the wire (spec 011 M4 T4): one limit per source and one overall, both on a sliding
// window of 60 s read from the fake clock. A refused request is counted nowhere; a malformed body is invalid-request before it
// costs a slot. The source is the peer unless trusted proxy hops say otherwise.

afterEach(closeAllServers);

const start = (limits: { createSource?: number; createAll?: number }, hops = 0): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    trustedProxyHops: hops,
    service: { publicCreation: { maps: ['dev'], maxOpenLobbies: 1000 } },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, ...limits },
  });
const forwarded = (address: string): Record<string, string> => ({ 'x-forwarded-for': address });
const create = (h: ServerHarness, requestId: string, headers: Record<string, string> = {}, token?: string): Promise<ClientReply> =>
  request(h.port, {
    method: 'POST',
    path: '/matches',
    body: creationBody(requestId),
    headers: { ...(token === undefined ? {} : { authorization: `Bearer ${token}` }), ...headers },
  });
const kindOf = (reply: ClientReply): unknown => (reply.json() as { kind?: unknown }).kind;

describe('http public creation limits: per source', () => {
  it('FR-370 the per-source limit is exact (limit - 1, limit, limit + 1 requests) and the window slides on the fake clock', async () => {
    const h = await start({ createSource: 3, createAll: 1000 });
    expect((await create(h, 'c-1')).status).toBe(201); // limit - 2 held
    h.clock.advance(10_000);
    expect((await create(h, 'c-2')).status).toBe(201); // limit - 1 held
    h.clock.advance(10_000);
    expect((await create(h, 'c-3')).status).toBe(201); // the limit
    const over = await create(h, 'c-4'); // limit + 1
    expect([over.status, over.headers['retry-after'], over.json()]).toStrictEqual([429, '40', { kind: 'rate-limited', retryAfter: 40 }]);
    h.clock.advance(39_999); // one ms before the first instant leaves the window
    const near = await create(h, 'c-4');
    expect([near.status, near.headers['retry-after']]).toStrictEqual([429, '1']);
    h.clock.advance(1);
    expect((await create(h, 'c-4')).status).toBe(201); // the first instant has left: one slot
    expect((await create(h, 'c-5')).status).toBe(429);
  });

  it('FR-370 a refused request is counted nowhere: it neither holds a slot of the source nor of the overall limit', async () => {
    const h = await start({ createSource: 2, createAll: 1000 });
    expect((await create(h, 'a-1')).status).toBe(201);
    expect((await create(h, 'a-2')).status).toBe(201);
    expect((await create(h, 'a-3')).status).toBe(429);
    h.clock.advance(30_000);
    expect((await create(h, 'a-4')).status).toBe(429);
    h.clock.advance(30_000); // the two accepted instants leave now; a counted refusal at +30 s would still hold a slot
    expect((await create(h, 'a-5')).status).toBe(201);
    expect((await create(h, 'a-6')).status).toBe(201);
    expect((await create(h, 'a-7')).status).toBe(429);
  });

  it('FR-370 a request refused by the source limit does not charge the overall limit', async () => {
    const h = await start({ createSource: 2, createAll: 3 }, 1);
    expect((await create(h, 'x-1', forwarded('203.0.113.1'))).status).toBe(201);
    expect((await create(h, 'x-2', forwarded('203.0.113.1'))).status).toBe(201);
    expect((await create(h, 'x-3', forwarded('203.0.113.1'))).status).toBe(429); // the source limit; overall held: 2
    expect((await create(h, 'y-1', forwarded('203.0.113.2'))).status).toBe(201); // the third of three overall
    expect((await create(h, 'y-2', forwarded('203.0.113.2'))).status).toBe(429); // now the overall limit
  });

  it('FR-370 a rate-limited creation creates, stores, memoises and draws nothing', async () => {
    const h = await start({ createSource: 1, createAll: 1000 });
    expect((await create(h, 'c-1')).status).toBe(201);
    const memo = (id: string) => h.base.store.memoGet({ credentialDigest: credentialDigest('public:127.0.0.1'), match: null }, id);
    const before = { draws: h.base.draws.length, matches: h.base.store.listMatches(undefined, 100).length, lobbies: h.base.store.openLobbyCount(), oldest: h.base.store.memoOldest() };
    const refused = await create(h, 'c-2');
    expect(refused.status).toBe(429);
    expect({ draws: h.base.draws.length, matches: h.base.store.listMatches(undefined, 100).length, lobbies: h.base.store.openLobbyCount(), oldest: h.base.store.memoOldest() }).toStrictEqual(before);
    expect(memo('c-2')).toBeUndefined();
    h.clock.advance(60_000);
    expect((await create(h, 'c-2')).status).toBe(201);
  });

  it('FR-370 a malformed body is invalid-request before it costs a creation slot', async () => {
    const h = await start({ createSource: 1, createAll: 1 });
    for (let i = 0; i < 3; i += 1) {
      const bad = await request(h.port, { method: 'POST', path: '/matches', body: { mapId: 'dev', timing: { i: 120, l1: 30, l2: 10 } } });
      expect([bad.status, kindOf(bad)]).toStrictEqual([400, 'invalid-request']);
    }
    const notJson = await request(h.port, { method: 'POST', path: '/matches', body: 'not json' });
    expect(notJson.status).toBe(400);
    expect((await create(h, 'c-1')).status).toBe(201);
    expect((await create(h, 'c-2')).status).toBe(429);
  });

  it('FR-370 the operator credential is not under the creation limits', async () => {
    const h = await start({ createSource: 1, createAll: 1 });
    for (let i = 0; i < 4; i += 1) expect((await create(h, `o-${i}`, {}, OPERATOR)).status).toBe(201);
    // And operator creations hold no slot of the public limits.
    expect((await create(h, 'p-1')).status).toBe(201);
    expect((await create(h, 'p-2')).status).toBe(429);
  });
});

describe('http public creation limits: overall and sources', () => {
  it('FR-370 the overall limit holds across sources at its edge', async () => {
    const h = await start({ createSource: 1000, createAll: 4 }, 1);
    for (let i = 1; i <= 3; i += 1) expect((await create(h, `s-${i}`, forwarded(`203.0.113.${i}`))).status).toBe(201);
    expect((await create(h, 's-4', forwarded('203.0.113.4'))).status).toBe(201); // the fourth, the limit
    const over = await create(h, 's-5', forwarded('203.0.113.5')); // a fifth source
    expect([over.status, over.headers['retry-after'], kindOf(over)]).toStrictEqual([429, '60', 'rate-limited']);
    expect((await create(h, 's-6', forwarded('203.0.113.1'))).status).toBe(429); // a source already seen
    h.clock.advance(60_000);
    expect((await create(h, 's-5', forwarded('203.0.113.5'))).status).toBe(201);
  });

  it('FR-370 the per-source limit is per source: another source has its own', async () => {
    const h = await start({ createSource: 1, createAll: 1000 }, 1);
    expect((await create(h, 'a', forwarded('203.0.113.1'))).status).toBe(201);
    expect((await create(h, 'b', forwarded('203.0.113.1'))).status).toBe(429);
    expect((await create(h, 'b', forwarded('203.0.113.2'))).status).toBe(201);
  });

  it('FR-370 with one trusted hop the forged left entries of X-Forwarded-For do not give a caller a new source', async () => {
    const h = await start({ createSource: 2, createAll: 1000 }, 1);
    expect((await create(h, 'f-1', forwarded('198.51.100.1, 203.0.113.9'))).status).toBe(201);
    expect((await create(h, 'f-2', forwarded('198.51.100.2, 203.0.113.9'))).status).toBe(201);
    expect((await create(h, 'f-3', forwarded('198.51.100.3, 203.0.113.9'))).status).toBe(429);
  });

  it('FR-370 with no trusted hop a forged X-Forwarded-For gives a caller no new source either', async () => {
    const h = await start({ createSource: 2, createAll: 1000 }, 0);
    expect((await create(h, 'f-1', forwarded('203.0.113.1'))).status).toBe(201);
    expect((await create(h, 'f-2', forwarded('203.0.113.2'))).status).toBe(201);
    expect((await create(h, 'f-3', forwarded('203.0.113.3'))).status).toBe(429);
  });
});
