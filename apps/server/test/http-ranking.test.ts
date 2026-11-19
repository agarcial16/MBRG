import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeCursor, encodeRankingPage, readRankingPage } from '@mbrg/protocol';
import type { RankingPage } from '@mbrg/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Every test of this file drives a real server (~0.9 s alone each): explicit headroom against the default 5 s under the
// full suite's CPU load (the lesson of the load-induced flakes).
vi.setConfig({ testTimeout: 30_000 });
import { productionRoutes } from '../src/http/server';
import type { Identity } from '../src/http/identity';
import type { RouteContext } from '../src/http/router';
import { openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { get } from './helpers/http-reads-kit';
import { withTempDirAsync } from './helpers/http-reads-kit';
import { request } from './helpers/http-client';
import {
  ANA,
  BEA,
  CAL,
  DISCORD,
  KEY_A,
  KEY_B,
  WEB,
  createCommunityMatch,
  playMatch,
  populateRanking,
  postRanking,
  runMatch,
  startHistory,
  walkRanking,
} from './helpers/ranking-kit';
import type { Made, RankPlayer, RankedWalk, ServerHarness } from './helpers/ranking-kit';
import { PLANTED, closeAllServers, errorBody } from './helpers/server-harness';
import { OPERATOR } from './helpers/service-harness';

// Spec 025 `POST /ranking` over a real listener, the production routes, the real service and store: a client credential reads
// the ranking of a community key under its namespace, in pages of 10 in every order, with the snapshot total. The oracle of a row
// is the public reads of the same matches (the leaderboard for the points, the correct counts and the names; a player's results
// for the scored count; the match maximum for the won rule). Key values and ids are planted literals.

const dirs: string[] = [];
afterEach(async () => {
  await closeAllServers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

interface Row {
  readonly playerId: string;
  readonly name?: string;
  readonly points: number;
  readonly correct: number;
  readonly scored: number;
  readonly played: number;
  readonly won: number;
  readonly rank?: number;
}
interface Page {
  readonly items: Row[];
  readonly total: number;
  readonly next?: string;
  readonly asker?: unknown;
}

const read = async (h: ServerHarness, body: unknown, client: { credential: string } = DISCORD): Promise<{ status: number; text: string; page: Page }> => {
  const reply = await postRanking(h, client.credential, body);
  return { status: reply.status, text: reply.text, page: reply.status === 200 ? (reply.json() as Page) : { items: [], total: -1 } };
};

/** One leaderboard row of a match's public read. */
interface BoardRow {
  readonly rank: number;
  readonly playerId: string;
  readonly total: number;
  readonly correctVictims: number;
  readonly correctAbsorbers: number;
  readonly correctWinner: number;
  readonly name?: string;
}

/** The oracle statistics of one player over the community's counted matches, from the public reads alone. */
interface Oracle {
  readonly playerId: string;
  readonly name?: string;
  readonly points: number;
  readonly correct: number;
  readonly scored: number;
  readonly played: number;
  readonly won: number;
}

/**
 * The oracle of the ranking of a community: for every match, the public leaderboard gives each player's points, correct counts
 * and name, and the match's maximum decides the won rule; the player's own results read gives the scored count. Independent of
 * the ranking code: only the public reads of the matches.
 */
async function oracleOf(h: ServerHarness, matches: readonly Made[]): Promise<Map<string, Oracle>> {
  const byPlayer = new Map<string, Oracle & { nameSet: boolean }>();
  for (const made of [...matches].reverse()) {
    const board = ((await get(h, `/matches/${made.id}/leaderboard?limit=500`)).json() as { items: BoardRow[] }).items;
    const max = board.reduce((top, row) => Math.max(top, row.total), 0);
    for (const row of board) {
      const results = (await get(h, `/matches/${made.id}/players/${row.playerId}/results?limit=500`)).json() as { items: unknown[] };
      const current = byPlayer.get(row.playerId);
      // The shown name is the one of the most recent counted match that stored one: the newest match first, a name set once.
      if (current === undefined) {
        byPlayer.set(row.playerId, { playerId: row.playerId, ...(row.name === undefined ? {} : { name: row.name }), points: row.total, correct: row.correctVictims + row.correctAbsorbers + row.correctWinner, scored: results.items.length, played: 1, won: row.total > 0 && row.total === max ? 1 : 0, nameSet: row.name !== undefined });
      } else {
        byPlayer.set(row.playerId, {
          ...current,
          points: current.points + row.total,
          correct: current.correct + row.correctVictims + row.correctAbsorbers + row.correctWinner,
          scored: current.scored + results.items.length,
          played: current.played + 1,
          won: current.won + (row.total > 0 && row.total === max ? 1 : 0),
          ...(!current.nameSet && row.name !== undefined ? { name: row.name, nameSet: true } : {}),
        });
      }
    }
  }
  const out = new Map<string, Oracle>();
  for (const [playerId, value] of byPlayer) out.set(playerId, { playerId: value.playerId, ...(value.name === undefined ? {} : { name: value.name }), points: value.points, correct: value.correct, scored: value.scored, played: value.played, won: value.won });
  return out;
}

/** The rows the ranking must answer in one order, derived from the oracle alone: order, competition ranks, the accuracy tail. */
function expectedRows(oracle: ReadonlyMap<string, Oracle>, order: string): Row[] {
  const all = [...oracle.values()];
  const morePrimary = (a: Oracle, b: Oracle): boolean =>
    order === 'accuracy' ? a.correct * b.scored > b.correct * a.scored : order === 'points' ? a.points > b.points : order === 'correct' ? a.correct > b.correct : a.won > b.won;
  const byOrder = (a: Oracle, b: Oracle): number => {
    if (morePrimary(a, b)) return -1;
    if (morePrimary(b, a)) return 1;
    if (a.points !== b.points) return a.points > b.points ? -1 : 1;
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  };
  const qualified = (o: Oracle): boolean => order !== 'accuracy' || o.scored >= 10;
  const ranked = all.filter(qualified).sort(byOrder);
  const tail = order === 'accuracy' ? all.filter((o) => !qualified(o)).sort((a, b) => byOrder({ ...a, correct: 0, scored: 1 }, { ...b, correct: 0, scored: 1 })) : [];
  const rows: Row[] = [];
  let rank = 0;
  ranked.forEach((o, i) => {
    if (i === 0 || morePrimary(ranked[i - 1]!, o)) rank = i + 1;
    rows.push({ playerId: o.playerId, ...(o.name === undefined ? {} : { name: o.name }), points: o.points, correct: o.correct, scored: o.scored, played: o.played, won: o.won, rank });
  });
  for (const o of tail) rows.push({ playerId: o.playerId, ...(o.name === undefined ? {} : { name: o.name }), points: o.points, correct: o.correct, scored: o.scored, played: o.played, won: o.won });
  return rows;
}

describe('the ranking read over HTTP', () => {
  it('FR-563 FR-565 (HTTP) a client credential reads pages of 10 in every order, every row and the total what the matches\' public reads show', async () => {
    const h = await startHistory();
    const { matches } = await populateRanking(h);
    const oracle = await oracleOf(h, matches);
    expect(oracle.size).toBe(18);
    for (const order of ['points', 'correct', 'wins', 'accuracy'] as const) {
      const walked = await walkRanking(h, DISCORD, { community: KEY_A, order }, 10);
      expect(walked.pages.map((p) => p.total), order).toStrictEqual([18, 18]);
      expect(walked.pages.flatMap((p) => p.items), order).toStrictEqual(expectedRows(oracle, order));
      expect(walked.pages[0]!.items, order).toHaveLength(10);
      expect(walked.pages[0]!.next, order).toBeTypeOf('string');
      expect(walked.pages.at(-1)!.items, order).toHaveLength(8);
      expect(walked.pages.at(-1)!.next, order).toBeUndefined();
    }
    // The reply is the protocol encoding of its page, not a JSON.stringify of the service object.
    const points = await read(h, { community: KEY_A, limit: 10 });
    expect(readRankingPage(JSON.parse(points.text)).ok).toBe(true);
    expect(points.text).toBe(encodeRankingPage(points.page as RankingPage));
  });

  it('FR-565 (HTTP) every page size from 1 to 10 walks the same rows in the same order, without repeat or skip', async () => {
    const h = await startHistory();
    const { matches } = await populateRanking(h);
    const oracle = await oracleOf(h, matches);
    const expected = expectedRows(oracle, 'points');
    for (let size = 1; size <= 10; size += 1) {
      const walked = await walkRanking(h, DISCORD, { community: KEY_A }, size);
      expect(walked.pages.flatMap((p) => p.items), `size ${size}`).toStrictEqual(expected);
      expect(walked.pages.map((p) => p.total), `size ${size}`).toStrictEqual(walked.pages.map(() => 18));
      expect(walked.pages, `size ${size}`).toHaveLength(Math.ceil(18 / size));
      expect(walked.pages.at(-1)!.next, `size ${size}`).toBeUndefined();
    }
  });

  it('FR-566 (HTTP) the accuracy order ranks only the players with at least 10 scored predictions; the rest follow without a rank, counted in the total', async () => {
    const h = await startHistory();
    const { matches } = await populateRanking(h);
    const oracle = await oracleOf(h, matches);
    const walked = await walkRanking(h, DISCORD, { community: KEY_A, order: 'accuracy' }, 500);
    const rows = walked.pages.flatMap((p) => p.items) as unknown as Row[];
    expect(walked.pages[0]!.total).toBe(18);
    // Only the three players of the first two matches can reach 10 scored predictions; each of them ranks.
    for (const row of rows) expect((row.scored >= 10) === (row.rank !== undefined), row.playerId).toBe(true);
    const ranked = rows.filter((r) => r.scored >= 10);
    expect(ranked.map((r) => r.playerId).sort()).toStrictEqual(['discord:u1', 'discord:u2', 'discord:u3']);
    // The tail follows every ranked row, by total points, then player id.
    expect(rows.slice(0, ranked.length).every((r) => r.scored >= 10)).toBe(true);
  });

  it('FR-567 (HTTP) the asker is their row with their rank in every order, without one when unqualified in the accuracy order, or played false', async () => {
    const h = await startHistory();
    const { matches } = await populateRanking(h);
    const oracle = await oracleOf(h, matches);
    for (const order of ['points', 'correct', 'wins', 'accuracy'] as const) {
      const asked = await read(h, { community: KEY_A, order, playerId: 'u2' });
      const expected = expectedRows(oracle, order).find((r) => r.playerId === 'discord:u2')!;
      expect(asked.page.asker, order).toStrictEqual({ points: expected.points, correct: expected.correct, scored: expected.scored, played: expected.played, won: expected.won, rank: expected.rank });
    }
    // A player of one match is not qualified for accuracy: their row, without a rank.
    const single = await read(h, { community: KEY_A, order: 'accuracy', playerId: 'u41' });
    const row = expectedRows(oracle, 'accuracy').find((r) => r.playerId === 'discord:u41')!;
    expect(single.page.asker).toStrictEqual({ points: row.points, correct: row.correct, scored: row.scored, played: row.played, won: row.won });
    // A local id nobody holds has no row at all; a body without a player id has no asker member.
    expect((await read(h, { community: KEY_A, playerId: 'nobody-zz-9' })).page.asker).toStrictEqual({ played: false });
    const anonymous = await read(h, { community: KEY_A });
    expect(Object.prototype.hasOwnProperty.call(anonymous.page, 'asker')).toBe(false);
  });

  it('FR-565 (HTTP) a walk across a match that finishes in between keeps its pages byte for byte, and a fresh walk counts it', async () => {
    const h = await startHistory();
    await populateRanking(h);
    const running = await createCommunityMatch(h, DISCORD, 'running', KEY_A);
    runMatch(h, running, 10);
    const before = await walkRanking(h, DISCORD, { community: KEY_A }, 3);
    // The running match finishes, and another one is created and finished, between the pages.
    h.service.advance({ credential: OPERATOR, matchId: running.id, body: { round: 4, step: 'phase-2-close' } });
    h.clock.advance(1000);
    h.service.advance({ credential: OPERATOR, matchId: running.id, body: { round: 4, step: 'application' } });
    const latePlayers: RankPlayer[] = [
      { client: DISCORD, local: 'u91', victim: 'wrong', absorber: 'wrong', winner: 'wrong' },
      { client: DISCORD, local: 'u92', victim: 'right', absorber: 'wrong', winner: 'wrong' },
      { client: DISCORD, local: 'u93', victim: 'wrong', absorber: 'right', winner: 'right' },
    ];
    const late = await createCommunityMatch(h, DISCORD, 'late', KEY_A);
    playMatch(h, late, latePlayers);
    // The walk continues from its first page: every later page equals the twin walk's, byte for byte, total included.
    const after: string[] = [];
    let cursor = before.pages[0]!.next;
    let guard = 0;
    while (cursor !== undefined && guard++ < 20) {
      const reply = await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 3, cursor });
      if (reply.status !== 200) throw new Error(`ranking refused: ${reply.status}`);
      after.push(reply.text);
      cursor = (reply.json() as Page).next;
    }
    expect([...before.texts.slice(0, 1), ...after]).toStrictEqual(before.texts);
    // A fresh walk counts the late match's players (the finished running one holds no scored result).
    const fresh = await walkRanking(h, DISCORD, { community: KEY_A }, 500);
    expect(fresh.pages[0]!.total).toBe(21);
    expect(fresh.pages.flatMap((p) => p.items.map((r) => r.playerId))).toContain('discord:u91');
    expect(fresh.pages.flatMap((p) => p.items.map((r) => r.playerId))).toContain('discord:u93');
  });

  it('FR-565 (HTTP) a cursor issued for another order is invalid-request naming cursor, in both directions', async () => {
    const h = await startHistory();
    await populateRanking(h);
    const invalid = (items: string[]): string => `{"kind":"invalid-request","items":${JSON.stringify(items)}}`;
    const first = await read(h, { community: KEY_A, order: 'correct', limit: 10 });
    const pointsCursor = (await read(h, { community: KEY_A, limit: 10 })).page.next!;
    expect([first.status, first.text]).toStrictEqual([200, expect.any(String)]);
    // A walk of one order cannot continue in another, the default included.
    const cross = await postRanking(h, DISCORD.credential, { community: KEY_A, order: 'wins', limit: 10, cursor: first.page.next });
    expect([cross.status, cross.text]).toStrictEqual([400, invalid(['cursor'])]);
    const defaultOrder = await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 10, cursor: first.page.next });
    expect([defaultOrder.status, defaultOrder.text]).toStrictEqual([400, invalid(['cursor'])]);
    const back = await postRanking(h, DISCORD.credential, { community: KEY_A, order: 'correct', limit: 10, cursor: pointsCursor });
    expect([back.status, back.text]).toStrictEqual([400, invalid(['cursor'])]);
  });

  it('FR-568 (HTTP) anonymous, a bad token, the operator, a host token and a player token get forbidden, with the bytes of any other forbidden reply', async () => {
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
    const body = { community: KEY_A, playerId: 'u1', limit: 10 };
    for (const [label, token] of [['anonymous', undefined], ['a bad token', 'not-a-credential-0123456789'], ['the operator', OPERATOR], ['a host token', made.hostToken], ['a player token', playerToken]] as const) {
      const reply = await postRanking(h, token, body);
      expect([reply.status, reply.text], label).toStrictEqual([reference.status, reference.text]);
    }
  });

  it('FR-568 (HTTP) another namespace, an unknown key and a cross-namespace cursor get the empty page with total 0, the same bytes', async () => {
    const h = await startHistory();
    await populateRanking(h);
    const empty = '{"items":[],"total":0}';
    const unknown = await read(h, { community: KEY_B, playerId: 'u1' });
    expect([unknown.status, unknown.text]).toStrictEqual([200, empty]);
    const other = await read(h, { community: KEY_A, limit: 5, playerId: 'u1' }, WEB);
    expect([other.status, other.text]).toStrictEqual([200, empty]);
    // A cursor of the Discord walk read under the web credential is empty too, never an echo of the other namespace.
    const first = await read(h, { community: KEY_A, limit: 2 });
    const cross = await read(h, { community: KEY_A, limit: 2, cursor: first.page.next }, WEB);
    expect([cross.status, cross.text]).toStrictEqual([200, empty]);
  });

  it('FR-568 (HTTP) any query text is invalid-request naming `query`, the key in a query is never read or echoed, and GET is no method of the route', async () => {
    const h = await startHistory();
    await populateRanking(h);
    const echoed = await postRanking(h, DISCORD.credential, { community: KEY_A }, `/ranking?${KEY_A}=1`);
    expect([echoed.status, echoed.text]).toStrictEqual([400, '{"kind":"invalid-request","items":["query"]}']);
    for (const path of ['/ranking?community=' + KEY_A, '/ranking?limit=1', '/ranking?cursor=x&playerId=u1', '/ranking?=', '/ranking?x']) {
      const reply = await postRanking(h, DISCORD.credential, { community: KEY_B }, path);
      expect([reply.status, reply.text], path).toStrictEqual([400, '{"kind":"invalid-request","items":["query"]}']);
    }
    // A query naming the populated key does not find it when the body names another one: nothing in a query is read.
    const viaQuery = await postRanking(h, DISCORD.credential, {}, `/ranking?community=${KEY_A}`);
    expect(viaQuery.status).toBe(400);
    expect(viaQuery.text).not.toContain(KEY_A);
    const wrongMethod = await request(h.port, { method: 'GET', path: '/ranking', headers: { authorization: `Bearer ${DISCORD.credential}` } });
    expect(wrongMethod.status).toBe(405);
  });

  it('FR-568 (HTTP) a malformed body is invalid-request naming the member: community, order, limit, cursor, playerId, an unknown member, no object', async () => {
    const h = await startHistory();
    await populateRanking(h);
    const invalid = (items: string[]): string => `{"kind":"invalid-request","items":${JSON.stringify(items)}}`;
    const send = async (body: unknown): Promise<string> => (await postRanking(h, DISCORD.credential, body)).text;
    expect(await send({})).toBe(invalid(['community']));
    expect(await send({ community: KEY_A.toUpperCase() })).toBe(invalid(['community']));
    expect(await send({ community: KEY_A, order: 'puntos' })).toBe(invalid(['order']));
    expect(await send({ community: KEY_A, order: 5 })).toBe(invalid(['order']));
    expect(await send({ community: KEY_A, limit: 0 })).toBe(invalid(['limit']));
    expect(await send({ community: KEY_A, limit: 501 })).toBe(invalid(['limit']));
    expect(await send({ community: KEY_A, limit: '10' })).toBe(invalid(['limit']));
    expect(await send({ community: KEY_A, cursor: 'nope' })).toBe(invalid(['cursor']));
    expect(await send({ community: KEY_A, cursor: encodeCursor('matches', [1, 'AAAA']) })).toBe(invalid(['cursor']));
    expect(await send({ community: KEY_A, namespace: 'web' })).toBe(invalid(['namespace']));
    expect(await send({ community: KEY_A, playerId: 5 })).toBe(invalid(['playerId']));
    expect(await send({ community: KEY_A, playerId: 'web:u1' })).toBe('{"kind":"invalid-player-id","items":["playerId"]}');
    expect(await send([])).toBe(invalid(['body']));
    const raw = (text: string): Promise<{ status: number; text: string }> =>
      request(h.port, { method: 'POST', path: '/ranking', body: text, headers: { authorization: `Bearer ${DISCORD.credential}`, 'content-type': 'application/json' } });
    expect((await raw(`{"community":"${KEY_A}","community":"${KEY_B}"}`)).text).toBe(invalid(['community']));
    expect((await raw('{"community":')).status).toBe(400);
    // No error text ever carries the key that was sent.
    for (const body of [{ community: `${KEY_A}x` }, { community: KEY_A, order: 'bad' }, { community: KEY_A, limit: 0 }, { community: KEY_A, zzz: KEY_A }]) expect(await send(body)).not.toContain(KEY_A);
  });

  it('FR-568 (HTTP) nothing is stored or memoised by a read: the database file has the same rows after any number of reads', async () => {
    await withTempDirAsync(async (dir) => {
      const file = join(dir, 'r.sqlite');
      const h = await startHistory({ wrapStore: () => openStore(file) });
      await populateRanking(h);
      runMatch(h, await createCommunityMatch(h, DISCORD, 'r', KEY_A), 3);
      await h.close();
      const memoRows = (): number => withRawDb(file, (db) => Number(db.prepare('SELECT COUNT(*) AS n FROM memo').get()?.n));
      const before = withRawDb(file, dumpRows);
      const memoBefore = memoRows();
      // The creations are memoised (one row each); a read adds none.
      expect(memoBefore).toBe(8);
      const again = await startHistory({ wrapStore: () => openStore(file) });
      for (const body of [{ community: KEY_A, limit: 10 }, { community: KEY_A, limit: 10, playerId: 'u1' }, { community: KEY_B }, { community: KEY_A, cursor: 'bad' }, { community: KEY_A, order: 'accuracy' }]) {
        await postRanking(again, DISCORD.credential, body);
        await postRanking(again, WEB.credential, body);
      }
      await again.close();
      expect(withRawDb(file, dumpRows)).toBe(before);
      expect(memoRows()).toBe(memoBefore);
    });
  });

  it('FR-568 (HTTP) no reply, header or log line carries the key or the asker id, and the public reads of the matches carry neither', async () => {
    const h = await startHistory();
    // One played match, so a failing snapshot read is reached at all.
    const made = await createCommunityMatch(h, DISCORD, 'a-0', KEY_A);
    playMatch(h, made, [ANA, BEA, CAL], true);
    const ASKER = 'asker-zz-91';
    const replies = [
      await postRanking(h, DISCORD.credential, { community: KEY_A, playerId: ASKER, limit: 10 }),
      await postRanking(h, DISCORD.credential, { community: KEY_B, playerId: ASKER }),
      await postRanking(h, WEB.credential, { community: KEY_A, playerId: ASKER }),
      await postRanking(h, undefined, { community: KEY_A, playerId: ASKER }),
      await postRanking(h, DISCORD.credential, { community: KEY_A, playerId: ASKER, zzz: 1 }),
      await postRanking(h, DISCORD.credential, { community: KEY_A, playerId: ASKER, limit: 0 }),
      await postRanking(h, DISCORD.credential, { community: KEY_A, playerId: ASKER }, `/ranking?community=${KEY_A}`),
    ];
    // A reply that is a page holds the asker only as their statistics, never the id; the key never appears at all.
    for (const reply of replies) {
      const wire = `${reply.text}${JSON.stringify(reply.headers)}`;
      expect(wire).not.toContain(KEY_A);
      expect(wire).not.toContain(KEY_B);
      expect(wire).not.toContain(ASKER);
    }
    // The public reads of the same matches never hold the key.
    for (const path of ['/matches?limit=500', `/matches/${made.id}`, `/matches/${made.id}/leaderboard`, `/matches/${made.id}/records`, '/config']) {
      const reply = await get(h, path);
      expect(`${reply.text}${JSON.stringify(reply.headers)}`, path).not.toContain(KEY_A);
    }
    // A failing read logs only the closed error fields: neither the key nor the planted text of the error.
    const failing = await startHistory({
      wrapStore: (store) => ({ ...store, rankingResults: () => { throw new Error(`${PLANTED} ${KEY_A} ${ASKER}`); } }) as Store,
    });
    const failingMade = await createCommunityMatch(failing, DISCORD, 'a-0', KEY_A);
    playMatch(failing, failingMade, [ANA, BEA, CAL], true);
    const boom = await postRanking(failing, DISCORD.credential, { community: KEY_A, playerId: ASKER });
    expect(boom.status).toBe(500);
    const logged = JSON.stringify([...h.logs, ...failing.logs]);
    expect(logged).not.toContain(KEY_A);
    expect(logged).not.toContain(ASKER);
    expect(logged).not.toContain(PLANTED);
    expect(boom.text).not.toContain(KEY_A);
    expect(boom.text).not.toContain(PLANTED);
  });

  it('FR-568 (HTTP) a storage failure of the read is unavailable, and the same request answers once the store works again', async () => {
    let failing = true;
    const h = await startHistory({
      wrapStore: (store) => ({
        ...store,
        rankingResults: (...args: Parameters<Store['rankingResults']>) => {
          if (failing) throw new StoreError('store-failure', 'injected');
          return store.rankingResults(...args);
        },
      }) as Store,
    });
    // One played match, so the failing snapshot read is reached at all.
    const made = await createCommunityMatch(h, DISCORD, 'a-0', KEY_A);
    playMatch(h, made, [ANA, BEA, CAL], true);
    const reply = await postRanking(h, DISCORD.credential, { community: KEY_A });
    expect([reply.status, reply.text]).toStrictEqual([503, errorBody('unavailable')]);
    failing = false;
    const healed = await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 500 });
    expect(healed.status).toBe(200);
    expect((healed.json() as Page).total).toBe(3);
  });

  it('FR-568 (HTTP) the page is written by the protocol encoder, and the caller namespace is the credential\'s', async () => {
    const seen: unknown[] = [];
    const h = await startHistory({
      stub: {
        ranking: (request) => {
          seen.push(request);
          return { ok: true, reply: { total: 1, items: [{ playerId: 'discord:u1', points: 2, correct: 1, scored: 1, played: 1, won: 1, rank: 1 }] } };
        },
      },
    });
    const reply = await postRanking(h, DISCORD.credential, { community: KEY_A, order: 'wins', playerId: 'u1', limit: 4 });
    expect(reply.text).toBe('{"items":[{"playerId":"discord:u1","points":2,"correct":1,"scored":1,"played":1,"won":1,"rank":1}],"total":1}');
    await postRanking(h, WEB.credential, { community: KEY_B });
    expect(seen).toStrictEqual([
      { namespace: 'discord', community: KEY_A, order: 'wins', limit: 4, playerId: 'u1' },
      { namespace: 'web', community: KEY_B, order: 'points', limit: 100 },
    ]);
  });

  it('FR-568 (HTTP) a stub that returns something the encoder refuses is answered as an unexpected failure, never as a page', async () => {
    const h = await startHistory({ stub: { ranking: () => ({ ok: true, reply: { total: 0, items: [{ nope: 1 }] } as never }) } });
    const reply = await postRanking(h, DISCORD.credential, { community: KEY_A });
    expect(reply.status).toBe(500);
    expect(reply.text).toBe(errorBody('unavailable'));
  });

  it('FR-568 (HTTP) each layer of the route refuses on its own: the authorization hook and the decision both answer forbidden to a caller that is not a client, and the shape hook refuses a bad body', async () => {
    const h = await startHistory();
    const route = productionRoutes(h.service, h.settings).find((r) => r.method === 'POST' && r.path === '/ranking')!;
    const ctx = (identity: Identity, body: unknown, query = ''): RouteContext => ({ params: {}, query, body, token: 't', lastEventId: undefined, identity, now: 0, source: 'src' });
    const forbidden = { kind: 'forbidden' };
    for (const identity of [{ role: 'operator', digest: 'd' }, { role: 'anonymous' }, { role: 'candidate' }, { role: 'host', digest: 'd' }, { role: 'player', digest: 'd', playerId: 'p' }] as unknown as Identity[]) {
      expect(route.authorize!(ctx(identity, { community: KEY_A }))).toStrictEqual(forbidden);
      expect(await route.decide(ctx(identity, { community: KEY_A }))).toStrictEqual({ kind: 'error', error: forbidden });
    }
    const client = { role: 'client', digest: 'd', namespace: 'discord' } as unknown as Identity;
    expect(route.authorize!(ctx(client, { community: KEY_A }))).toBeUndefined();
    expect(route.shape!(ctx(client, { community: 'bad' }))).toStrictEqual({ kind: 'invalid-request', items: ['community'] });
    expect(route.shape!(ctx(client, { community: KEY_A, order: 'bad' }))).toStrictEqual({ kind: 'invalid-request', items: ['order'] });
    expect(route.shape!(ctx(client, { community: KEY_A }))).toBeUndefined();
    expect(route.checkQuery!(ctx(client, {}, 'x=1'))).toStrictEqual({ kind: 'invalid-request', items: ['query'] });
    expect(route.checkQuery!(ctx(client, {}))).toBeUndefined();
    expect(route.body).toBe('object');
  });
});
