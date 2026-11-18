import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_V2_ADDITIONS, SCHEMA_V3_ADDITIONS, SCHEMA_V4_ADDITIONS, SCHEMA_V5_ADDITIONS, SCHEMA_VERSION, TABLES } from '../src/store/schema';
import { openStore } from '../src/store/sqlite';
import { dumpRows, listColumns, withRawDb } from './helpers/db-scan';

// Spec 024 schema version 5: one table `communities` and one index. A file of version 1 to 4 is upgraded in place by adding
// storage only: no row of an existing table is written, `meta` included; its matches have no community.

const V1_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'v1-database.db');
const V4_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'v4-database.db');
const DIGEST =(c: string): string => c.repeat(64);

const withTempDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-v5-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const makeV2 = (file: string): void => {
  copyFileSync(V1_FIXTURE, file);
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN');
    for (const statement of SCHEMA_V2_ADDITIONS) db.exec(statement);
    db.prepare('INSERT INTO lobbies (match_id, public, expires_ms) VALUES (?, 1, ?)').run('BBBBBBBBBBBBBBBB', 1_800_000_000_000);
    db.prepare('INSERT INTO players (match_id, player_id, name, name_key, token_digest, joined_seq, joined_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run('BBBBBBBBBBBBBBBB', 'player:x', 'Ana', 'ana', DIGEST('6'), 2, 1_700_000_000_500);
    db.prepare("INSERT INTO memo (scope, request_id, content_digest, reply_json, created_ms) VALUES ('s2', 'r2', 'd2', '{}', 1700000000999)").run();
    db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
  } finally {
    db.close();
  }
};

const makeV3 = (file: string): void => {
  makeV2(file);
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN');
    for (const statement of SCHEMA_V3_ADDITIONS) db.exec(statement);
    db.prepare("INSERT INTO client_matches (match_id, namespace) VALUES ('BBBBBBBBBBBBBBBB', 'discord')").run();
    db.exec('PRAGMA user_version = 3');
    db.exec('COMMIT');
  } finally {
    db.close();
  }
};

/** A file as the 022 code leaves it: version 3 plus the version 4 table with one name. */
const makeV4 = (file: string): void => {
  makeV3(file);
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN');
    for (const statement of SCHEMA_V4_ADDITIONS) db.exec(statement);
    db.prepare("INSERT INTO client_names (match_id, player_id, name) VALUES ('BBBBBBBBBBBBBBBB', 'discord:1', 'Ana')").run();
    db.exec('PRAGMA user_version = 4');
    db.exec('COMMIT');
  } finally {
    db.close();
  }
};

const version = (file: string): number => withRawDb(file, (db) => Number(db.prepare('PRAGMA user_version').get()?.user_version));
const metaOf = (file: string): number[] => withRawDb(file, (db) => db.prepare('SELECT schema_version FROM meta').all().map((r) => Number(r.schema_version)));

describe('FR-560 schema version 5 (spec 024)', () => {
  it('FR-560 the version is 5 and the new storage is the table communities with its index on (community, match)', () => {
    expect(SCHEMA_VERSION).toBe(5);
    expect(SCHEMA_V5_ADDITIONS).toHaveLength(2);
    expect(TABLES).toContain('communities');
    withTempDir((dir) => {
      const file = join(dir, 'new.sqlite');
      const store = openStore(file);
      expect(store.settings().userVersion).toBe(5);
      expect(store.tables()).toContain('communities');
      store.close();
      expect(version(file)).toBe(5);
      expect(metaOf(file)).toStrictEqual([5]);
      expect(withRawDb(file, (db) => listColumns(db).communities)).toStrictEqual(['match_id', 'community']);
      const keys = withRawDb(file, (db) => db.prepare('PRAGMA table_info(communities)').all().map((c) => [String(c.name), Number(c.pk), Number(c.notnull)]));
      expect(keys).toStrictEqual([['match_id', 1, 1], ['community', 0, 1]]);
      expect(withRawDb(file, (db) => db.prepare('PRAGMA foreign_key_list(communities)').all().map((r) => [String(r.table), String(r.from)]))).toStrictEqual([['matches', 'match_id']]);
      const index = withRawDb(file, (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'communities' AND name NOT LIKE 'sqlite_%'").all().map((r) => String(r.name)));
      expect(index).toStrictEqual(['communities_by_key']);
      expect(withRawDb(file, (db) => db.prepare('PRAGMA index_info(communities_by_key)').all().map((r) => String(r.name)))).toStrictEqual(['community', 'match_id']);
    });
  });

  for (const [label, prepare, before] of [
    ['a version 1 file (008)', (file: string) => copyFileSync(V1_FIXTURE, file), 1],
    ['a version 2 file (011)', makeV2, 2],
    ['a version 3 file (018)', makeV3, 3],
    ['a version 4 file (022)', makeV4, 4],
    // Built once by the `main` code (schema 4, before spec 024), not from the current SCHEMA_V4_ADDITIONS.
    ['a version 4 file written by the pre-024 code (fixture)', (file: string) => copyFileSync(V4_FIXTURE, file), 4],
  ] as const) {
    it(`FR-560 ${label} is upgraded in place: every existing row of every table is byte-equal, meta included, and communities is empty`, () => {
      withTempDir((dir) => {
        const file = join(dir, 'old.sqlite');
        prepare(file);
        expect(version(file)).toBe(before);
        const rowsBefore = withRawDb(file, dumpRows);
        const metaBefore = metaOf(file);
        const store = openStore(file);
        try {
          expect(store.settings().userVersion).toBe(5);
          expect(store.tables()).toContain('communities');
        } finally {
          store.close();
        }
        expect(version(file)).toBe(5);
        expect(metaOf(file)).toStrictEqual(metaBefore);
        const rowsAfter = JSON.parse(withRawDb(file, dumpRows)) as [string, unknown[]][];
        const old = JSON.parse(rowsBefore) as [string, unknown[]][];
        for (const [table, rows] of old) expect(rowsAfter.find(([t]) => t === table)?.[1], table).toStrictEqual(rows);
        expect(rowsAfter.find(([t]) => t === 'communities')?.[1]).toStrictEqual([]);
        expect(withRawDb(file, (db) => db.prepare('SELECT COUNT(*) AS n FROM communities').get()?.n)).toBe(0);
      });
    });

    it(`FR-560 the upgrade of ${label} is one transaction: a failure leaves the old version and the old rows`, () => {
      withTempDir((dir) => {
        const file = join(dir, 'old.sqlite');
        prepare(file);
        // An index of the same name makes the version 5 statement fail, after every earlier addition of the same transaction.
        const raw = new DatabaseSync(file);
        raw.exec('CREATE INDEX communities ON memo (created_ms)');
        raw.close();
        const kept = withRawDb(file, dumpRows);
        expect(() => openStore(file)).toThrow();
        expect(version(file)).toBe(before);
        expect(withRawDb(file, dumpRows)).toBe(kept);
      });
    });
  }

  it('FR-560 a reopened version 5 file keeps its version and its rows', () => {
    withTempDir((dir) => {
      const file = join(dir, 'twice.sqlite');
      openStore(file).close();
      const kept = withRawDb(file, dumpRows);
      openStore(file).close();
      expect(version(file)).toBe(5);
      expect(withRawDb(file, dumpRows)).toBe(kept);
    });
  });

  it('FR-560 a file of version 6 is refused by the unknown-version rule and left untouched', () => {
    withTempDir((dir) => {
      const file = join(dir, 'six.sqlite');
      const raw = new DatabaseSync(file);
      raw.exec('CREATE TABLE foreign_data (k INTEGER); PRAGMA user_version = 6');
      raw.close();
      expect(() => openStore(file)).toThrow(/schema version 6/);
      expect(version(file)).toBe(6);
    });
  });
});
