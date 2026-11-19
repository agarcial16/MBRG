import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCursor } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { READ_SQL, openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { withRawDb } from './helpers/db-scan';
import { DISCORD, KEY_A, KEY_B, createCommunityMatch, playMatch, postHistory, startHistory } from './helpers/history-kit';
import type { Player } from './helpers/history-kit';
import { closeAllServers } from './helpers/server-harness';

// Spec 024 NFR-121 (bounded work): one page of the history costs the same constant number of store statements whatever the history
// holds. A real match is played to its end once (three players, names, points); its rows are copied by SQL into 10, then 1,000
// finished matches of one community and 1,000 of another; the same requests are then counted through a counting store wrapper.
// The query plans of the two reads are checked on the large file too: index lookups, never a scan.

const dirs: string[] = [];
afterEach(async () => {
  await closeAllServers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const ANA: Player = { client: DISCORD, local: 'u1', name: 'Ana', victim: 'right', absorber: 'right', winner: 'right' };
const BEA: Player = { client: DISCORD, local: 'u2', name: 'Bea', victim: 'right', absorber: 'wrong', winner: 'wrong' };
const CAL: Player = { client: DISCORD, local: 'u3', victim: 'wrong', absorber: 'wrong', winner: 'wrong' };

const cloneId = (n: number): string => `c${String(n).padStart(15, '0')}`;

/** Copies the rows of `from` in `table` as the match `to`, with `overrides` for named columns. */
function copyRows(db: DatabaseSync, table: string, keyColumn: string, from: string, to: string, overrides: Record<string, string | number> = {}): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => String(c.name));
  const params: (string | number)[] = [];
  const select = columns.map((column) => {
    if (column === keyColumn) {
      params.push(to);
      return '?';
    }
    const over = overrides[column];
    if (over === undefined) return column;
    params.push(over);
    return '?';
  });
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) SELECT ${select.join(', ')} FROM ${table} WHERE ${keyColumn} = ?`).run(...params, from);
}

/** Finished matches copied from the played one: `count` of KEY_A, then `count` of KEY_B (other instants, other ids). */
function clones(file: string, template: string, count: number): void {
  withRawDb(file, (db) => {
    const last = Number((db.prepare('SELECT last_step_ms AS t FROM matches WHERE id = ?').get(template) as { t: number }).t);
    db.exec('BEGIN');
    for (let i = 1; i < count; i += 1) {
      const id = cloneId(i);
      copyRows(db, 'matches', 'id', template, id, { last_step_ms: last + 1000 * i });
      for (const table of ['results', 'client_matches', 'client_names']) copyRows(db, table, 'match_id', template, id);
      copyRows(db, 'communities', 'match_id', template, id);
    }
    for (let i = 0; i < count; i += 1) {
      const id = cloneId(100_000 + i);
      copyRows(db, 'matches', 'id', template, id, { last_step_ms: last + 500 + 1000 * i });
      for (const table of ['results', 'client_matches', 'client_names']) copyRows(db, table, 'match_id', template, id);
      copyRows(db, 'communities', 'match_id', template, id, { community: KEY_B });
    }
    db.exec('COMMIT');
  });
}

/** A store wrapper that counts every method call by name. */
const counting = (store: Store, counts: Map<string, number>): Store =>
  new Proxy(store, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        counts.set(String(prop), (counts.get(String(prop)) ?? 0) + 1);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });

interface Counted {
  readonly pages: string[];
  readonly counts: Record<string, number>[];
}

/** Reads the first page, the second by its cursor, a deep one by a made cursor and the last page, counting each. */
async function measure(file: string, total: number): Promise<Counted> {
  const counts = new Map<string, number>();
  const keys = withRawDb(file, (db) =>
    db
      .prepare('SELECT m.last_step_ms AS t, m.id AS id FROM matches m JOIN communities c ON c.match_id = m.id WHERE c.community = ? ORDER BY m.last_step_ms DESC, m.id ASC')
      .all(KEY_A)
      .map((r) => [Number(r.t), String(r.id)] as const),
  );
  expect(keys).toHaveLength(total);
  const h = await startHistory({ wrapStore: (inner) => (inner.close(), counting(openStore(file), counts)) });
  const head = keys[0]!;
  const bodies: Record<string, unknown>[] = [
    { community: KEY_A, playerId: 'u1', limit: 5 },
    { community: KEY_A, playerId: 'u1', limit: 5, cursor: encodeCursor('history', [head[0], head[1], keys[4]![0], keys[4]![1]]) },
    { community: KEY_A, playerId: 'u1', limit: 5, cursor: encodeCursor('history', [head[0], head[1], keys[Math.floor(total / 2)]![0], keys[Math.floor(total / 2)]![1]]) },
    { community: KEY_A, playerId: 'u1', limit: 5, cursor: encodeCursor('history', [head[0], head[1], keys[total - 3]![0], keys[total - 3]![1]]) },
    { community: KEY_B, limit: 5 },
  ];
  const pages: string[] = [];
  const perPage: Record<string, number>[] = [];
  for (const body of bodies) {
    counts.clear();
    const reply = await postHistory(h, DISCORD.credential, body);
    expect(reply.status, JSON.stringify(body)).toBe(200);
    pages.push(reply.text);
    perPage.push(Object.fromEntries([...counts].sort()));
  }
  return { pages, counts: perPage };
}

describe('NFR-121 a page of the history is bounded work', () => {
  it('NFR-121 one page costs the same store statements with 10 and with 1,000 finished matches in the community, and the plans have no scan', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrg-bounds-'));
    dirs.push(dir);
    const template = join(dir, 'template.sqlite');
    const h = await startHistory({ wrapStore: (inner) => (inner.close(), openStore(template)) });
    const made = await createCommunityMatch(h, DISCORD, 'tpl', KEY_A);
    playMatch(h, made, [ANA, BEA, CAL], true);
    await closeAllServers();

    const small = join(dir, 'small.sqlite');
    const large = join(dir, 'large.sqlite');
    copyFileSync(template, small);
    copyFileSync(template, large);
    clones(small, made.id, 10);
    clones(large, made.id, 1000);

    const a = await measure(small, 10);
    const b = await measure(large, 1000);
    // Two statements for the page and the total, and two for each entry (its leaderboard and its names), whatever the history holds.
    const shape = (counted: Counted, i: number): Record<string, number> => {
      const items = (JSON.parse(counted.pages[i]!) as { items: unknown[] }).items.length;
      return { clientNames: items, historyAfter: 1, historyCount: 1, leaderboardTotals: items };
    };
    for (const counted of [a, b]) for (let i = 0; i < 5; i += 1) expect(counted.counts[i], `page ${i}`).toStrictEqual(shape(counted, i));
    // The full pages of the two histories cost exactly the same, down to the call.
    for (const i of [0, 1]) expect(b.counts[i]).toStrictEqual(a.counts[i]);
    expect(b.counts[2]).toStrictEqual({ clientNames: 5, historyAfter: 1, historyCount: 1, leaderboardTotals: 5 });
    // A page near the end of the large history has its 2 entries and 2 + 2 x 2 statements; the other community counts as its own.
    const lastBig = JSON.parse(b.pages[3]!) as { items: unknown[]; total: number };
    expect(lastBig.total).toBe(1000);
    expect(lastBig.items).toHaveLength(2);
    expect(JSON.parse(b.pages[4]!)).toMatchObject({ total: 1000 });
    expect(JSON.parse(a.pages[0]!)).toMatchObject({ total: 10 });

    // The plans on the large file, with data: index lookups, never a scan of the three tables.
    await closeAllServers();
    withRawDb(large, (db) => {
      const after = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL.historyAfter}`).all(KEY_A, 'discord', null, null, null, null, null, null, null, null, 5).map((r) => String(r.detail));
      const count = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL.historyCount}`).all(KEY_A, 'discord', null, null, null, null).map((r) => String(r.detail));
      for (const plan of [after, count]) {
        expect(plan.filter((d) => /\bSCAN\b/.test(d)), plan.join(' | ')).toStrictEqual([]);
        expect(plan.some((d) => /communities_by_key/.test(d)), plan.join(' | ')).toBe(true);
      }
    });
  }, 120_000);
});
