import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// NFR-53 (D7): the built-in `node:sqlite` is the only SQLite option; these checks pin its behavior on
// the installed Node. A failure here is a platform question for the user (plan section 8), not a code fix.

type Sqlite = typeof import('node:sqlite');
const loadSqlite = (): Promise<Sqlite> => import('node:sqlite');

const withTempDir = async (body: (dir: string) => void | Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-sqlite-'));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('node:sqlite platform checks', () => {
  it('NFR-53 node:sqlite loads without a flag on the installed Node', async () => {
    const sqlite = await loadSqlite();
    expect(typeof sqlite.DatabaseSync).toBe('function');
    expect(process.execArgv.filter((a) => a.includes('sqlite'))).toStrictEqual([]);
    // Recorded in plan section 13.
    expect(process.version).toMatch(/^v24\.\d+\.\d+$/);
  });

  it('NFR-53 an in-memory database opens, stores and reads integers', async () => {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE t (k INTEGER PRIMARY KEY, v INTEGER NOT NULL)');
      db.prepare('INSERT INTO t (k, v) VALUES (?, ?)').run(1, 1_700_000_000_123);
      const row = db.prepare('SELECT v FROM t WHERE k = ?').get(1);
      expect(row?.v).toBe(1_700_000_000_123);
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
    } finally {
      db.close();
    }
  });

  it('NFR-53 a file database in the temporary directory persists across reopen', async () => {
    const { DatabaseSync } = await loadSqlite();
    await withTempDir((dir) => {
      const file = join(dir, 'a.sqlite');
      const first = new DatabaseSync(file);
      try {
        first.exec('CREATE TABLE t (k INTEGER PRIMARY KEY); INSERT INTO t VALUES (7); PRAGMA user_version = 3');
      } finally {
        first.close();
      }
      const second = new DatabaseSync(file);
      try {
        expect(second.prepare('SELECT k FROM t').get()?.k).toBe(7);
        expect(second.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
      } finally {
        second.close();
      }
    });
  });

  it('NFR-53 a transaction commits and a failed one rolls back', async () => {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE t (k INTEGER PRIMARY KEY)');
      db.exec('BEGIN');
      db.exec('INSERT INTO t VALUES (1)');
      db.exec('COMMIT');
      db.exec('BEGIN');
      db.exec('INSERT INTO t VALUES (2)');
      expect(() => db.exec('INSERT INTO t VALUES (2)')).toThrow();
      db.exec('ROLLBACK');
      const keys = db.prepare('SELECT k FROM t ORDER BY k').all().map((r) => r.k);
      expect(keys).toStrictEqual([1]);
    } finally {
      db.close();
    }
  });

  it('NFR-53 the exclusive lock makes a second connection to the same file fail', async () => {
    const { DatabaseSync } = await loadSqlite();
    await withTempDir((dir) => {
      const file = join(dir, 'lock.sqlite');
      const first = new DatabaseSync(file);
      let second: InstanceType<Sqlite['DatabaseSync']> | undefined;
      try {
        first.exec('PRAGMA locking_mode = EXCLUSIVE');
        first.exec('CREATE TABLE t (k INTEGER PRIMARY KEY); INSERT INTO t VALUES (1)');
        second = new DatabaseSync(file, { timeout: 0 });
        expect(() => second?.prepare('SELECT k FROM t').all()).toThrow(/locked|busy/i);
      } finally {
        second?.close();
        first.close();
      }
      // After the first connection closes, the file opens normally again.
      const third = new DatabaseSync(file);
      try {
        expect(third.prepare('SELECT k FROM t').get()?.k).toBe(1);
      } finally {
        third.close();
      }
    });
  });
});
