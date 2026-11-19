import { mkdtempSync, rmSync } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { PublicState } from '@mbrg/protocol';
import { decodeCursor, readRankingPage } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES } from '../src/http/body';
import type { CoreMatch } from '../src/core/view';
import type { ResultRow } from '../src/core/scoring';
import { READ_SQL, openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';
import { DISCORD, KEY_A, postRanking, startHistory } from './helpers/ranking-kit';

// Spec 025 NFR-125 (closed) and NFR-124 (source scan part): the ranking work is bounded. One page reads the head and the two
// snapshot statements whatever the stored matches (a recording store wrapper at the service level: every store method is
// pinned to ONE statement by the prepare-counting test in store-ranking.test.ts), the query plans show index lookups only, a
// worst-case page of 10 rows answers within the reply body bound, and the sources read `communities` in no statement outside
// the history and ranking reads. Key values and ids are planted literals.

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 7) % 256);
const T0 = 1_723_456_789_012;
const KEY_R = '5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b';
const KEY_S = '7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d';
const KEY_T = '9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8d9e0f';
const NAMESPACE = 'rank';
const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 10], [3, 10]] });

/** One stored finished match of a community and a namespace, `at` its finish instant. */
const put = (store: Store, id: string, community: string, namespace: string, at: number): void => {
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
    store.insertClientMatch(id, namespace);
    store.insertCommunity(id, community);
  });
};

/** Ten scored players of one match: two result rows each, distinct players per match. */
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

/** `count` counted matches of ten scored players each for a community. */
function seed(store: Store, community: string, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const matchId = `m${String(i).padStart(4, '0')}`.padEnd(16, community === KEY_R ? 'r' : community === KEY_S ? 's' : 't');
    const at = T0 + i;
    put(store, matchId, community, NAMESPACE, at);
    putTen(store, matchId, at);
  }
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

describe('NFR-125 the ranking work is bounded whatever the stored matches', () => {
  it('NFR-125 one page reads the head and the two snapshot statements with 10 counted matches and with 1,000 in each of two communities, and nothing else', () => {
    const store = openStore(':memory:');
    seed(store, KEY_T, 10);
    seed(store, KEY_R, 1000);
    seed(store, KEY_S, 1000);
    const wrapped = recording(store);
    const h = serviceHarness({ store: wrapped.store });
    try {
      for (const [community, count] of [[KEY_T, 100], [KEY_R, 10000], [KEY_S, 10000]] as const) {
        const first = h.service.ranking({ namespace: NAMESPACE, community, order: 'points', limit: 10 });
        expect(first.ok && first.reply.total, community).toBe(count);
        expect(wrapped.calls().sort(), community).toStrictEqual(['historyAfter', 'rankingNames', 'rankingResults']);
        const next = first.ok ? first.reply.next : undefined;
        expect(next, community).toBeTypeOf('string');
        const after = next === undefined ? undefined : decodeCursor('ranking', next);
        expect(after?.ok, community).toBe(true);
        const second = h.service.ranking({ namespace: NAMESPACE, community, order: 'points', limit: 10, ...(after !== undefined && after.ok ? { after: after.value } : {}) });
        expect(second.ok && second.reply.total, community).toBe(count);
        expect(wrapped.calls().sort(), community).toStrictEqual(['rankingNames', 'rankingResults']);
      }
    } finally {
      h.close();
      store.close();
    }
    // Seeds 2,010 matches with 40,200 result rows and folds 10,000 players three times: near the default 5 s under the
    // full suite's CPU load, so the timeout is explicit.
  }, 30_000);

  it('NFR-125 both snapshot statements reach communities, matches, results and client_names through indexes: no scan of any table, head bound included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrg-ranking-bounds-'));
    try {
      const file = join(dir, 'b.sqlite');
      openStore(file).close();
      const db = new DatabaseSync(file);
      try {
        for (const [sql, players] of [[READ_SQL.rankingResults, 'r'], [READ_SQL.rankingNames, 'n']] as const) {
          for (const bound of [true, false]) {
            const plan = db
              .prepare(`EXPLAIN QUERY PLAN ${sql}`)
              .all(KEY_R, NAMESPACE, ...(bound ? [T0, T0, T0, 'x'.repeat(16)] : [null, null, null, null]))
              .map((r) => String(r.detail));
            const text = plan.join(' | ');
            expect(plan.filter((d) => /\bSCAN\b/.test(d)), `${players} ${bound}`).toStrictEqual([]);
            expect(plan.some((d) => /SEARCH .*communities/.test(d)), `${players} ${bound}`).toBe(true);
            expect(plan.some((d) => /SEARCH .*matches/.test(d)), `${players} ${bound}`).toBe(true);
          }
        }
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('NFR-125 a worst-case page of 10 rows (24-character names, 20-digit ids, every statistic at its widest) answers within the reply body bound', async () => {
    const NAME = 'N'.repeat(24);
    const ASKER = '7'.repeat(19).concat('0');
    const h = await startHistory({
      wrapStore: (store) => {
        const matchId = 'W'.repeat(16);
        put(store, matchId, KEY_A, 'discord', T0);
        const rows: ResultRow[] = [];
        for (let p = 0; p < 10; p += 1) {
          // A 20-digit local id: wider than any safe integer, built as a text.
          const playerId = `discord:${String(p).padStart(20, '7')}`;
          rows.push({ playerId, kind: 'victim', round: 1, choice: 3, correct: true, points: 999_999_999 });
          store.transaction(() => store.putClientName(matchId, playerId, NAME));
        }
        store.transaction(() => store.putResults(matchId, rows));
        return store;
      },
    });
    try {
      const reply = await postRanking(h, DISCORD.credential, { community: KEY_A, playerId: ASKER, limit: 10 });
      expect(reply.status).toBe(200);
      const page = JSON.parse(reply.text) as { items: unknown[]; total: number; asker?: unknown };
      expect(page.items).toHaveLength(10);
      expect(page.total).toBe(10);
      expect(page.asker).toBeTypeOf('object');
      expect(readRankingPage(page).ok).toBe(true);
      expect(Buffer.byteLength(reply.text, 'utf8')).toBeLessThanOrEqual(MAX_BODY_BYTES);
    } finally {
      await h.close();
    }
  });
});

describe('NFR-124 (source scan part) the community storage is read only by the history and ranking reads', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
  const short = (file: string): string => file.slice(SRC.length + 1).replace(/\\/g, '/');

  it('NFR-124 (source scan part) every FROM or JOIN of communities sits in store/sqlite.ts, in exactly the four read statements', () => {
    const readers: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8');
      if (/\b(?:FROM|JOIN)\s+communities\b/i.test(text)) readers.push(short(file));
    }
    expect([...new Set(readers)].sort()).toStrictEqual(['store/sqlite.ts']);
    // Within sqlite.ts, the statements that read `communities` are exactly the two history reads of spec 024 and the two
    // ranking reads of spec 025. The 024 source scan (its own twins task, another branch) must list the ranking reads as the
    // other allowed reader, as this spec's NFR-124 says.
    const sqlite = readFileSync(join(SRC, 'store', 'sqlite.ts'), 'utf8');
    const keys = [...sqlite.matchAll(/(\w+):\s*`[^`]*\b(?:FROM|JOIN)\s+communities\b[^`]*`/g)].map((m) => String(m[1]));
    expect([...new Set(keys)].sort()).toStrictEqual(['historyAfter', 'historyCount', 'rankingNames', 'rankingResults']);
    // One more occurrence reads the table: the duplicate guard of `insertCommunity`, by match id (never by the key).
    const outside = [...sqlite.matchAll(/\b(?:FROM|JOIN)\s+communities\b/g)].length - keys.length;
    expect(outside).toBe(1);
    expect(sqlite.split(/\r?\n/).some((l) => /FROM communities\b/.test(l) && /already has a community row/.test(l))).toBe(true);
  });
});
