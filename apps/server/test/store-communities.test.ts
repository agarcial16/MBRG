import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MatchEvent, PublicState } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { CoreMatch } from '../src/core/view';
import { InjectedFault, withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { LOBBY_RETENTION_MS, StoreError, type Store } from '../src/store/store';
import { withRawDb } from './helpers/db-scan';

// Spec 024 storage: the community key of a match is one row of `communities`, written in the creation transaction with the
// match, never changed, and removed only with the match by the purge of an expired lobby. Key values are planted literals.

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
const T0 = 1_700_000_000_000;
const KEY_A = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';
const KEY_B = 'fe98dc76ba54fe98dc76ba54fe98dc76ba54fe98dc76ba54fe98dc76ba54fe98';
const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 20], [3, 30]] });
const id = (c: string): string => c.repeat(16);

const lobbyMatch = (matchId: string, over: Partial<CoreMatch> = {}): CoreMatch => ({
  matchId,
  mapId: 'dev',
  mapDigest: DIGEST('a'),
  totalRounds: 5,
  timing: { i: 120, l1: 30, l2: 10 },
  commitment: DIGEST('c'),
  stage: 'lobby',
  appliedRounds: 0,
  state: state(0),
  stateDigest: DIGEST('d'),
  lastSeq: 1,
  createdAt: T0,
  lastStepMs: T0,
  anchors: null,
  ...over,
});
const schedule = (match: CoreMatch): MatchEvent => ({ type: 'schedule', seq: 1, stage: match.stage, reportedTime: match.createdAt });

/** A public lobby as the service stores it, with its community key when given. */
const put = (store: Store, matchId: string, community?: string, createdAt = T0): void => {
  const match = lobbyMatch(matchId, { createdAt, lastStepMs: createdAt });
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    store.insertLobby({ matchId, public: true, expiresMs: createdAt + 1000 });
    if (community !== undefined) store.insertCommunity(matchId, community);
    store.appendEvents(matchId, [schedule(match)]);
  });
};

/** Runs `body` on a file store, closes it, and returns what `read` finds in the closed file (the store has no read of the key). */
const onFile = <T>(body: (store: Store) => void, read: (file: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-communities-'));
  try {
    const file = join(dir, 'm.sqlite');
    const store = openStore(file);
    try {
      body(store);
    } finally {
      store.close();
    }
    return read(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const rowsOf = (file: string): [string, string][] => withRawDb(file, (db) => db.prepare('SELECT match_id, community FROM communities ORDER BY match_id').all().map((r) => [String(r.match_id), String(r.community)]));

const failureOf = (action: () => unknown): StoreError | undefined => {
  try {
    action();
  } catch (error) {
    if (error instanceof StoreError) return error;
    throw error;
  }
  return undefined;
};
const codeOf = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    if (error instanceof StoreError) return error.code;
    throw error;
  }
  return 'no error';
};

describe('community storage (spec 024)', () => {
  it('FR-547 (storage) inserting a key with its match stores one row, and a match without a key has none', () => {
    const rows = onFile(
      (store) => {
        put(store, id('A'), KEY_A);
        put(store, id('B'));
        put(store, id('C'), KEY_B, T0 + 1);
        put(store, id('D'), KEY_A, T0 + 2);
      },
      rowsOf,
    );
    expect(rows).toStrictEqual([[id('A'), KEY_A], [id('C'), KEY_B], [id('D'), KEY_A]]);
  });

  it('FR-547 (storage) a second row for the same match, a missing match and a call outside a transaction are invalid-write and change nothing', () => {
    const rows = onFile(
      (store) => {
        put(store, id('A'), KEY_A);
        put(store, id('B'));
        // Each refusal is the store's own check (its message names the rule), not a constraint of SQLite that would refuse it too.
        expect(failureOf(() => store.transaction(() => store.insertCommunity(id('A'), KEY_B)))).toMatchObject({ code: 'invalid-write', message: expect.stringMatching(/already has a community row/) });
        expect(failureOf(() => store.transaction(() => store.insertCommunity(id('A'), KEY_A)))).toMatchObject({ code: 'invalid-write', message: expect.stringMatching(/already has a community row/) });
        expect(failureOf(() => store.transaction(() => store.insertCommunity(id('Z'), KEY_A)))).toMatchObject({ code: 'invalid-write', message: expect.stringMatching(/does not exist/) });
        expect(failureOf(() => store.insertCommunity(id('B'), KEY_B))).toMatchObject({ code: 'invalid-write', message: expect.stringMatching(/inside a transaction/) });
      },
      rowsOf,
    );
    expect(rows).toStrictEqual([[id('A'), KEY_A]]);
  });

  it('FR-546 (storage) a malformed key is invalid-write and stores nothing, whatever the way it is malformed', () => {
    const bad = [KEY_A.toUpperCase(), KEY_A.slice(0, 63), `${KEY_A}0`, `${KEY_A.slice(0, 63)}g`, '', ' '.repeat(64), `${KEY_A.slice(0, 63)}\n`, 5 as unknown as string, undefined as unknown as string, null as unknown as string];
    const rows = onFile((store) => {
      put(store, id('A'));
      for (const key of bad) expect(codeOf(() => store.transaction(() => store.insertCommunity(id('A'), key))), JSON.stringify(key)).toBe('invalid-write');
    }, rowsOf);
    expect(rows).toStrictEqual([]);
  });

  it('FR-547 (storage) the row is written with the match and rolls back with it', () => {
    const rows = onFile((store) => {
      expect(() =>
        store.transaction(() => {
          store.insertMatch({ match: lobbyMatch(id('A')), secret: SECRET, hostTokenDigest: DIGEST('b') });
          store.insertCommunity(id('A'), KEY_A);
          throw new Error('abort');
        }),
      ).toThrow('abort');
      expect(store.getMatch(id('A'))).toBeUndefined();
    }, rowsOf);
    expect(rows).toStrictEqual([]);
  });

  it('FR-547 (storage) the fault wrapper counts the insert as a write, so an injected failure after the match leaves neither', () => {
    const rows = onFile(
      (inner) => {
        const store = withFaults(inner, { failWrite: { transaction: 1, afterWrites: 1 } });
        expect(() =>
          store.transaction(() => {
            store.insertMatch({ match: lobbyMatch(id('A')), secret: SECRET, hostTokenDigest: DIGEST('b') });
            store.insertCommunity(id('A'), KEY_A);
          }),
        ).toThrow(InjectedFault);
        expect(store.getMatch(id('A'))).toBeUndefined();
      },
      rowsOf,
    );
    expect(rows).toStrictEqual([]);
  });

  it('FR-547 (storage) start, expiry, steps and a halt leave the row as it was', () => {
    const rows = onFile(
      (store) => {
        put(store, id('A'), KEY_A);
        put(store, id('B'), KEY_B, T0 + 1);
        store.transaction(() => store.markExpired(id('A'), T0 + 1000));
        const running = lobbyMatch(id('B'), { stage: 'phase-1', lastSeq: 2, lastStepMs: T0 + 10, createdAt: T0 + 1, anchors: { t0: T0 + 10, c1: T0 + 80_010, c2: T0 + 110_010, a: T0 + 120_010 } });
        store.transaction(() => {
          store.markStarted(id('B'), T0 + 10);
          store.updateMatch(running);
        });
        store.transaction(() => store.updateMatch({ ...running, stage: 'halted', lastSeq: 3, haltReason: 'clock-failure', anchors: null } as unknown as CoreMatch));
      },
      rowsOf,
    );
    expect(rows).toStrictEqual([[id('A'), KEY_A], [id('B'), KEY_B]]);
  });

  it('FR-547 (storage) the purge of an expired lobby after its retention removes its row with its match; a started match keeps it', () => {
    const rows = onFile(
      (store) => {
        put(store, id('A'), KEY_A);
        put(store, id('B'));
        put(store, id('C'), KEY_B, T0 + 1);
        store.transaction(() => {
          store.markExpired(id('A'), T0 + 1000);
          store.markExpired(id('B'), T0 + 1000);
          store.markStarted(id('C'), T0 + 5);
        });
        const at = T0 + 1000 + LOBBY_RETENTION_MS + 1;
        expect(store.transaction(() => store.purgeExpired(at))).toBe(2);
        expect(store.getMatch(id('A'))).toBeUndefined();
        expect(store.getMatch(id('C'))).toBeDefined();
      },
      rowsOf,
    );
    expect(rows).toStrictEqual([[id('C'), KEY_B]]);
  });

  it('FR-547 (storage) an expired lobby inside its retention is not purged and keeps its row', () => {
    const rows = onFile(
      (store) => {
        put(store, id('A'), KEY_A);
        store.transaction(() => store.markExpired(id('A'), T0 + 1000));
        expect(store.transaction(() => store.purgeExpired(T0 + 1000 + LOBBY_RETENTION_MS))).toBe(0);
      },
      rowsOf,
    );
    expect(rows).toStrictEqual([[id('A'), KEY_A]]);
  });
});

describe('no path changes or removes a community row (spec 024)', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));

  it('FR-547 (storage) the sources use communities only in INSERT, CREATE and the table lists of the purge and of the schema', () => {
    const kinds = new Set<string>();
    const lists: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO|ALTER\s+TABLE|DROP\s+TABLE|FROM|CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS|JOIN)\s+communities\b/gi)) {
        kinds.add((m[1] ?? '').toUpperCase().replace(/\s+/g, ' '));
      }
      if (/\[[^\]]*'communities'[^\]]*\]/.test(text)) lists.push(file.slice(SRC.length + 1).replace(/\\/g, '/'));
    }
    for (const forbidden of ['UPDATE', 'REPLACE INTO', 'ALTER TABLE', 'DROP TABLE', 'DELETE FROM']) expect(kinds.has(forbidden), forbidden).toBe(false);
    expect(kinds.has('INSERT INTO')).toBe(true);
    // The one delete is the child-first table list of the purge, in sqlite.ts; `TABLES` in schema.ts lists every table too.
    expect(lists.sort()).toStrictEqual(['store/schema.ts', 'store/sqlite.ts']);
  });

  it('FR-547 (storage) the Store interface has one write about a community and no read of it before the history read', () => {
    const text = readFileSync(join(SRC, 'store', 'store.ts'), 'utf8');
    const methods = [...text.matchAll(/^\s+(\w*[cC]ommunit\w*)[(<]/gm)].map((m) => m[1]);
    expect(methods).toStrictEqual(['insertCommunity']);
  });
});
