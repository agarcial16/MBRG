import { encodePrediction } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { credentialDigest } from '../src/service/ids';
import { SECRETS } from './helpers/core-timelines';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { creationBody } from './helpers/service-harness';

// The player role of the pipeline (spec 011 M4 T3): a match token authenticates a prediction submission and the read of own
// predictions, for that match only and under the player's own id. The client-credential path of 008 is covered by
// http-commands and http-reads and is not changed here.

afterEach(closeAllServers);

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 48 } as const;

const start = (options: Parameters<typeof startServer>[0] = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    service: { publicCreation: PUBLIC, secret: SECRETS['ascending-00-1f'] },
    ...options,
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, advances: 100_000, submissions: 100_000, ...(options.limits ?? {}) },
  });

const post = (h: ServerHarness, path: string, body: unknown, token?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path, body, headers: token === undefined ? {} : bearer(token) });
const get = (h: ServerHarness, path: string, token?: string): Promise<ClientReply> =>
  request(h.port, { path, headers: token === undefined ? {} : bearer(token) });
const kindOf = (reply: ClientReply): unknown => (reply.json() as { kind?: unknown }).kind;

interface Player {
  readonly playerId: string;
  readonly local: string;
  readonly token: string;
}

/** A public match (service level, then over HTTP) with the named players, started: phase 1 of round 1. */
function runningMatch(h: ServerHarness, names: readonly string[], requestId = 'c-1'): { matchId: string; players: Player[] } {
  const made = h.service.createPublic({ source: 'src-host', body: creationBody(requestId) });
  if (!made.ok) throw new Error('public creation failed');
  const { matchId, hostToken } = made.reply;
  const players = names.map((name): Player => {
    const joined = h.service.join({ source: `src-${name}`, matchId, body: { name, requestId: `j-${name}` } });
    if (!joined.ok) throw new Error('join refused');
    return { playerId: joined.reply.playerId, local: joined.reply.playerId.slice('player:'.length), token: joined.reply.playerToken };
  });
  const started = h.service.startMatch({ credential: hostToken, matchId, body: {} });
  if (!started.ok) throw new Error('start refused');
  return { matchId, players };
}

const living = (h: ServerHarness, id: string): number[] =>
  [...new Set(h.base.store.getMatch(id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
const winnerBody = (faction: number, playerId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ kind: 'winner', faction, playerId, ...extra });
const ownItems = (reply: ClientReply): { playerId: string }[] => (reply.json() as { items: { playerId: string }[] }).items;

describe('http player token: submissions', () => {
  it('FR-379 a player token submits for its own player id and the reply is byte for byte the 008 reply', async () => {
    const h = await start();
    const { matchId, players } = runningMatch(h, ['Ana']);
    const ana = players[0] as Player;
    const [a, b] = living(h, matchId) as [number, number];
    const first = await post(h, `/matches/${matchId}/predictions`, winnerBody(a, ana.local), ana.token);
    expect(first.status).toBe(200);
    expect(first.text).toBe(encodePrediction({ kind: 'winner', choice: a, version: 1 }));
    expect(h.base.store.predictionsOf(matchId, ana.playerId)).toHaveLength(1);
    // The same form as a client's reply, and an update raises the version.
    const client = await post(h, `/matches/${matchId}/predictions`, winnerBody(a, 'zed'), CLIENT_CREDENTIAL);
    expect(client.text).toBe(first.text);
    const second = await post(h, `/matches/${matchId}/predictions`, winnerBody(b, ana.local), ana.token);
    expect(second.text).toBe(encodePrediction({ kind: 'winner', choice: b, version: 2 }));
    // Nothing is stored under any other id.
    expect(h.base.store.predictionsOf(matchId, ana.local)).toStrictEqual([]);
    expect(h.base.store.predictionsOf(matchId, `web:${ana.local}`)).toStrictEqual([]);
  });

  it('FR-379 the body player id of another player, or a client-style one, is not trusted: forbidden, or invalid-player-id first', async () => {
    const h = await start();
    const { matchId, players } = runningMatch(h, ['Ana', 'Bea']);
    const [ana, bea] = players as [Player, Player];
    const [a] = living(h, matchId) as [number];
    const path = `/matches/${matchId}/predictions`;
    const other = await post(h, path, winnerBody(a, bea.local), ana.token);
    expect([other.status, other.text]).toStrictEqual([403, errorBody('forbidden')]);
    for (const playerId of ['web:ana', 'player:' + ana.local, ':x', 'a b', '']) {
      const bad = await post(h, path, winnerBody(a, playerId), ana.token);
      expect([playerId, bad.status, kindOf(bad)]).toStrictEqual([playerId, 400, 'invalid-player-id']);
    }
    // A malformed id is invalid-player-id even with no credential at all (checked first), a well-formed one is forbidden.
    expect(kindOf(await post(h, path, winnerBody(a, 'web:ana')))).toBe('invalid-player-id');
    const none = await post(h, path, winnerBody(a, ana.local));
    expect([none.status, none.text]).toStrictEqual([403, errorBody('forbidden')]);
    expect(h.base.store.predictionsOf(matchId, ana.playerId)).toStrictEqual([]);
    expect(h.base.store.predictionsOf(matchId, bea.playerId)).toStrictEqual([]);
  });

  it('FR-379 the token of match A does not work on match B, and a host token or a wrong token is forbidden on a submission', async () => {
    const h = await start();
    const one = runningMatch(h, ['Ana'], 'c-1');
    const two = runningMatch(h, ['Ana'], 'c-2');
    const [a] = living(h, two.matchId) as [number];
    const ana1 = one.players[0] as Player;
    const ana2 = two.players[0] as Player;
    const across = await post(h, `/matches/${two.matchId}/predictions`, winnerBody(a, ana1.local), ana1.token);
    expect([across.status, across.text]).toStrictEqual([403, errorBody('forbidden')]);
    expect(h.base.store.predictionsOf(two.matchId, ana1.playerId)).toStrictEqual([]);
    expect((await post(h, `/matches/${two.matchId}/predictions`, winnerBody(a, ana2.local), ana2.token)).status).toBe(200);
    // The host token of the match is a token, but not a player's.
    const made = h.service.createPublic({ source: 'src-x', body: creationBody('c-3') });
    if (!made.ok) throw new Error('creation failed');
    const host = await post(h, `/matches/${made.reply.matchId}/predictions`, winnerBody(a, 'x'), made.reply.hostToken);
    expect([host.status, host.text]).toStrictEqual([403, errorBody('forbidden')]);
    const wrong = await post(h, `/matches/${two.matchId}/predictions`, winnerBody(a, ana2.local), 'wrong-credential-0123456789abcdef');
    expect([wrong.status, wrong.text]).toStrictEqual([403, errorBody('forbidden')]);
  });

  it('FR-379 the per-player submission limit applies to a player id as to a client id, and the credential limit to the token', async () => {
    const h = await start({ limits: { submissions: 1, commands: 3 } });
    const { matchId, players } = runningMatch(h, ['Ana', 'Bea']);
    const [ana, bea] = players as [Player, Player];
    const [a] = living(h, matchId) as [number];
    const put = (p: Player): Promise<ClientReply> => post(h, `/matches/${matchId}/predictions`, winnerBody(a, p.local), p.token);
    expect((await put(ana)).status).toBe(200);
    const refused = await put(ana); // over the per-player limit: counted nowhere
    expect([refused.status, refused.headers['retry-after'], refused.json()]).toStrictEqual([429, '60', { kind: 'rate-limited', retryAfter: 60 }]);
    expect((await put(bea)).status).toBe(200); // another player has its own key and its own token bucket
    h.clock.advance(60_000);
    expect((await put(ana)).status).toBe(200);
    // A client's id with the same local text is another player, with another key.
    expect((await post(h, `/matches/${matchId}/predictions`, winnerBody(a, ana.local), CLIENT_CREDENTIAL)).status).toBe(200);
  });

  it('FR-379 the credential limit of a token is the client commands limit, counted per token', async () => {
    const h = await start({ limits: { commands: 2 } });
    const { matchId, players } = runningMatch(h, ['Ana', 'Bea']);
    const [ana, bea] = players as [Player, Player];
    const [a] = living(h, matchId) as [number];
    const put = (p: Player): Promise<ClientReply> => post(h, `/matches/${matchId}/predictions`, winnerBody(a, p.local), p.token);
    expect((await put(ana)).status).toBe(200);
    expect((await put(ana)).status).toBe(200);
    expect((await put(ana)).status).toBe(429);
    expect((await put(bea)).status).toBe(200);
  });

  it('FR-379 an advance route still takes the host token and the operator only: a player token is forbidden there', async () => {
    const h = await start();
    const made = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
    if (!made.ok) throw new Error('creation failed');
    const { matchId, hostToken } = made.reply;
    const joined = h.service.join({ source: 'src-a', matchId, body: { name: 'Ana', requestId: 'j-1' } });
    if (!joined.ok) throw new Error('join refused');
    expect(h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
    const step = { round: 1, step: 'phase-1-close' };
    const byPlayer = await post(h, `/matches/${matchId}/advance`, step, joined.reply.playerToken);
    expect([byPlayer.status, byPlayer.text]).toStrictEqual([403, errorBody('forbidden')]);
    expect((await post(h, `/matches/${matchId}/advance`, step, hostToken)).status).toBe(200);
  });
});

describe('http player token: the layers of the route', () => {
  it('FR-379 the route itself refuses another player id before the service is asked, whatever the service would accept', async () => {
    const submits: unknown[] = [];
    const h = await start({
      stub: {
        submit: (request) => {
          submits.push(request);
          return { ok: true, reply: { kind: 'winner', choice: 1, version: 1 } };
        },
      },
    });
    const { matchId, players } = runningMatch(h, ['Ana', 'Bea']);
    const [ana, bea] = players as [Player, Player];
    const refused = await post(h, `/matches/${matchId}/predictions`, winnerBody(1, bea.local), ana.token);
    expect([refused.status, refused.text]).toStrictEqual([403, errorBody('forbidden')]);
    expect(submits).toStrictEqual([]);
    // Its own id reaches the service with the resolved pair and not with the token text.
    expect((await post(h, `/matches/${matchId}/predictions`, winnerBody(1, ana.local), ana.token)).status).toBe(200);
    expect(submits).toStrictEqual([{ client: { tokenDigest: credentialDigest(ana.token), playerId: ana.playerId }, matchId, body: winnerBody(1, ana.local) }]);
  });

  it('FR-379 the lookup of a match token costs one read, only on the prediction routes, and never asks the host token there', async () => {
    const calls = { host: 0, player: 0 };
    let real: ServerHarness | undefined;
    const h = await start({
      stub: {
        hostTokenMatches: (id, token) => {
          calls.host += 1;
          return (real as ServerHarness).base.service.hostTokenMatches(id, token);
        },
        playerTokenOf: (id, token) => {
          calls.player += 1;
          return (real as ServerHarness).base.service.playerTokenOf(id, token);
        },
      },
    });
    real = h;
    const { matchId, players } = runningMatch(h, ['Ana']);
    const unknown = 'unrecognised-token-0123456789abcdef';
    const ana = players[0] as Player;
    // Reads and the match list never look a token up.
    await get(h, '/matches', unknown);
    await get(h, `/matches/${matchId}`, ana.token);
    await get(h, `/matches/${matchId}/leaderboard`, ana.token);
    expect(calls).toStrictEqual({ host: 0, player: 0 });
    // The two prediction routes: one player lookup each, no host lookup.
    await post(h, `/matches/${matchId}/predictions`, winnerBody(1, ana.local), unknown);
    expect(calls).toStrictEqual({ host: 0, player: 1 });
    await get(h, `/matches/${matchId}/predictions`, unknown);
    expect(calls).toStrictEqual({ host: 0, player: 2 });
    // The operator, a client and no token cost nothing there.
    await post(h, `/matches/${matchId}/predictions`, winnerBody(1, 'x'), CLIENT_CREDENTIAL);
    await get(h, `/matches/${matchId}/predictions`);
    expect(calls).toStrictEqual({ host: 0, player: 2 });
    // An advance asks the host token only.
    await post(h, `/matches/${matchId}/advance`, { round: 1, step: 'phase-1-close' }, unknown);
    expect(calls).toStrictEqual({ host: 1, player: 2 });
  });
});

describe('http player token: own predictions', () => {
  it('FR-379 a player token reads its own predictions only; another player id is forbidden, a malformed one invalid-player-id', async () => {
    const h = await start();
    const { matchId, players } = runningMatch(h, ['Ana', 'Bea']);
    const [ana, bea] = players as [Player, Player];
    const [a, b] = living(h, matchId) as [number, number];
    await post(h, `/matches/${matchId}/predictions`, winnerBody(a, ana.local), ana.token);
    await post(h, `/matches/${matchId}/predictions`, winnerBody(b, bea.local), bea.token);
    await post(h, `/matches/${matchId}/predictions`, winnerBody(b, 'client-one'), CLIENT_CREDENTIAL);
    const own = await get(h, `/matches/${matchId}/predictions`, ana.token);
    expect(own.status).toBe(200);
    expect(ownItems(own)).toStrictEqual([{ playerId: ana.local, kind: 'winner', choice: a, version: 1 }]);
    const named = await get(h, `/matches/${matchId}/predictions?playerId=${ana.local}`, ana.token);
    expect(named.text).toBe(own.text);
    const stolen = await get(h, `/matches/${matchId}/predictions?playerId=${bea.local}`, ana.token);
    expect([stolen.status, stolen.text]).toStrictEqual([403, errorBody('forbidden')]);
    const bad = await get(h, `/matches/${matchId}/predictions?playerId=web:ana`, ana.token);
    expect([bad.status, kindOf(bad)]).toStrictEqual([400, 'invalid-player-id']);
    // The client path is unchanged: it sees its own namespace only.
    expect(ownItems(await get(h, `/matches/${matchId}/predictions`, CLIENT_CREDENTIAL)).map((i) => i.playerId)).toStrictEqual(['client-one']);
    // Another match's token, a host token and no token are forbidden.
    const other = runningMatch(h, ['Ana'], 'c-2');
    const across = await get(h, `/matches/${matchId}/predictions`, (other.players[0] as Player).token);
    expect([across.status, across.text]).toStrictEqual([403, errorBody('forbidden')]);
    expect((await get(h, `/matches/${matchId}/predictions`)).status).toBe(403);
  });
});

describe('http player token: secrecy of the token', () => {
  it('FR-379 NFR-54 a token appears in no reply and no log line, and nothing is logged for refusals', async () => {
    const h = await start();
    const { matchId, players } = runningMatch(h, ['Ana']);
    const ana = players[0] as Player;
    const [a] = living(h, matchId) as [number];
    const replies = [
      await post(h, `/matches/${matchId}/predictions`, winnerBody(a, ana.local), ana.token),
      await post(h, `/matches/${matchId}/predictions`, winnerBody(a, 'web:x'), ana.token),
      await post(h, `/matches/${matchId}/predictions`, winnerBody(a, 'other'), ana.token),
      await get(h, `/matches/${matchId}/predictions`, ana.token),
      await get(h, `/matches/${matchId}/predictions?playerId=other`, ana.token),
      await post(h, `/matches/${matchId}/advance`, { round: 1, step: 'phase-1-close' }, ana.token),
    ];
    const digest = credentialDigest(ana.token);
    for (const reply of replies) {
      expect(reply.text).not.toContain(ana.token);
      expect(reply.text).not.toContain(digest);
      expect(JSON.stringify(reply.headers)).not.toContain(ana.token);
    }
    expect(JSON.stringify(h.logs)).not.toContain(ana.token);
    expect(h.logs).toStrictEqual([]);
  });
});
