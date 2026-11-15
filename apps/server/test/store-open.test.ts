import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { InjectedFault, withFaults } from '../src/store/faults';
import { StoreError, type Store } from '../src/store/store';
import { SCHEMA_VERSION, TABLES } from '../src/store/schema';
import { openStore } from '../src/store/sqlite';

// FR-291: one SQLite file with a schema version, a second process refused through an exclusive lock.
// FR-292 (durability settings): write-ahead log, full synchronous mode, foreign keys, exclusive locking
// (plan PD9). FR-292 (unavailable, retry) belongs to M2b' and is not traced here.
// Every file database lives in a unique temporary directory removed in `finally`.

const withTempDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-store-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

const sorted = (names: readonly string[]): string[] => [...names].sort();

/** The nine tables of schema version 1, and the database file the previous code wrote (matches, records, steps, predictions, results, events, memo). */
const V1_TABLES = ['meta', 'matches', 'states', 'records', 'steps', 'predictions', 'results', 'events', 'memo'];
const V1_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'v1-database.db');

/** What a raw connection sees in a closed file: version, meta, tables, the SQL of the version 1 tables and their rows in rowid order. */
const snapshot = (file: string) => {
  const db = new DatabaseSync(file);
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => String(r.name));
    const own = tables.filter((t) => V1_TABLES.includes(t));
    const rowsOf = (table: string): unknown[] => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r) => Object.values(r).map((v) => (v instanceof Uint8Array ? `blob:${Buffer.from(v).toString('hex')}` : v)));
    return {
      userVersion: Number(db.prepare('PRAGMA user_version').get()?.user_version),
      meta: tables.includes('meta') ? db.prepare('SELECT schema_version FROM meta').all().map((r) => Number(r.schema_version)) : [],
      tables,
      definitions: own.map((t) => [t, String(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)?.sql)]),
      rows: own.filter((t) => t !== 'meta').map((t) => [t, rowsOf(t)]),
      newRows: Object.fromEntries(tables.filter((t) => t === 'lobbies' || t === 'players').map((t) => [t, rowsOf(t).length])),
    };
  } finally {
    db.close();
  }
};

describe('store open', () => {
  it('FR-291 an in-memory database gets schema version 2 with every table', () => {
    const store = openStore(':memory:');
    try {
      expect(SCHEMA_VERSION).toBe(2);
      expect(store.settings().userVersion).toBe(2);
      expect(sorted(store.tables())).toStrictEqual(sorted([...V1_TABLES, 'lobbies', 'players']));
      expect(sorted(TABLES)).toStrictEqual(sorted(store.tables()));
    } finally {
      store.close();
    }
  });

  it('FR-291 a file database gets schema version 2, and reopening it keeps the data', () => {
    withTempDir((dir) => {
      const file = join(dir, 'a.sqlite');
      const first = openStore(file);
      expect(first.settings().userVersion).toBe(2);
      first.close();
      const raw = new DatabaseSync(file);
      raw.prepare("INSERT INTO memo (scope, request_id, content_digest, reply_json, created_ms) VALUES ('s', 'r', 'd', '{}', 1700000000123)").run();
      raw.close();
      const second = openStore(file);
      expect(second.settings().userVersion).toBe(2);
      second.close();
      const check = new DatabaseSync(file);
      try {
        expect(check.prepare('SELECT created_ms FROM memo').all().map((r) => r.created_ms)).toStrictEqual([1_700_000_000_123]);
        expect(check.prepare('SELECT schema_version FROM meta').all().map((r) => r.schema_version)).toStrictEqual([2]);
      } finally {
        check.close();
      }
    });
  });

  it('FR-291 a second open of a version 2 file changes nothing', () => {
    withTempDir((dir) => {
      const file = join(dir, 'twice.sqlite');
      openStore(file).close();
      const before = snapshot(file);
      openStore(file).close();
      expect(snapshot(file)).toStrictEqual(before);
      expect(before.userVersion).toBe(2);
    });
  });

  it('FR-391 a database written by the previous code opens unchanged: its rows are byte-equal and the new tables are empty', () => {
    withTempDir((dir) => {
      const file = join(dir, 'v1.sqlite');
      copyFileSync(V1_FIXTURE, file);
      const before = snapshot(file);
      expect(before.userVersion).toBe(1);
      expect(before.tables).toStrictEqual(sorted(V1_TABLES));
      const store = openStore(file);
      try {
        expect(store.settings().userVersion).toBe(2);
        expect(sorted(store.tables())).toStrictEqual(sorted([...V1_TABLES, 'lobbies', 'players']));
        // The matches read back as the fixture holds them.
        expect(store.getMatch('AAAAAAAAAAAAAAAA')?.match).toMatchObject({ stage: 'phase-2', appliedRounds: 1, lastSeq: 3, createdAt: 1_700_000_000_123, victim: { victim: 20, round: 2 } });
        expect(store.getMatch('BBBBBBBBBBBBBBBB')?.match).toMatchObject({ stage: 'phase-1', timing: 'manual', anchors: null });
        expect(store.runningCount()).toBe(2);
        expect(store.runningMatchIds()).toStrictEqual(['AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB']);
        expect(store.listMatches(undefined, 10).map((m) => m.matchId)).toStrictEqual(['AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB']);
        expect(store.eventsAfter('AAAAAAAAAAAAAAAA', 0).map((e) => e.seq)).toStrictEqual([1, 2, 3]);
        expect(store.records('AAAAAAAAAAAAAAAA')).toStrictEqual([{ round: 1, eliminated: 20, absorber: 10, transferred: [2] }]);
        expect(store.steps('AAAAAAAAAAAAAAAA')).toHaveLength(1);
        expect(store.predictionsOf('AAAAAAAAAAAAAAAA', 'client:p1')).toHaveLength(2);
        expect(store.playerTotal('AAAAAAAAAAAAAAAA', 'client:p1')).toBe(3);
        expect(store.memoOldest()).toBe(1_700_000_000_123);
        expect(store.hostTokenDigest('BBBBBBBBBBBBBBBB')).toBe('8'.repeat(64));
        // No lobby row exists for these matches: they count in neither lobby count.
        expect(store.openLobbyCount()).toBe(0);
        expect(store.publicRunningCount()).toBe(0);
        expect(store.getLobby('AAAAAAAAAAAAAAAA')).toBeUndefined();
      } finally {
        store.close();
      }
      const after = snapshot(file);
      expect(after.userVersion).toBe(2);
      expect(after.meta).toStrictEqual([2]);
      // The definition of every table of version 1 is the one it had (no ALTER), and its rows are byte-equal.
      expect(after.definitions).toStrictEqual(before.definitions);
      expect(after.rows).toStrictEqual(before.rows);
      expect(after.tables).toStrictEqual(sorted([...V1_TABLES, 'lobbies', 'players']));
      expect(after.newRows).toStrictEqual({ lobbies: 0, players: 0 });
    });
  });

  it('FR-391 an upgraded database keeps working as before: a match steps and a new one is stored', () => {
    withTempDir((dir) => {
      const file = join(dir, 'v1.sqlite');
      copyFileSync(V1_FIXTURE, file);
      const store = openStore(file);
      try {
        const stored = store.getMatch('AAAAAAAAAAAAAAAA');
        if (stored === undefined) throw new Error('the fixture match is missing');
        store.transaction(() => {
          store.updateMatch({ ...stored.match, stage: 'locked' });
          store.insertMatch({ match: { ...stored.match, matchId: 'CCCCCCCCCCCCCCCC', stage: 'phase-1', appliedRounds: 0, state: { mode: 'classic', round: 0, owners: [[1, 10]] }, lastSeq: 0, victim: undefined } as never, secret: stored.secret, hostTokenDigest: '5'.repeat(64) });
        });
        expect(store.getMatch('AAAAAAAAAAAAAAAA')?.match.stage).toBe('locked');
        expect(store.getMatch('CCCCCCCCCCCCCCCC')?.match.stage).toBe('phase-1');
        expect(store.runningCount()).toBe(3);
      } finally {
        store.close();
      }
    });
  });

  it('FR-391 the upgrade is one transaction: a failure in the middle leaves version 1 and a usable file', () => {
    withTempDir((dir) => {
      const file = join(dir, 'v1.sqlite');
      copyFileSync(V1_FIXTURE, file);
      const before = snapshot(file);
      // A foreign table named `lobbies` is skipped by CREATE TABLE IF NOT EXISTS, so the index on its columns fails at the
      // end of the additions: every earlier statement (and the version change) must be rolled back with it.
      const raw = new DatabaseSync(file);
      raw.exec('CREATE TABLE lobbies (k INTEGER)');
      raw.close();
      expect(() => openStore(file)).toThrow();
      const failed = snapshot(file);
      expect(failed.userVersion).toBe(1);
      expect(failed.meta).toStrictEqual([1]);
      expect(failed.tables).toStrictEqual(sorted([...V1_TABLES, 'lobbies']));
      expect(failed.rows).toStrictEqual(before.rows);
      const fixed = new DatabaseSync(file);
      fixed.exec('DROP TABLE lobbies');
      fixed.close();
      const store = openStore(file);
      try {
        expect(store.settings().userVersion).toBe(2);
        expect(store.getMatch('AAAAAAAAAAAAAAAA')).toBeDefined();
      } finally {
        store.close();
      }
    });
  });

  it('FR-391 a failing creation of a new file leaves version 0 and no table of version 2 either', () => {
    withTempDir((dir) => {
      const file = join(dir, 'fresh.sqlite');
      const raw = new DatabaseSync(file);
      raw.exec('CREATE TABLE players (k INTEGER)');
      raw.close();
      expect(() => openStore(file)).toThrow();
      const failed = snapshot(file);
      expect(failed.userVersion).toBe(0);
      expect(failed.tables).toStrictEqual(['players']);
    });
  });

  it('FR-291 a file with another schema version is refused, untouched and unlocked', () => {
    withTempDir((dir) => {
      for (const version of [3, 7]) {
        const file = join(dir, `v${version}.sqlite`);
        const raw = new DatabaseSync(file);
        raw.exec(`CREATE TABLE foreign_data (k INTEGER); PRAGMA user_version = ${version}`);
        raw.close();
        expect(codeOf(() => openStore(file))).toBe('unknown-schema-version');
        const after = new DatabaseSync(file);
        try {
          expect(after.prepare('PRAGMA user_version').get()?.user_version).toBe(version);
          expect(after.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)).toStrictEqual(['foreign_data']);
        } finally {
          after.close();
        }
      }
    });
  });

  it('FR-291 a failing schema creation leaves the file at version 0 with no table', () => {
    withTempDir((dir) => {
      const file = join(dir, 'broken.sqlite');
      const raw = new DatabaseSync(file);
      // A foreign table named `matches` is skipped by CREATE TABLE IF NOT EXISTS, so the index on its `stage`
      // column fails at the very end of the creation: every earlier table must be rolled back with it.
      raw.exec('CREATE TABLE matches (k INTEGER)');
      raw.close();
      expect(() => openStore(file)).toThrow();
      const after = new DatabaseSync(file);
      try {
        expect(after.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
        expect(after.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)).toStrictEqual(['matches']);
      } finally {
        after.close();
      }
    });
  });

  it('FR-292 (durability settings) a file database reads back WAL, full, foreign keys on and exclusive locking', () => {
    withTempDir((dir) => {
      const store = openStore(join(dir, 'p.sqlite'));
      try {
        expect(store.settings()).toStrictEqual({ journalMode: 'wal', synchronous: 'full', foreignKeys: true, lockingMode: 'exclusive', userVersion: 2 });
      } finally {
        store.close();
      }
    });
  });

  it('FR-292 (durability settings) an in-memory database keeps full, foreign keys and exclusive locking', () => {
    const store = openStore(':memory:');
    try {
      const settings = store.settings();
      expect(settings.synchronous).toBe('full');
      expect(settings.foreignKeys).toBe(true);
      expect(settings.lockingMode).toBe('exclusive');
      expect(settings.journalMode).toBe('memory');
    } finally {
      store.close();
    }
  });

  it('FR-291 a second open of the same file fails with database-locked until the first closes', () => {
    withTempDir((dir) => {
      const file = join(dir, 'lock.sqlite');
      const first = openStore(file);
      try {
        expect(codeOf(() => openStore(file))).toBe('database-locked');
        expect(codeOf(() => openStore(file))).toBe('database-locked');
        // The refused attempt did not disturb the holder.
        expect(first.transaction(() => 5)).toBe(5);
        expect(first.settings().userVersion).toBe(2);
      } finally {
        first.close();
      }
      const third = openStore(file);
      try {
        expect(third.settings().lockingMode).toBe('exclusive');
      } finally {
        third.close();
      }
    });
  });

  it('FR-291 two in-memory stores are independent databases', () => {
    const one = openStore(':memory:');
    const two = openStore(':memory:');
    try {
      expect(one.settings().userVersion).toBe(2);
      expect(two.settings().userVersion).toBe(2);
    } finally {
      one.close();
      two.close();
    }
  });
});

describe('store transactions and the fault seam', () => {
  it('FR-291 a transaction returns its value, rolls back on a throw and never nests', () => {
    const store = openStore(':memory:');
    try {
      expect(store.transaction(() => 'value')).toBe('value');
      const boom = new Error('boom');
      expect(() =>
        store.transaction(() => {
          throw boom;
        }),
      ).toThrow(boom);
      // A throw does not leave the connection inside a transaction.
      expect(store.transaction(() => 1)).toBe(1);
      expect(() => store.transaction(() => store.transaction(() => 1))).toThrow();
      expect(store.transaction(() => 2)).toBe(2);
    } finally {
      store.close();
    }
  });

  it('FR-291 the fault seam fails the chosen transaction before it runs and passes the others', () => {
    const base = openStore(':memory:');
    const ran: number[] = [];
    const store: Store = withFaults(base, { failTransaction: 2 });
    try {
      expect(store.transaction(() => ran.push(1))).toBe(1);
      expect(() => store.transaction(() => ran.push(2))).toThrow(InjectedFault);
      expect(store.transaction(() => ran.push(3))).toBe(2);
      expect(ran).toStrictEqual([1, 3]);
    } finally {
      store.close();
    }
  });

  it('FR-291 the fault seam can abort: the connection is closed before the transaction commits', () => {
    withTempDir((dir) => {
      const file = join(dir, 'abort.sqlite');
      const store = withFaults(openStore(file), { abortTransaction: 1 });
      expect(() => store.transaction(() => 'never')).toThrow(InjectedFault);
      // The abort released the lock, as a killed process would.
      const reopened = openStore(file);
      try {
        expect(reopened.settings().userVersion).toBe(2);
      } finally {
        reopened.close();
      }
    });
  });
});
