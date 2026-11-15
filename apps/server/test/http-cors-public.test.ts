import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { closeAllServers, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { creationBody } from './helpers/service-harness';

// The cross-origin rule of the new paths (spec 011 M4 T7, plan Q11): the public POSTs (create, join, start) are answered with the
// allowed origin only (a foreign page can neither create nor join nor start), never `*`; the credential-free GETs (players,
// results, the lobby read) stay `*`. `Retry-After` is exposed and `Allow` is sent on the new paths. The policy table is in
// http-cors.test.ts; the older paths are in http-cors-wire.test.ts.

afterEach(closeAllServers);

const ALLOWED = 'https://app.example';
const OTHER = 'https://evil.example';

const corsOf = (r: ClientReply): Record<string, string | string[] | undefined> =>
  Object.fromEntries(Object.entries(r.headers).filter(([k]) => k.startsWith('access-control-') || k === 'vary'));
const ANY = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after' };
const ECHO = { 'access-control-allow-origin': ALLOWED, vary: 'Origin', 'access-control-expose-headers': 'retry-after' };
const PREFLIGHT_PUBLIC = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-max-age': '600' };
const PREFLIGHT_POST = {
  'access-control-allow-origin': ALLOWED,
  vary: 'Origin',
  'access-control-allow-methods': 'GET, POST',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

let counter = 0;
const begin = (limits: Record<string, number> = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    service: { publicCreation: { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 100 } },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000, ...limits },
  });
const lobbyOf = (h: ServerHarness, requestId = 'c-1'): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody(requestId) });
  if (!out.ok) throw new Error('public creation failed');
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};
const post = (h: ServerHarness, path: string, body: unknown, origin: string | undefined, token?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path, body, headers: { ...(origin === undefined ? {} : { origin }), ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) } });
const preflight = (h: ServerHarness, path: string, origin: string, method: string, headers?: string): Promise<ClientReply> =>
  request(h.port, {
    method: 'OPTIONS',
    path,
    headers: { origin, 'access-control-request-method': method, ...(headers === undefined ? {} : { 'access-control-request-headers': headers }) },
  });

describe('http cors on the public paths: actual requests', () => {
  it('a public create, join and start answer the allowed origin only, with Vary, whatever the status; a foreign origin gets no permission and never `*`', async () => {
    const h = await begin();
    for (const [origin, expected] of [[ALLOWED, ECHO], [OTHER, {}], ['null', {}], [undefined, {}]] as const) {
      const tag = `${origin}`;
      const created = await post(h, '/matches', creationBody(`c-${counter++}`), origin);
      expect([tag, created.status, corsOf(created)]).toStrictEqual([tag, 201, expected]);
      const { matchId, hostToken } = created.json() as { matchId: string; hostToken: string };
      const joined = await post(h, `/matches/${matchId}/players`, { name: 'Ana', requestId: 'j-1' }, origin);
      expect([tag, joined.status, corsOf(joined)]).toStrictEqual([tag, 201, expected]);
      // A refusal carries the same headers as a success.
      const taken = await post(h, `/matches/${matchId}/players`, { name: 'ana', requestId: 'j-2' }, origin);
      expect([tag, taken.status, corsOf(taken)]).toStrictEqual([tag, 409, expected]);
      const bad = await post(h, `/matches/${matchId}/players`, { name: '', requestId: 'j-3' }, origin);
      expect([tag, bad.status, corsOf(bad)]).toStrictEqual([tag, 400, expected]);
      const started = await post(h, `/matches/${matchId}/start`, {}, origin, hostToken);
      expect([tag, started.status, corsOf(started)]).toStrictEqual([tag, 200, expected]);
      const again = await post(h, `/matches/${matchId}/start`, {}, origin, 'wrong-token-0123456789abcdef');
      expect([tag, again.status, corsOf(again)]).toStrictEqual([tag, 403, expected]);
    }
  });

  it('a foreign page gets the same server answer but cannot read it: nothing but the absence of headers differs, and `*` is never sent on a POST', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    const mine = await post(h, `/matches/${matchId}/players`, { name: 'Ana', requestId: 'j-1' }, ALLOWED);
    const theirs = await post(h, `/matches/${matchId}/players`, { name: 'Ana', requestId: 'j-1' }, OTHER);
    expect([theirs.status, theirs.headers['access-control-allow-origin']]).toStrictEqual([201, undefined]);
    expect(mine.headers['access-control-allow-origin']).toBe(ALLOWED);
    for (const r of [mine, theirs]) expect(r.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('the credential-free GETs of the lobby, the players and the results are `*` for any origin; with a credential they follow the allowed list', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    await post(h, `/matches/${matchId}/players`, { name: 'Ana', requestId: 'j-1' }, undefined);
    for (const origin of [OTHER, ALLOWED, 'null']) {
      for (const path of [`/matches/${matchId}`, `/matches/${matchId}/players`, `/matches/${matchId}/leaderboard`, `/matches/${matchId}/players/web:x/results`]) {
        const reply = await request(h.port, { path, headers: { origin } });
        expect([origin, path, corsOf(reply)]).toStrictEqual([origin, path, ANY]);
      }
    }
    const credentialed = await request(h.port, { path: `/matches/${matchId}/players`, headers: { origin: OTHER, authorization: 'Bearer anything-0123456789abcdef' } });
    expect(corsOf(credentialed)).toStrictEqual({});
  });

  it('Retry-After is sent and exposed on the rate-limited create and join; Allow is sent on a 405, both with the headers of the origin', async () => {
    const h = await begin({ createSource: 1, joinSource: 1 });
    const { matchId } = lobbyOf(h);
    await post(h, '/matches', creationBody('c-a'), ALLOWED);
    const createLimited = await post(h, '/matches', creationBody('c-b'), ALLOWED);
    expect([createLimited.status, createLimited.headers['retry-after'], corsOf(createLimited)]).toStrictEqual([429, '60', ECHO]);
    await post(h, `/matches/${matchId}/players`, { name: 'Ana', requestId: 'j-1' }, ALLOWED);
    const joinLimited = await post(h, `/matches/${matchId}/players`, { name: 'Bea', requestId: 'j-2' }, ALLOWED);
    expect([joinLimited.status, joinLimited.headers['retry-after'], corsOf(joinLimited)]).toStrictEqual([429, '60', ECHO]);
    const foreign = await post(h, `/matches/${matchId}/players`, { name: 'Bea', requestId: 'j-2' }, OTHER);
    expect([foreign.status, corsOf(foreign)]).toStrictEqual([429, {}]);
    for (const [path, allow] of [[`/matches/${matchId}/start`, 'OPTIONS, POST'], [`/matches/${matchId}/players`, 'GET, OPTIONS, POST']] as const) {
      const refused = await request(h.port, { method: 'DELETE', path, headers: { origin: ALLOWED } });
      expect([path, refused.status, refused.headers.allow, corsOf(refused)]).toStrictEqual([path, 405, allow, ECHO]);
    }
    const getStart = await request(h.port, { path: `/matches/${matchId}/start` });
    expect([getStart.status, getStart.headers.allow]).toStrictEqual([405, 'OPTIONS, POST']);
  });
});

describe('http cors on the public paths: preflight', () => {
  it('the preflight of a POST to create, join or start is answered for an allowed origin only, with the Authorization header listed as in 008', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    for (const path of ['/matches', `/matches/${matchId}/players`, `/matches/${matchId}/start`]) {
      for (const headers of [undefined, 'content-type', 'authorization,content-type'] as const) {
        const allowed = await preflight(h, path, ALLOWED, 'POST', headers);
        expect([path, headers, allowed.status, allowed.text, corsOf(allowed)]).toStrictEqual([path, headers, 204, '', PREFLIGHT_POST]);
        for (const origin of [OTHER, 'null', 'https://APP.example']) {
          const other = await preflight(h, path, origin, 'POST', headers);
          expect([path, origin, other.status, corsOf(other)]).toStrictEqual([path, origin, 204, {}]);
        }
      }
    }
  });

  it('the preflight of a GET of the players list is `*` for any origin and, listing authorization, only for the allowed one', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    const path = `/matches/${matchId}/players`;
    for (const origin of [OTHER, ALLOWED]) expect(corsOf(await preflight(h, path, origin, 'GET'))).toStrictEqual(PREFLIGHT_PUBLIC);
    expect(corsOf(await preflight(h, path, ALLOWED, 'GET', 'authorization'))).toStrictEqual(PREFLIGHT_POST);
    expect(corsOf(await preflight(h, path, OTHER, 'GET', 'authorization'))).toStrictEqual({});
    // The start path asked for GET is classified by the method asked, like every other path.
    expect(corsOf(await preflight(h, `/matches/${matchId}/start`, OTHER, 'GET'))).toStrictEqual(PREFLIGHT_PUBLIC);
  });
});
