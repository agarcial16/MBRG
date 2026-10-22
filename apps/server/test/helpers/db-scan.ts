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

/**
 * The encodings NFR-47 (c) and (d) scan for, of a planted value: a round seed (an unsigned 32-bit number, as the 4 bytes
 * big-endian) or a byte string (a secret, a digest, a token). Decimal (the number, or the byte list), hexadecimal in both
 * cases (padded and, for a number, unpadded), base64 with and without padding, base64url, and the raw bytes.
 */
export function encodingsOf(value: number | Uint8Array): (string | Uint8Array)[] {
  const bytes = typeof value === 'number' ? Uint8Array.from(Buffer.from(value.toString(16).padStart(8, '0'), 'hex')) : value;
  const buffer = Buffer.from(bytes);
  const hex = buffer.toString('hex');
  const base64 = buffer.toString('base64');
  const decimal = typeof value === 'number' ? [String(value), value.toString(16), value.toString(16).toUpperCase()] : [BigInt(`0x${hex}`).toString(10), [...bytes].join(','), [...bytes].join(', ')];
  return [...new Set([...decimal, hex, hex.toUpperCase(), base64, base64.replace(/=+$/, ''), buffer.toString('base64url')]), Uint8Array.from(bytes)];
}

/** A raw dump of every row of every table, in rowid order, blobs as hexadecimal: equal dumps mean equal storage. */
export const dumpRows = (db: DatabaseSync): string =>
  JSON.stringify(
    Object.entries(listColumns(db)).map(([table, names]) => [
      table,
      db
        .prepare(`SELECT ${names.map((n) => `"${n}"`).join(', ')} FROM ${table} ORDER BY rowid`)
        .all()
        .map((row) => names.map((n) => (row[n] instanceof Uint8Array ? `blob:${Buffer.from(row[n]).toString('hex')}` : row[n]))),
    ]),
  );

/** Keys that name a pending or future outcome or a seed (NFR-47 (d)); `absorber` is allowed only in a `round-applied` record. */
const FUTURE_KEY = /absorb|pending|next|future|seed|rng|owner/i;
/** Keys of the revealed victim: allowed only in a `victim-revealed` event (and, for the memo, in a public match). */
const VICTIM_KEY = /^(victim|candidates|living|revealedAt)$/;

function keyPaths(value: unknown, path: string, out: string[]): string[] {
  if (Array.isArray(value)) value.forEach((v) => keyPaths(v, path, out));
  else if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      out.push(path === '' ? key : `${path}.${key}`);
      keyPaths(v, path === '' ? key : `${path}.${key}`, out);
    }
  }
  return out;
}

const parsed = (text: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const leaf = (path: string): string => path.slice(path.lastIndexOf('.') + 1);

/**
 * The stored events and memoised replies that tell more than the stage of their match allows (FR-255, FR-256 storage,
 * NFR-47 (d)): with N the applied rounds of the match row,
 * - no event names a round above N + 1, and no `round-applied` event a round above N;
 * - the phase-1 close and the victim of round N + 1 exist only once that close happened (stage `phase-2`, `locked`, or
 *   `halted` with the victim column set), and the match row holds a victim only then (a winner only when finished, a
 *   halt reason only when halted: no column of the row carries anything its stage does not reveal);
 * - no event or memoised reply has a key about an absorber, a pending or next state, an owner list or a seed, apart from
 *   the record of a `round-applied` event; victim keys appear only in a `victim-revealed` event; in a reply, only inside
 *   its public match (`…match.state.owners` is the applied state, `…match.victim` the revealed victim).
 * Each violation is a readable text naming the match, the row and the rule.
 */
export function storedFutureViolations(db: DatabaseSync): string[] {
  const out: string[] = [];
  const matches = db.prepare('SELECT id, stage, n, victim, reveal_ms, winner, halt_reason FROM matches ORDER BY rowid').all();
  for (const m of matches) {
    const id = String(m.id);
    const n = Number(m.n);
    const revealed = m.stage === 'phase-2' || m.stage === 'locked' || (m.stage === 'halted' && m.victim !== null);
    if (!revealed && (m.victim !== null || m.reveal_ms !== null)) out.push(`${id}: victim column set in stage ${String(m.stage)}`);
    if (m.stage !== 'finished' && m.winner !== null) out.push(`${id}: winner column set in stage ${String(m.stage)}`);
    if (m.stage !== 'halted' && m.halt_reason !== null) out.push(`${id}: halt reason column set in stage ${String(m.stage)}`);
    for (const e of db.prepare('SELECT seq, type, payload_json FROM events WHERE match_id = ? ORDER BY seq').all(id)) {
      const where = `${id} event ${String(e.seq)} ${String(e.type)}`;
      const payload = parsed(String(e.payload_json));
      if (payload === undefined) {
        out.push(`${where}: not JSON`);
        continue;
      }
      const round = typeof payload.round === 'number' ? payload.round : null;
      if (round !== null && round > n + 1) out.push(`${where}: round ${round} above N + 1 = ${n + 1}`);
      if (e.type === 'round-applied' && round !== null && round > n) out.push(`${where}: applied round ${round} above N = ${n}`);
      if (!revealed && round === n + 1 && (e.type === 'victim-revealed' || (e.type === 'phase-closed' && payload.phase === 1))) out.push(`${where}: round ${round} revealed in stage ${String(m.stage)}`);
      for (const path of keyPaths(payload, '', [])) {
        if (FUTURE_KEY.test(leaf(path)) && !(e.type === 'round-applied' && path === 'record.absorber')) out.push(`${where}: key ${path}`);
        if (VICTIM_KEY.test(leaf(path)) && e.type !== 'victim-revealed') out.push(`${where}: key ${path}`);
      }
    }
  }
  for (const r of db.prepare('SELECT scope, request_id, reply_json FROM memo ORDER BY rowid').all()) {
    const where = `memo ${String(r.request_id)}`;
    const reply = parsed(String(r.reply_json));
    if (reply === undefined) out.push(`${where}: not JSON`);
    for (const path of keyPaths(reply, '', [])) {
      // The public match of a reply carries the applied state (its owners) and, once revealed, the victim fields.
      if (FUTURE_KEY.test(leaf(path)) && !/(^|\.)match\.state\.owners$/.test(path)) out.push(`${where}: key ${path}`);
      if (VICTIM_KEY.test(leaf(path)) && !/(^|\.)match\.victim(\.|$)/.test(path)) out.push(`${where}: key ${path}`);
    }
  }
  return out;
}

/** Runs `body` with a raw read connection on a closed store's file. */
export const withRawDb = <T>(file: string, body: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(file);
  try {
    return body(db);
  } finally {
    db.close();
  }
};
