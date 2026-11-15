import { errorReply } from './errors';
import { isJoinedPlayerId, isLocalId, isPlayerId } from './ids';
import type { ReadResult } from './read';
import { PREDICTION_KINDS, type PredictionKind } from './wire';

/**
 * Paging of every list read (FR-279, P38, PD20). A page has 1 to 500 items (default 100); a page that is not the last
 * carries an opaque cursor: `base64url(JSON [list, ...key])`, where the key is the fixed order key of the item the page
 * ended on. A cursor is accepted only for its own list, with the key shape of that list, and only in the exact text the
 * server issues (re-encoding the decoded key must give the same text). It carries no secret: the ids it names are public
 * to the reader of that list. Reads are keyset reads: the next page starts strictly after the key, so items inserted
 * ahead of the cursor between pages are not seen and nothing is repeated or skipped (FR-279 (c)).
 */

export const PAGE_LIMIT_DEFAULT = 100;
export const PAGE_LIMIT_MAX = 500;
export const CURSOR_MAX_LENGTH = 256;

/** The list tags: the three of M3a, the results lists (phase results, a player's results, the leaderboard), then the players and the winners of a phase. */
export const CURSOR_LISTS = ['matches', 'records', 'predictions', 'phase-results', 'player-results', 'leaderboard', 'players', 'phase-winners'] as const;
export type CursorList = (typeof CURSOR_LISTS)[number];

/**
 * The order key of each list (FR-279 (b)): match list by creation instant then match id; records by round; own
 * predictions by local player id, then round (0 for the winner, which has none), then kind. Texts compare by UTF-16 code
 * unit, which equals SQLite's BINARY order for the ASCII texts these keys hold. The results lists (plan 20.7): phase
 * results by namespaced player id; a player's results by round (0 for the winner) then kind; the leaderboard by rank then
 * player id, with the generation (the number of scored phases) the page was cut at, so a cursor from before a new scored
 * phase can be told apart (FR-279 (d)). The players of a match: by the join sequence number (`joinedSeq` of the list item). The players who guessed a phase right: by joined player id.
 */
export interface CursorKeys {
  readonly matches: readonly [createdAt: number, matchId: string];
  readonly records: readonly [round: number];
  readonly predictions: readonly [playerId: string, round: number, kind: PredictionKind];
  readonly 'phase-results': readonly [playerId: string];
  readonly 'player-results': readonly [round: number, kind: PredictionKind];
  readonly leaderboard: readonly [generation: number, rank: number, playerId: string];
  readonly players: readonly [joinedSeq: number];
  readonly 'phase-winners': readonly [playerId: string];
}
export type CursorKey<L extends CursorList> = CursorKeys[L];

export interface PageQuery<L extends CursorList> {
  readonly limit: number;
  /** The key the previous page ended on; absent for the first page. */
  readonly after?: CursorKey<L>;
  /** The values of the route's extra parameters that were given (each at most once). */
  readonly extra: Readonly<Record<string, string>>;
}

const MATCH_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const LIMIT = /^[1-9][0-9]{0,2}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

/** Whether `parts` (the JSON array after the tag) is a key of `list`. */
function isKeyOf(list: CursorList, parts: readonly unknown[]): boolean {
  switch (list) {
    case 'matches':
      return parts.length === 2 && isInt(parts[0], 0) && typeof parts[1] === 'string' && MATCH_ID.test(parts[1]);
    case 'records':
      return parts.length === 1 && isInt(parts[0], 1);
    case 'predictions': {
      if (parts.length !== 3 || !isLocalId(parts[0]) || !isInt(parts[1], 0)) return false;
      const kind = parts[2];
      if (typeof kind !== 'string' || !(PREDICTION_KINDS as readonly string[]).includes(kind)) return false;
      return (kind === 'winner') === (parts[1] === 0);
    }
    case 'phase-results':
      return parts.length === 1 && isPlayerId(parts[0]);
    case 'player-results': {
      if (parts.length !== 2 || !isInt(parts[0], 0)) return false;
      const kind = parts[1];
      if (typeof kind !== 'string' || !(PREDICTION_KINDS as readonly string[]).includes(kind)) return false;
      return (kind === 'winner') === (parts[0] === 0);
    }
    case 'leaderboard':
      return parts.length === 3 && isInt(parts[0], 0) && isInt(parts[1], 1) && isPlayerId(parts[2]);
    case 'players':
      return parts.length === 1 && isInt(parts[0], 1);
    case 'phase-winners':
      return parts.length === 1 && isJoinedPlayerId(parts[0]);
    default:
      return false;
  }
}

/** base64url without padding of an ASCII text (the cursor JSON holds only ASCII: the key shapes guarantee it). */
function toBase64url(ascii: string): string {
  let out = '';
  for (let i = 0; i < ascii.length; i += 3) {
    const len = Math.min(3, ascii.length - i);
    const n = (ascii.charCodeAt(i) << 16) | ((len > 1 ? ascii.charCodeAt(i + 1) : 0) << 8) | (len > 2 ? ascii.charCodeAt(i + 2) : 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (len > 1) out += ALPHABET[(n >> 6) & 63]!;
    if (len > 2) out += ALPHABET[n & 63]!;
  }
  return out;
}

/** The ASCII text of a base64url text, or undefined when it is not base64url of ASCII bytes. */
function fromBase64url(b64: string): string | undefined {
  if (!BASE64URL.test(b64) || b64.length % 4 === 1) return undefined;
  let out = '';
  for (let i = 0; i < b64.length; i += 4) {
    const chunk = b64.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) n = (n << 6) | (j < chunk.length ? ALPHABET.indexOf(chunk[j]!) : 0);
    const bytes = [(n >> 16) & 255, (n >> 8) & 255, n & 255].slice(0, chunk.length - 1);
    for (const b of bytes) {
      if (b > 127) return undefined;
      out += String.fromCharCode(b);
    }
  }
  return out;
}

/** The cursor text of a key of `list`. Throws RangeError for a key of the wrong shape (the server never issues one). */
export function encodeCursor<L extends CursorList>(list: L, key: CursorKey<L>): string {
  if (!(CURSOR_LISTS as readonly string[]).includes(list)) throw new RangeError('unknown cursor list');
  if (!Array.isArray(key) || !isKeyOf(list, key)) throw new RangeError(`not a key of the ${list} list`);
  const text = toBase64url(JSON.stringify([list, ...key]));
  if (text.length > CURSOR_MAX_LENGTH) throw new RangeError('the cursor is too long');
  return text;
}

const badCursor = { ok: false, error: errorReply('invalid-request', ['cursor']) } as const;

/** The key of a cursor issued for `list`; anything else (another list, another shape, other text) is `invalid-request ['cursor']`. */
export function decodeCursor<L extends CursorList>(list: L, text: string): ReadResult<CursorKey<L>> {
  if (typeof text !== 'string' || text.length === 0 || text.length > CURSOR_MAX_LENGTH) return badCursor;
  const json = fromBase64url(text);
  if (json === undefined) return badCursor;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return badCursor;
  }
  if (!Array.isArray(parsed)) return badCursor;
  // Only the issued spelling: a different text of the same array (spaces, extra trailing bits) is not a cursor we issued.
  if (toBase64url(JSON.stringify(parsed)) !== text) return badCursor;
  if (parsed[0] !== list) return badCursor;
  const parts = parsed.slice(1);
  if (!isKeyOf(list, parts)) return badCursor;
  return { ok: true, value: parts as unknown as CursorKey<L> };
}

/**
 * Reads the query of a list route (FR-279 (a), (e)): `limit` (a decimal whole number 1 to 500 without sign or leading
 * zero, default 100), `cursor` (issued for this list) and the route's extra parameter names, each at most once. Checked
 * in that order; an unknown parameter is named last, the first in sorted order (as the body readers do, FR-296).
 */
export function readPageQuery<L extends CursorList>(
  list: L,
  params: readonly (readonly [string, string])[],
  extraNames: readonly string[] = [],
): ReadResult<PageQuery<L>> {
  const fail = (field: string): { ok: false; error: ReturnType<typeof errorReply> } => ({ ok: false, error: errorReply('invalid-request', [field]) });
  const valuesOf = (name: string): string[] => params.filter(([k]) => k === name).map(([, v]) => v);

  const limits = valuesOf('limit');
  let limit = PAGE_LIMIT_DEFAULT;
  if (limits.length > 1) return fail('limit');
  if (limits.length === 1) {
    const text = limits[0]!;
    if (!LIMIT.test(text) || Number(text) > PAGE_LIMIT_MAX) return fail('limit');
    limit = Number(text);
  }

  const cursors = valuesOf('cursor');
  let after: CursorKey<L> | undefined;
  if (cursors.length > 1) return fail('cursor');
  if (cursors.length === 1) {
    const decoded = decodeCursor(list, cursors[0]!);
    if (!decoded.ok) return decoded;
    after = decoded.value;
  }

  const extra: Record<string, string> = {};
  for (const name of extraNames) {
    const values = valuesOf(name);
    if (values.length > 1) return fail(name);
    if (values.length === 1) extra[name] = values[0]!;
  }

  const known = new Set(['limit', 'cursor', ...extraNames]);
  const unknown = params.map(([k]) => k).filter((k) => !known.has(k)).sort()[0];
  if (unknown !== undefined) return fail(unknown);
  return { ok: true, value: { limit, ...(after === undefined ? {} : { after }), extra } };
}

/** Orders two keys part by part: numbers by value, texts by UTF-16 code unit; a shorter key that is a prefix comes first. */
export function compareKeys(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (typeof x !== typeof y) throw new RangeError('keys of different shapes');
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}

/**
 * One keyset page of `items` (sorted by `keyOf`): up to `limit` items whose key is after `after`, and `next` (the key of
 * the last item) exactly when more items follow. The reference for the store's keyset reads and for the tests.
 */
export function pageOf<T, K extends readonly (string | number)[]>(
  items: readonly T[],
  keyOf: (item: T) => K,
  after: K | undefined,
  limit: number,
): { items: T[]; next?: K } {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_LIMIT_MAX) throw new RangeError('the page size is not 1 to 500');
  const rest = after === undefined ? items : items.filter((item) => compareKeys(keyOf(item), after) > 0);
  const page = rest.slice(0, limit);
  const last = page[page.length - 1];
  return rest.length > limit && last !== undefined ? { items: page, next: keyOf(last) } : { items: page };
}
