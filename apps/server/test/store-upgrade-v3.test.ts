import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_V2_ADDITIONS, SCHEMA_VERSION } from '../src/store/schema';
import { openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import { dumpRows, withRawDb } from './helpers/db-scan';

// Spec 018 FR-506: a database written by 008 (version 1) or 011 (version 2) is upgraded in place by adding storage only.
// The committed version 1 fixture is the 008 file; the version 2 file is that fixture taken through the version 2 additions
// with lobby, player and memo rows added, as the 011 code leaves it. No existing row is rewritten, `meta` included.

const V1_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'v1-database.db');
const DIGEST = (c: string): string => c.repeat(64);

const withTempDir = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-v3-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** A file as the 011 code leaves it: the fixture plus the version 2 tables, a lobby, a player and a memo row; meta and user_version 2. */
const makeV2 = (file: string): void => {
  copyFileSync(V1_FIXTURE, file);
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN');
    for (const statement of SCHEMA_V2_ADDITIONS) db.exec(statement);
    db.prepare('UPDATE meta SET schema_version = 2').run();
    db.prepare('INSERT INTO lobbies (match_id, public, expires_ms) VALUES (?, 1, ?)').run('BBBBBBBBBBBBBBBB', 1_800_000_000_000);
    db.prepare('INSERT INTO players (match_id, player_id, name, name_key, token_digest, joined_seq, joined_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run('BBBBBBBBBBBBBBBB', 'player:x', 'Ana', 'ana', DIGEST('6'), 2, 1_700_000_000_500);
    db.prepare("INSERT INTO memo (scope, request_id, content_digest, reply_json, created_ms) VALUES ('s2', 'r2', 'd2', '{}', 1700000000999)").run();
    db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
  } finally {
    db.close();
  }
};

const version = (file: string): number => withRawDb(file, (db) => Number(db.prepare('PRAGMA user_version').get()?.user_version));
const metaOf = (file: string): number[] => withRawDb(file, (db) => db.prepare('SELECT schema_version FROM meta').all().map((r) => Number(r.schema_version)));
const tablesOf = (file: string): string[] =>
  withRawDb(file, (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => String(r.name)));

describe('the upgrade to schema version 3 and on to 4 (spec 018 and 022)', () => {
  it('FR-506 the schema version is 5 since spec 024', () => {
    expect(SCHEMA_VERSION).toBe(5);
  });

  for (const [label, prepare, before] of [
    ['a version 1 file (008)', (file: string) => copyFileSync(V1_FIXTURE, file), 1],
    ['a version 2 file (011)', makeV2, 2],
  ] as const) {
    it(`FR-506 ${label} is upgraded in place: every existing row of every table is byte-equal, meta included, and every match reads open`, () => {
      withTempDir((dir) => {
        const file = join(dir, 'old.sqlite');
        prepare(file);
        expect(version(file)).toBe(before);
        const rowsBefore = withRawDb(file, dumpRows);
        const metaBefore = metaOf(file);
        const store = openStore(file);
        try {
          expect(store.settings().userVersion).toBe(5);
          expect(store.tables()).toContain('client_matches');
          for (const matchId of ['AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB']) expect(store.getClientNamespace(matchId), matchId).toBeUndefined();
          expect(store.listMatches(undefined, 10).map((m) => m.clientOnly)).toStrictEqual([undefined, undefined]);
        } finally {
          store.close();
        }
        expect(version(file)).toBe(5);
        expect(metaOf(file)).toStrictEqual(metaBefore);
        expect(tablesOf(file)).toContain('client_matches');
        // The dump lists every table: the old rows are the same text, and the new table is empty.
        const rowsAfter = JSON.parse(withRawDb(file, dumpRows)) as [string, unknown[]][];
        const old = JSON.parse(rowsBefore) as [string, unknown[]][];
        for (const [table, rows] of old) expect(rowsAfter.find(([t]) => t === table)?.[1], table).toStrictEqual(rows);
        expect(rowsAfter.find(([t]) => t === 'client_matches')?.[1]).toStrictEqual([]);
      });
    });

    it(`FR-506 the upgrade of ${label} is one transaction: a failure leaves the old version and the old rows`, () => {
      withTempDir((dir) => {
        const file = join(dir, 'old.sqlite');
        prepare(file);
        // An index of the same name makes the version 3 statement fail, after the version 2 additions of a version 1 file.
        const raw = new DatabaseSync(file);
        raw.exec('CREATE INDEX client_matches ON memo (created_ms)');
        raw.close();
        const withForeign = withRawDb(file, dumpRows);
        expect(() => openStore(file)).toThrow();
        expect(version(file)).toBe(before);
        expect(withRawDb(file, dumpRows)).toBe(withForeign);
      });
    });
  }

  it('FR-506 a file of version 6 is refused unknown-schema-version and left untouched', () => {
    withTempDir((dir) => {
      const file = join(dir, 'new.sqlite');
      const raw = new DatabaseSync(file);
      raw.exec('CREATE TABLE foreign_data (k INTEGER); PRAGMA user_version = 6');
      raw.close();
      let code = 'no error';
      try {
        openStore(file);
      } catch (error) {
        if (error instanceof StoreError) code = error.code;
      }
      expect(code).toBe('unknown-schema-version');
      expect(version(file)).toBe(6);
    });
  });

  it('FR-506 a client-only match keeps its row across a close and a reopen', () => {
    withTempDir((dir) => {
      const file = join(dir, 'keep.sqlite');
      copyFileSync(V1_FIXTURE, file);
      const first = openStore(file);
      first.transaction(() => first.insertClientMatch('AAAAAAAAAAAAAAAA', 'discord'));
      first.close();
      const second = openStore(file);
      try {
        expect(second.getClientNamespace('AAAAAAAAAAAAAAAA')).toBe('discord');
        expect(second.getClientNamespace('BBBBBBBBBBBBBBBB')).toBeUndefined();
      } finally {
        second.close();
      }
    });
  });
});
