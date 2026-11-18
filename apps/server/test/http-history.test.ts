import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeCursor, encodeHistoryPage, readHistoryPage } from '@mbrg/protocol';
import type { HistoryPage } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import type { Identity } from '../src/http/identity';
import type { RouteContext } from '../src/http/router';
import { openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { DISCORD, KEY_A, KEY_B, WEB, createCommunityMatch, playMatch, postHistory, runMatch, startHistory, walk } from './helpers/history-kit';
import type { Made, Player } from './helpers/history-kit';
import { get } from './helpers/http-reads-kit';
import { request } from './helpers/http-client';
import { PLANTED, closeAllServers, errorBody } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR } from './helpers/service-harness';

// Spec 024 `POST /history` over a real listener, the production routes, the real service and store: a client credential reads the
// finished matches of a community key under its namespace, in pages of 5 with the snapshot total. Matches are created over HTTP with
// the key and played through the service API (helpers/history-kit.ts). Key values are planted literals; the oracle of an entry is the
// public leaderboard read of the same match.

const dirs: string[] = [];
afterEach(async () => {
  await closeAllServers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

interface Entry {
  matchId: string;
  mapId: string;
  finishedAt: number;
  winner: number;
  playerCount: number;
  top: { playerId: string; name?: string; points: number; rank: number }[];
  more: number;
  asker?: { points: number; rank: number } | { played: false };
}
interface Page {
  items: Entry[];
  total: number;
  next?: string;
}

const ANA: Player = { client: DISCORD, local: 'u1', name: 'Ana', victim: 'right', absorber: 'right', winner: 'right' };
const BEA: Player = { client: DISCORD, local: 'u2', name: 'Bea', victim: 'right', absorber: 'wrong', winner: 'wrong' };
const CAL: Player = { client: DISCORD, local: 'u3', victim: 'wrong', absorber: 'wrong', winner: 'wrong' };
const WEBBY: Player = { client: WEB, local: 'w1', name: 'Web', victim: 'right', absorber: 'right', winner: 'right' };

const read = async (h: ServerHarness, body: unknown, client = DISCORD): Promise<{ status: number; text: string; page: Page }> => {
  const reply = await postHistory(h, client.credential, body);
  return { status: reply.status, text: reply.text, page: reply.status === 200 ? (reply.json() as Page) : { items: [], total: -1 } };
};

/** The public leaderboard of a match through the 008 read (the oracle of an entry). */
const board = async (h: ServerHarness, id: string): Promise<{ rank: number; playerId: string; total: number; name?: string }[]> =>
  ((await get(h, `/matches/${id}/leaderboard?limit=500`)).json() as { items: { rank: number; playerId: string; total: number; name?: string }[] }).items;

/** Seven finished matches of KEY_A (the first has scripted predictions), then an unrelated one of KEY_B and a web one of KEY_A. */
async function populate(h: ServerHarness): Promise<Made[]> {
  const made: Made[] = [];
  for (let i = 0; i < 7; i += 1) {
    const m = await createCommunityMatch(h, DISCORD, `a-${i}`, KEY_A);
    made.push(m);
    playMatch(h, m, i === 0 ? [ANA, BEA, CAL] : [], i === 0);
  }
  return made;
}

describe('the history read over HTTP', () => {
  it('FR-549 FR-550 (HTTP) a client credential reads pages of 5 with the total, newest finish first, and each entry is what the public leaderboard shows', async () => {
    const h = await startHistory();
    const made = await populate(h);
    const first = await read(h, { community: KEY_A, limit: 5 });
    expect(first.status).toBe(200);
    expect(first.page.total).toBe(7);
    expect(first.page.items).toHaveLength(5);
    expect(first.page.next).toBeTypeOf('string');
    const second = await read(h, { community: KEY_A, limit: 5, cursor: first.page.next });
    expect(second.page.total).toBe(7);
    expect(second.page.items).toHaveLength(2);
    expect(second.page.next).toBeUndefined();
    const all = [...first.page.items, ...second.page.items];
    // The last match played finished last: newest first, so the scripted first match is the oldest.
    expect(all.map((e) => e.matchId)).toStrictEqual([...made].reverse().map((m) => m.id));
    expect(all.map((e) => e.finishedAt)).toStrictEqual([...all.map((e) => e.finishedAt)].sort((a, b) => b - a));
    for (const entry of all) {
      const rows = await board(h, entry.matchId);
      const scoring = rows.filter((r) => r.total > 0);
      expect(entry.playerCount, entry.matchId).toBe(rows.length);
      expect(entry.top, entry.matchId).toStrictEqual(scoring.slice(0, 5).map((r) => ({ playerId: r.playerId, ...(r.name === undefined ? {} : { name: r.name }), points: r.total, rank: r.rank })));
      expect(entry.more, entry.matchId).toBe(scoring.length - Math.min(5, scoring.length));
      expect(entry.mapId).toBe('dev');
      expect(Object.keys(entry)).toStrictEqual(['matchId', 'mapId', 'finishedAt', 'winner', 'playerCount', 'top', 'more']);
    }
    // The scripted match: Ana 27, Bea and Cal listed, Ana first with her name.
    const scripted = all[6]!;
    expect(scripted.matchId).toBe(made[0]!.id);
    expect(scripted.top[0]).toStrictEqual({ playerId: 'discord:u1', name: 'Ana', points: 27, rank: 1 });
    expect(scripted.playerCount).toBe(3);
    // The reply is the protocol encoding of its page.
    expect(readHistoryPage(JSON.parse(first.text)).ok).toBe(true);
    expect(first.text).toBe(encodeHistoryPage(first.page as HistoryPage));
  });

  it('FR-551 (HTTP) the asker is their row, 0 points included, or { played: false }; a body without a player id has no asker member', async () => {
    const h = await startHistory();
    const made = await populate(h);
    const oldest = (body: Record<string, unknown>): Promise<Entry> => read(h, { community: KEY_A, limit: 500, ...body }).then((r) => r.page.items.find((e) => e.matchId === made[0]!.id)!);
    expect((await oldest({ playerId: 'u1' })).asker).toStrictEqual({ points: 27, rank: 1 });
    expect((await oldest({ playerId: 'u3' })).asker).toStrictEqual({ points: 0, rank: 3 });
    expect((await oldest({ playerId: 'nobody-1' })).asker).toStrictEqual({ played: false });
    expect(Object.prototype.hasOwnProperty.call(await oldest({}), 'asker')).toBe(false);
    // The local id is read under the credential's namespace: the same local id of the web client is another player.
    const web = await read(h, { community: KEY_A, limit: 500, playerId: 'w1' }, DISCORD);
    expect(web.page.items.every((e) => (e.asker as { played?: boolean }).played === false)).toBe(true);
    // The asker of an entry where they did not play has no row, even in a match they scored in elsewhere.
    const other = (await read(h, { community: KEY_A, limit: 500, playerId: 'u1' })).page.items.filter((e) => e.matchId !== made[0]!.id);
    expect(other.every((e) => (e.asker as { played?: boolean }).played === false)).toBe(true);
  });

  it('FR-549 (HTTP) a walk across a match that finishes in between keeps its pages and its total, and never repeats or skips', async () => {
    const h = await startHistory();
    const made = await populate(h);
    const running = await createCommunityMatch(h, DISCORD, 'running', KEY_A);
    runMatch(h, running, 10);
    const first = await read(h, { community: KEY_A, limit: 3 });
    expect(first.page.total).toBe(7);
    // The running match finishes, and another one is created and finished, between the pages.
    h.service.advance({ credential: OPERATOR, matchId: running.id, body: { round: 4, step: 'phase-2-close' } });
    h.clock.advance(1000);
    h.service.advance({ credential: OPERATOR, matchId: running.id, body: { round: 4, step: 'application' } });
    const late = await createCommunityMatch(h, DISCORD, 'late', KEY_A);
    playMatch(h, late);
    const seen = [...first.page.items.map((e) => e.matchId)];
    let cursor = first.page.next;
    let guard = 0;
    while (cursor !== undefined && guard++ < 20) {
      const page = await read(h, { community: KEY_A, limit: 3, cursor });
      expect(page.page.total, 'the total of the walk never changes').toBe(7);
      seen.push(...page.page.items.map((e) => e.matchId));
      cursor = page.page.next;
    }
    expect(seen).toStrictEqual([...made].reverse().map((m) => m.id));
    // A new walk shows the two new matches first, and counts them.
    const fresh = await walk(h, DISCORD, { community: KEY_A }, 3);
    expect(fresh.pages.every((p) => p.total === 9)).toBe(true);
    expect(fresh.pages.flatMap((p) => p.items.map((e) => e.matchId))).toStrictEqual([late.id, running.id, ...[...made].reverse().map((m) => m.id)]);
  });

  it('FR-549 (HTTP) every page size from 1 to 8 walks the same entries without repeat or skip', async () => {
    const h = await startHistory();
    const made = await populate(h);
    const expected = [...made].reverse().map((m) => m.id);
    for (let size = 1; size <= 8; size += 1) {
      const walked = await walk(h, DISCORD, { community: KEY_A }, size);
      expect(walked.pages.flatMap((p) => p.items.map((e) => e.matchId)), `size ${size}`).toStrictEqual(expected);
      expect(walked.pages.map((p) => p.total), `size ${size}`).toStrictEqual(walked.pages.map(() => 7));
      // A page that ends exactly on the last entry has no cursor, so no empty page follows it.
      expect(walked.pages, `size ${size}`).toHaveLength(Math.ceil(7 / size));
      expect(walked.pages.slice(0, -1).every((p) => p.items.length === size && p.next !== undefined)).toBe(true);
      expect(walked.pages.at(-1)!.next).toBeUndefined();
    }
  });

  it('FR-552 (HTTP) anonymous, a bad token, the operator, a host token and a player token get forbidden, with the bytes of any other forbidden reply', async () => {
    const h = await startHistory();
    const made = await createCommunityMatch(h, DISCORD, 'a-0', KEY_A);
    // A player token: a join of an open public lobby.
    const open = await request(h.port, { method: 'POST', path: '/matches', body: { mapId: 'dev', timing: { i: 120, l1: 30, l2: 10 }, requestId: 'open-1' } });
    expect(open.status).toBe(201);
    const lobby = (open.json() as { matchId: string }).matchId;
    const joined = await request(h.port, { method: 'POST', path: `/matches/${lobby}/players`, body: { name: 'Joiner', requestId: 'j-1' } });
    expect(joined.status).toBe(201);
    const playerToken = (joined.json() as { playerToken: string }).playerToken;
    const reference = await request(h.port, { method: 'POST', path: `/matches/${made.id}/advance`, body: { round: 1, step: 'phase-1-close' }, headers: { authorization: 'Bearer not-a-credential-0123456789' } });
    expect([reference.status, reference.text]).toStrictEqual([403, errorBody('forbidden')]);
    const body = { community: KEY_A, playerId: 'u1', limit: 5 };
    for (const [label, token] of [['anonymous', undefined], ['a bad token', 'not-a-credential-0123456789'], ['the operator', OPERATOR], ['a host token', made.hostToken], ['a player token', playerToken]] as const) {
      const reply = await postHistory(h, token, body);
      expect([reply.status, reply.text], label).toStrictEqual([reference.status, reference.text]);
    }
  });

  it('FR-552 (HTTP) another namespace and an unknown key get an empty history with total 0, the same bytes as a community that never played', async () => {
    const h = await startHistory();
    await populate(h);
    const empty = '{"items":[],"total":0}';
    const unknown = await read(h, { community: KEY_B });
    expect([unknown.status, unknown.text]).toStrictEqual([200, empty]);
    const other = await read(h, { community: KEY_A, limit: 5, playerId: 'u1' }, WEB);
    expect([other.status, other.text]).toStrictEqual([200, empty]);
    // A cursor of the Discord walk read under the web credential is empty too, never an echo of the other namespace.
    const first = await read(h, { community: KEY_A, limit: 2 });
    const cross = await read(h, { community: KEY_A, limit: 2, cursor: first.page.next }, WEB);
    expect([cross.status, cross.text]).toStrictEqual([200, empty]);
  });

  it('FR-573 (HTTP) any query text is invalid-request naming `query`, the key in a query is never read or echoed, and the body is still the only input', async () => {
    const h = await startHistory();
    await populate(h);
    const echoed = await postHistory(h, DISCORD.credential, { community: KEY_A }, `/history?${KEY_A}=1`);
    expect([echoed.status, echoed.text]).toStrictEqual([400, '{"kind":"invalid-request","items":["query"]}']);
    for (const path of ['/history?community=' + KEY_A, '/history?limit=1', '/history?cursor=x&playerId=u1', '/history?=', '/history?x']) {
      const reply = await postHistory(h, DISCORD.credential, { community: KEY_B }, path);
      expect([reply.status, reply.text], path).toStrictEqual([400, '{"kind":"invalid-request","items":["query"]}']);
    }
    // A query naming the populated key does not find it when the body names another one: nothing in a query is read.
    const viaQuery = await postHistory(h, DISCORD.credential, {}, `/history?community=${KEY_A}`);
    expect(viaQuery.status).toBe(400);
    expect(viaQuery.text).not.toContain(KEY_A);
    // GET is not a method of the route.
    const wrongMethod = await request(h.port, { method: 'GET', path: '/history', headers: { authorization: `Bearer ${DISCORD.credential}` } });
    expect(wrongMethod.status).toBe(405);
  });

  it('FR-573 (HTTP) a malformed body is invalid-request naming the member: key, limit, cursor, an unknown member, a repeated member, no object', async () => {
    const h = await startHistory();
    await populate(h);
    const invalid = (items: string[]): string => `{"kind":"invalid-request","items":${JSON.stringify(items)}}`;
    const send = async (body: unknown): Promise<string> => (await postHistory(h, DISCORD.credential, body)).text;
    expect(await send({})).toBe(invalid(['community']));
    expect(await send({ community: KEY_A.toUpperCase() })).toBe(invalid(['community']));
    expect(await send({ community: KEY_A, limit: 0 })).toBe(invalid(['limit']));
    expect(await send({ community: KEY_A, limit: 501 })).toBe(invalid(['limit']));
    expect(await send({ community: KEY_A, limit: '5' })).toBe(invalid(['limit']));
    expect(await send({ community: KEY_A, cursor: 'nope' })).toBe(invalid(['cursor']));
    expect(await send({ community: KEY_A, cursor: encodeCursor('matches', [1, 'AAAA']) })).toBe(invalid(['cursor']));
    expect(await send({ community: KEY_A, namespace: 'web' })).toBe(invalid(['namespace']));
    expect(await send({ community: KEY_A, playerId: 5 })).toBe(invalid(['playerId']));
    expect(await send({ community: KEY_A, playerId: 'web:u1' })).toBe('{"kind":"invalid-player-id","items":["playerId"]}');
    expect(await send([])).toBe(invalid(['body']));
    const raw = (text: string): Promise<{ status: number; text: string }> =>
      request(h.port, { method: 'POST', path: '/history', body: text, headers: { authorization: `Bearer ${DISCORD.credential}`, 'content-type': 'application/json' } });
    expect((await raw(`{"community":"${KEY_A}","community":"${KEY_B}"}`)).text).toBe(invalid(['community']));
    expect((await raw('{"community":')).status).toBe(400);
    // No error text ever carries the key that was sent.
    for (const body of [{ community: `${KEY_A}x` }, { community: KEY_A, limit: 0 }, { community: KEY_A, zzz: KEY_A }]) expect(await send(body)).not.toContain(KEY_A);
  });

  it('FR-573 FR-549 (HTTP) nothing is stored or memoised by a read: the database file has the same rows after any number of reads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrg-history-'));
    dirs.push(dir);
    const file = join(dir, 'h.sqlite');
    const h = await startHistory({ wrapStore: () => openStore(file) });
    await populate(h);
    runMatch(h, await createCommunityMatch(h, DISCORD, 'r', KEY_A), 3);
    await h.close();
    const memoRows = (): number => withRawDb(file, (db) => Number(db.prepare('SELECT COUNT(*) AS n FROM memo').get()?.n));
    const before = withRawDb(file, dumpRows);
    const memoBefore = memoRows();
    // The creations are memoised (one row each); a read adds none.
    expect(memoBefore).toBe(8);
    const again = await startHistory({ wrapStore: () => openStore(file) });
    for (const body of [{ community: KEY_A, limit: 5 }, { community: KEY_A, limit: 5, playerId: 'u1' }, { community: KEY_B }, { community: KEY_A, cursor: 'bad' }]) {
      await postHistory(again, DISCORD.credential, body);
      await postHistory(again, WEB.credential, body);
    }
    await again.close();
    expect(withRawDb(file, dumpRows)).toBe(before);
    expect(memoRows()).toBe(memoBefore);
  });

  it('FR-553 (HTTP) no reply, header or log line carries the key or the asker id, and the match list, a match and the leaderboard carry neither', async () => {
    const h = await startHistory();
    const made = await populate(h);
    const ASKER = 'asker-zz-91';
    const replies = [
      await postHistory(h, DISCORD.credential, { community: KEY_A, playerId: ASKER, limit: 5 }),
      await postHistory(h, DISCORD.credential, { community: KEY_B, playerId: ASKER }),
      await postHistory(h, WEB.credential, { community: KEY_A, playerId: ASKER }),
      await postHistory(h, undefined, { community: KEY_A, playerId: ASKER }),
      await postHistory(h, DISCORD.credential, { community: KEY_A, playerId: ASKER, zzz: 1 }),
      await postHistory(h, DISCORD.credential, { community: KEY_A, playerId: ASKER, limit: 0 }),
      await postHistory(h, DISCORD.credential, { community: KEY_A, playerId: ASKER }, `/history?community=${KEY_A}`),
    ];
    // A reply that is a page holds the asker only as `{ played: false }`, never the id.
    for (const reply of replies) {
      const wire = `${reply.text}${JSON.stringify(reply.headers)}`;
      expect(wire).not.toContain(KEY_A);
      expect(wire).not.toContain(KEY_B);
      expect(wire).not.toContain(ASKER);
    }
    // The public reads of the same matches never hold the key.
    for (const path of ['/matches?limit=500', `/matches/${made[0]!.id}`, `/matches/${made[0]!.id}/leaderboard`, `/matches/${made[0]!.id}/records`, '/config']) {
      const reply = await get(h, path);
      expect(`${reply.text}${JSON.stringify(reply.headers)}`, path).not.toContain(KEY_A);
    }
    // A failing read logs only the closed error fields: neither the key nor the planted text of the error.
    const failing = await startHistory({
      wrapStore: (store) => ({ ...store, historyAfter: () => { throw new Error(`${PLANTED} ${KEY_A} ${ASKER}`); } }) as Store,
    });
    const boom = await postHistory(failing, DISCORD.credential, { community: KEY_A, playerId: ASKER });
    expect(boom.status).toBe(500);
    const logged = JSON.stringify([...h.logs, ...failing.logs]);
    expect(logged).not.toContain(KEY_A);
    expect(logged).not.toContain(ASKER);
    expect(logged).not.toContain(PLANTED);
    expect(boom.text).not.toContain(KEY_A);
    expect(boom.text).not.toContain(PLANTED);
  });

  it('FR-549 (HTTP) a storage failure of the read is unavailable, and the same request answers once the store works again', async () => {
    let failing = true;
    const h = await startHistory({
      wrapStore: (store) => ({
        ...store,
        historyAfter: (...args: Parameters<Store['historyAfter']>) => {
          if (failing) throw new StoreError('store-failure', 'injected');
          return store.historyAfter(...args);
        },
      }) as Store,
    });
    const reply = await postHistory(h, DISCORD.credential, { community: KEY_A });
    expect([reply.status, reply.text]).toStrictEqual([503, errorBody('unavailable')]);
    failing = false;
    expect((await postHistory(h, DISCORD.credential, { community: KEY_A })).text).toBe('{"items":[],"total":0}');
  });

  it('FR-549 FR-573 (HTTP) the page is written by the protocol encoder, not by JSON.stringify of the service object, and the caller namespace is the credential\'s', async () => {
    const seen: unknown[] = [];
    const h = await startHistory({
      stub: {
        history: (request) => {
          seen.push(request);
          return { ok: true, reply: { total: 1, items: [{ more: 0, top: [], playerCount: 0, winner: 2, finishedAt: 5, mapId: 'dev', matchId: 'Zz' }] } };
        },
      },
    });
    const reply = await postHistory(h, DISCORD.credential, { community: KEY_A, playerId: 'u1', limit: 4 });
    expect(reply.text).toBe('{"items":[{"matchId":"Zz","mapId":"dev","finishedAt":5,"winner":2,"playerCount":0,"top":[],"more":0}],"total":1}');
    await postHistory(h, WEB.credential, { community: KEY_B });
    expect(seen).toStrictEqual([
      { namespace: 'discord', community: KEY_A, limit: 4, playerId: 'u1' },
      { namespace: 'web', community: KEY_B, limit: 100 },
    ]);
  });

  it('FR-549 (HTTP) a stub that returns something the encoder refuses is answered as an unexpected failure, never as a page', async () => {
    const h = await startHistory({ stub: { history: () => ({ ok: true, reply: { total: 0, items: [{ nope: 1 }] } as never }) } });
    const reply = await postHistory(h, DISCORD.credential, { community: KEY_A });
    expect(reply.status).toBe(500);
    expect(reply.text).toBe(errorBody('unavailable'));
  });

  it('FR-552 (HTTP) each layer of the route refuses on its own: the authorization hook and the decision both answer forbidden to a caller that is not a client, and the shape hook refuses a bad body', async () => {
    const h = await startHistory();
    const route = productionRoutes(h.service, h.settings).find((r) => r.method === 'POST' && r.path === '/history')!;
    const ctx = (identity: Identity, body: unknown, query = ''): RouteContext => ({ params: {}, query, body, token: 't', lastEventId: undefined, identity, now: 0, source: 'src' });
    const forbidden = { kind: 'forbidden' };
    for (const identity of [{ role: 'operator', digest: 'd' }, { role: 'anonymous' }, { role: 'candidate' }, { role: 'host', digest: 'd' }, { role: 'player', digest: 'd', playerId: 'p' }] as unknown as Identity[]) {
      expect(route.authorize!(ctx(identity, { community: KEY_A }))).toStrictEqual(forbidden);
      expect(await route.decide(ctx(identity, { community: KEY_A }))).toStrictEqual({ kind: 'error', error: forbidden });
    }
    const client = { role: 'client', digest: 'd', namespace: 'discord' } as unknown as Identity;
    expect(route.authorize!(ctx(client, { community: KEY_A }))).toBeUndefined();
    expect(route.shape!(ctx(client, { community: 'bad' }))).toStrictEqual({ kind: 'invalid-request', items: ['community'] });
    expect(route.shape!(ctx(client, { community: KEY_A }))).toBeUndefined();
    expect(route.checkQuery!(ctx(client, {}, 'x=1'))).toStrictEqual({ kind: 'invalid-request', items: ['query'] });
    expect(route.checkQuery!(ctx(client, {}))).toBeUndefined();
    expect(route.body).toBe('object');
  });
});
