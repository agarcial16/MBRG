import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_V2_ADDITIONS, SCHEMA_V3_ADDITIONS, SCHEMA_V4_ADDITIONS, SCHEMA_VERSION, TABLES } from '../src/store/schema';
import { openStore } from '../src/store/sqlite';
import { dumpRows, listColumns, withRawDb } from './helpers/db-scan';

// Spec 022 schema version 4: one table `client_names`. A file of version 1, 2 or 3 is upgraded in place by adding storage only:
// no row of an existing table is written, `meta` included.

const V1_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'v1-database.db');
const DIGEST = (c: string): string => c.repeat(64);

const withTempDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-v4-'));
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

/** A file as the 018 code leaves it: version 2 plus the version 3 table with a client-only match. */
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

const version = (file: string): number => withRawDb(file, (db) => Number(db.prepare('PRAGMA user_version').get()?.user_version));
const metaOf = (file: string): number[] => withRawDb(file, (db) => db.prepare('SELECT schema_version FROM meta').all().map((r) => Number(r.schema_version)));

describe('FR-536 schema version 4 (spec 022)', () => {
  it('the version is 4 and the one new table is client_names with the key (match, player)', () => {
    expect(SCHEMA_VERSION).toBe(4);
    expect(SCHEMA_V4_ADDITIONS).toHaveLength(1);
    expect(TABLES).toContain('client_names');
    withTempDir((dir) => {
      const file = join(dir, 'new.sqlite');
      openStore(file).close();
      expect(version(file)).toBe(4);
      expect(withRawDb(file, (db) => listColumns(db).client_names)).toStrictEqual(['match_id', 'player_id', 'name']);
      const keys = withRawDb(file, (db) => db.prepare('PRAGMA table_info(client_names)').all().map((c) => [String(c.name), Number(c.pk), Number(c.notnull)]));
      expect(keys).toStrictEqual([['match_id', 1, 1], ['player_id', 2, 1], ['name', 0, 1]]);
      expect(withRawDb(file, (db) => db.prepare('PRAGMA index_list(client_names)').all().length)).toBe(1);
      expect(withRawDb(file, (db) => db.prepare('PRAGMA foreign_key_list(client_names)').all().map((r) => [String(r.table), String(r.from)]))).toStrictEqual([['matches', 'match_id']]);
    });
  });

  for (const [label, prepare, before] of [
    ['a version 1 file (008)', (file: string) => copyFileSync(V1_FIXTURE, file), 1],
    ['a version 2 file (011)', makeV2, 2],
    ['a version 3 file (018)', makeV3, 3],
  ] as const) {
    it(`${label} is upgraded in place: every existing row of every table is byte-equal, meta included, and the new table is empty`, () => {
      withTempDir((dir) => {
        const file = join(dir, 'old.sqlite');
        prepare(file);
        expect(version(file)).toBe(before);
        const rowsBefore = withRawDb(file, dumpRows);
        const metaBefore = metaOf(file);
        const store = openStore(file);
        try {
          expect(store.settings().userVersion).toBe(4);
          expect(store.tables()).toContain('client_names');
          expect(store.clientNames('BBBBBBBBBBBBBBBB', ['discord:1'])).toStrictEqual(new Map());
        } finally {
          store.close();
        }
        expect(version(file)).toBe(4);
        expect(metaOf(file)).toStrictEqual(metaBefore);
        const rowsAfter = JSON.parse(withRawDb(file, dumpRows)) as [string, unknown[]][];
        const old = JSON.parse(rowsBefore) as [string, unknown[]][];
        for (const [table, rows] of old) expect(rowsAfter.find(([t]) => t === table)?.[1], table).toStrictEqual(rows);
        expect(rowsAfter.find(([t]) => t === 'client_names')?.[1]).toStrictEqual([]);
      });
    });

    it(`the upgrade of ${label} is one transaction: a failure leaves the old version and the old rows`, () => {
      withTempDir((dir) => {
        const file = join(dir, 'old.sqlite');
        prepare(file);
        // An index of the same name makes the version 4 statement fail, after every earlier addition of the same transaction.
        const raw = new DatabaseSync(file);
        raw.exec('CREATE INDEX client_names ON memo (created_ms)');
        raw.close();
        const kept = withRawDb(file, dumpRows);
        expect(() => openStore(file)).toThrow();
        expect(version(file)).toBe(before);
        expect(withRawDb(file, dumpRows)).toBe(kept);
      });
    });
  }

  it('a file of version 5 is refused and left untouched', () => {
    withTempDir((dir) => {
      const file = join(dir, 'five.sqlite');
      const raw = new DatabaseSync(file);
      raw.exec('CREATE TABLE foreign_data (k INTEGER); PRAGMA user_version = 5');
      raw.close();
      expect(() => openStore(file)).toThrow(/schema version 5/);
      expect(version(file)).toBe(5);
    });
  });
});
