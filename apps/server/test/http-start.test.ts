import { encodeError, encodePublicMatch, errorReply } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { request, raw, head } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, START_MS, creationBody } from './helpers/service-harness';

// Starting a lobby over a real listener (spec 011 M4 T5): POST /matches/:id/start with the host token of the match. Nobody else
// starts it: not the operator credential, not a player, not a client.

afterEach(closeAllServers);

const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 10 } as const;

const begin = (options: Parameters<typeof startServer>[0] = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    service: { publicCreation: PUBLIC },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000 },
    ...options,
  });
const lobbyOf = (h: ServerHarness, requestId = 'c-1', extra: Record<string, unknown> = {}): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody(requestId, extra) });
  if (!out.ok) throw new Error('public creation failed');
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};
const startOf = (h: ServerHarness, matchId: string, token?: string, body: unknown = {}): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path: `/matches/${matchId}/start`, body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
const kindOf = (reply: ClientReply): unknown => (reply.json() as { kind?: unknown }).kind;

describe('http start: the host token', () => {
  it('the host token starts the lobby: 200 with the public data in phase-1, the start instant as the clock origin', async () => {
    const h = await begin();
    const { matchId, hostToken } = lobbyOf(h);
    h.clock.advance(5_000);
    const reply = await startOf(h, matchId, hostToken);
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('application/json');
    const body = reply.json() as { stage: string; matchId: string };
    expect(body).toMatchObject({ matchId, stage: 'phase-1' });
    expect(reply.text).toBe(encodePublicMatch(body as never));
    expect(h.base.store.getMatch(matchId)!.match.stage).toBe('phase-1');
    expect(h.base.store.getMatch(matchId)!.match.lastStepMs).toBe(START_MS + 5_000);
    // The public read answers the same bytes.
    expect((await request(h.port, { path: `/matches/${matchId}` })).text).toBe(reply.text);
  });

  it('an operator-created match is already running: its host token gets match-started 409', async () => {
    const h = await begin();
    const made = h.service.create({ credential: OPERATOR, body: creationBody('c-m', { timing: 'manual' }) });
    if (!made.ok) throw new Error('creation failed');
    const reply = await startOf(h, made.reply.matchId, made.reply.hostToken);
    expect([reply.status, kindOf(reply)]).toStrictEqual([409, 'match-started']);
  });

  it('a second start with the same request id replays the first reply; without an id or with another one it is match-started 409', async () => {
    const h = await begin();
    const { matchId, hostToken } = lobbyOf(h);
    const first = await startOf(h, matchId, hostToken, { requestId: 's-1' });
    const replay = await startOf(h, matchId, hostToken, { requestId: 's-1' });
    expect([replay.status, replay.text]).toStrictEqual([200, first.text]);
    for (const body of [{}, { requestId: 's-2' }]) {
      const again = await startOf(h, matchId, hostToken, body);
      expect([again.status, again.text]).toStrictEqual([409, errorBody('match-started')]);
    }
    expect(h.base.store.getMatch(matchId)!.match.lastSeq).toBe(2);
  });

  it('an expired lobby is match-expired 409, even before the wake-up ran', async () => {
    const h = await begin();
    const { matchId, hostToken } = lobbyOf(h);
    h.clock.set(START_MS + 3_600_000);
    const reply = await startOf(h, matchId, hostToken);
    expect([reply.status, reply.text]).toStrictEqual([409, errorBody('match-expired')]);
    expect(h.base.store.getMatch(matchId)!.match.stage).not.toBe('phase-1');
  });
});

describe('http start: nobody else starts a lobby', () => {
  it('a missing, wrong, other-match host, player, client and operator credential is 403 forbidden and starts nothing', async () => {
    const h = await begin();
    const { matchId, hostToken } = lobbyOf(h, 'c-1');
    const other = lobbyOf(h, 'c-2');
    const joined = h.service.join({ source: 'src-a', matchId, body: { name: 'Ana', requestId: 'j-1' } });
    if (!joined.ok) throw new Error('join failed');
    const tokens: [string, string | undefined][] = [
      ['missing', undefined],
      ['wrong', 'wrong-credential-0123456789abcdef'],
      ['host of another match', other.hostToken],
      ['player', joined.reply.playerToken],
      ['client', CLIENT_CREDENTIAL],
      ['operator', OPERATOR],
    ];
    for (const [label, token] of tokens) {
      const reply = await startOf(h, matchId, token);
      expect([label, reply.status, reply.text]).toStrictEqual([label, 403, errorBody('forbidden')]);
    }
    expect(h.base.store.getMatch(matchId)!.match.stage).toBe('lobby');
    expect((await startOf(h, matchId, hostToken)).status).toBe(200);
  });

  it('an unknown match has no host: the answer is 403 forbidden, the same as a wrong token (FR-301 order), never 404', async () => {
    const h = await begin();
    const reply = await startOf(h, 'nope', 'wrong-credential-0123456789abcdef');
    expect([reply.status, reply.text]).toStrictEqual([403, errorBody('forbidden')]);
  });

  it('the token never appears in a refusal; a malformed body is invalid-request before forbidden', async () => {
    const h = await begin();
    const { matchId, hostToken } = lobbyOf(h);
    const bad = await startOf(h, matchId, 'wrong-credential-0123456789abcdef', { requestId: '' });
    expect([bad.status, bad.text]).toStrictEqual([400, encodeError(errorReply('invalid-request', ['requestId']))]);
    const refused = await startOf(h, matchId, 'wrong-credential-0123456789abcdef');
    expect(refused.text).not.toContain('wrong-credential');
    expect(refused.text).not.toContain(hostToken);
  });
});

describe('http start: the advance route and the methods', () => {
  it('an advance sent to a lobby is 409 step-mismatch for the stage lobby, from the host and the operator alike', async () => {
    const h = await begin();
    const { matchId, hostToken } = lobbyOf(h);
    for (const token of [hostToken, OPERATOR]) {
      const reply = await request(h.port, {
        method: 'POST',
        path: `/matches/${matchId}/advance`,
        body: { round: 1, step: 'phase-1-close' },
        headers: { authorization: `Bearer ${token}` },
      });
      expect([reply.status, kindOf(reply)]).toStrictEqual([409, 'step-mismatch']);
    }
  });

  it('GET on the start path is 405 with Allow OPTIONS, POST; the 4,096-byte rule applies and a reply over an unread large body closes', async () => {
    const h = await begin();
    const { matchId, hostToken } = lobbyOf(h);
    const get = await request(h.port, { method: 'GET', path: `/matches/${matchId}/start` });
    expect([get.status, get.headers.allow]).toStrictEqual([405, 'OPTIONS, POST']);
    const big = await raw(h.port, [
      head('POST', `/matches/${matchId}/start`, { 'content-length': '5000', connection: 'close', authorization: `Bearer ${hostToken}` }),
      'x'.repeat(10),
    ]);
    expect([big.status, big.headers.connection]).toStrictEqual([413, 'close']);
    const chunked = await raw(h.port, [
      head('POST', `/matches/${matchId}/start`, { 'transfer-encoding': 'chunked', connection: 'close', authorization: `Bearer ${hostToken}` }),
      `1400\r\n${'x'.repeat(0x1400)}\r\n0\r\n\r\n`,
    ]);
    expect([chunked.status, chunked.headers.connection]).toStrictEqual([413, 'close']);
    expect(h.base.store.getMatch(matchId)!.match.stage).toBe('lobby');
  });
});
