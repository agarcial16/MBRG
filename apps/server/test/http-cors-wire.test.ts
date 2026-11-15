import { afterEach, describe, expect, it } from 'vitest';
import { head, raw, request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { bearer, get, makeMatch, startReads } from './helpers/http-reads-kit';
import { CLIENT_CREDENTIAL, closeAllServers } from './helpers/server-harness';
import { OPERATOR, creationBody } from './helpers/service-harness';

// The cross-origin headers on the wire (M3a' T3', FR-286 headers on the wire; the policy table is in http-cors.test.ts):
// `*` only for credential-free GETs and their preflights, an allowed origin (exact match) for everything else, `Vary:
// Origin` with an echoed origin, `Retry-After` exposed, the headers on every reply including errors, never
// `Access-Control-Allow-Credentials`.

afterEach(closeAllServers);

const ALLOWED = 'https://app.example';
const OTHER = 'https://evil.example';

const acao = (r: { headers: Record<string, string | string[] | undefined> }): unknown => r.headers['access-control-allow-origin'];
const corsOf = (r: ClientReply): Record<string, string | string[] | undefined> =>
  Object.fromEntries(Object.entries(r.headers).filter(([k]) => k.startsWith('access-control-') || k === 'vary'));

const ANY = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after' };
const ECHO = { 'access-control-allow-origin': ALLOWED, vary: 'Origin', 'access-control-expose-headers': 'retry-after' };
const PREFLIGHT_PUBLIC = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-max-age': '600' };
const PREFLIGHT_CREDENTIALED = {
  'access-control-allow-origin': ALLOWED,
  vary: 'Origin',
  'access-control-allow-methods': 'GET, POST',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

const preflight = (h: { port: number }, path: string, origin: string, method?: string, headers?: string): Promise<ClientReply> =>
  request(h.port, {
    method: 'OPTIONS',
    path,
    headers: { origin, ...(method === undefined ? {} : { 'access-control-request-method': method }), ...(headers === undefined ? {} : { 'access-control-request-headers': headers }) },
  });

describe('http cors on the wire: actual requests', () => {
  it('FR-286 (headers on the wire) a credential-free GET from any origin gets `*` and exposes Retry-After, with no Vary and no credentials header', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    for (const origin of [OTHER, ALLOWED, 'null']) {
      for (const path of ['/matches', `/matches/${m.id}`, `/matches/${m.id}/states/0`, `/matches/${m.id}/records`, '/maps/dev/map.json', '/maps/dev/ids.png', '/maps/dev/presentation.json']) {
        const reply = await get(h, path, { origin });
        expect([origin, path, reply.status]).toStrictEqual([origin, path, 200]);
        expect(corsOf(reply), `${origin} ${path}`).toStrictEqual(ANY);
      }
    }
  });

  it('FR-286 (headers on the wire) without an Origin header no reply carries a CORS header', async () => {
    const h = await startReads();
    for (const reply of [await get(h, '/matches'), await get(h, '/nope'), await get(h, '/maps/dev/map.json'), await request(h.port, { method: 'POST', path: '/matches', body: {} })]) {
      expect(corsOf(reply)).toStrictEqual({});
    }
  });

  it('FR-286 (headers on the wire) a request with Authorization gets the allowed origin echoed with Vary: Origin and no other origin', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    const own = `/matches/${m.id}/predictions`;
    const echoed = await get(h, own, { origin: ALLOWED, ...bearer(CLIENT_CREDENTIAL) });
    expect([echoed.status, corsOf(echoed)]).toStrictEqual([200, ECHO]);
    // A credential on a public read also makes it a credentialed request.
    const publicRead = await get(h, '/matches', { origin: ALLOWED, ...bearer(CLIENT_CREDENTIAL) });
    expect(corsOf(publicRead)).toStrictEqual(ECHO);
    for (const origin of [OTHER, 'https://APP.example', 'https://app.example:443', 'http://app.example', 'null']) {
      const reply = await get(h, own, { origin, ...bearer(CLIENT_CREDENTIAL) });
      expect([origin, reply.status, corsOf(reply)]).toStrictEqual([origin, 200, {}]);
    }
  });

  it('FR-286 (headers on the wire) a POST gets the allowed origin only, with or without Authorization; another origin gets nothing, never `*`', async () => {
    const h = await startReads();
    const created = await request(h.port, { method: 'POST', path: '/matches', body: creationBody('w-1'), headers: { origin: ALLOWED, ...bearer(OPERATOR) } });
    expect([created.status, corsOf(created)]).toStrictEqual([201, ECHO]);
    const anonymous = await request(h.port, { method: 'POST', path: '/matches', body: creationBody('w-2'), headers: { origin: ALLOWED } });
    // (Spec 011 M4 T4, NFR-75: 403 in 008; now the public path answers, and it is off in this harness: an unknown map.)
    expect([anonymous.status, corsOf(anonymous)]).toStrictEqual([404, ECHO]);
    for (const token of [undefined, OPERATOR]) {
      const other = await request(h.port, { method: 'POST', path: '/matches', body: creationBody('w-3'), headers: { origin: OTHER, ...(token === undefined ? {} : bearer(token)) } });
      expect(acao(other)).toBeUndefined();
      expect(corsOf(other)).toStrictEqual({});
    }
  });

  it('FR-286 (headers on the wire) the allowed origins come from the setting: an empty list allows no credentialed origin', async () => {
    const h = await startReads({ allowedOrigins: [] });
    const reply = await get(h, '/matches', { origin: ALLOWED, ...bearer(CLIENT_CREDENTIAL) });
    expect(corsOf(reply)).toStrictEqual({});
    expect(corsOf(await get(h, '/matches', { origin: ALLOWED }))).toStrictEqual(ANY);
    expect(corsOf(await preflight(h, '/matches', ALLOWED, 'GET', 'authorization'))).toStrictEqual({});
  });
});

describe('http cors on the wire: preflight', () => {
  it('FR-286 (headers on the wire) the preflight of a credential-free GET is `*` for any origin, 204 with no body, on a public path or the command path alike', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    for (const origin of [OTHER, ALLOWED]) {
      for (const path of ['/matches', `/matches/${m.id}`, `/matches/${m.id}/records/1`, '/maps/dev/map.json', `/matches/${m.id}/advance`]) {
        for (const [method, headers] of [['GET', undefined], ['GET', 'content-type'], [undefined, undefined]] as const) {
          const reply = await preflight(h, path, origin, method, headers);
          expect([origin, path, method, reply.status, reply.text]).toStrictEqual([origin, path, method, 204, '']);
          expect(corsOf(reply), `${origin} ${path} ${method}`).toStrictEqual(PREFLIGHT_PUBLIC);
        }
      }
    }
  });

  it('FR-286 (headers on the wire) the preflight listing authorization or asking for POST is answered only for an allowed origin', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    for (const path of ['/matches', `/matches/${m.id}/predictions`, `/matches/${m.id}/advance`, '/maps/dev/map.json']) {
      for (const [method, headers] of [['GET', 'authorization'], ['GET', 'Content-Type, Authorization'], ['POST', undefined], ['POST', 'authorization,content-type']] as const) {
        const allowed = await preflight(h, path, ALLOWED, method, headers);
        expect([path, method, headers, allowed.status]).toStrictEqual([path, method, headers, 204]);
        expect(corsOf(allowed), `${path} ${method} ${headers}`).toStrictEqual(PREFLIGHT_CREDENTIALED);
        const other = await preflight(h, path, OTHER, method, headers);
        expect([path, method, headers, other.status, corsOf(other)]).toStrictEqual([path, method, headers, 204, {}]);
      }
    }
  });

  it('FR-286 (headers on the wire) a preflight is classified by the requested method, not by the path of the route table', async () => {
    const h = await startReads();
    // `/matches` offers GET (public) and POST (command): the same path gives both answers, by the method asked.
    expect(corsOf(await preflight(h, '/matches', OTHER, 'GET'))).toStrictEqual(PREFLIGHT_PUBLIC);
    expect(corsOf(await preflight(h, '/matches', OTHER, 'POST'))).toStrictEqual({});
    expect(corsOf(await preflight(h, '/matches', ALLOWED, 'POST'))).toStrictEqual(PREFLIGHT_CREDENTIALED);
    // A read-only path asked for POST is still the credentialed class (the browser will be refused by the 405 later).
    expect(corsOf(await preflight(h, '/maps/dev/map.json', OTHER, 'POST'))).toStrictEqual({});
  });

  it('FR-286 (headers on the wire) the preflight of an unknown path is unknown-path 404 and still carries the CORS headers of its class', async () => {
    const h = await startReads();
    const reply = await preflight(h, '/nowhere', OTHER, 'GET');
    expect([reply.status, reply.json(), corsOf(reply)]).toStrictEqual([404, { kind: 'unknown-path' }, PREFLIGHT_PUBLIC]);
    const credentialed = await preflight(h, '/nowhere', ALLOWED, 'POST');
    expect([credentialed.status, corsOf(credentialed)]).toStrictEqual([404, PREFLIGHT_CREDENTIALED]);
  });

  it('FR-286 (headers on the wire) a preflight without an Origin header has no CORS headers', async () => {
    const h = await startReads();
    const reply = await request(h.port, { method: 'OPTIONS', path: '/matches', headers: { 'access-control-request-method': 'GET' } });
    expect([reply.status, corsOf(reply)]).toStrictEqual([204, {}]);
  });
});

describe('http cors on the wire: errors and limits', () => {
  it('FR-286 (headers on the wire) every error reply carries the CORS headers of its request', async () => {
    const h = await startReads({ stub: { listMatches: () => { throw new TypeError('planted'); } } });
    const m = makeMatch(h);
    const cases: [string, ClientReply, number, unknown][] = [
      ['unknown-path', await get(h, '/nowhere', { origin: OTHER }), 404, ANY],
      ['unknown-match', await get(h, '/matches/nope', { origin: OTHER }), 404, ANY],
      ['invalid-request', await get(h, `/matches/${m.id}?x=1`, { origin: OTHER }), 400, ANY],
      ['round-not-applied', await get(h, `/matches/${m.id}/states/9`, { origin: OTHER }), 404, ANY],
      ['unknown-map', await get(h, '/maps/zzz/map.json', { origin: OTHER }), 404, ANY],
      ['forbidden read', await get(h, `/matches/${m.id}/predictions`, { origin: OTHER }), 403, ANY],
      ['unexpected exception', await get(h, '/matches', { origin: OTHER }), 500, ANY],
      ['method-not-allowed', await request(h.port, { method: 'POST', path: `/matches/${m.id}/records`, body: {}, headers: { origin: ALLOWED } }), 405, ECHO],
      ['method-not-allowed other', await request(h.port, { method: 'POST', path: `/matches/${m.id}/records`, body: {}, headers: { origin: OTHER } }), 405, {}],
      ['forbidden credentialed', await get(h, `/matches/${m.id}/predictions`, { origin: ALLOWED, ...bearer('wrong-credential-0123456789abcdef') }), 403, ECHO],
      ['invalid-request body', await request(h.port, { method: 'POST', path: '/matches', body: '[]', headers: { origin: ALLOWED, ...bearer(OPERATOR) } }), 400, ECHO],
    ];
    for (const [name, reply, status, cors] of cases) {
      expect([name, reply.status, corsOf(reply)]).toStrictEqual([name, status, cors]);
    }
    // too-large (nothing of the body is read) is a reply of the same pipeline.
    const large = await raw(h.port, [head('POST', '/matches', { origin: ALLOWED, authorization: `Bearer ${OPERATOR}`, 'content-length': '5000', connection: 'close' })]);
    expect(large.status).toBe(413);
    expect(large.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(large.headers.vary).toBe('Origin');
  });

  it('FR-286 (headers on the wire) FR-299 (over HTTP) a 429 carries Retry-After, exposes it, and keeps the CORS headers of its request', async () => {
    const h = await startReads({ limits: { anonymous: 1, reads: 1 } });
    expect((await get(h, '/matches', { origin: OTHER })).status).toBe(200);
    const limited = await get(h, '/matches', { origin: OTHER });
    expect([limited.status, limited.headers['retry-after'], corsOf(limited)]).toStrictEqual([429, '60', ANY]);
    expect(limited.headers['access-control-expose-headers']).toBe('retry-after');
    // A credentialed 429 echoes the allowed origin and exposes Retry-After as well.
    expect((await get(h, '/matches', { origin: ALLOWED, ...bearer(CLIENT_CREDENTIAL) })).status).toBe(200);
    const credentialed = await get(h, '/matches', { origin: ALLOWED, ...bearer(CLIENT_CREDENTIAL) });
    expect([credentialed.status, credentialed.headers['retry-after'], corsOf(credentialed)]).toStrictEqual([429, '60', ECHO]);
    // The preflight is a read of the anonymous address bucket: it is limited too, with the same headers.
    const pre = await preflight(h, '/matches', OTHER, 'GET');
    expect([pre.status, pre.headers['retry-after']]).toStrictEqual([429, '60']);
  });

  it('FR-286 (headers on the wire) no reply of any class carries Access-Control-Allow-Credentials', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    const replies: ClientReply[] = [];
    for (const origin of [OTHER, ALLOWED]) {
      for (const token of [undefined, CLIENT_CREDENTIAL, OPERATOR]) {
        const headers = { origin, ...(token === undefined ? {} : bearer(token)) };
        replies.push(await get(h, '/matches', headers), await get(h, `/matches/${m.id}/predictions`, headers), await get(h, '/nowhere', headers));
        replies.push(await request(h.port, { method: 'POST', path: '/matches', body: creationBody(`z-${origin}-${token}`), headers }));
      }
      for (const method of ['GET', 'POST', undefined]) replies.push(await preflight(h, '/matches', origin, method, 'authorization'));
    }
    expect(replies.length).toBeGreaterThan(20);
    for (const reply of replies) expect(reply.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
