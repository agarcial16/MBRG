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

/**
 * A credential-like column that is not a digest (the match secret is the one allowed plain column, D14; `players.name_key` is
 * the case-folded name used for the uniqueness of names, not a key of any kind).
 */
export const credentialTextColumns = (columns: Columns): string[] =>
  columnsMatching(columns, /token|credential|password|secret|key/i).filter((c) => !c.endsWith('_digest') && c !== 'matches.secret' && c !== 'players.name_key');

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
 * - no event names a round above N + 1, and no `round-applied` or phase-2 `results` event a round above N (a phase-1
 *   `results` event of round N + 1 exists only once that round's victim is revealed);
 * - no result row scores an absorber of a round above N, a victim of a round above N + 1 (or of N + 1 before its reveal),
 *   or a winner before the match is finished (M4: a premature `correct` bit would reveal an outcome);
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
    for (const r of db.prepare('SELECT round, kind, player_id FROM results WHERE match_id = ? ORDER BY rowid').all(id)) {
      const where = `${id} result ${String(r.kind)} round ${String(r.round)} ${String(r.player_id)}`;
      if (r.kind === 'absorber' && Number(r.round) > n) out.push(`${where}: absorber scored for a round above N = ${n}`);
      if (r.kind === 'victim' && (Number(r.round) > n + 1 || (Number(r.round) === n + 1 && !revealed))) out.push(`${where}: victim scored before its reveal (N = ${n}, stage ${String(m.stage)})`);
      if (r.kind === 'winner' && m.stage !== 'finished') out.push(`${where}: winner scored in stage ${String(m.stage)}`);
    }
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
      if (e.type === 'results' && payload.phase === 2 && round !== null && round > n) out.push(`${where}: phase 2 results for round ${round} above N = ${n}`);
      if (e.type === 'results' && payload.phase === 1 && !revealed && round === n + 1) out.push(`${where}: round ${round} scored in stage ${String(m.stage)}`);
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

/**
 * Where the tokens of players (and hosts) sit in the database, as violations (spec 011 M3 T9): the plain token text is allowed
 * only in `memo.reply_json` and only while `inMemo` (the 24 h retention of the reply that carried it); the raw bytes of a
 * token in any other encoding (hexadecimal, base64, decimal, raw) are allowed nowhere. No other table or column may hold it.
 */
export const playerTokenPlaces = (db: DatabaseSync, tokens: readonly string[], inMemo: boolean): string[] => {
  const out: string[] = [];
  for (const token of tokens) {
    const bytes = Uint8Array.from(Buffer.from(token, 'base64url'));
    for (const where of scanValues(db, encodingsOf(bytes).filter((e) => e !== token))) out.push(`token bytes in ${where}`);
    for (const where of scanValues(db, [token])) if (!inMemo || where !== 'memo.reply_json') out.push(`token in ${where}`);
  }
  return out;
};

/**
 * What a partial join would leave behind (spec 011 M3 T9), as readable violations: event numbers with a gap; a player without
 * its `player-joined` event (same number as its join order, same id and name) or an event without its player; players out of
 * the order of their events; a memoised join reply of a player who does not exist.
 */
export function playerEventViolations(db: DatabaseSync): string[] {
  const out: string[] = [];
  for (const m of db.prepare('SELECT id FROM matches ORDER BY rowid').all()) {
    const id = String(m.id);
    const events = db.prepare('SELECT seq, type, payload_json FROM events WHERE match_id = ? ORDER BY seq').all(id);
    if (events.some((e, i) => Number(e.seq) !== i + 1)) out.push(`${id}: event numbers have a gap`);
    const joined = events.filter((e) => e.type === 'player-joined').map((e) => ({ seq: Number(e.seq), ...(JSON.parse(String(e.payload_json)) as { playerId: string; name: string }) }));
    const players = db.prepare('SELECT player_id, name, joined_seq FROM players WHERE match_id = ? ORDER BY joined_seq').all(id);
    for (const p of players) {
      const hit = joined.filter((e) => e.playerId === String(p.player_id));
      if (hit.length !== 1) out.push(`${id}: player ${String(p.player_id)} has ${hit.length} joined events`);
      else if (hit[0]!.seq !== Number(p.joined_seq) || hit[0]!.name !== String(p.name)) out.push(`${id}: player ${String(p.player_id)} differs from its event`);
    }
    for (const e of joined) if (!players.some((p) => String(p.player_id) === e.playerId)) out.push(`${id}: joined event ${e.seq} without its player`);
    if (players.map((p) => Number(p.joined_seq)).join() !== joined.map((e) => e.seq).join()) out.push(`${id}: players are not in the order of their events`);
  }
  for (const r of db.prepare('SELECT request_id, reply_json FROM memo ORDER BY rowid').all()) {
    const reply = parsed(String(r.reply_json)) as { reply?: { playerId?: string; playerToken?: string } } | undefined;
    const joinedId = reply?.reply?.playerToken === undefined ? undefined : reply.reply.playerId;
    if (joinedId !== undefined && db.prepare('SELECT 1 AS x FROM players WHERE player_id = ?').get(joinedId) === undefined) out.push(`memo ${String(r.request_id)}: a join reply of a player who does not exist`);
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

/**
 * Every form a player or host token can take in an output or a row (spec 011 NFR-73): the token text itself (base64url of its
 * 32 random bytes), and the decimal, hexadecimal, base64 (with and without padding), base64url and raw-byte forms of the bytes.
 */
export const tokenNeedles = (token: string): (string | Uint8Array)[] => encodingsOf(Uint8Array.from(Buffer.from(token, 'base64url')));

/** The needles (texts or bytes) a text holds, as readable names (the first 12 characters of a text needle); empty when it holds none. */
export const needlesHeldBy = (text: string, needles: readonly (string | Uint8Array)[]): string[] => {
  const bytes = Buffer.from(text, 'utf8');
  return needles.filter((n) => (typeof n === 'string' ? n.length > 0 && text.includes(n) : n.length > 0 && bytes.includes(Buffer.from(n)))).map((n) => (typeof n === 'string' ? n.slice(0, 12) : `bytes:${Buffer.from(n).toString('hex').slice(0, 12)}`));
};
