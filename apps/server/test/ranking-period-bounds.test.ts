import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { PublicState } from '@mbrg/protocol';
import { decodeCursor } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { CoreMatch } from '../src/core/view';
import type { ResultRow } from '../src/core/scoring';
import { isInPeriod, periodFloorOf } from '../src/core/ranking';
import { READ_SQL, openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Spec 027 NFR-128 (source scan part) and NFR-130 (server part): the windowed ranking work is bounded. The floor is one more
// lower bound on the reads 025 already makes, so a windowed page makes the SAME store calls as an all-time page whatever the
// stored matches (a recording wrapper), with 1,000 counted matches of ten scored players each spread over 60 days in each of two
// communities, and both statements still reach communities, matches and their result tables through indexes only (a floor that
// is positive, negative or none). The accepted model: the floor filters the rows the index walk reaches, so the cost grows with
// the matches of the community that sit at or after the head, not with the window; the totals are what the instants say. The
// sources read the community storage only where 024 and 025 did, and the log modules know neither the period nor the floor.
// Key values and ids are planted literals.

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 17 + 3) % 256);
const DAY = 86_400_000;
const T0 = 1_690_000_000_000;
// 1,000 matches over 59.9 days; the service clock stands one day after the newest, so every match is settled and the
// 7-day and 30-day floors fall inside the stored range.
const STEP = Math.floor((60 * DAY) / 1000);
const NOW = T0 + 999 * STEP + DAY;
const KEY_R = '5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b';
const KEY_S = '7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d';
const KEY_T = '9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f';
const NAMESPACE = 'rank';
const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 10], [3, 10]] });

const put = (store: Store, id: string, community: string, at: number): void => {
  const match: CoreMatch = {
    matchId: id,
    mapId: 'dev',
    mapDigest: DIGEST('a'),
    totalRounds: 5,
    timing: { i: 120, l1: 30, l2: 10 },
    commitment: DIGEST('c'),
    stage: 'finished',
    appliedRounds: 5,
    state: state(5),
    stateDigest: DIGEST('d'),
    lastSeq: 1,
    createdAt: T0,
    lastStepMs: at,
    anchors: null,
    winner: 10,
  };
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    store.insertClientMatch(id, NAMESPACE);
    store.insertCommunity(id, community);
  });
};

/** Ten scored players of one match: two result rows each, distinct players per instant. */
const putTen = (store: Store, matchId: string, at: number): void => {
  const rows: ResultRow[] = [];
  for (let p = 0; p < 10; p += 1) {
    const playerId = `${NAMESPACE}:q${at}x${p}`;
    const rightVictim = p % 2 === 0;
    const rightAbsorber = p % 3 === 0;
    rows.push({ playerId, kind: 'victim', round: 1, choice: 3, correct: rightVictim, points: rightVictim ? p + 1 : 0 });
    rows.push({ playerId, kind: 'absorber', round: 1, choice: 2, correct: rightAbsorber, points: rightAbsorber ? p + 1 : 0 });
  }
  store.transaction(() => store.putResults(matchId, rows));
};

/** The finish instants of the `count` matches of a community: `offset` ms later than the grid, so two communities differ. */
const instants = (count: number, offset: number): number[] => Array.from({ length: count }, (_, i) => T0 + i * STEP + offset);

function seed(store: Store, community: string, at: readonly number[], tag: string): void {
  at.forEach((instant, i) => {
    const matchId = `${tag}${String(i).padStart(4, '0')}`.padEnd(16, tag);
    put(store, matchId, community, instant);
    putTen(store, matchId, instant);
  });
}

/** A store wrapper that records the name of every method the service calls. */
const recording = (store: Store): { store: Store; calls: () => string[] } => {
  const seen: string[] = [];
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(store)) {
    wrapped[name] =
      typeof value === 'function'
        ? (...args: unknown[]) => {
            seen.push(name);
            return (value as (...a: unknown[]) => unknown).apply(store, args);
          }
        : value;
  }
  return { store: wrapped as unknown as Store, calls: () => seen.splice(0) };
};

type Read = ReturnType<Harness['service']['ranking']>;
const first = (h: Harness, community: string, period?: 'last-7-days' | 'last-30-days', after?: unknown, limit = 10): Read =>
  h.service.ranking({ namespace: NAMESPACE, community, order: 'points', limit, ...(period === undefined ? {} : { period }), ...(after === undefined ? {} : { after }) } as Parameters<Harness['service']['ranking']>[0]);
const nextOf = (out: Read): unknown => {
  if (!out.ok || out.reply.next === undefined) throw new Error('no next page');
  const decoded = decodeCursor('ranking', out.reply.next);
  if (!decoded.ok) throw new Error('bad cursor');
  return decoded.value;
};

describe('NFR-130 (server part) the windowed ranking work is bounded whatever the stored matches', () => {
  it('NFR-130 (server part) a windowed page makes the store calls of an all-time page over 10 matches, with 1,000 counted matches over 60 days in each of two communities, and its totals are the instants\'', () => {
    const store = openStore(':memory:');
    const a = instants(1000, 0);
    const b = instants(1000, 2_700_000);
    seed(store, KEY_T, instants(10, 0).map((t) => t + 50 * DAY), 't');
    seed(store, KEY_R, a, 'r');
    seed(store, KEY_S, b, 's');
    const wrapped = recording(store);
    const h = serviceHarness({ store: wrapped.store, start: NOW });
    try {
      // The reference: an all-time first page and a later page over the community of 10 matches.
      const reference = first(h, KEY_T);
      expect(reference.ok && reference.reply.total).toBe(100);
      const referenceFirst = wrapped.calls().sort();
      expect(referenceFirst).toStrictEqual(['historyAfter', 'rankingNames', 'rankingResults']);
      first(h, KEY_T, undefined, nextOf(reference));
      const referenceLater = wrapped.calls().sort();
      expect(referenceLater).toStrictEqual(['rankingNames', 'rankingResults']);
      for (const [community, grid] of [[KEY_R, a], [KEY_S, b]] as const) {
        for (const period of ['last-7-days', 'last-30-days'] as const) {
          const floor = periodFloorOf(period, NOW);
          const inside = grid.filter((at) => isInPeriod(at, floor)).length;
          // Between a tenth of the matches and all of them but 400: the window really cuts, and is not empty.
          expect(inside, period).toBeGreaterThan(50);
          expect(inside, period).toBeLessThan(600);
          const page = first(h, community, period);
          expect(page.ok && page.reply.total, `${community.slice(0, 4)} ${period}`).toBe(10 * inside);
          expect(wrapped.calls().sort(), `${community.slice(0, 4)} ${period} first page`).toStrictEqual(referenceFirst);
          const later = first(h, community, period, nextOf(page));
          expect(later.ok && later.reply.total, `${community.slice(0, 4)} ${period}`).toBe(10 * inside);
          expect(wrapped.calls().sort(), `${community.slice(0, 4)} ${period} later page`).toStrictEqual(referenceLater);
          // The windowed page equals the all-time page of a community that holds only the matches inside the window (items, total).
          const twin = openStore(':memory:');
          const twinHarness = serviceHarness({ store: twin, start: NOW });
          seed(twin, KEY_R, grid.filter((at) => isInPeriod(at, floor)), 'x');
          const alone = first(twinHarness, KEY_R, undefined, undefined, 500);
          const windowed = first(h, community, period, undefined, 500);
          expect(windowed.ok && windowed.reply.items, `${community.slice(0, 4)} ${period}`).toStrictEqual(alone.ok && alone.reply.items);
          expect(windowed.ok && windowed.reply.total).toBe(alone.ok && alone.reply.total);
          wrapped.calls();
          twinHarness.close();
          twin.close();
        }
        // All time reads every match of the community: 1,000 x 10 players.
        const everything = first(h, community);
        expect(everything.ok && everything.reply.total).toBe(10_000);
        wrapped.calls();
      }
    } finally {
      h.close();
      store.close();
    }
    // Seeds 2,010 matches with 40,200 result rows and folds up to 10,000 players a dozen times: near the default 5 s under the
    // full suite's CPU load, so the timeout is explicit.
  }, 120_000);

  it('NFR-130 (server part) both snapshot statements reach communities, matches, results and client_names through indexes: no scan of any table, with a positive, a negative and no floor, with and without a head bound', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrg-period-bounds-'));
    try {
      const file = join(dir, 'b.sqlite');
      openStore(file).close();
      const db = new DatabaseSync(file);
      try {
        for (const [sql, table] of [[READ_SQL.rankingResults, 'results'], [READ_SQL.rankingNames, 'client_names']] as const) {
          for (const bound of [true, false]) {
            for (const floor of [NOW - 7 * DAY, -604_800_000, undefined] as const) {
              const params = [KEY_R, NAMESPACE, ...(bound ? [T0, T0, T0, 'x'.repeat(16)] : [null, null, null, null]), floor ?? null, floor ?? null];
              const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => String(r.detail));
              const text = plan.join(' | ');
              expect(plan.filter((d) => /\bSCAN\b/.test(d)), text).toStrictEqual([]);
              expect(plan.some((d) => /SEARCH .*communities/.test(d)), text).toBe(true);
              expect(plan.some((d) => /SEARCH .*matches/.test(d)), text).toBe(true);
              expect(plan.some((d) => new RegExp(`SEARCH .*${table}`).test(d)), text).toBe(true);
            }
          }
        }
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe('NFR-128 (source scan part) the period adds no reader of the community storage and no log of the period or the floor', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
  const short = (file: string): string => file.slice(SRC.length + 1).replace(/\\/g, '/');

  it('NFR-128 (source scan part) the sources read `communities` only in the four statements of 024 and 025, and the service still calls them from exactly five places', () => {
    const readers = files(SRC).filter((f) => /\b(?:FROM|JOIN)\s+communities\b/i.test(readFileSync(f, 'utf8'))).map(short);
    expect([...new Set(readers)].sort()).toStrictEqual(['store/sqlite.ts']);
    const sqlite = readFileSync(join(SRC, 'store', 'sqlite.ts'), 'utf8');
    const keys = [...sqlite.matchAll(/(\w+):\s*`[^`]*\b(?:FROM|JOIN)\s+communities\b[^`]*`/g)].map((m) => String(m[1]));
    expect([...new Set(keys)].sort()).toStrictEqual(['historyAfter', 'historyCount', 'rankingNames', 'rankingResults']);
    expect(READ_SQL.rankingResults).toMatch(/last_step_ms >= \?/);
    expect(READ_SQL.rankingNames).toMatch(/last_step_ms >= \?/);
    const service = readFileSync(join(SRC, 'service', 'matches.ts'), 'utf8');
    expect([...service.matchAll(/store\.(historyAfter|historyCount|rankingResults|rankingNames)\(/g)]).toHaveLength(5);
  });

  it('NFR-128 (source scan part) the log, the shutdown and the stream modules never name a period or a floor, and the body bound reads no period member', () => {
    // Comments are stripped first: "the grace period" of the shutdown prose is not the ranking period.
    const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, '')).join('\n');
    const scanned = files(SRC).map(short).filter((f) => /^http\/(log|shutdown|stream|streams|limits)\.ts$/.test(f));
    expect(scanned.length).toBeGreaterThanOrEqual(3);
    for (const file of scanned) {
      expect(code(readFileSync(join(SRC, file), 'utf8')), file).not.toMatch(/\bperiod\b|(?<!Math\.)\bfloor\b/i);
    }
    // The route reads the period from the decoded request only, never from the query or a header.
    const server = readFileSync(join(SRC, 'http', 'server.ts'), 'utf8');
    expect(server).not.toMatch(/ctx\.query[^\n]*period|headers?[^\n]*period/i);
  });
});
