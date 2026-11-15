import { encodePublicConfig } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { publicConfigOf } from '../src/service/public-config';
import { head, raw, request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';
import { OPERATOR, creationBody } from './helpers/service-harness';

// Spec 014 T4: GET /config over a real listener (port 0, fake clock, production routes). It is a plain anonymous read: the
// pipeline gives it the response shape, CORS, the anonymous per-minute count, the 405 and the body discard.

afterEach(closeAllServers);

const DEFAULT_TEXT = '{"maps":["dev"],"minInterval":30,"maxInterval":3600,"minPhase1":10,"minPhase2":5,"maxPlayers":200,"enabled":true}';

const begin = (options: ServerHarnessOptions = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    ...options,
    service: { publicCreation: { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 10 }, ...(options.service ?? {}) },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, joinSource: 100_000, joinMatch: 100_000, ...(options.limits ?? {}) },
  });
const config = (h: ServerHarness, path = '/config', headers: Record<string, string> = {}): Promise<ClientReply> => request(h.port, { path, headers });
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
const withoutVolatile = (headers: ClientReply['headers']): Record<string, unknown> => {
  const { date: _date, 'content-length': _length, ...rest } = headers;
  return rest;
};

describe('GET /config: the reply', () => {
  it('FR-413 the read answers 200 application/json with the protocol bytes of the settings, and the literal text of the defaults', async () => {
    const h = await begin();
    const reply = await config(h);
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('application/json');
    expect(reply.text).toBe(DEFAULT_TEXT);
    expect(reply.text).toBe(encodePublicConfig(publicConfigOf(h.settings)));
  });

  it('FR-413 the body follows the settings: several maps in the operator order, other bounds, a disabled config keeps the bounds', async () => {
    const many = await begin({
      service: { publicCreation: { maps: ['zeta', 'dev', 'alpha'], minInterval: 61, maxInterval: 7000, minPhase1: 12, minPhase2: 8 }, maxPlayers: 33 },
    });
    expect((await config(many)).text).toBe('{"maps":["zeta","dev","alpha"],"minInterval":61,"maxInterval":7000,"minPhase1":12,"minPhase2":8,"maxPlayers":33,"enabled":true}');
    const off = await begin({ service: { publicCreation: { maps: [] } } });
    expect((await config(off)).text).toBe('{"maps":[],"minInterval":30,"maxInterval":3600,"minPhase1":10,"minPhase2":5,"maxPlayers":200,"enabled":false}');
  });

  it('FR-413 FR-418 Content-Length matches the bytes and the header set is the one of GET /matches/:id/players', async () => {
    const h = await begin();
    const created = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
    if (!created.ok) throw new Error('public creation failed');
    const reply = await config(h);
    expect(reply.headers['content-length']).toBe(String(Buffer.byteLength(reply.text)));
    const players = await request(h.port, { path: `/matches/${created.reply.matchId}/players` });
    expect(players.status).toBe(200);
    expect(Object.keys(reply.headers).sort()).toStrictEqual(Object.keys(players.headers).sort());
    expect(withoutVolatile(reply.headers)).toStrictEqual(withoutVolatile(players.headers));
  });

  it('FR-418 a credential-free read from any origin carries Access-Control-Allow-Origin * and exposes Retry-After', async () => {
    const h = await begin();
    for (const origin of ['https://app.example', 'https://evil.example', 'null']) {
      const reply = await config(h, '/config', { origin });
      expect([origin, reply.status, reply.headers['access-control-allow-origin'], reply.headers['access-control-expose-headers']]).toStrictEqual([origin, 200, '*', 'retry-after']);
      expect(reply.headers.vary).toBeUndefined();
    }
    expect((await config(h)).headers['access-control-allow-origin']).toBeUndefined();
  });

  it('FR-418 the CORS headers of the read are those of GET /matches (the same pipeline rule), error replies included', async () => {
    const h = await begin();
    const cors = (r: ClientReply): Record<string, unknown> => Object.fromEntries(Object.entries(r.headers).filter(([k]) => k.startsWith('access-control-') || k === 'vary'));
    const origin = { origin: 'https://evil.example' };
    expect(cors(await config(h, '/config', origin))).toStrictEqual(cors(await config(h, '/matches', origin)));
    expect(cors(await config(h, '/config?a=1', origin))).toStrictEqual(cors(await config(h, '/matches?limit=0', origin)));
    expect(cors(await request(h.port, { method: 'POST', path: '/config', headers: origin }))).toStrictEqual({});
  });
});

describe('GET /config: query, methods and paths', () => {
  it('FR-418 a query string is refused with invalid-request naming the parameter; with several, the first in sorted order', async () => {
    const h = await begin();
    const one = await config(h, '/config?a=1');
    expect([one.status, one.json()]).toStrictEqual([400, { kind: 'invalid-request', items: ['a'] }]);
    const several = await config(h, '/config?zeta=1&beta=2&mid=3');
    expect([several.status, several.json()]).toStrictEqual([400, { kind: 'invalid-request', items: ['beta'] }]);
    const limit = await config(h, '/config?limit=5');
    expect(limit.json()).toStrictEqual({ kind: 'invalid-request', items: ['limit'] });
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('FR-419 %s is 405 method-not-allowed with Allow GET, OPTIONS', async (method) => {
    const h = await begin();
    const reply = await request(h.port, { method, path: '/config', body: method === 'DELETE' ? undefined : {} });
    expect([reply.status, reply.headers.allow, reply.text]).toStrictEqual([405, 'GET, OPTIONS', errorBody('method-not-allowed')]);
  });

  it('FR-419 HEAD and OPTIONS are handled as for the other reads (HEAD is not offered; a preflight is answered the same way)', async () => {
    const h = await begin();
    const headConfig = await request(h.port, { method: 'HEAD', path: '/config' });
    const headList = await request(h.port, { method: 'HEAD', path: '/matches' });
    expect([headConfig.status, headConfig.headers.allow]).toStrictEqual([405, 'GET, OPTIONS']);
    expect(headList.status).toBe(headConfig.status);
    const preflight = { origin: 'https://evil.example', 'access-control-request-method': 'GET' };
    const optConfig = await request(h.port, { method: 'OPTIONS', path: '/config', headers: preflight });
    const optList = await request(h.port, { method: 'OPTIONS', path: '/matches', headers: preflight });
    expect(optConfig.status).toBe(optList.status);
    expect(withoutVolatile(optConfig.headers)).toStrictEqual(withoutVolatile(optList.headers));
    expect(optConfig.text).toBe(optList.text);
    const plain = await request(h.port, { method: 'OPTIONS', path: '/config' });
    const plainList = await request(h.port, { method: 'OPTIONS', path: '/matches' });
    expect([plain.status, plain.text]).toStrictEqual([plainList.status, plainList.text]);
  });

  it('FR-413 a trailing slash and another case are unknown-path', async () => {
    const h = await begin();
    for (const path of ['/config/', '/Config', '/CONFIG', '//config', '/config//', '/public-config', '/conf%69g']) {
      const reply = await config(h, path);
      expect([path, reply.status, reply.text]).toStrictEqual([path, 404, errorBody('unknown-path')]);
    }
  });
});

describe('GET /config: the anonymous limit', () => {
  it('FR-418 the anonymous per-minute count is shared with the other anonymous reads: limit requests are 200 and the next is 429 with Retry-After', async () => {
    const limit = 4;
    const h = await begin({ limits: { anonymous: limit } });
    const statuses: number[] = [];
    for (const path of ['/config', '/matches', '/config', '/matches']) statuses.push((await config(h, path)).status);
    expect(statuses).toStrictEqual([200, 200, 200, 200]);
    const over = await config(h);
    expect([over.status, over.headers['retry-after'], over.json()]).toStrictEqual([429, '60', { kind: 'rate-limited', retryAfter: 60 }]);
    h.clock.advance(60_000);
    expect((await config(h)).status).toBe(200);
  });

  it('FR-418 limit - 1, limit and limit + 1 reads of the config give 200, 200 and 429, and another read is refused too', async () => {
    const limit = 3;
    const h = await begin({ limits: { anonymous: limit } });
    const statuses: number[] = [];
    for (let i = 0; i < limit + 1; i += 1) statuses.push((await config(h)).status);
    expect(statuses).toStrictEqual([200, 200, 200, 429]);
    expect((await config(h, '/matches')).status).toBe(429);
  });

  it('FR-418 a refused read (400 query, 405) is counted like any other anonymous request', async () => {
    const h = await begin({ limits: { anonymous: 2 } });
    expect((await config(h, '/config?a=1')).status).toBe(400);
    expect((await request(h.port, { method: 'POST', path: '/config', body: {} })).status).toBe(405);
    expect((await config(h)).status).toBe(429);
  });

  it('FR-418 a client credential has its own read bucket, apart from the anonymous address bucket', async () => {
    const h = await begin({ limits: { anonymous: 1, reads: 2 } });
    expect((await config(h, '/config', bearer(CLIENT_CREDENTIAL))).status).toBe(200);
    expect((await config(h, '/config', bearer(CLIENT_CREDENTIAL))).status).toBe(200);
    expect((await config(h, '/config', bearer(CLIENT_CREDENTIAL))).status).toBe(429);
    expect((await config(h)).status).toBe(200);
    expect((await config(h)).status).toBe(429);
  });
});

describe('GET /config: body and caller', () => {
  it('FR-418 a small body on a GET is discarded and the read is answered; a body over 4,096 bytes is 413 too-large', async () => {
    const h = await begin();
    const small = await raw(h.port, [head('GET', '/config', { 'content-length': '5', connection: 'close' }), 'hello']);
    expect([small.status, small.body]).toStrictEqual([200, DEFAULT_TEXT]);
    const big = await raw(h.port, [head('GET', '/config', { 'content-length': '5000' })]);
    expect([big.status, big.body]).toStrictEqual([413, errorBody('too-large')]);
    const json = await request(h.port, { path: '/config', body: '{"maps":["x"]}', headers: { 'content-type': 'application/json' } });
    expect([json.status, json.text]).toStrictEqual([200, DEFAULT_TEXT]);
  });

  it('FR-413 FR-418 a client, the operator, a wrong Bearer and a player token get the same bytes as no credential', async () => {
    const h = await begin();
    const created = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
    if (!created.ok) throw new Error('public creation failed');
    const joined = h.service.join({ source: 'src-a', matchId: created.reply.matchId, body: { name: 'Ana', requestId: 'j-1' } });
    if (!joined.ok) throw new Error('join failed');
    const plain = await config(h);
    for (const token of [CLIENT_CREDENTIAL, OPERATOR, 'wrong-credential-0123456789abcdef', joined.reply.playerToken, created.reply.hostToken, 'x']) {
      const reply = await config(h, '/config', bearer(token));
      expect([token, reply.status, reply.text]).toStrictEqual([token, 200, plain.text]);
      expect(reply.headers['content-type']).toBe('application/json');
    }
    const malformed = await config(h, '/config', { authorization: 'Basic abc' });
    expect([malformed.status, malformed.text]).toStrictEqual([200, plain.text]);
  });
});
