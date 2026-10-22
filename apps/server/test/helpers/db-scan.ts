// Storage inspection for the anti-spoiler and credential checks (spec 008 FR-293, plan PD11, PD12, NFR-47 (d)).
// It reads a database file with a raw connection, so the store that wrote it must be closed first (the store holds an
// exclusive lock). Tests only.
import { DatabaseSync } from 'node:sqlite';

export type Columns = Record<string, string[]>;

/** Every table of the database with its column names, in declaration order. */
export const listColumns = (db: DatabaseSync): Columns => {
  const out: Columns = {};
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for (const { name } of tables) out[String(name)] = db.prepare(`PRAGMA table_info(${String(name)})`).all().map((c) => String(c.name));
  return out;
};

/** `table.column` names matching `pattern`, optionally limited to the tables for which `skipTable` is false. */
const columnsMatching = (columns: Columns, pattern: RegExp, skipTable: (table: string) => boolean = () => false): string[] =>
  Object.entries(columns).flatMap(([table, names]) => (skipTable(table) ? [] : names.filter((n) => pattern.test(n)).map((n) => `${table}.${n}`)));

/** A column about an absorber anywhere but `records` (the absorber is public once its round is applied only). */
export const absorberColumnsOutsideRecords = (columns: Columns): string[] => columnsMatching(columns, /absorb/i, (t) => t === 'records');

/** A column that could hold a pending or future state or a round seed. */
export const pendingStateColumns = (columns: Columns): string[] => columnsMatching(columns, /pending|next|future|seed|rng|round_seed/i);

/** A credential-like column that is not a digest (the match secret is the one allowed plain column, D14). */
export const credentialTextColumns = (columns: Columns): string[] =>
  columnsMatching(columns, /token|credential|password|secret|key/i).filter((c) => !c.endsWith('_digest') && c !== 'matches.secret');

/** Rows whose round is above N: an absorber record or a state of a round that is not applied (FR-255, FR-256). */
export const rowsBeyondApplied = (db: DatabaseSync): { table: string; matchId: string; round: number }[] => {
  const out: { table: string; matchId: string; round: number }[] = [];
  for (const table of ['records', 'states']) {
    const rows = db.prepare(`SELECT t.match_id AS match_id, t.round AS round FROM ${table} t JOIN matches m ON m.id = t.match_id WHERE t.round > m.n`).all();
    for (const r of rows) out.push({ table, matchId: String(r.match_id), round: Number(r.round) });
  }
  return out;
};

const toBytes = (marker: string | Uint8Array): Uint8Array => (typeof marker === 'string' ? new TextEncoder().encode(marker) : marker);

const contains = (haystack: Uint8Array, needle: Uint8Array): boolean => {
  if (needle.length === 0) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

/**
 * `table.column` names holding a planted marker in any row: text is searched as UTF-8 bytes, blobs as bytes, integers
 * as their decimal text when the marker is a number. `allow` lists `table.column` names that may hold it.
 */
export const scanValues = (db: DatabaseSync, markers: readonly (string | Uint8Array | number)[], allow: readonly string[] = []): string[] => {
  const found = new Set<string>();
  const needles = markers.map((m) => (typeof m === 'number' ? new TextEncoder().encode(String(m)) : toBytes(m)));
  for (const [table, names] of Object.entries(listColumns(db))) {
    const rows = db.prepare(`SELECT ${names.map((n) => `"${n}"`).join(', ')} FROM ${table}`).all();
    for (const row of rows) {
      for (const name of names) {
        const where = `${table}.${name}`;
        if (allow.includes(where)) continue;
        const value = row[name];
        if (value === null || value === undefined) continue;
        const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
        if (needles.some((n) => contains(bytes, n))) found.add(where);
      }
    }
  }
  return [...found].sort();
};

/** Runs `body` with a raw read connection on a closed store's file. */
export const withRawDb = <T>(file: string, body: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(file);
  try {
    return body(db);
  } finally {
    db.close();
  }
};
