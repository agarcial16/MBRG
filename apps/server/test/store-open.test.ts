import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('store open', () => {
  it('FR-291 an in-memory database gets schema version 1 with every table', () => {
    const store = openStore(':memory:');
    try {
      expect(SCHEMA_VERSION).toBe(1);
      expect(store.settings().userVersion).toBe(1);
      expect(sorted(store.tables())).toStrictEqual(sorted(['meta', 'matches', 'states', 'records', 'steps', 'predictions', 'results', 'events', 'memo']));
      expect(sorted(TABLES)).toStrictEqual(sorted(store.tables()));
    } finally {
      store.close();
    }
  });

  it('FR-291 a file database gets schema version 1, and reopening it keeps the data', () => {
    withTempDir((dir) => {
      const file = join(dir, 'a.sqlite');
      const first = openStore(file);
      expect(first.settings().userVersion).toBe(1);
      first.close();
      const raw = new DatabaseSync(file);
      raw.prepare("INSERT INTO memo (scope, request_id, content_digest, reply_json, created_ms) VALUES ('s', 'r', 'd', '{}', 1700000000123)").run();
      raw.close();
      const second = openStore(file);
      expect(second.settings().userVersion).toBe(1);
      second.close();
      const check = new DatabaseSync(file);
      try {
        expect(check.prepare('SELECT created_ms FROM memo').all().map((r) => r.created_ms)).toStrictEqual([1_700_000_000_123]);
        expect(check.prepare('SELECT schema_version FROM meta').all().map((r) => r.schema_version)).toStrictEqual([1]);
      } finally {
        check.close();
      }
    });
  });

  it('FR-291 a file with another schema version is refused, untouched and unlocked', () => {
    withTempDir((dir) => {
      for (const version of [2, 7]) {
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
        expect(store.settings()).toStrictEqual({ journalMode: 'wal', synchronous: 'full', foreignKeys: true, lockingMode: 'exclusive', userVersion: 1 });
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
        expect(first.settings().userVersion).toBe(1);
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
      expect(one.settings().userVersion).toBe(1);
      expect(two.settings().userVersion).toBe(1);
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
        expect(reopened.settings().userVersion).toBe(1);
      } finally {
        reopened.close();
      }
    });
  });
});
