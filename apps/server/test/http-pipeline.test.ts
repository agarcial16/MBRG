import { afterEach, describe, expect, it } from 'vitest';
import { createRouter, parseRoundSegment } from '../src/http/router';
import type { Route } from '../src/http/router';
import { SERVER_OPTION_KEYS, addressOf } from '../src/http/server';
import { CONNECTION_OPTIONS } from '../src/service/settings';
import { raw, head, request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, PLANTED, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import { OPERATOR, creationBody } from './helpers/service-harness';

// The request pipeline over a real listener on port 0 (M3a' T2'a): the stage order of plan 18.2 in the FR-301 order, the
// router rules, the limiter on the wire with the fake clock, the unexpected exception and the platform options. The routes
// here are test routes over the real service (`testRoutes`); the command routes arrive in T2'b.

afterEach(closeAllServers);

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
const kindOf = (reply: ClientReply): unknown => (reply.json() as { kind?: unknown }).kind;
const WINNER = { kind: 'winner', faction: 1, playerId: 'alice' };

describe('http pipeline: the stage order', () => {
  it('FR-301 (order over HTTP) rate-limited comes before unknown-path and before a known route', async () => {
    const h = await startServer({ limits: { anonymous: 2 } });
    expect((await request(h.port, { path: '/nope' })).status).toBe(404);
    expect((await request(h.port, { path: '/nope' })).status).toBe(404);
    const third = await request(h.port, { path: '/nope' });
    expect(third.status).toBe(429);
    expect(third.json()).toStrictEqual({ kind: 'rate-limited', retryAfter: 60 });
    const known = await request(h.port, { path: '/ping' });
    expect(known.status).toBe(429);
  });

  it('FR-301 (order over HTTP) unknown-path comes before too-large', async () => {
    const h = await startServer();
    const reply = await raw(h.port, [head('POST', '/nope', { 'content-length': '5000', connection: 'close' })]);
    expect(reply.status).toBe(404);
    expect(JSON.parse(reply.body)).toStrictEqual({ kind: 'unknown-path' });
  });

  it('FR-301 (order over HTTP) method-not-allowed comes before too-large', async () => {
    const h = await startServer();
    const reply = await raw(h.port, [head('POST', '/read-only', { 'content-length': '5000', connection: 'close' })]);
    expect(reply.status).toBe(405);
  });

  it('FR-301 (order over HTTP) too-large comes before invalid-request, by length and when chunked', async () => {
    const h = await startServer();
    const declared = await raw(h.port, [head('POST', '/echo', { 'content-length': '5000', connection: 'close' })]);
    expect(declared.status).toBe(413);
    const junk = 'x'.repeat(5000);
    const chunked = await raw(h.port, [head('POST', '/echo', { 'transfer-encoding': 'chunked', connection: 'close' }), `${junk.length.toString(16)}\r\n${junk}\r\n0\r\n\r\n`]);
    expect(chunked.status).toBe(413);
    // The same junk within the limit is an invalid-request.
    const small = await request(h.port, { method: 'POST', path: '/echo', body: 'x'.repeat(100) });
    expect(small.status).toBe(400);
  });

  it('FR-301 (order over HTTP) invalid-request comes before invalid-player-id, and both before forbidden', async () => {
    const h = await startServer();
    const post = (body: unknown, token?: string): Promise<ClientReply> =>
      request(h.port, { method: 'POST', path: '/submit', body, headers: token === undefined ? {} : bearer(token) });
    // A structure error and a bad player id together: the structure error is named.
    const both = await post({ kind: 'bogus', faction: 1, playerId: 'discord:1' });
    expect(both.status).toBe(400);
    expect(both.json()).toStrictEqual({ kind: 'invalid-request', items: ['kind'] });
    // A good structure with a namespaced player id: invalid-player-id even without a credential.
    const player = await post({ ...WINNER, playerId: 'discord:1' });
    expect(player.status).toBe(400);
    expect(kindOf(player)).toBe('invalid-player-id');
    // A good body without a credential: forbidden; with the client credential: accepted.
    expect((await post(WINNER)).status).toBe(403);
    expect((await post(WINNER, CLIENT_CREDENTIAL)).status).toBe(200);
    // A bad structure also beats a missing credential.
    expect(kindOf(await post({ ...WINNER, faction: 'x' }))).toBe('invalid-request');
  });

  it('FR-300 (transport) a wrong, a missing and a malformed credential are forbidden with identical bytes', async () => {
    const h = await startServer();
    const advance = (headers: Record<string, string>): Promise<ClientReply> => request(h.port, { method: 'POST', path: '/advance/someid', headers });
    const missing = await advance({});
    const wrong = await advance(bearer('wrong-credential-0123456789abcdef'));
    const malformed = await advance({ authorization: 'Bearer short' });
    const basic = await advance({ authorization: `Basic ${OPERATOR}` });
    for (const reply of [missing, wrong, malformed, basic]) {
      expect(reply.status).toBe(403);
      expect(reply.text).toBe(errorBody('forbidden'));
    }
    expect((await advance(bearer(OPERATOR))).status).toBe(200);
  });

  it('FR-300 (transport) two Authorization headers are read as no credential', async () => {
    const h = await startServer();
    const two = await raw(h.port, [head('POST', '/advance/someid', { authorization: `Bearer ${OPERATOR}`, connection: 'close' }).replace('\r\n\r\n', `\r\nAuthorization: Bearer ${OPERATOR}\r\n\r\n`)]);
    expect(two.status).toBe(403);
    const one = await raw(h.port, [head('POST', '/advance/someid', { authorization: `Bearer ${OPERATOR}`, connection: 'close' })]);
    expect(one.status).toBe(200);
  });

  it('FR-300 (transport) the host token of the match authorises an advance of that match only', async () => {
    const h = await startServer();
    const made = h.service.create({ credential: OPERATOR, body: creationBody('r1') });
    if (!made.ok) throw new Error('creation failed');
    const advance = (id: string, token: string): Promise<ClientReply> => request(h.port, { method: 'POST', path: `/advance/${id}`, headers: bearer(token) });
    const asHost = await advance(made.reply.matchId, made.reply.hostToken);
    expect(asHost.status).toBe(200);
    expect(asHost.json()).toStrictEqual({ as: 'host' });
    expect((await advance('another-match', made.reply.hostToken)).status).toBe(403);
    expect((await advance(made.reply.matchId, 'not-the-host-token-0123456789')).status).toBe(403);
    expect((await advance(made.reply.matchId, OPERATOR)).json()).toStrictEqual({ as: 'operator' });
  });
});

describe('http pipeline: routing', () => {
  it('NFR-52 (network) a path that no route has is unknown-path, with trailing slash, empty segment and percent-encoding', async () => {
    const h = await startServer();
    for (const path of ['/', '/ping/', '//ping', '/pi%6Eg', '/%70ing', '/ping/extra', '/match/', '/maps/dev/other.txt', '/PING']) {
      const reply = await request(h.port, { path });
      expect([path, reply.status]).toStrictEqual([path, 404]);
      expect(reply.text).toBe(errorBody('unknown-path'));
    }
    // A query does not change the path.
    expect((await request(h.port, { path: '/ping?x=1&y=%zz' })).status).toBe(200);
    // Absolute form and asterisk form are not paths.
    expect((await raw(h.port, ['GET http://localhost/ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'])).status).toBe(404);
    expect((await raw(h.port, ['OPTIONS * HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'])).status).toBe(404);
  });

  it('NFR-52 (network) a known path with another method is method-not-allowed with Allow, HEAD included', async () => {
    const h = await startServer();
    const cases: [string, string, string][] = [
      ['POST', '/ping', 'GET, OPTIONS'],
      ['PUT', '/ping', 'GET, OPTIONS'],
      ['DELETE', '/ping', 'GET, OPTIONS'],
      ['HEAD', '/ping', 'GET, OPTIONS'],
      ['GET', '/echo', 'OPTIONS, POST'],
      ['PATCH', '/echo', 'OPTIONS, POST'],
      ['POST', '/read-only', 'GET, OPTIONS'],
    ];
    for (const [method, path, allow] of cases) {
      const reply = await request(h.port, { method, path });
      expect([method, path, reply.status]).toStrictEqual([method, path, 405]);
      expect(reply.headers.allow).toBe(allow);
      if (method !== 'HEAD') expect(reply.text).toBe(errorBody('method-not-allowed'));
      else expect(reply.text).toBe('');
    }
    // HEAD on an unknown path stays unknown-path, with no body.
    const unknown = await request(h.port, { method: 'HEAD', path: '/nope' });
    expect(unknown.status).toBe(404);
    expect(unknown.text).toBe('');
    expect(unknown.headers['content-length']).toBe(String(Buffer.byteLength(errorBody('unknown-path'))));
  });

  it('NFR-52 (network) OPTIONS on a known path is the preflight (204, no body) and on an unknown path unknown-path', async () => {
    const h = await startServer();
    const known = await request(h.port, { method: 'OPTIONS', path: '/ping' });
    expect(known.status).toBe(204);
    expect(known.text).toBe('');
    expect(known.headers['content-length']).toBeUndefined();
    expect(known.headers['cache-control']).toBe('no-store');
    expect((await request(h.port, { method: 'OPTIONS', path: '/nope' })).status).toBe(404);
  });

  it('NFR-52 (network) a path parameter is matched as text, never percent-decoded, and the service decides the match id', async () => {
    const h = await startServer();
    for (const id of ['x', '%41', 'a.b', '..', '%2e%2e', 'A'.repeat(200)]) {
      const reply = await request(h.port, { path: `/match/${id}` });
      expect([id, reply.status, kindOf(reply)]).toStrictEqual([id, 404, 'unknown-match']);
    }
    const made = h.service.create({ credential: OPERATOR, body: creationBody('r1') });
    if (!made.ok) throw new Error('creation failed');
    expect((await request(h.port, { path: `/match/${made.reply.matchId}` })).status).toBe(200);
  });

  it('FR-301 (order over HTTP) the router: file parameter, duplicate routes and the round segment rules', () => {
    const route = (method: 'GET' | 'POST', path: string): Route => ({ method, path, body: 'none', decide: () => ({ kind: 'success', status: 200, body: '{}' }) });
    const router = createRouter([route('GET', '/maps/:mapId/:file'), route('GET', '/matches/:id/states/:round'), route('POST', '/matches/:id/states/:round')]);
    expect(router.resolve('GET', '/maps/dev/map.json').kind).toBe('found');
    expect(router.resolve('GET', '/maps/dev/ids.png').kind).toBe('found');
    expect(router.resolve('GET', '/maps/dev/presentation.json').kind).toBe('found');
    expect(router.resolve('GET', '/maps/dev/other.txt').kind).toBe('unknown-path');
    expect(router.resolve('GET', '/maps/dev/map.json/').kind).toBe('unknown-path');
    const found = router.resolve('GET', '/matches/abc/states/7?limit=2');
    expect(found.kind === 'found' && { ...found.params, query: found.query }).toStrictEqual({ id: 'abc', round: '7', query: 'limit=2' });
    expect(router.resolve('DELETE', '/matches/abc/states/7')).toStrictEqual({ kind: 'method-not-allowed', allow: ['GET', 'OPTIONS', 'POST'] });
    expect(router.resolve('OPTIONS', '/maps/dev/map.json')).toStrictEqual({ kind: 'preflight', allow: ['GET', 'OPTIONS'] });
    expect(() => createRouter([route('GET', '/a/:x'), route('GET', '/a/:y')])).toThrow(RangeError);
    // The round segment: a round, past the safe range, or invalid (leading zero, sign, fraction, text).
    expect(parseRoundSegment('0')).toStrictEqual({ kind: 'round', value: 0 });
    expect(parseRoundSegment('7')).toStrictEqual({ kind: 'round', value: 7 });
    expect(parseRoundSegment('9007199254740991')).toStrictEqual({ kind: 'round', value: 9007199254740991 });
    expect(parseRoundSegment('9007199254740992')).toStrictEqual({ kind: 'beyond' });
    expect(parseRoundSegment('9'.repeat(20))).toStrictEqual({ kind: 'beyond' });
    for (const bad of ['01', '00', '-1', '+1', '1.5', '1e3', 'x', '', '1 ', '0x10', '١']) expect(parseRoundSegment(bad), bad).toStrictEqual({ kind: 'invalid' });
  });
});

describe('http pipeline: the limiter on the wire', () => {
  it('FR-299 (over HTTP) a refusal is 429 with Retry-After and retryAfter, and the clock opens the window again', async () => {
    const h = await startServer({ limits: { anonymous: 2 } });
    expect((await request(h.port, { path: '/ping' })).status).toBe(200);
    expect((await request(h.port, { path: '/ping' })).status).toBe(200);
    const refused = await request(h.port, { path: '/ping' });
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBe('60');
    expect(refused.json()).toStrictEqual({ kind: 'rate-limited', retryAfter: 60 });
    h.clock.advance(30_000);
    const later = await request(h.port, { path: '/ping' });
    expect(later.status).toBe(429);
    expect(later.headers['retry-after']).toBe('30');
    expect(later.json()).toStrictEqual({ kind: 'rate-limited', retryAfter: 30 });
    // Not even the refusals were counted: at 60 s after the two accepted requests, two more are accepted.
    h.clock.advance(30_000);
    expect((await request(h.port, { path: '/ping' })).status).toBe(200);
    expect((await request(h.port, { path: '/ping' })).status).toBe(200);
    expect((await request(h.port, { path: '/ping' })).status).toBe(429);
  });

  it('FR-299 (over HTTP) a credential has its own bucket per class, apart from the address', async () => {
    const h = await startServer({ limits: { anonymous: 1, commands: 2, reads: 3 } });
    const post = (token: string): Promise<ClientReply> => request(h.port, { method: 'POST', path: '/echo', body: {}, headers: bearer(token) });
    expect((await post(CLIENT_CREDENTIAL)).status).toBe(200);
    expect((await post(CLIENT_CREDENTIAL)).status).toBe(200);
    expect((await post(CLIENT_CREDENTIAL)).status).toBe(429);
    // The operator is another bucket; reads are another class; an anonymous request is the address bucket.
    expect((await post(OPERATOR)).status).toBe(200);
    for (let i = 0; i < 3; i += 1) expect((await request(h.port, { path: '/ping', headers: bearer(CLIENT_CREDENTIAL) })).status).toBe(200);
    expect((await request(h.port, { path: '/ping', headers: bearer(CLIENT_CREDENTIAL) })).status).toBe(429);
    expect((await request(h.port, { path: '/ping' })).status).toBe(200);
    expect((await request(h.port, { path: '/ping' })).status).toBe(429);
  });

  it('FR-299 (over HTTP) a preflight counts as a read of its credential bucket and is refused with 429 past the limit', async () => {
    const h = await startServer({ limits: { reads: 2, anonymous: 100 } });
    const preflight = (): Promise<ClientReply> => request(h.port, { method: 'OPTIONS', path: '/ping', headers: bearer(CLIENT_CREDENTIAL) });
    expect((await preflight()).status).toBe(204);
    expect((await request(h.port, { path: '/ping', headers: bearer(CLIENT_CREDENTIAL) })).status).toBe(200);
    const refused = await preflight();
    expect(refused.status).toBe(429);
    expect(refused.json()).toStrictEqual({ kind: 'rate-limited', retryAfter: 60 });
    // The anonymous bucket is untouched: a preflight without a credential is still answered.
    expect((await request(h.port, { method: 'OPTIONS', path: '/ping' })).status).toBe(204);
  });

  it('FR-299 (over HTTP) a token that matches nothing counts under the address, not under a bucket of its own', async () => {
    const h = await startServer({ limits: { anonymous: 3 } });
    for (const token of ['unknown-token-aaaaaaaaaaaaaaaa', 'unknown-token-bbbbbbbbbbbbbbbb', 'unknown-token-cccccccccccccccc']) {
      expect((await request(h.port, { path: '/ping', headers: bearer(token) })).status).toBe(200);
    }
    expect((await request(h.port, { path: '/ping', headers: bearer('unknown-token-dddddddddddddddd') })).status).toBe(429);
  });

  it('FR-299 (over HTTP) a request over the per-player limit cancels its credential ticket: it is counted nowhere', async () => {
    const h = await startServer({ limits: { commands: 3, submissions: 1 } });
    const player = (name: string): Promise<ClientReply> => request(h.port, { method: 'POST', path: `/players/${name}`, headers: bearer(CLIENT_CREDENTIAL) });
    expect((await player('alice')).status).toBe(200); // commands 1
    const refused = await player('alice'); // over the player limit: cancelled, commands stay 1
    expect(refused.status).toBe(429);
    expect(refused.json()).toStrictEqual({ kind: 'rate-limited', retryAfter: 60 });
    expect((await player('bob')).status).toBe(200); // commands 2
    expect((await player('carol')).status).toBe(200); // commands 3
    expect((await player('dave')).status).toBe(429); // the credential limit (3) is reached
  });

  it('FR-299 (over HTTP) the host token advances under its own limit, apart from the operator', async () => {
    const h = await startServer({ limits: { advances: 1 } });
    const made = h.service.create({ credential: OPERATOR, body: creationBody('r1') });
    if (!made.ok) throw new Error('creation failed');
    const advance = (token: string): Promise<ClientReply> => request(h.port, { method: 'POST', path: `/advance/${made.reply.matchId}`, headers: bearer(token) });
    expect((await advance(made.reply.hostToken)).status).toBe(200);
    expect((await advance(made.reply.hostToken)).status).toBe(429);
    expect((await advance(OPERATOR)).status).toBe(200);
  });

  it('NFR-52 (network) a socket with no remote address never shares one address key', () => {
    expect(addressOf('127.0.0.1', 1)).toBe('127.0.0.1');
    const one = addressOf(undefined, 1);
    const two = addressOf(undefined, 2);
    expect(one).not.toBe(two);
    for (const key of [one, two]) {
      expect(key).not.toBe('undefined');
      expect(key).not.toContain('address:undefined');
      expect(key).not.toBe(addressOf('127.0.0.1', 1));
    }
    expect(addressOf(undefined, 1)).toBe(one);
  });
});

describe('http pipeline: failures, headers and options', () => {
  it('NFR-54 (logs) an unexpected exception is 500 with the unavailable body and ONE closed log event with no values', async () => {
    const h = await startServer();
    const reply = await request(h.port, { path: '/boom', headers: { 'x-extra': PLANTED } });
    expect(reply.status).toBe(500);
    expect(reply.text).toBe('{"kind":"unavailable"}');
    expect(reply.text).not.toContain(PLANTED);
    expect(JSON.stringify(reply.headers)).not.toContain(PLANTED);
    expect(h.logs).toStrictEqual([{ event: 'request-failed', stage: 'decide', error: { name: 'TypeError' } }]);
    expect(JSON.stringify(h.logs)).not.toContain(PLANTED);
    expect(JSON.stringify(h.logs)).not.toContain('boom');
    // The server still serves.
    expect((await request(h.port, { path: '/ping' })).status).toBe(200);
    expect(h.logs).toHaveLength(1);
  });

  it('NFR-54 (logs) a TypeError thrown by the service (a bad namespace) is the same 500 and the same single event', async () => {
    const h = await startServer({
      stub: {
        readPublicMatch: () => {
          throw new TypeError(`namespace ${PLANTED}`);
        },
      },
    });
    const reply = await request(h.port, { path: '/match/anything' });
    expect(reply.status).toBe(500);
    expect(reply.text).toBe('{"kind":"unavailable"}');
    expect(h.logs).toStrictEqual([{ event: 'request-failed', stage: 'decide', error: { name: 'TypeError' } }]);
    expect(JSON.stringify([reply.text, h.logs])).not.toContain(PLANTED);
  });

  it('NFR-54 (logs) a log sink that throws does not stop the 500 reply, and the server still serves', async () => {
    const h = await startServer({
      onLog: () => {
        throw new Error(`sink ${PLANTED}`);
      },
    });
    const reply = await request(h.port, { path: '/boom' });
    expect(reply.status).toBe(500);
    expect(reply.text).toBe('{"kind":"unavailable"}');
    expect(reply.text).not.toContain(PLANTED);
    expect(h.logs).toHaveLength(1);
    expect((await request(h.port, { path: '/ping' })).status).toBe(200);
  });

  it('NFR-54 (logs) client errors and expected 503 are not logged per request', async () => {
    const h = await startServer({ faults: { failTransaction: 1 } });
    await request(h.port, { path: '/nope' });
    await request(h.port, { method: 'POST', path: '/echo', body: 'not json' });
    await request(h.port, { method: 'POST', path: '/advance/x' });
    const failed = await request(h.port, { method: 'POST', path: '/create', body: creationBody('r1'), headers: bearer(OPERATOR) });
    expect(failed.status).toBe(503);
    expect(failed.text).toBe(errorBody('unavailable'));
    expect(h.logs).toStrictEqual([]);
  });

  it('FR-292 (unavailable over HTTP) a storage failure under a command is 503 and nothing was stored', async () => {
    const h = await startServer({ faults: { failTransaction: 1 } });
    const failed = await request(h.port, { method: 'POST', path: '/create', body: creationBody('r1'), headers: bearer(OPERATOR) });
    expect(failed.status).toBe(503);
    const list = h.service.listMatches({ limit: 10 });
    expect(list.ok && list.reply.items).toStrictEqual([]);
    // The failure was one transaction: the retry with the same request id works.
    const retry = await request(h.port, { method: 'POST', path: '/create', body: creationBody('r1'), headers: bearer(OPERATOR) });
    expect(retry.status).toBe(200);
  });

  it('NFR-52 (network) every reply, error or not, has the fixed headers and a Content-Length that matches its body', async () => {
    const h = await startServer({ limits: { anonymous: 8 }, faults: { failTransaction: 1 } });
    const replies = [
      await request(h.port, { path: '/ping' }), // 200
      await request(h.port, { path: '/nope' }), // 404
      await request(h.port, { method: 'POST', path: '/ping' }), // 405
      await request(h.port, { method: 'POST', path: '/echo', body: 'nope' }), // 400
      await request(h.port, { method: 'POST', path: '/advance/x' }), // 403
      await request(h.port, { path: '/boom' }), // 500
      await request(h.port, { method: 'POST', path: '/create', body: creationBody('r1'), headers: bearer(OPERATOR) }), // 503
    ];
    expect(replies.map((r) => r.status)).toStrictEqual([200, 404, 405, 400, 403, 500, 503]);
    const large = await raw(h.port, [head('POST', '/echo', { 'content-length': '9999', connection: 'close' })]);
    expect(large.status).toBe(413);
    expect(large.headers.connection).toBe('close');
    for (const reply of replies) {
      expect(reply.headers['content-type']).toBe('application/json');
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
      expect(reply.headers['content-length']).toBe(String(Buffer.byteLength(reply.text)));
    }
    for (const name of ['content-type', 'cache-control', 'x-content-type-options']) expect(large.headers[name], name).toBeDefined();
    expect(large.headers['content-length']).toBe(String(Buffer.byteLength(large.body)));
    expect(large.body).toBe(errorBody('too-large'));
  });

  it('NFR-52 (network) the server options read back as in the plan, and a header block over 8,192 bytes is refused', async () => {
    const h = await startServer();
    expect(CONNECTION_OPTIONS).toStrictEqual({ maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 30_000, keepAliveTimeout: 5_000 });
    expect(h.server.headersTimeout).toBe(10_000);
    expect(h.server.requestTimeout).toBe(30_000);
    expect(h.server.keepAliveTimeout).toBe(5_000);
    const under = await raw(h.port, [head('GET', '/ping', { 'x-fill': 'a'.repeat(7000), connection: 'close' })]);
    expect(under.status).toBe(200);
    const over = await raw(h.port, [head('GET', '/ping', { 'x-fill': 'a'.repeat(9000), connection: 'close' })]);
    expect(over.status).toBe(431);
  });

  it('FR-260 (option keys) the option keys of createServer are pinned and name no seed source', () => {
    expect([...SERVER_OPTION_KEYS].sort()).toStrictEqual(['clock', 'log', 'routes', 'service', 'settings', 'streams']);
    for (const key of SERVER_OPTION_KEYS) expect(key).not.toMatch(/seed|random|secret/i);
  });
});
