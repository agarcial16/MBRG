// The SQLite adapter (spec 008 FR-291, FR-292; plan PD9, PD10): the only module that imports `node:sqlite`.
// It does not depend on the ExperimentalWarning being printed: warnings.ts only hides it where Node prints it.
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_V1, SCHEMA_VERSION, TABLES } from './schema';
import { StoreError, type Store, type StoreSettings } from './store';

const SYNCHRONOUS = ['off', 'normal', 'full', 'extra'] as const;

const isLockedError = (error: unknown): boolean => error instanceof Error && /\b(locked|busy)\b/i.test(error.message);

const asStoreError = (error: unknown, path: string): Error => {
  if (error instanceof StoreError) return error;
  if (isLockedError(error)) return new StoreError('database-locked', `the database ${path} is locked by another connection or process`);
  return error instanceof Error ? error : new Error(String(error));
};

const closeQuietly = (db: DatabaseSync): void => {
  try {
    db.close();
  } catch {
    // Already closed or unusable: nothing more to release.
  }
};

const userVersionOf = (db: DatabaseSync): number => {
  const value = db.prepare('PRAGMA user_version').get()?.user_version;
  if (typeof value !== 'number') throw new StoreError('store-failure', 'the database did not report its schema version');
  return value;
};

/**
 * Opens (and, for a new file, creates) the store. `path` is a file path or `:memory:`.
 * PRAGMAs (PD9): exclusive locking, write-ahead log on a file, synchronous FULL, foreign keys ON. An immediate
 * write transaction at open takes the lock, so a second connection or process fails here with `database-locked`.
 * `user_version` 0 is a new file (schema 1 created in that same transaction); any other value than 1 is refused.
 */
export const openStore = (path: string): Store => {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { timeout: 0 });
  } catch (error) {
    throw asStoreError(error, path);
  }
  let inTransaction = false;
  let closed = false;
  try {
    db.exec('PRAGMA locking_mode = EXCLUSIVE');
    if (path !== ':memory:') {
      const mode = db.prepare('PRAGMA journal_mode = WAL').get()?.journal_mode;
      if (mode !== 'wal') throw new StoreError('store-failure', `the write-ahead log could not be enabled (journal mode ${String(mode)})`);
    }
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('BEGIN IMMEDIATE');
    try {
      const version = userVersionOf(db);
      if (version === 0) {
        for (const statement of SCHEMA_V1) db.exec(statement);
        db.prepare('INSERT INTO meta (schema_version) VALUES (?)').run(SCHEMA_VERSION);
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      } else if (version !== SCHEMA_VERSION) {
        throw new StoreError('unknown-schema-version', `the database has schema version ${version}; this server supports version ${SCHEMA_VERSION}`);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    closeQuietly(db);
    throw asStoreError(error, path);
  }

  const pragma = (name: string): unknown => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];

  return {
    settings(): StoreSettings {
      return {
        journalMode: String(pragma('journal_mode')),
        synchronous: SYNCHRONOUS[Number(pragma('synchronous'))] ?? 'off',
        foreignKeys: Number(pragma('foreign_keys')) === 1,
        lockingMode: String(pragma('locking_mode')),
        userVersion: Number(pragma('user_version')),
      };
    },
    tables(): string[] {
      const own = new Set<string>(TABLES);
      return db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row.name))
        .filter((name) => own.has(name));
    },
    transaction<T>(fn: () => T): T {
      if (inTransaction) throw new Error('store transactions do not nest');
      db.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      try {
        const value = fn();
        db.exec('COMMIT');
        return value;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // The failed COMMIT may already have ended the transaction.
        }
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      closeQuietly(db);
    },
  };
};
