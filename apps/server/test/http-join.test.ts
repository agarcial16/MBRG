import { encodeError, encodeJoinReply, encodePublicMatch, errorReply } from '@mbrg/protocol';
import type { StepKind } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { request, raw, head } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, START_MS, creationBody } from './helpers/service-harness';
import type { HarnessOptions } from './helpers/service-harness';

// Joining over a real listener (spec 011 M4 T5): anonymous POST /matches/:id/players with a name and a request id. The rates are
// in http-join-limits.test.ts. The service decides; the route only shapes the body and takes the join slots.

afterEach(closeAllServers);

const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 10 } as const;

const start = (service: Omit<HarnessOptions, 'store'> = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    service: { publicCreation: PUBLIC, ...service },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000 },
  });
const lobbyOf = (h: ServerHarness, requestId = 'c-1'): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody(requestId) });
  if (!out.ok) throw new Error('public creation failed');
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};
const join = (h: ServerHarness, matchId: string, body: unknown, headers: Record<string, string> = {}): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path: `/matches/${matchId}/players`, body, headers });
const named = (name: unknown, requestId = 'j-1'): Record<string, unknown> => ({ name, requestId });

describe('http join: the reply', () => {
  it('FR-377 a join answers 201 with exactly the join reply bytes: the token once, the name as stored, the public data with one player', async () => {
    const h = await start();
    const { matchId } = lobbyOf(h);
    const reply = await join(h, matchId, named('  José  '));
    expect(reply.status).toBe(201);
    expect(reply.headers['content-type']).toBe('application/json');
    const body = reply.json() as { playerId: string; name: string; playerToken: string; match: { stage: string; playerCount: number } };
    expect(Object.keys(body)).toStrictEqual(['playerId', 'name', 'playerToken', 'match']);
    expect(body.name).toBe('José');
    expect(body.match).toMatchObject({ stage: 'lobby', playerCount: 1 });
    expect(reply.text).toBe(encodeJoinReply(body as never));
    // The token is shown once: the public read and the players list do not carry it.
    const read = await request(h.port, { path: `/matches/${matchId}` });
    expect(read.text).not.toContain(body.playerToken);
    expect(read.text).toBe(encodePublicMatch(body.match as never));
  });

  it('FR-381 a repeated join with the same request id and content from the same source returns the first reply, token included, and joins nobody twice', async () => {
    const h = await start();
    const { matchId } = lobbyOf(h);
    const first = await join(h, matchId, named('Ana', 'r-1'));
    const again = await join(h, matchId, named('Ana', 'r-1'));
    expect([again.status, again.text]).toStrictEqual([201, first.text]);
    expect(h.base.store.playerCount(matchId)).toBe(1);
    // The same id with other content is request-id-reused and stores nothing.
    const reused = await join(h, matchId, named('Bea', 'r-1'));
    expect([reused.status, reused.text]).toStrictEqual([409, errorBody('request-id-reused')]);
    expect(h.base.store.playerCount(matchId)).toBe(1);
  });

  it('FR-381 two sources with the same request id are two joins: neither sees the other reply', async () => {
    const h = await start();
    const { matchId } = lobbyOf(h);
    const a = await join(h, matchId, named('Ana', 'r-1'));
    const b = await join(h, matchId, named('Bea', 'r-1'), { 'x-forwarded-for': '203.0.113.9' });
    // Hops are 0, so the header is ignored and both come from the same peer: the second is a reuse.
    expect(a.status).toBe(201);
    expect(b.status).toBe(409);
    const h2 = await startServer({
      routes: productionRoutes,
      trustedProxyHops: 1,
      service: { publicCreation: PUBLIC },
      limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, joinSource: 100_000, joinMatch: 100_000 },
    });
    const m = lobbyOf(h2).matchId;
    const c = await join(h2, m, named('Ana', 'r-1'), { 'x-forwarded-for': '203.0.113.1' });
    const d = await join(h2, m, named('Bea', 'r-1'), { 'x-forwarded-for': '203.0.113.2' });
    expect([c.status, d.status]).toStrictEqual([201, 201]);
    expect((c.json() as { playerId: string }).playerId).not.toBe((d.json() as { playerId: string }).playerId);
  });
});

describe('http join: the refusals', () => {
  it('a taken name is 409 name-taken, and the bytes carry no name and no token', async () => {
    const h = await start();
    const { matchId } = lobbyOf(h);
    const ok = await join(h, matchId, named('Ana', 'j-1'));
    const refused = await join(h, matchId, named('ANA', 'j-2'));
    expect([refused.status, refused.text]).toStrictEqual([409, errorBody('name-taken')]);
    expect(refused.text).not.toContain((ok.json() as { playerToken: string }).playerToken);
    expect(h.base.store.playerCount(matchId)).toBe(1);
  });

  it('a full match is 409 match-full', async () => {
    const h = await start({ maxPlayers: 1 });
    const { matchId } = lobbyOf(h);
    expect((await join(h, matchId, named('Ana', 'j-1'))).status).toBe(201);
    const refused = await join(h, matchId, named('Bea', 'j-2'));
    expect([refused.status, refused.text]).toStrictEqual([409, errorBody('match-full')]);
  });

  it('an expired lobby is 409 match-expired, a halted match 409 match-halted and a finished match 409 match-finished', async () => {
    const h = await start();
    const { matchId } = lobbyOf(h);
    h.clock.set(START_MS + 3_600_000);
    const expired = await join(h, matchId, named('Ana'));
    expect([expired.status, expired.text]).toStrictEqual([409, errorBody('match-expired')]);

    const halted = h.service.create({ credential: OPERATOR, body: creationBody('c-h', { timing: 'manual' }) });
    if (!halted.ok) throw new Error('creation failed');
    const view = h.base.store.getMatch(halted.reply.matchId)!.match;
    h.base.store.transaction(() => h.base.store.updateMatch({ ...view, stage: 'halted', haltReason: 'map-changed', anchors: null }));
    const haltedReply = await join(h, halted.reply.matchId, named('Ana'));
    expect([haltedReply.status, haltedReply.text]).toStrictEqual([409, errorBody('match-halted')]);

    const over = h.service.create({ credential: OPERATOR, body: creationBody('c-f', { timing: 'manual' }) });
    if (!over.ok) throw new Error('creation failed');
    for (let round = 1; h.base.store.getMatch(over.reply.matchId)!.match.stage !== 'finished'; round++) {
      for (const step of ['phase-1-close', 'phase-2-close', 'application'] as StepKind[]) {
        if (!h.service.advance({ credential: OPERATOR, matchId: over.reply.matchId, body: { round, step } }).ok) throw new Error('advance refused');
      }
    }
    const finished = await join(h, over.reply.matchId, named('Ana'));
    expect([finished.status, finished.text]).toStrictEqual([409, errorBody('match-finished')]);
    for (const id of [matchId, halted.reply.matchId, over.reply.matchId]) expect(h.base.store.playerCount(id)).toBe(0);
  });

  it('an unknown match is 404 unknown-match', async () => {
    const h = await start();
    const reply = await join(h, 'nope', named('Ana'));
    expect([reply.status, reply.text]).toStrictEqual([404, errorBody('unknown-match')]);
  });

  it('each edge of the name rules is 400 invalid-request naming only the field, never the text, and stores nothing', async () => {
    const h = await start();
    const { matchId } = lobbyOf(h);
    const draws = h.base.draws.length;
    const names: unknown[] = ['', '   ', 'x'.repeat(25), 'a  b', 'tab\there', 'bell\u0007', 7, null, ['Ana'], 'a'.repeat(300)];
    for (const [i, name] of names.entries()) {
      const reply = await join(h, matchId, named(name, `n-${i}`));
      expect([i, reply.status, reply.text]).toStrictEqual([i, 400, encodeError(errorReply('invalid-request', ['name']))]);
      if (typeof name === 'string' && name.trim().length > 0) expect(reply.text).not.toContain(name);
    }
    expect((await join(h, matchId, { name: 'Ana' })).text).toBe(encodeError(errorReply('invalid-request', ['requestId'])));
    expect((await join(h, matchId, { name: 'Ana', requestId: 'j-1', extra: 1 })).text).toBe(encodeError(errorReply('invalid-request', ['extra'])));
    // The edge itself: 24 characters is accepted.
    expect((await join(h, matchId, named('y'.repeat(24), 'ok-1'))).status).toBe(201);
    expect(h.base.store.playerCount(matchId)).toBe(1);
    expect(h.base.draws.length).toBe(draws + 2);
  });

  it('a storage failure is 503 unavailable and the request id stays free', async () => {
    const h = await start();
    const { matchId } = lobbyOf(h);
    const failing = await startServer({
      routes: productionRoutes,
      service: { publicCreation: PUBLIC },
      stub: { join: () => ({ ok: false, error: errorReply('unavailable') }) },
    });
    const m = lobbyOf(failing).matchId;
    const reply = await join(failing, m, named('Ana'));
    expect([reply.status, reply.text]).toStrictEqual([503, errorBody('unavailable')]);
    expect((await join(h, matchId, named('Ana'))).status).toBe(201);
  });
});

describe('http join: methods and bodies', () => {
  it('a PUT or a DELETE on the join path is 405 with Allow GET, OPTIONS, POST; a body over 4,096 bytes is 413 and closes', async () => {
    const h = await start();
    const { matchId } = lobbyOf(h);
    for (const method of ['PUT', 'DELETE']) {
      const refused = await request(h.port, { method, path: `/matches/${matchId}/players` });
      expect([method, refused.status, refused.headers.allow]).toStrictEqual([method, 405, 'GET, OPTIONS, POST']);
    }
    const big = await raw(h.port, [head('POST', `/matches/${matchId}/players`, { 'content-length': '5000', connection: 'close' }), 'x'.repeat(10)]);
    expect([big.status, big.headers.connection]).toStrictEqual([413, 'close']);
    // A body of exactly 4,096 bytes is read; it is then refused for its shape (a name over the bound), not for its size.
    const base = JSON.stringify({ name: 'Ana', requestId: 'j-1', pad: '' });
    const text = JSON.stringify({ name: 'Ana', requestId: 'j-1', pad: 'x'.repeat(4096 - Buffer.byteLength(base)) });
    expect(Buffer.byteLength(text)).toBe(4096);
    const exact = await request(h.port, { method: 'POST', path: `/matches/${matchId}/players`, body: text });
    expect([exact.status, exact.text]).toStrictEqual([400, encodeError(errorReply('invalid-request', ['pad']))]);
  });
});
