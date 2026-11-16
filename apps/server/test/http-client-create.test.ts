import { encodeCreation } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';
import { OPERATOR, START_MS, creationBody } from './helpers/service-harness';

// Spec 018 creation over a real listener: a client credential may create a client-only match (FR-490 to FR-493, FR-495,
// FR-501); any other caller asking for it is refused before anything is drawn or stored.

afterEach(closeAllServers);

const OTHER_CREDENTIAL = 'client-credential-tg-0123456789abcd';
const CLIENTS = [
  { namespace: 'web', credential: CLIENT_CREDENTIAL },
  { namespace: 'tg', credential: OTHER_CREDENTIAL },
];
const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 10 } as const;

const start = (options: ServerHarnessOptions = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    clients: CLIENTS,
    ...options,
    service: { publicCreation: PUBLIC, ...(options.service ?? {}) },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, ...(options.limits ?? {}) },
  });
const post = (h: ServerHarness, body: unknown, token?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path: '/matches', body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
const created = (reply: ClientReply): { matchId: string; hostToken: string; match: { clientOnly?: true; stage: string } } => reply.json() as never;

/** What a refusal must leave untouched: the draws of the random source and what the store holds. */
const snapshot = (h: ServerHarness) => ({
  draws: h.base.draws.length,
  matches: h.base.store.listMatches(undefined, 100).length,
  lobbies: h.base.store.openLobbyCount(),
  oldestMemo: h.base.store.memoOldest(),
});

describe('creation with a client credential', () => {
  it('FR-491 a client credential asking for client creates a public lobby, flagged, with the namespace of its credential stored', async () => {
    const h = await start();
    const reply = await post(h, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
    expect(reply.status).toBe(201);
    const body = created(reply);
    expect(Object.keys(body).sort()).toStrictEqual(['hostToken', 'match', 'matchId']);
    expect(body.match).toMatchObject({ stage: 'lobby', clientOnly: true });
    expect(reply.text).toBe(encodeCreation({ matchId: body.matchId, match: body.match as never, hostToken: body.hostToken }));
    expect(h.base.store.getClientNamespace(body.matchId)).toBe('web');
    expect(h.base.store.getLobby(body.matchId)).toMatchObject({ public: true, expiresMs: START_MS + 3_600_000 });
    // The namespace is the credential's: the other client gets its own.
    const other = created(await post(h, creationBody('c-2', { joinPolicy: 'client' }), OTHER_CREDENTIAL));
    expect(h.base.store.getClientNamespace(other.matchId)).toBe('tg');
    // The host token still starts the lobby (FR-499, checked fully in the host test).
    expect(h.service.startMatch({ credential: body.hostToken, matchId: body.matchId, body: {} }).ok).toBe(true);
  });

  it('FR-491 the public creation rules apply: a refusal of a client-only creation is the refusal of an anonymous one', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ['a map outside the public list', creationBody('c-1', { mapId: 'other' })],
      ['a manual timing', creationBody('c-1', { timing: 'manual' })],
      ['a timing under the public bounds', creationBody('c-1', { timing: { i: 1, l1: 1, l2: 1 } })],
      ['a timing over the public bounds', creationBody('c-1', { timing: { i: 99_999, l1: 30, l2: 10 } })],
    ];
    for (const [name, body] of cases) {
      const anonymous = await start();
      const client = await start();
      const expected = await post(anonymous, body);
      const got = await post(client, { ...body, joinPolicy: 'client' }, CLIENT_CREDENTIAL);
      expect(expected.status, name).toBeGreaterThanOrEqual(400);
      expect([got.status, got.text], name).toStrictEqual([expected.status, expected.text]);
      expect(snapshot(client), name).toStrictEqual(snapshot(anonymous));
      await anonymous.close();
      await client.close();
    }
  });

  it('FR-491 the open-lobby cap and the creation rate apply to client-only creations too', async () => {
    const capped = await start({ service: { publicCreation: { ...PUBLIC, maxOpenLobbies: 1 } } });
    expect((await post(capped, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL)).status).toBe(201);
    const full = await post(capped, creationBody('c-2', { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
    expect([full.status, full.text]).toStrictEqual([409, errorBody('too-many-matches')]);
    const limited = await start({ limits: { createSource: 1 } });
    expect((await post(limited, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL)).status).toBe(201);
    expect((await post(limited, creationBody('c-2', { joinPolicy: 'client' }), CLIENT_CREDENTIAL)).status).toBe(429);
  });

  it('FR-492 any caller that is not a client credential asking for client gets forbidden, and nothing is drawn or stored', async () => {
    const h = await start();
    const lobby = created(await post(h, creationBody('seed-1')));
    const joined = h.service.join({ source: 'src-j', matchId: lobby.matchId, body: { name: 'Ana', requestId: 'j-1' } });
    if (!joined.ok) throw new Error('join failed');
    const before = snapshot(h);
    const callers: [string, string | undefined][] = [
      ['anonymous', undefined],
      ['a host token', lobby.hostToken],
      ['a player token', joined.reply.playerToken],
      ['an unknown token', 'unknown-token-0123456789abcdef'],
      ['a malformed credential', 'x'],
    ];
    for (const [name, token] of callers) {
      const reply = await post(h, creationBody(`r-${name.length}`, { joinPolicy: 'client' }), token);
      expect([reply.status, reply.text], name).toStrictEqual([403, errorBody('forbidden')]);
    }
    expect(snapshot(h)).toStrictEqual(before);
  });

  it('FR-492 forbidden comes before the timing rules, and it counts against the creation limits like any refusal', async () => {
    const h = await start({ limits: { createSource: 2 } });
    const slow = creationBody('r-1', { joinPolicy: 'client', timing: { i: 1, l1: 1, l2: 1 } });
    expect((await post(h, slow)).text).toBe(errorBody('forbidden'));
    expect((await post(h, creationBody('r-2', { joinPolicy: 'client' }))).text).toBe(errorBody('forbidden'));
    expect((await post(h, creationBody('r-3'))).status).toBe(429);
  });

  it('FR-490 joinPolicy open is accepted from any caller and gives the very reply of a creation without the member', async () => {
    for (const token of [undefined, CLIENT_CREDENTIAL]) {
      const without = await start();
      const open = await start();
      const a = await post(without, creationBody('c-1'), token);
      const b = await post(open, creationBody('c-1', { joinPolicy: 'open' }), token);
      expect(a.status).toBe(201);
      expect([b.status, b.text]).toStrictEqual([a.status, a.text]);
      expect(open.base.store.getClientNamespace(created(b).matchId)).toBeUndefined();
      expect('clientOnly' in created(b).match).toBe(false);
    }
  });

  it('FR-490 a client creation without the member is the open public match of 011, byte for byte', async () => {
    const anonymous = await start();
    const client = await start();
    const a = await post(anonymous, creationBody('c-1'));
    const b = await post(client, creationBody('c-1'), CLIENT_CREDENTIAL);
    expect([b.status, b.text]).toStrictEqual([a.status, a.text]);
    expect(client.base.store.getClientNamespace(created(b).matchId)).toBeUndefined();
  });

  it('FR-490 every other joinPolicy is invalid-request naming joinPolicy, and so is a body member that would name a namespace', async () => {
    const h = await start();
    for (const bad of ['Client', 'operator', '', 5, null, true, ['client'], {}]) {
      const reply = await post(h, creationBody('c-1', { joinPolicy: bad }), CLIENT_CREDENTIAL);
      expect([reply.status, (reply.json() as { kind: string; items: string[] }).kind, (reply.json() as { items: string[] }).items], JSON.stringify(bad)).toStrictEqual([400, 'invalid-request', ['joinPolicy']]);
    }
    const named = await post(h, creationBody('c-1', { joinPolicy: 'client', namespace: 'tg' }), CLIENT_CREDENTIAL);
    expect([named.status, (named.json() as { items: string[] }).items]).toStrictEqual([400, ['namespace']]);
    expect(h.base.store.listMatches(undefined, 10)).toStrictEqual([]);
  });

  it('FR-490 a raw body that repeats the joinPolicy member is invalid-request naming joinPolicy, for every caller', async () => {
    const h = await start();
    const text = '{"mapId":"dev","timing":{"i":120,"l1":30,"l2":10},"requestId":"c-1","joinPolicy":"open","joinPolicy":"client"}';
    for (const token of [undefined, CLIENT_CREDENTIAL]) {
      const reply = await request(h.port, { method: 'POST', path: '/matches', body: text, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
      expect([reply.status, (reply.json() as { items: string[] }).items]).toStrictEqual([400, ['joinPolicy']]);
    }
    // A joinPolicy text inside another member, or a value, is not a repeated member.
    const inner = '{"mapId":"dev","timing":{"i":120,"l1":30,"l2":10},"requestId":"joinPolicy","joinPolicy":"open"}';
    expect((await request(h.port, { method: 'POST', path: '/matches', body: inner })).status).toBe(201);
    expect(h.base.store.listMatches(undefined, 10)).toHaveLength(1);
  });

  it('FR-491 a failure of the client row leaves no match, no lobby and no memo', async () => {
    // Writes of one creation: the match (1), the lobby (2), the client row (3): the third write fails.
    const h = await start({ faults: { failWrite: { transaction: 1, afterWrites: 2 } } });
    const reply = await post(h, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
    expect(reply.status).toBe(503);
    expect(h.base.store.listMatches(undefined, 10)).toStrictEqual([]);
    expect(h.base.store.openLobbyCount()).toBe(0);
    expect(h.base.store.memoOldest()).toBeUndefined();
  });
});

describe('the operator path and the request ids of client creations', () => {
  it('FR-493 the operator credential with any joinPolicy is invalid-request naming joinPolicy; without it the 008 creation is unchanged', async () => {
    const h = await start();
    for (const joinPolicy of ['open', 'client']) {
      const reply = await post(h, creationBody(`o-${joinPolicy}`, { joinPolicy }), OPERATOR);
      expect([reply.status, (reply.json() as { kind: string; items: string[] }).kind, (reply.json() as { items: string[] }).items]).toStrictEqual([400, 'invalid-request', ['joinPolicy']]);
    }
    expect(h.base.store.listMatches(undefined, 10)).toStrictEqual([]);
    const plain = await post(h, creationBody('o-1'), OPERATOR);
    expect(plain.status).toBe(201);
    expect(created(plain).match.stage).toBe('phase-1');
    expect('clientOnly' in created(plain).match).toBe(false);
    expect(h.base.store.getClientNamespace(created(plain).matchId)).toBeUndefined();
  });

  it('FR-495 the same request id and content from the same client replays the first reply, host token included', async () => {
    const h = await start();
    const first = await post(h, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
    const again = await post(h, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
    expect([again.status, again.text]).toStrictEqual([first.status, first.text]);
    expect(h.base.store.listMatches(undefined, 10)).toHaveLength(1);
  });

  it('FR-495 the same request id with the member added, removed or changed is request-id-reused', async () => {
    const h = await start();
    expect((await post(h, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL)).status).toBe(201);
    const changed = await post(h, creationBody('c-1', { joinPolicy: 'open' }), CLIENT_CREDENTIAL);
    expect([changed.status, changed.text]).toStrictEqual([409, errorBody('request-id-reused')]);
    const removed = await post(h, creationBody('c-1'), CLIENT_CREDENTIAL);
    expect([removed.status, removed.text]).toStrictEqual([409, errorBody('request-id-reused')]);
    // And the other way round: first without the member, then with it.
    expect((await post(h, creationBody('c-2'), CLIENT_CREDENTIAL)).status).toBe(201);
    const added = await post(h, creationBody('c-2', { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
    expect([added.status, added.text]).toStrictEqual([409, errorBody('request-id-reused')]);
    expect(h.base.store.listMatches(undefined, 10)).toHaveLength(2);
  });

  it('FR-495 a second client behind the same source never receives the host token of the first one', async () => {
    const h = await start();
    const first = await post(h, creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
    const second = await post(h, creationBody('c-1', { joinPolicy: 'client' }), OTHER_CREDENTIAL);
    expect([second.status, second.text]).toStrictEqual([409, errorBody('request-id-reused')]);
    expect(second.text).not.toContain(created(first).hostToken);
    // The anonymous replay of the same text is refused before the memo.
    const anonymous = await post(h, creationBody('c-1', { joinPolicy: 'client' }));
    expect(anonymous.text).toBe(errorBody('forbidden'));
  });
});
