import type { PublicState } from './wire';

/**
 * Canonical forms of spec 008 (Definitions). This module only produces the bytes or text that are hashed; the
 * SHA-256 digests are computed by callers with their platform's hash (the protocol package stays pure).
 */

/** The map package files, in the order of the map digest. */
export const MAP_FILE_NAMES = ['map.json', 'ids.png', 'presentation.json'] as const;
export type MapFileName = (typeof MAP_FILE_NAMES)[number];

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/**
 * State digest text: `classic;<round>;<t1>:<f1>,<t2>:<f2>,...` (decimal integers without sign or leading zeros,
 * owners in the order given, no spaces). Throws RangeError for a number that has no such text.
 */
export function stateText(state: PublicState): string {
  if (!isCount(state.round)) throw new RangeError('state round is not a non-negative integer');
  const parts: string[] = [];
  for (const pair of state.owners) {
    const t = pair[0];
    const f = pair[1];
    if (!isCount(t) || !isCount(f)) throw new RangeError('state owner is not a pair of non-negative integers');
    parts.push(`${t}:${f}`);
  }
  return `classic;${state.round};${parts.join(',')}`;
}

/**
 * Map digest bytes: for each of `map.json`, `ids.png`, `presentation.json`, in this order, the UTF-8 name, one zero
 * byte, the file length as an 8-byte unsigned big-endian number, then the file's bytes exactly as given.
 */
export function mapDigestBytes(files: Readonly<Record<MapFileName, Uint8Array>>): Uint8Array {
  for (const name of MAP_FILE_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(files, name) || !(files[name] instanceof Uint8Array)) {
      throw new TypeError(`map file ${name} is missing or is not a byte array`);
    }
  }
  let size = 0;
  for (const name of MAP_FILE_NAMES) size += name.length + 1 + 8 + files[name].length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const name of MAP_FILE_NAMES) {
    for (let i = 0; i < name.length; i++) out[at++] = name.charCodeAt(i); // names are ASCII, so UTF-8 equals code units
    out[at++] = 0;
    view.setBigUint64(at, BigInt(files[name].length), false);
    at += 8;
    out.set(files[name], at);
    at += files[name].length;
  }
  return out;
}

/** Compact JSON with object keys sorted (by UTF-16 code unit) at every depth; arrays keep their order. */
function sortedJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('a non-finite number has no JSON form');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => sortedJson(v === undefined ? null : v)).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const members: string[] = [];
    for (const key of Object.keys(o).sort()) {
      if (o[key] !== undefined) members.push(`${JSON.stringify(key)}:${sortedJson(o[key])}`);
    }
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`a ${typeof value} has no JSON form`);
}

/** The key of the client request id, the only member the canonical body leaves out (FR-282). */
export const REQUEST_ID_KEY = 'requestId';

/**
 * The content of a command for FR-282: its method, its path and its JSON body without the top-level request-id
 * member, keys sorted and no insignificant whitespace. Two commands have the same content exactly when these texts
 * are equal. Throws TypeError for a body JSON cannot carry.
 */
export function canonicalBody(method: string, path: string, body: unknown): string {
  let content = body;
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    // No prototype: an own `__proto__` member must stay an own member, not set the prototype.
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(body)) if (key !== REQUEST_ID_KEY) copy[key] = (body as Record<string, unknown>)[key];
    content = copy;
  }
  return `${JSON.stringify(method)} ${JSON.stringify(path)} ${sortedJson(content)}`;
}
