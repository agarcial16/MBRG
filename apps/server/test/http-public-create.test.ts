import { encodeCreation, encodeError, errorReply } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { credentialDigest } from '../src/service/ids';
import { SECRETS } from './helpers/core-timelines';
import { encodingsOf } from './helpers/db-scan';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, START_MS, creationBody } from './helpers/service-harness';

// Public creation over a real listener (spec 011 M4 T4): a caller without the operator credential creates a lobby with a map of
// the public list and a timing inside the public bounds. The rates are in http-public-limits.test.ts.

afterEach(closeAllServers);

const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 3 } as const;
const SECRET = SECRETS['ascending-00-1f'];

const start = (options: Parameters<typeof startServer>[0] = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    ...options,
    service: { publicCreation: PUBLIC, secret: SECRET, ...(options.service ?? {}) },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, ...(options.limits ?? {}) },
  });
const post = (h: ServerHarness, body: unknown, token?: string, headers: Record<string, string> = {}): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path: '/matches', body, headers: { ...(token === undefined ? {} : { authorization: `Bearer ${token}` }), ...headers } });
const kindOf = (reply: ClientReply): unknown => (reply.json() as { kind?: unknown }).kind;

/** What a refusal must leave untouched, from the store and the draws of the random source. */
const snapshot = (h: ServerHarness, requestIds: readonly string[], source = '127.0.0.1') => {
  const list = h.base.store.listMatches(undefined, 100);
  return {
    draws: h.base.draws.length,
    matches: list.length,
    lobbies: h.base.store.openLobbyCount(),
    running: h.base.store.runningCount(),
    memo: requestIds.map((id) => h.base.store.memoGet({ credentialDigest: credentialDigest(`public:${source}`), match: null }, id) !== undefined),
    oldestMemo: h.base.store.memoOldest(),
  };
};

describe('http public creation: the reply', () => {
  it('FR-369 an anonymous creation answers 201 with exactly the match, in stage lobby, and the host token, and nothing else secret', async () => {
    const h = await start();
    const reply = await post(h, creationBody('c-1'));
    expect(reply.status).toBe(201);
    expect(reply.headers['content-type']).toBe('application/json');
    const body = reply.json() as { matchId: string; hostToken: string; match: { stage: string; playerCount?: number; matchId: string } };
    expect(Object.keys(body).sort()).toStrictEqual(['hostToken', 'match', 'matchId']);
    expect(body.match.stage).toBe('lobby');
    expect(body.match.matchId).toBe(body.matchId);
    expect(reply.text).toBe(encodeCreation({ matchId: body.matchId, match: body.match as never, hostToken: body.hostToken }));
    expect(body.hostToken.length).toBeGreaterThanOrEqual(22);
    // No secret, seed, absorber or other data of the match: the secret is not in the bytes in any common encoding.
    for (const encoding of encodingsOf(SECRET)) {
      if (typeof encoding === 'string') expect(reply.text).not.toContain(encoding);
      else expect(Buffer.from(reply.text).includes(Buffer.from(encoding))).toBe(false);
    }
    expect(reply.text).not.toMatch(/seed|secret|absorber|victim|candidates/i);
    // The host token is the one of the stored match; the stored match is a public lobby.
    expect(h.base.store.getMatch(body.matchId)?.match.stage).toBe('lobby');
    expect(h.base.store.getLobby(body.matchId)).toMatchObject({ public: true, expiresMs: START_MS + 3_600_000 });
    expect(h.service.startMatch({ credential: body.hostToken, matchId: body.matchId, body: {} }).ok).toBe(true);
  });

  it('FR-369 the operator credential still creates a running match in phase-1 as in 008, and a repeat is a replay', async () => {
    const h = await start();
    const first = await post(h, creationBody('c-1'), OPERATOR);
    expect(first.status).toBe(201);
    const body = first.json() as { matchId: string; match: { stage: string } };
    expect(body.match.stage).toBe('phase-1');
    expect(h.base.store.getLobby(body.matchId)).toBeUndefined();
    const again = await post(h, creationBody('c-1'), OPERATOR);
    expect(again.text).toBe(first.text);
    // The operator path has no public rules: a manual timing and a map outside the public list are accepted.
    const manual = await post(h, creationBody('c-2', { timing: 'manual' }), OPERATOR);
    expect(manual.status).toBe(201);
  });

  it('FR-369 a bad credential is treated as anonymous: the public path answers it, never forbidden, so it tells nothing of credentials', async () => {
    const h = await start({ service: { publicCreation: { ...PUBLIC, maxOpenLobbies: 10 } } });
    const other = await post(h, creationBody('c-0'));
    const host = (other.json() as { hostToken: string }).hostToken;
    const credentials = [undefined, 'wrong-credential-0123456789abcdef', CLIENT_CREDENTIAL, host];
    const kinds: string[] = [];
    for (const [i, token] of credentials.entries()) {
      const reply = await post(h, creationBody(`c-${i + 1}`), token);
      expect([i, reply.status]).toStrictEqual([i, 201]);
      expect((reply.json() as { match: { stage: string } }).match.stage).toBe('lobby');
      kinds.push(Object.keys(reply.json() as object).sort().join());
    }
    expect(new Set(kinds).size).toBe(1);
    // A malformed Authorization header is no credential at all.
    const malformed = await request(h.port, { method: 'POST', path: '/matches', body: creationBody('c-9'), headers: { authorization: 'Bearer short' } });
    expect(malformed.status).toBe(201);
  });

  it('FR-369 with no public map the public path refuses every caller alike as an unknown map, and the operator still creates', async () => {
    const h = await start({ service: { publicCreation: { maps: [] } } });
    for (const token of [undefined, 'wrong-credential-0123456789abcdef', CLIENT_CREDENTIAL]) {
      const reply = await post(h, creationBody('c-1'), token);
      expect([reply.status, reply.text]).toStrictEqual([404, errorBody('unknown-map')]);
    }
    expect((await post(h, creationBody('c-2'), OPERATOR)).status).toBe(201);
  });
});

describe('http public creation: the refusals', () => {
  it('FR-369 FR-370 every refusal is the closed code at its status and creates, stores, memoises and draws nothing', async () => {
    const h = await start({ service: { publicCreation: { ...PUBLIC, maxOpenLobbies: 1 } } });
    expect((await post(h, creationBody('c-1'))).status).toBe(201);
    const ids = ['u-1', 'u-2', 'u-3', 'u-4', 'u-5', 'u-6'];
    const before = snapshot(h, ids);
    const cases: [string, unknown, number, unknown, readonly string[] | undefined][] = [
      ['unknown-map (unlisted)', creationBody('u-1', { mapId: 'nowhere' }), 404, 'unknown-map', undefined],
      ['invalid-timing (below the public bounds)', creationBody('u-2', { timing: { i: 40, l1: 8, l2: 3 } }), 422, 'invalid-timing', ['f', 'g']],
      ['invalid-timing (above the public maximum)', creationBody('u-3', { timing: { i: 3601, l1: 30, l2: 10 } }), 422, 'invalid-timing', ['h']],
      ['invalid-timing (manual)', creationBody('u-4', { timing: 'manual' }), 422, 'invalid-timing', ['manual']],
      ['invalid-request', { mapId: 'dev', timing: { i: 120, l1: 30, l2: 10 } }, 400, 'invalid-request', ['requestId']],
      ['too-many-matches (the open-lobby cap)', creationBody('u-5'), 409, 'too-many-matches', undefined],
    ];
    for (const [label, body, status, kind, items] of cases) {
      const reply = await post(h, body);
      expect([label, reply.status, kindOf(reply)]).toStrictEqual([label, status, kind]);
      expect(reply.text).toBe(items === undefined ? errorBody(kind as never) : encodeError(errorReply(kind as never, items)));
    }
    expect(snapshot(h, ids)).toStrictEqual(before);
  });

  it('FR-370 the open-lobby cap is at the cap, not above it, and an expiry opens a slot again (fake clock)', async () => {
    const h = await start({ service: { scheduler: true } });
    const make = (n: number): Promise<ClientReply> => post(h, creationBody(`c-${n}`), undefined, {});
    // The cap is 3: the lobbies at cap - 1 and at the cap are created, the next is refused.
    expect((await make(1)).status).toBe(201);
    expect((await make(2)).status).toBe(201);
    expect(h.base.store.openLobbyCount()).toBe(2);
    expect((await make(3)).status).toBe(201);
    const refused = await make(4);
    expect([refused.status, kindOf(refused)]).toStrictEqual([409, 'too-many-matches']);
    h.base.scheduler!.runTo(START_MS + 3_600_000 - 1);
    expect((await make(4)).status).toBe(409);
    h.base.scheduler!.runTo(START_MS + 3_600_000);
    expect(h.base.store.openLobbyCount()).toBe(0);
    // The refusal was not memoised: the same request id now creates.
    expect((await make(4)).status).toBe(201);
  });

  it('FR-369 a public map list of one map rejects the others, and the unlisted one answers as an unknown map', async () => {
    const h = await start({ service: { publicCreation: { maps: ['dev'] } } });
    const other = await post(h, creationBody('c-1', { mapId: 'elsewhere' }));
    expect([other.status, other.text]).toStrictEqual([404, errorBody('unknown-map')]);
    expect((await post(h, creationBody('c-2', { mapId: 'dev' }))).status).toBe(201);
  });

  it('FR-369 a manual timing is refused on the public path and accepted by the operator', async () => {
    const h = await start();
    const refused = await post(h, creationBody('c-1', { timing: 'manual' }));
    expect([refused.status, refused.json()]).toStrictEqual([422, { kind: 'invalid-timing', items: ['manual'] }]);
    expect((await post(h, creationBody('c-1', { timing: 'manual' }), OPERATOR)).status).toBe(201);
  });

  it('FR-369 a storage failure under a public creation is 503 and nothing is stored', async () => {
    const h = await start({ faults: { failTransaction: 1 } });
    const failed = await post(h, creationBody('c-1'));
    expect([failed.status, failed.text]).toStrictEqual([503, errorBody('unavailable')]);
    expect(h.base.store.listMatches(undefined, 10)).toStrictEqual([]);
    expect((await post(h, creationBody('c-1'))).status).toBe(201);
  });
});

describe('http public creation: the replay', () => {
  it('FR-369 the same source, request id and content return the first reply with its token, and another content is request-id-reused', async () => {
    const h = await start();
    const first = await post(h, creationBody('c-1'));
    h.clock.advance(5_000);
    const again = await post(h, creationBody('c-1'));
    expect(again.status).toBe(201);
    expect(again.text).toBe(first.text);
    expect(h.base.store.listMatches(undefined, 10)).toHaveLength(1);
    const reused = await post(h, creationBody('c-1', { timing: { i: 121, l1: 30, l2: 10 } }));
    expect([reused.status, kindOf(reused)]).toStrictEqual([409, 'request-id-reused']);
  });

  it('FR-369 two sources with the same request id do not see each other reply', async () => {
    const h = await start({ trustedProxyHops: 1 });
    const one = await post(h, creationBody('same'), undefined, { 'x-forwarded-for': '203.0.113.1' });
    const two = await post(h, creationBody('same'), undefined, { 'x-forwarded-for': '203.0.113.2' });
    expect([one.status, two.status]).toStrictEqual([201, 201]);
    const a = one.json() as { matchId: string; hostToken: string };
    const b = two.json() as { matchId: string; hostToken: string };
    expect(a.matchId).not.toBe(b.matchId);
    expect(a.hostToken).not.toBe(b.hostToken);
    // Each source replays its own.
    expect((await post(h, creationBody('same'), undefined, { 'x-forwarded-for': '203.0.113.1' })).text).toBe(one.text);
    expect((await post(h, creationBody('same'), undefined, { 'x-forwarded-for': '203.0.113.2' })).text).toBe(two.text);
    expect(h.base.store.listMatches(undefined, 10)).toHaveLength(2);
  });

  it('FR-369 a forged X-Forwarded-For changes nothing while no proxy hop is trusted: the same peer replays its own reply', async () => {
    const h = await start();
    const one = await post(h, creationBody('same'), undefined, { 'x-forwarded-for': '203.0.113.1' });
    const two = await post(h, creationBody('same'), undefined, { 'x-forwarded-for': '203.0.113.9' });
    expect(two.text).toBe(one.text);
    expect(h.base.store.listMatches(undefined, 10)).toHaveLength(1);
  });
});
