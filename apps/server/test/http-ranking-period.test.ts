import { join } from 'node:path';
import { decodeCursor, encodeCursor } from '@mbrg/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInPeriod, periodFloorOf } from '../src/core/ranking';
import { openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { withTempDirAsync } from './helpers/http-reads-kit';
import { request } from './helpers/http-client';
import { expectedRows, oracleOf } from './helpers/ranking-oracle';
import type { OracleRow } from './helpers/ranking-oracle';
import {
  DISCORD,
  KEY_A,
  KEY_B,
  WEB,
  createCommunityMatch,
  playMatch,
  populateSpread,
  postRanking,
  startHistory,
  walkRanking,
} from './helpers/ranking-kit';
import type { RankPlayer, ServerHarness, Spread } from './helpers/ranking-kit';
import { PLANTED, closeAllServers, errorBody } from './helpers/server-harness';
import { living } from './helpers/http-reads-kit';
import { OPERATOR } from './helpers/service-harness';

// Spec 027 T2.2 `POST /ranking` with a period over a real listener, the production routes, the real service and store and the
// injected clock. The seven matches of the spread community end about 33, 27.5, 22, 16.5, 11, 5.5 and 0 days before the clock
// (the clock moves 5.5 days between them), so the last 7 days hold two matches, the last 30 days six, all time seven. The oracle
// of a window is the public reads (leaderboard, player results) of the matches `isInPeriod` keeps, never the ranking code.
// Key values and ids are planted literals. Every test drives a real server and plays matches: explicit headroom.

vi.setConfig({ testTimeout: 120_000 });
afterEach(closeAllServers);

const DAY = 86_400_000;
const LENGTH = { 'last-7-days': 7 * DAY, 'last-30-days': 30 * DAY } as const;
type Period = keyof typeof LENGTH;
const PERIODS = Object.keys(LENGTH) as Period[];
const ORDERS = ['points', 'correct', 'wins', 'accuracy'] as const;
const EMPTY = '{"items":[],"total":0}';
const invalid = (items: string[]): string => `{"kind":"invalid-request","items":${JSON.stringify(items)}}`;

interface Page {
  readonly items: (OracleRow & { readonly rank?: number })[];
  readonly total: number;
  readonly next?: string;
  readonly asker?: unknown;
}

/** The matches of the spread inside the window whose floor is `floor` (an oracle step independent of the ranking code), newest first. */
const inside = (spread: Spread, floor: number | undefined): Spread['matches'] =>
  spread.matches.map((made, i) => ({ made, at: spread.finishedAt[i]! })).filter((m) => isInPeriod(m.at, floor)).map((m) => m.made).reverse();

const floorNow = (h: ServerHarness, period: Period): number => h.clock.now() - LENGTH[period];

/** Pages of one walk with the windowed body, every row compared with the oracle over the matches inside `floor`. */
async function expectWindow(h: ServerHarness, spread: Spread, period: Period, floor: number, label: string): Promise<number> {
  const oracle = await oracleOf(h, inside(spread, floor));
  for (const order of ORDERS) {
    const walked = await walkRanking(h, DISCORD, { community: KEY_A, order, period }, 10);
    expect(walked.pages.flatMap((p) => p.items), `${label} ${order}`).toStrictEqual(expectedRows(oracle, order));
    expect(walked.pages.map((p) => p.total), `${label} ${order}`).toStrictEqual(walked.pages.map(() => oracle.size));
  }
  return oracle.size;
}

describe('FR-576 FR-577 (HTTP) a client reads each period over the matches inside it', () => {
  it('FR-577 (HTTP) in each period and every order, pages of 10 give every row, rank, shown name, total and asker the public reads of the matches inside the window show', async () => {
    const h = await startHistory();
    const spread = await populateSpread(h);
    const sizes: Record<string, number> = {};
    for (const period of PERIODS) sizes[period] = await expectWindow(h, spread, period, floorNow(h, period), period);
    // The three scopes differ: 6 players in the week, 18 in the month (the player of the oldest match is out), 19 all time.
    const all = await oracleOf(h, inside(spread, undefined));
    expect([sizes['last-7-days'], sizes['last-30-days'], all.size]).toStrictEqual([6, 18, 19]);
    expect((await walkRanking(h, DISCORD, { community: KEY_A }, 10)).pages[0]!.total).toBe(19);
    // The asker is their row inside the window with their rank in every order (u72 plays a match of the week, u2 one of the month).
    for (const [period, asker] of [['last-7-days', 'u72'], ['last-30-days', 'u2']] as const) {
      const oracle = await oracleOf(h, inside(spread, floorNow(h, period)));
      for (const order of ORDERS) {
        const asked = (await postRanking(h, DISCORD.credential, { community: KEY_A, order, period, playerId: asker })).json() as Page;
        const row = expectedRows(oracle, order).find((r) => r.playerId === `discord:${asker}`)!;
        expect(asked.asker, `${period} ${order}`).toStrictEqual({ points: row.points, correct: row.correct, scored: row.scored, played: row.played, won: row.won, ...(row.rank === undefined ? {} : { rank: row.rank }) });
      }
    }
    // A player whose only matches are outside the window has no row there: u00 played only the oldest match.
    expect(((await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-30-days', playerId: 'u00', limit: 500 })).json() as Page).items.map((r) => r.playerId)).not.toContain('discord:u00');
    expect((await postRanking(h, DISCORD.credential, { community: KEY_A, playerId: 'u00' })).json()).toMatchObject({ asker: { played: 1 } });
    // The asker of a window who played none of its matches (u00 only played the oldest): the page of the window, and `played: false`.
    const stranger = (await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days', playerId: 'u00' })).json() as Page;
    expect(stranger.asker).toStrictEqual({ played: false });
  });

  it('FR-576 FR-577 (HTTP) a match finished exactly at the floor is in the window, one finished 1 ms before is out, in both periods', async () => {
    const h = await startHistory();
    const spread = await populateSpread(h);
    // The first match inside each window by the plan of the spread: the week holds the matches 5 and 6, the month 1 to 6.
    for (const [period, first] of [['last-7-days', 5], ['last-30-days', 1]] as const) {
      const at = spread.finishedAt[first]!;
      h.clock.set(at + LENGTH[period]);
      expect(floorNow(h, period)).toBe(at);
      const atFloor = await expectWindow(h, spread, period, at, `${period} at the floor`);
      h.clock.set(at + LENGTH[period] + 1);
      const oneAfter = await expectWindow(h, spread, period, at + 1, `${period} one ms later`);
      // The boundary moved: the match at the floor left the window.
      expect(atFloor, period).toBeGreaterThan(oneAfter);
      // Reading the clock the other way: one ms earlier than the floor of the match, the match before it is still out.
      h.clock.set(at + LENGTH[period] - 1);
      expect(await expectWindow(h, spread, period, at - 1, `${period} one ms earlier`), period).toBe(atFloor);
    }
  });

  it('FR-576 (HTTP) a walk whose clock advances 31 days between its pages keeps its rows, its total and its floor, with no repeat or skip, in each period', async () => {
    const h = await startHistory();
    const spread = await populateSpread(h);
    for (const period of PERIODS) {
      const reference = await walkRanking(h, DISCORD, { community: KEY_A, period, playerId: 'u2' }, 4);
      expect(reference.pages.length, period).toBeGreaterThan(1);
      // The same walk, the clock moving 31 days after its first page (more than the window length of either period).
      const texts: string[] = [];
      let reply = await postRanking(h, DISCORD.credential, { community: KEY_A, period, playerId: 'u2', limit: 4 });
      texts.push(reply.text);
      const t0 = h.clock.now();
      h.clock.advance(31 * DAY);
      let guard = 0;
      while ((reply.json() as Page).next !== undefined && guard++ < 20) {
        reply = await postRanking(h, DISCORD.credential, { community: KEY_A, period, playerId: 'u2', limit: 4, cursor: (reply.json() as Page).next });
        expect(reply.status).toBe(200);
        texts.push(reply.text);
      }
      expect(texts, period).toStrictEqual(reference.texts);
      const rows = texts.flatMap((t) => (JSON.parse(t) as Page).items.map((r) => r.playerId));
      expect(new Set(rows).size, period).toBe(rows.length);
      // The cursor of the first page carries the floor of the first page's clock, not the later one.
      const decoded = decodeCursor('ranking', (JSON.parse(texts[0]!) as Page).next!);
      expect(decoded.ok && (decoded.value as readonly unknown[])[5], period).toBe(t0 - LENGTH[period]);
      // A fresh walk reads the moved clock: the newest match is now 31 days old, older than the floor of either period.
      const fresh = await postRanking(h, DISCORD.credential, { community: KEY_A, period, playerId: 'u2' });
      expect([fresh.status, fresh.text], period).toStrictEqual([200, EMPTY]);
      h.clock.set(t0);
    }
    expect(spread.matches).toHaveLength(7);
  });

  it('FR-576 (HTTP) a match finishing during a windowed walk does not join it, and a fresh walk counts it', async () => {
    const h = await startHistory();
    await populateSpread(h);
    const reference = await walkRanking(h, DISCORD, { community: KEY_A, period: 'last-7-days' }, 3);
    const first = await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days', limit: 3 });
    expect(first.text).toBe(reference.texts[0]);
    const late: RankPlayer[] = [
      { client: DISCORD, local: 'u91', victim: 'wrong', absorber: 'wrong', winner: 'wrong' },
      { client: DISCORD, local: 'u92', victim: 'right', absorber: 'wrong', winner: 'wrong' },
      { client: DISCORD, local: 'u93', victim: 'wrong', absorber: 'right', winner: 'right' },
    ];
    playMatch(h, await createCommunityMatch(h, DISCORD, 'late', KEY_A), late);
    const texts = [first.text];
    let cursor = (first.json() as Page).next;
    let guard = 0;
    while (cursor !== undefined && guard++ < 20) {
      const reply = await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days', limit: 3, cursor });
      texts.push(reply.text);
      cursor = (reply.json() as Page).next;
    }
    expect(texts).toStrictEqual(reference.texts);
    const fresh = await walkRanking(h, DISCORD, { community: KEY_A, period: 'last-7-days' }, 500);
    expect(fresh.pages[0]!.total).toBe(9);
    expect(fresh.pages.flatMap((p) => p.items.map((r) => r.playerId))).toContain('discord:u93');
  });
});

describe('FR-575 FR-578 (HTTP) the request names its period, never a floor, and a walk is held to its period', () => {
  it('FR-575 (HTTP) an unknown period, a floor or any instant member in the body is invalid-request naming it, and `all` is the request with none', async () => {
    const h = await startHistory();
    await populateSpread(h);
    const send = async (body: unknown): Promise<string> => (await postRanking(h, DISCORD.credential, body)).text;
    expect(await send({ community: KEY_A, period: 'last-1-days' })).toBe(invalid(['period']));
    expect(await send({ community: KEY_A, period: 'week' })).toBe(invalid(['period']));
    expect(await send({ community: KEY_A, period: 7 })).toBe(invalid(['period']));
    expect(await send({ community: KEY_A, period: null })).toBe(invalid(['period']));
    expect(await send({ community: KEY_A, period: ['last-7-days'] })).toBe(invalid(['period']));
    expect(await send({ community: KEY_A, period: '' })).toBe(invalid(['period']));
    for (const member of ['floor', 'since', 'from', 'until', 'at', 'now', 'instant', 'finishedAt', 'start', 'window']) {
      expect(await send({ community: KEY_A, period: 'last-7-days', [member]: 1_700_000_000_000 }), member).toBe(invalid([member]));
    }
    const raw = (text: string): Promise<{ status: number; text: string }> =>
      request(h.port, { method: 'POST', path: '/ranking', body: text, headers: { authorization: `Bearer ${DISCORD.credential}`, 'content-type': 'application/json' } });
    // A repeated `period` in the raw text is read as the last one, exactly as a repeated `order` of 025 is (only `community` and
    // `joinPolicy` have a body-level repeat guard); a repeated unknown one is refused by name.
    expect((await raw(`{"community":"${KEY_A}","period":"last-30-days","period":"last-7-days","limit":500}`)).text).toBe((await send({ community: KEY_A, period: 'last-7-days', limit: 500 })));
    expect((await raw(`{"community":"${KEY_A}","period":"last-7-days","period":"nope"}`)).text).toBe(invalid(['period']));
    // `all` and no period are the same request: the same bytes, the cursor included.
    expect(await send({ community: KEY_A, period: 'all', limit: 4, playerId: 'u2' })).toBe(await send({ community: KEY_A, limit: 4, playerId: 'u2' }));
    // No error text carries the period or the key that was sent.
    for (const body of [{ community: KEY_A, period: 'last-1-days' }, { community: KEY_A, floor: 5 }]) expect(await send(body)).not.toMatch(/last-1-days|floor":5/);
  });

  it('FR-578 (HTTP) a period/cursor mismatch is invalid-request naming the cursor, in every direction', async () => {
    const h = await startHistory();
    await populateSpread(h);
    const cursorOf = async (extra: Record<string, unknown>): Promise<string> => ((await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 2, ...extra })).json() as Page).next!;
    const week = await cursorOf({ period: 'last-7-days' });
    const month = await cursorOf({ period: 'last-30-days' });
    const all = await cursorOf({});
    for (const [label, body] of [
      ['week cursor, month request', { period: 'last-30-days', cursor: week }],
      ['month cursor, week request', { period: 'last-7-days', cursor: month }],
      ['week cursor, no period', { cursor: week }],
      ['week cursor, period all', { period: 'all', cursor: week }],
      ['month cursor, no period', { cursor: month }],
      ['all-time cursor, week request', { period: 'last-7-days', cursor: all }],
      ['all-time cursor, month request', { period: 'last-30-days', cursor: all }],
    ] as const) {
      const reply = await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 2, ...body });
      expect([reply.status, reply.text], label).toStrictEqual([400, invalid(['cursor'])]);
    }
    // Each cursor continues its own walk (an all-time one with `all` too).
    expect((await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 2, period: 'last-7-days', cursor: week })).status).toBe(200);
    expect((await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 2, period: 'last-30-days', cursor: month })).status).toBe(200);
    expect((await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 2, period: 'all', cursor: all })).status).toBe(200);
    // The order mismatch of 025 still holds on a windowed cursor.
    const cross = await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 2, order: 'wins', period: 'last-7-days', cursor: week });
    expect([cross.status, cross.text]).toStrictEqual([400, invalid(['cursor'])]);
  });

  it('FR-575 (HTTP) a windowed request reaches the service with its period only, never a floor, and an all-time request exactly as in 025; the store reads get the floor of the clock', async () => {
    const seen: unknown[] = [];
    const floors: (number | undefined)[] = [];
    const h = await startHistory({
      stub: {
        ranking: (request) => {
          seen.push(request);
          return { ok: true, reply: { total: 0, items: [] } };
        },
      },
    });
    await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days', playerId: 'u1', limit: 4 });
    await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'all', playerId: 'u1', limit: 4 });
    await postRanking(h, WEB.credential, { community: KEY_B, period: 'last-30-days', order: 'wins' });
    await postRanking(h, WEB.credential, { community: KEY_B });
    expect(seen).toStrictEqual([
      { namespace: 'discord', community: KEY_A, order: 'points', period: 'last-7-days', limit: 4, playerId: 'u1' },
      { namespace: 'discord', community: KEY_A, order: 'points', limit: 4, playerId: 'u1' },
      { namespace: 'web', community: KEY_B, order: 'wins', period: 'last-30-days', limit: 100 },
      { namespace: 'web', community: KEY_B, order: 'points', limit: 100 },
    ]);
    // The real service: the floor each store read gets is the clock of the first page minus the period length (none for all time).
    const wrapped = await startHistory({
      wrapStore: (store) =>
        ({
          ...store,
          rankingResults: (...args: Parameters<Store['rankingResults']>) => {
            floors.push(args[3]);
            return store.rankingResults(...args);
          },
          rankingNames: (...args: Parameters<Store['rankingNames']>) => {
            floors.push(args[3]);
            return store.rankingNames(...args);
          },
        }) as Store,
    });
    await populateSpread(wrapped);
    floors.length = 0;
    const now = wrapped.clock.now();
    await postRanking(wrapped, DISCORD.credential, { community: KEY_A, period: 'last-7-days' });
    await postRanking(wrapped, DISCORD.credential, { community: KEY_A, period: 'last-30-days' });
    await postRanking(wrapped, DISCORD.credential, { community: KEY_A, period: 'all' });
    await postRanking(wrapped, DISCORD.credential, { community: KEY_A });
    expect(floors).toStrictEqual([periodFloorOf('last-7-days', now), periodFloorOf('last-7-days', now), periodFloorOf('last-30-days', now), periodFloorOf('last-30-days', now), undefined, undefined, undefined, undefined]);
  });
});

describe('FR-579 (HTTP) the windowed read follows the 025 read: only a client, bare empty replies, no key echoed, nothing stored', () => {
  it('FR-579 (HTTP) anonymous, a bad token, the operator, a host token and a player token get the forbidden bytes with a period too', async () => {
    const h = await startHistory();
    const made = await createCommunityMatch(h, DISCORD, 'a-0', KEY_A);
    const open = await request(h.port, { method: 'POST', path: '/matches', body: { mapId: 'dev', timing: { i: 120, l1: 30, l2: 10 }, requestId: 'open-1' } });
    const lobby = (open.json() as { matchId: string }).matchId;
    const joined = await request(h.port, { method: 'POST', path: `/matches/${lobby}/players`, body: { name: 'Joiner', requestId: 'j-1' } });
    const playerToken = (joined.json() as { playerToken: string }).playerToken;
    const reference = await request(h.port, { method: 'POST', path: `/matches/${made.id}/advance`, body: { round: 1, step: 'phase-1-close' }, headers: { authorization: 'Bearer not-a-credential-0123456789' } });
    expect([reference.status, reference.text]).toStrictEqual([403, errorBody('forbidden')]);
    for (const period of PERIODS) {
      for (const [label, token] of [['anonymous', undefined], ['a bad token', 'not-a-credential-0123456789'], ['the operator', OPERATOR], ['a host token', made.hostToken], ['a player token', playerToken]] as const) {
        const reply = await postRanking(h, token, { community: KEY_A, period, playerId: 'u1', limit: 10 });
        expect([reply.status, reply.text], `${period} ${label}`).toStrictEqual([reference.status, reference.text]);
      }
    }
  });

  it('FR-579 (HTTP) another namespace, an unknown key, an empty windowed snapshot, a head older than the floor and a forged later floor answer the same bytes, a player named or not', async () => {
    const h = await startHistory();
    const spread = await populateSpread(h);
    for (const period of PERIODS) {
      const unknown = await postRanking(h, DISCORD.credential, { community: KEY_B, period, playerId: 'u1' });
      expect([unknown.status, unknown.text], period).toStrictEqual([200, EMPTY]);
      const other = await postRanking(h, WEB.credential, { community: KEY_A, period, playerId: 'u1', limit: 5 });
      expect([other.status, other.text], period).toStrictEqual([200, EMPTY]);
      // A windowed cursor of the Discord walk read under the web credential is empty too.
      const first = (await postRanking(h, DISCORD.credential, { community: KEY_A, period, limit: 2 })).json() as Page;
      const cross = await postRanking(h, WEB.credential, { community: KEY_A, period, limit: 2, cursor: first.next });
      expect([cross.status, cross.text], period).toStrictEqual([200, EMPTY]);
      // A forged cursor whose floor is later than its head: the window holds no match.
      const key = decodeCursor('ranking', first.next!);
      if (!key.ok || key.value!.length !== 6) throw new Error('the windowed cursor is a 6-part key');
      const [order, headAt, headId, local, index] = key.value as readonly [number, number, string, string, number, number];
      for (const floor of [headAt + 1, headAt + 30 * DAY]) {
        const forged = await postRanking(h, DISCORD.credential, { community: KEY_A, period, limit: 2, playerId: 'u2', cursor: encodeCursor('ranking', [order, headAt, headId, local, index, floor]) });
        expect([forged.status, forged.text], `${period} forged ${floor - headAt}`).toStrictEqual([200, EMPTY]);
      }
    }
    // A head older than the floor: the clock moves past both windows, the newest match is more than 30 days old.
    h.clock.set(spread.finishedAt[6]! + 31 * DAY);
    for (const period of PERIODS) {
      for (const body of [{ community: KEY_A, period }, { community: KEY_A, period, playerId: 'u2' }, { community: KEY_A, period, playerId: 'nobody-zz-1', order: 'accuracy' }]) {
        const reply = await postRanking(h, DISCORD.credential, body);
        expect([reply.status, reply.text], `${period} ${JSON.stringify(body)}`).toStrictEqual([200, EMPTY]);
      }
    }
    // The all-time read of the same clock is not empty (and keeps its asker): the empty windowed reply is the window's.
    const all = (await postRanking(h, DISCORD.credential, { community: KEY_A, playerId: 'u2' })).json() as Page;
    expect(all.total).toBe(19);
  });

  it('FR-579 (HTTP) any query text is invalid-request naming `query`, a period or a key in a query is never read, and a body period is read as usual', async () => {
    const h = await startHistory();
    await populateSpread(h);
    for (const path of ['/ranking?period=last-7-days', '/ranking?floor=1', `/ranking?${KEY_A}=1&period=last-30-days`]) {
      const reply = await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days' }, path);
      expect([reply.status, reply.text], path).toStrictEqual([400, '{"kind":"invalid-request","items":["query"]}']);
    }
    const viaQuery = await postRanking(h, DISCORD.credential, { community: KEY_A }, '/ranking?period=last-7-days');
    expect(viaQuery.status).toBe(400);
    expect(viaQuery.text).not.toContain('last-7-days');
    // The same request without query text: the week answers, and differs from the all-time reply.
    const week = await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days', limit: 500 });
    const all = await postRanking(h, DISCORD.credential, { community: KEY_A, limit: 500 });
    expect((week.json() as Page).total).toBe(6);
    expect((all.json() as Page).total).toBe(19);
  });

  it('FR-579 (HTTP) nothing is stored or memoised by a windowed read: the database file has the same rows after any number of reads', async () => {
    await withTempDirAsync(async (dir) => {
      const file = join(dir, 'p.sqlite');
      const h = await startHistory({ wrapStore: () => openStore(file) });
      const spread = await populateSpread(h);
      await h.close();
      const memoRows = (): number => withRawDb(file, (db) => Number(db.prepare('SELECT COUNT(*) AS n FROM memo').get()?.n));
      const before = withRawDb(file, dumpRows);
      const memoBefore = memoRows();
      expect(memoBefore).toBe(7);
      const again = await startHistory({ wrapStore: () => openStore(file) });
      // The new harness's clock starts long before the stored matches: move it just past the newest one, so the reads find rows.
      again.clock.set(spread.finishedAt[6]! + 10_000);
      expect(((await postRanking(again, DISCORD.credential, { community: KEY_A, period: 'last-7-days' })).json() as Page).total).toBe(6);
      for (const period of ['last-7-days', 'last-30-days', 'all'] as const) {
        for (const body of [{ community: KEY_A, period, limit: 5 }, { community: KEY_A, period, playerId: 'u1', limit: 5 }, { community: KEY_B, period }, { community: KEY_A, period, cursor: 'bad' }, { community: KEY_A, period, order: 'accuracy' }]) {
          await postRanking(again, DISCORD.credential, body);
          await postRanking(again, WEB.credential, body);
        }
      }
      await again.close();
      expect(withRawDb(file, dumpRows)).toBe(before);
      expect(memoRows()).toBe(memoBefore);
    });
  });

  it('FR-579 (HTTP) no reply, header or log line carries the key, the period word or the floor; a storage failure is unavailable and the same request answers once the store works', async () => {
    let failing = false;
    const h = await startHistory({
      wrapStore: (store) =>
        ({
          ...store,
          rankingResults: (...args: Parameters<Store['rankingResults']>) => {
            if (failing) throw new StoreError('store-failure', `${PLANTED} injected`);
            return store.rankingResults(...args);
          },
        }) as Store,
    });
    await populateSpread(h);
    const ASKER = 'asker-zz-91';
    const now = h.clock.now();
    const floor7 = String(now - 7 * DAY);
    const floor30 = String(now - 30 * DAY);
    const replies = [
      await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days', playerId: ASKER, limit: 2 }),
      await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-30-days', playerId: ASKER, limit: 500 }),
      await postRanking(h, DISCORD.credential, { community: KEY_B, period: 'last-7-days', playerId: ASKER }),
      await postRanking(h, WEB.credential, { community: KEY_A, period: 'last-7-days' }),
      await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days', playerId: ASKER, zzz: 1 }),
      await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-1-days', playerId: ASKER }),
      await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days', playerId: ASKER }, `/ranking?community=${KEY_A}`),
    ];
    failing = true;
    const boom = await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days', playerId: ASKER });
    expect([boom.status, boom.text]).toStrictEqual([503, errorBody('unavailable')]);
    replies.push(boom);
    for (const reply of replies) {
      const wire = `${reply.text}${JSON.stringify(reply.headers)}`;
      for (const secret of [KEY_A, KEY_B, ASKER, 'last-7-days', 'last-30-days', floor7, floor30, PLANTED]) expect(wire, secret).not.toContain(secret);
    }
    const logged = JSON.stringify(h.logs);
    for (const secret of [KEY_A, KEY_B, ASKER, 'last-7-days', 'last-30-days', floor7, floor30, PLANTED]) expect(logged, secret).not.toContain(secret);
    failing = false;
    const healed = await postRanking(h, DISCORD.credential, { community: KEY_A, period: 'last-7-days', limit: 500 });
    expect(healed.status).toBe(200);
    expect((healed.json() as Page).total).toBe(6);
  });
});

describe('FR-579 (HTTP) a match that is not finished changes no byte of a windowed reply', () => {
  it('FR-579 (HTTP) a running match of the community with scored predictions inside the window leaves every windowed page as it was', async () => {
    const h = await startHistory();
    await populateSpread(h);
    const bodies = PERIODS.flatMap((period) => ORDERS.map((order) => ({ community: KEY_A, period, order, playerId: 'u2', limit: 500 })));
    const before = await Promise.all(bodies.map(async (body) => (await postRanking(h, DISCORD.credential, body)).text));
    const running = await createCommunityMatch(h, DISCORD, 'running', KEY_A);
    const started = h.service.startMatch({ credential: running.hostToken, matchId: running.id, body: {} });
    if (!started.ok) throw new Error('start refused');
    h.clock.advance(1000);
    const out = h.service.submit({ client: { credential: DISCORD.credential, namespace: 'discord' }, matchId: running.id, body: { playerId: 'u2', name: 'Planted Runner', kind: 'winner', faction: living(h, running.id)[0]! } });
    if (!out.ok && out.error.kind !== 'forced-absorber') throw new Error('submission refused');
    const after = await Promise.all(bodies.map(async (body) => (await postRanking(h, DISCORD.credential, body)).text));
    expect(after).toStrictEqual(before);
    expect(after.join('')).not.toContain('Planted Runner');
  });
});
