import { encodeError, encodePage, encodePlayerListItem, errorReply } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { credentialDigest } from '../src/service/ids';
import { StoreError } from '../src/store/store';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';
import { creationBody } from './helpers/service-harness';

// The players list over a real listener (spec 011 M4 T6): GET /matches/:id/players, credential-free, paged like the other lists.

afterEach(closeAllServers);

const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 10 } as const;

const begin = (options: ServerHarnessOptions = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    ...options,
    service: { publicCreation: PUBLIC, ...(options.service ?? {}) },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, joinSource: 100_000, joinMatch: 100_000, ...(options.limits ?? {}) },
  });
const lobbyOf = (h: ServerHarness): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
  if (!out.ok) throw new Error('public creation failed');
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};
const joinAll = (h: ServerHarness, matchId: string, names: readonly string[]): { playerId: string; name: string; playerToken: string }[] =>
  names.map((name, i) => {
    const out = h.service.join({ source: 'src-a', matchId, body: { name, requestId: `j-${i}` } });
    if (!out.ok) throw new Error('join failed');
    return out.reply;
  });
const list = (h: ServerHarness, matchId: string, query = '', headers: Record<string, string> = {}): Promise<ClientReply> =>
  request(h.port, { path: `/matches/${matchId}/players${query}`, headers });
const itemsOf = (reply: ClientReply): { playerId: string; name: string; joinedSeq: number }[] => (reply.json() as { items: never }).items;

describe('http players list: the items', () => {
  it('FR-385 the list answers 200 with exactly the protocol bytes: id, name and join order, in join order, nothing else', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    const joined = joinAll(h, matchId, ['Zed', 'Amy', 'Bob']);
    const reply = await list(h, matchId);
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('application/json');
    const items = itemsOf(reply);
    // Join order, not name order: the first to join is first.
    expect(items.map((i) => i.name)).toStrictEqual(['Zed', 'Amy', 'Bob']);
    expect(items.map((i) => i.playerId)).toStrictEqual(joined.map((j) => j.playerId));
    expect(items.map((i) => i.joinedSeq)).toStrictEqual([2, 3, 4]);
    for (const item of items) expect(Object.keys(item)).toStrictEqual(['playerId', 'name', 'joinedSeq']);
    expect(reply.text).toBe(encodePage({ items }, encodePlayerListItem));
  });

  it('FR-385 an empty lobby is an empty page, and a started or running match lists the same players', async () => {
    const h = await begin();
    const { matchId, hostToken } = lobbyOf(h);
    expect((await list(h, matchId)).text).toBe('{"items":[]}');
    joinAll(h, matchId, ['Ana']);
    expect(h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
    expect(h.service.join({ source: 'src-b', matchId, body: { name: 'Late', requestId: 'l-1' } }).ok).toBe(true);
    const after = await list(h, matchId);
    expect(itemsOf(after).map((i) => i.name)).toStrictEqual(['Ana', 'Late']);
  });

  it('FR-385 the list exposes no token, no digest, no prediction and no count of predictions', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    const joined = joinAll(h, matchId, ['Ana', 'Bea']);
    const reply = await list(h, matchId);
    for (const j of joined) {
      expect(reply.text).not.toContain(j.playerToken);
      expect(reply.text).not.toContain(credentialDigest(j.playerToken));
    }
    expect(reply.text).not.toMatch(/token|digest|prediction|kind|round|faction|victim|winner|score/i);
    // A reader with any Bearer text sees the same bytes: the route asks for no credential.
    const withBearer = await list(h, matchId, '', { authorization: `Bearer ${CLIENT_CREDENTIAL}` });
    const withWrong = await list(h, matchId, '', { authorization: 'Bearer wrong-credential-0123456789abcdef' });
    expect([withBearer.text, withWrong.text]).toStrictEqual([reply.text, reply.text]);
  });
});

describe('http players list: paging and refusals', () => {
  it('FR-385 limit and cursor page the list as the other lists: pages join up with no repeat, the last page has no next', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    const names = ['A1', 'A2', 'A3', 'A4', 'A5'];
    joinAll(h, matchId, names);
    const seen: string[] = [];
    let query = '?limit=2';
    for (let pages = 0; pages < 5; pages++) {
      const page = (await list(h, matchId, query)).json() as { items: { name: string }[]; next?: string };
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((i) => i.name));
      if (page.next === undefined) break;
      query = `?limit=2&cursor=${encodeURIComponent(page.next)}`;
    }
    expect(seen).toStrictEqual(names);
    // A page that holds everything has no next.
    const whole = (await list(h, matchId, '?limit=5')).json() as { next?: string };
    expect(whole.next).toBeUndefined();
  });

  it('FR-385 a bad limit, a repeated limit, an unknown parameter and a foreign or damaged cursor are invalid-request naming the field', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    joinAll(h, matchId, ['Ana', 'Bea', 'Cy']);
    const records = (await request(h.port, { path: `/matches/${matchId}/records?limit=1` })).json() as { next?: string };
    const players = (await list(h, matchId, '?limit=1')).json() as { next?: string };
    expect(typeof players.next).toBe('string');
    const cases: [string, string][] = [
      ['?limit=0', 'limit'],
      ['?limit=501', 'limit'],
      ['?limit=x', 'limit'],
      ['?limit=1&limit=2', 'limit'],
      ['?other=1', 'other'],
      ['?cursor=zzz', 'cursor'],
      [`?cursor=${encodeURIComponent(records.next ?? 'none')}`, 'cursor'],
    ];
    for (const [query, field] of cases) {
      const reply = await list(h, matchId, query);
      expect([query, reply.status, reply.text]).toStrictEqual([query, 400, encodeError(errorReply('invalid-request', [field]))]);
    }
    expect((await list(h, matchId, '?limit=500')).status).toBe(200);
  });

  it('FR-385 an unknown match is 404 unknown-match', async () => {
    const h = await begin();
    const reply = await list(h, 'nope');
    expect([reply.status, reply.text]).toStrictEqual([404, errorBody('unknown-match')]);
  });

  it('FR-385 a storage failure is 503 unavailable with nothing leaked, and the next read works', async () => {
    let failing = false;
    const h = await begin({
      wrapStore: (store) => ({
        ...store,
        getMatch: (id) => {
          if (failing) throw new StoreError('store-failure', 'disk /private/path SECRET-TEXT');
          return store.getMatch(id);
        },
      }),
    });
    const { matchId } = lobbyOf(h);
    failing = true;
    const reply = await list(h, matchId);
    expect([reply.status, reply.text]).toStrictEqual([503, errorBody('unavailable')]);
    expect(JSON.stringify(reply.headers)).not.toContain('SECRET-TEXT');
    failing = false;
    expect((await list(h, matchId)).status).toBe(200);
  });

  it('FR-385 a PUT is 405 with Allow GET, OPTIONS, POST (the POST is the join), and the anonymous per-minute limit counts the route', async () => {
    const h = await begin({ limits: { anonymous: 2 } });
    const { matchId } = lobbyOf(h);
    const put = await request(h.port, { method: 'PUT', path: `/matches/${matchId}/players` });
    expect([put.status, put.headers.allow]).toStrictEqual([405, 'GET, OPTIONS, POST']);
    // The 405 above was the first anonymous request; this read is the second, the next one is over the limit.
    expect((await list(h, matchId)).status).toBe(200);
    const over = await list(h, matchId);
    expect([over.status, over.headers['retry-after']]).toStrictEqual([429, '60']);
    h.clock.advance(60_000);
    expect((await list(h, matchId)).status).toBe(200);
  });
});
