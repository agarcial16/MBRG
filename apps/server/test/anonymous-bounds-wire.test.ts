import { afterEach, describe, expect, it } from 'vitest';
import { encodeError, errorReply } from '@mbrg/protocol';
import { productionRoutes } from '../src/http/server';
import { head, raw, request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';
import { openStream } from './helpers/sse-reader';
import type { SseReader } from './helpers/sse-reader';
import { creationBody } from './helpers/service-harness';

// NFR-72, wire level: the bounds an anonymous caller meets through the real listener, each driven to its edge on the fake clock:
// the body size, the request ids, the names, the players page, the anonymous streams, the event backlog of a lobby, and the
// floods at the rate limits (10,000 joins, hundreds of creations). Sockets are opened in batches of 100 (a Windows listen
// backlog overflows with more). Nothing sleeps: the clock is the fake one and every wait is for a reply.

const readers: SseReader[] = [];
afterEach(async () => {
  for (const r of readers.splice(0, readers.length)) r.close();
  await closeAllServers();
});

const DAY = 24 * 3_600_000;
const BATCH = 100;

const begin = (options: ServerHarnessOptions = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    ...options,
    service: { publicCreation: { maps: ['dev'], lobbyExpiryHours: 720, maxOpenLobbies: 1000 }, ...(options.service ?? {}) },
    limits: { commands: 1_000_000, reads: 1_000_000, anonymous: 1_000_000, createSource: 1_000_000, createAll: 1_000_000, joinSource: 1_000_000, joinMatch: 1_000_000, ...(options.limits ?? {}) },
  });
const lobbyOf = (h: ServerHarness, requestId = 'c-1'): string => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody(requestId) });
  if (!out.ok) throw new Error('public creation failed');
  return out.reply.matchId;
};
const join = (h: ServerHarness, matchId: string, body: unknown, from?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path: `/matches/${matchId}/players`, body, headers: from === undefined ? {} : { 'x-forwarded-for': from } });
const create = (h: ServerHarness, body: unknown, from?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path: '/matches', body, headers: from === undefined ? {} : { 'x-forwarded-for': from } });
/** Sends `count` requests in batches of `BATCH` concurrent sockets and returns the status counts. */
async function flood(count: number, send: (i: number) => Promise<ClientReply>): Promise<Map<number, number>> {
  const statuses = new Map<number, number>();
  for (let from = 0; from < count; from += BATCH) {
    const batch = await Promise.all(Array.from({ length: Math.min(BATCH, count - from) }, (_, k) => send(from + k)));
    for (const r of batch) statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
  }
  return statuses;
}

describe('NFR-72 on the wire: bodies, ids and names', () => {
  it('NFR-72 a body of 4,096 bytes is read and judged by its shape; one of 4,097 is refused unread with 413 and the connection closed, on all three public POSTs', async () => {
    const h = await begin();
    const matchId = lobbyOf(h);
    for (const path of ['/matches', `/matches/${matchId}/players`, `/matches/${matchId}/start`]) {
      const base = JSON.stringify({ pad: '' });
      const exact = JSON.stringify({ pad: 'x'.repeat(4096 - Buffer.byteLength(base)) });
      expect(Buffer.byteLength(exact)).toBe(4096);
      const read = await request(h.port, { method: 'POST', path, body: exact });
      expect([path, read.status === 413]).toStrictEqual([path, false]);
      const over = await raw(h.port, [head('POST', path, { 'content-length': '4097', 'content-type': 'application/json' }), 'x'.repeat(10)]);
      expect([path, over.status, over.headers.connection]).toStrictEqual([path, 413, 'close']);
    }
    expect(h.base.store.playerCount(matchId)).toBe(0);
  });

  it('NFR-72 request ids: 64 characters of the set are accepted, 65 or a character outside the set are invalid-request naming requestId, for creation and join', async () => {
    const h = await begin();
    const matchId = lobbyOf(h);
    const invalid = encodeError(errorReply('invalid-request', ['requestId']));
    for (const [i, bad] of ['r'.repeat(65), '', 'a b', 'a/b', 'ñ', 'a'.repeat(4000)].entries()) {
      const c = await create(h, creationBody(bad));
      const j = await join(h, matchId, { name: `N${i}`, requestId: bad });
      expect([i, c.status, c.text, j.status, j.text]).toStrictEqual([i, 400, invalid, 400, invalid]);
    }
    expect((await create(h, creationBody('r'.repeat(64)))).status).toBe(201);
    expect((await join(h, matchId, { name: 'Ana', requestId: 'r'.repeat(64) })).status).toBe(201);
    expect(h.base.store.playerCount(matchId)).toBe(1);
  });

  it('NFR-72 names: 24 characters are stored, 25 are invalid-request naming name only, whatever the text', async () => {
    const h = await begin();
    const matchId = lobbyOf(h);
    const invalid = encodeError(errorReply('invalid-request', ['name']));
    expect((await join(h, matchId, { name: 'ñ'.repeat(24), requestId: 'n-1' })).status).toBe(201);
    for (const [i, bad] of ['ñ'.repeat(25), 'x'.repeat(3000)].entries()) {
      const r = await join(h, matchId, { name: bad, requestId: `n-b${i}` });
      expect([i, r.status, r.text]).toStrictEqual([i, 400, invalid]);
    }
    expect(h.base.store.playerCount(matchId)).toBe(1);
  });

  it('NFR-72 players per match: the join after maxPlayers is 409 match-full and stores nothing', async () => {
    const h = await begin({ service: { maxPlayers: 3 } });
    const matchId = lobbyOf(h);
    for (let i = 1; i <= 3; i += 1) expect((await join(h, matchId, { name: `P${i}`, requestId: `j-${i}` })).status).toBe(201);
    const full = await join(h, matchId, { name: 'P4', requestId: 'j-4' });
    expect([full.status, full.text]).toStrictEqual([409, errorBody('match-full')]);
    expect(h.base.store.playerCount(matchId)).toBe(3);
  });
});

describe('NFR-72 on the wire: lists and streams', () => {
  it('NFR-72 the players page is 500 at most: limit 500 answers 500 items and a cursor for the rest, 501 is invalid-request naming limit', async () => {
    const h = await begin({ service: { maxPlayers: 520 } });
    const matchId = lobbyOf(h);
    for (let i = 0; i < 520; i += 1) {
      const out = h.service.join({ source: 'src-a', matchId, body: { name: `P${i}`, requestId: `j-${i}` } });
      if (!out.ok) throw new Error('join failed');
    }
    const first = await request(h.port, { path: `/matches/${matchId}/players?limit=500` });
    const page = first.json() as { items: { name: string }[]; next?: string };
    expect([first.status, page.items.length, typeof page.next]).toStrictEqual([200, 500, 'string']);
    const second = await request(h.port, { path: `/matches/${matchId}/players?limit=500&cursor=${page.next}` });
    const rest = second.json() as { items: { name: string }[]; next?: string };
    expect([second.status, rest.items.length, rest.next]).toStrictEqual([200, 20, undefined]);
    expect(new Set([...page.items, ...rest.items].map((i) => i.name)).size).toBe(520);
    const bigger = await request(h.port, { path: `/matches/${matchId}/players?limit=501` });
    expect([bigger.status, bigger.text]).toStrictEqual([400, encodeError(errorReply('invalid-request', ['limit']))]);
    // No limit gives the default page, not the whole list.
    const dflt = await request(h.port, { path: `/matches/${matchId}/players` });
    expect((dflt.json() as { items: unknown[] }).items).toHaveLength(100);
  });

  it('NFR-72 anonymous streams: five per address on a lobby, the sixth is refused with rate-limited and Retry-After, and the refusal opens nothing', async () => {
    const h = await begin({ limits: { anonymousStreams: DEFAULT_ANON_STREAMS } });
    const matchId = lobbyOf(h);
    for (let i = 0; i < DEFAULT_ANON_STREAMS; i += 1) {
      const reader = await openStream({ port: h.port, path: `/matches/${matchId}/events` });
      readers.push(reader);
      expect([i, reader.status]).toStrictEqual([i, 200]);
    }
    const sixth = await openStream({ port: h.port, path: `/matches/${matchId}/events` });
    readers.push(sixth);
    expect([sixth.status, sixth.headers['retry-after']]).toStrictEqual([429, '15']);
    expect(h.streams.openCount()).toBe(DEFAULT_ANON_STREAMS);
  });

  it('NFR-72 the event backlog of a lobby with 200 joins is the 200 joins and the creation, replayed once and in order; the 201st join stores no event', async () => {
    const h = await begin({ service: { maxPlayers: 200 } });
    const matchId = lobbyOf(h);
    for (let i = 0; i < 200; i += 1) {
      const out = h.service.join({ source: 'src-a', matchId, body: { name: `P${i}`, requestId: `j-${i}` } });
      if (!out.ok) throw new Error('join failed');
    }
    const refused = await join(h, matchId, { name: 'Late', requestId: 'j-late' });
    expect([refused.status, refused.text]).toStrictEqual([409, errorBody('match-full')]);
    const stored = h.base.store.eventsAfter(matchId, 0);
    expect(stored).toHaveLength(201);
    const whole = await openStream({ port: h.port, path: `/matches/${matchId}/events`, headers: { 'last-event-id': '0' } });
    readers.push(whole);
    const frames = await whole.takeEvents(201, 10_000);
    expect(frames.map((f) => f.id)).toStrictEqual(stored.map((e) => e.seq));
    expect(frames.map((f) => f.id)).toStrictEqual(Array.from({ length: 201 }, (_, i) => i + 1));
    // A reconnect with the last number gets nothing more; one in the middle gets exactly the rest.
    const middle = await openStream({ port: h.port, path: `/matches/${matchId}/events`, headers: { 'last-event-id': '150' } });
    readers.push(middle);
    expect((await middle.takeEvents(51, 10_000)).map((f) => f.id)).toStrictEqual(Array.from({ length: 51 }, (_, i) => 151 + i));
    const caughtUp = await openStream({ port: h.port, path: `/matches/${matchId}/events`, headers: { 'last-event-id': '201' } });
    readers.push(caughtUp);
    expect(caughtUp.raw()).not.toContain('"seq"');
    expect(h.streams.openCount()).toBe(3);
  });
});

describe('NFR-72 on the wire: floods at the rate limits', () => {
  it('NFR-72 10,000 joins from 10,000 sources against one match store at most the per-match limit and one memo row each; the memo goes at 24 h + 1 ms', async () => {
    const LIMIT = 40;
    const h = await begin({ trustedProxyHops: 1, limits: { joinSource: 5, joinMatch: LIMIT } });
    const matchId = lobbyOf(h);
    const statuses = await flood(10_000, (i) => join(h, matchId, { name: `P${i}`, requestId: `j-${i}` }, `10.${i % 250}.${Math.floor(i / 250)}.1`));
    expect([...statuses.entries()].sort()).toStrictEqual([[201, LIMIT], [429, 10_000 - LIMIT]]);
    expect(h.base.store.playerCount(matchId)).toBe(LIMIT);
    expect(h.base.store.eventsAfter(matchId, 0)).toHaveLength(1 + LIMIT);
    // The refused requests recorded nothing: after the window the same sources join again, up to the limit.
    h.clock.advance(60_000);
    const again = await flood(LIMIT + 10, (i) => join(h, matchId, { name: `Q${i}`, requestId: `k-${i}` }, `10.${i % 250}.0.1`));
    expect([...again.entries()].sort()).toStrictEqual([[201, LIMIT], [429, 10]]);
    // Memo rows: the creation, the first joins and the second joins; none for a refusal. Purged only past 24 h.
    h.clock.advance(DAY - 60_000);
    expect(h.service.purgeMemos()).toBe(0); // the creation and the first joins are exactly 24 h old
    h.clock.advance(1);
    expect(h.service.purgeMemos()).toBe(1 + LIMIT);
    h.clock.advance(60_000);
    expect(h.service.purgeMemos()).toBe(LIMIT);
  }, 180_000);

  it('NFR-72 a creation flood from 600 sources stores at most the overall limit of lobbies and memo rows', async () => {
    const ALL = 30;
    const h = await begin({ trustedProxyHops: 1, limits: { createSource: 5, createAll: ALL } });
    const statuses = await flood(600, (i) => create(h, creationBody(`c-${i}`), `10.0.${Math.floor(i / 250)}.${i % 250}`));
    expect([...statuses.entries()].sort()).toStrictEqual([[201, ALL], [429, 600 - ALL]]);
    expect(h.base.store.openLobbyCount()).toBe(ALL);
    h.clock.advance(DAY);
    expect(h.service.purgeMemos()).toBe(0);
    h.clock.advance(1);
    expect(h.service.purgeMemos()).toBe(ALL);
  }, 60_000);

  it('NFR-72 the open-lobby cap bounds creations that the rate limit lets through', async () => {
    const h = await begin({ service: { publicCreation: { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 10 } } });
    const statuses = await flood(60, (i) => create(h, creationBody(`c-${i}`), undefined));
    expect([...statuses.entries()].sort()).toStrictEqual([[201, 10], [409, 50]]);
    expect(h.base.store.openLobbyCount()).toBe(10);
  });
});

const DEFAULT_ANON_STREAMS = 5;
