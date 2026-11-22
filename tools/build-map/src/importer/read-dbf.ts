import type { Result } from '@mbrg/shared';

/**
 * FR-590, PD4: the own dBASE reader of the extract mode. It uses only `TextDecoder` and `DataView` (no library, no file).
 * The shapefile library trims every text value, which would drop leading spaces; this reader removes only trailing
 * space and NUL padding, decodes in the encoding it is told and changes nothing else of a value.
 */

/** The three encodings the extract mode reads (FR-590). */
export type DbfEncoding = 'utf-8' | 'windows-1252' | 'iso-8859-1';

const ENCODING_SPELLINGS: Record<string, DbfEncoding> = {
  utf8: 'utf-8',
  '65001': 'utf-8',
  cp65001: 'utf-8',
  windows1252: 'windows-1252',
  cp1252: 'windows-1252',
  '1252': 'windows-1252',
  ansi1252: 'windows-1252',
  win1252: 'windows-1252',
  iso88591: 'iso-8859-1',
  latin1: 'iso-8859-1',
  l1: 'iso-8859-1',
};

/**
 * The encoding a `.cpg` file or the command names, in its common spellings (`UTF-8`, `UTF8`, `CP1252`, `1252`,
 * `ANSI 1252`, `ISO8859-1`, `Latin1`, ...): case, punctuation, spaces, NUL and a byte order mark are ignored.
 * Undefined when the text names none of the three.
 */
export function normalizeEncoding(name: string): DbfEncoding | undefined {
  const key = name.replace(/[\u0000\ufeff]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.hasOwn(ENCODING_SPELLINGS, key) ? ENCODING_SPELLINGS[key] : undefined;
}

/** One field descriptor of the table. */
export interface DbfField {
  name: string;
  /** dBASE type letter. */
  type: string;
  length: number;
  /** Byte offset of the field inside a record (after the deletion flag). */
  offset: number;
}

export interface DbfHeader {
  fields: DbfField[];
  records: number;
  headerLength: number;
  recordLength: number;
}

/** The problems of a table that cannot be read at all. */
export type DbfFault = { kind: 'invalid-input'; reason: string };

export const DBF_UNREADABLE_HEADER = 'the table has no readable header';
export const DBF_CUT_SHORT = 'the table is cut short';

const fault = (reason: string): Result<never, DbfFault> => ({ ok: false, errors: [{ kind: 'invalid-input', reason }] });

/** Field names are ASCII in dBASE: they are read byte for byte, whatever the text encoding. */
function nameOf(bytes: Uint8Array, at: number): string {
  let end = at;
  while (end < at + 11 && bytes[end] !== 0) end++;
  let name = '';
  for (let i = at; i < end; i++) name += String.fromCharCode(bytes[i]!);
  return name;
}

/** The header of a table: its fields and record geometry. Fails when it cannot be read or the records are cut short. */
export function readDbfHeader(bytes: Uint8Array): Result<DbfHeader, DbfFault> {
  if (bytes.length < 33) return fault(DBF_UNREADABLE_HEADER);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const fields: DbfField[] = [];
  let at = 32;
  let offset = 1;
  for (;;) {
    if (at >= headerLength || at >= bytes.length) return fault(DBF_UNREADABLE_HEADER);
    if (bytes[at] === 0x0d) break;
    if (at + 32 > headerLength || at + 32 > bytes.length) return fault(DBF_UNREADABLE_HEADER);
    const length = bytes[at + 16]!;
    fields.push({ name: nameOf(bytes, at), type: String.fromCharCode(bytes[at + 11]!), length, offset });
    offset += length;
    at += 32;
  }
  if (offset > recordLength) return fault(DBF_UNREADABLE_HEADER);
  if (bytes.length < headerLength + records * recordLength) return fault(DBF_CUT_SHORT);
  return { ok: true, value: { fields, records, headerLength, recordLength } };
}

const NUMBER_TEXT = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const INTEGER_TEXT = /^[-+]?\d+$/;

/** The text of a cell without its trailing space and NUL padding (the padding is single-byte in every encoding read). */
function unpadded(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0x00)) end--;
  return bytes.subarray(0, end);
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

/**
 * Windows-1252 bytes 0x80 to 0x9F as code points (the other bytes are their own code point). The runtime's
 * `TextDecoder('windows-1252')` is not used: Node 24.0 decodes this range as ISO-8859-1 (0x80 as U+0080, not the euro sign).
 */
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

function windows1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80]! : b);
  }
  return out;
}

/** The decoders of the three encodings; a UTF-8 text with an invalid sequence is refused, never repaired. */
function decoderFor(encoding: DbfEncoding): (bytes: Uint8Array) => string {
  if (encoding === 'iso-8859-1') return latin1;
  if (encoding === 'windows-1252') return windows1252;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  return (bytes) => decoder.decode(bytes);
}

/** A number as the table stores it: an integer within 2^53 as a number, a decimal as a number, anything else as its text. */
function numberOf(text: string): unknown {
  const t = text.trim();
  if (t === '' || /^\*+$/.test(t)) return null;
  if (INTEGER_TEXT.test(t)) {
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : t;
  }
  return NUMBER_TEXT.test(t) ? Number(t) : t;
}

/** One cell by its field type: C and any other type as text; N and F as numbers; D as its text; L as a boolean. */
function valueOf(field: DbfField, cell: Uint8Array, decode: (bytes: Uint8Array) => string): unknown {
  if (field.type === 'N' || field.type === 'F') return numberOf(latin1(unpadded(cell)));
  if (field.type === 'D') {
    const t = latin1(unpadded(cell)).trim();
    return t === '' ? null : t;
  }
  if (field.type === 'L') {
    const t = latin1(cell).trim();
    return /^[yYtT]$/.test(t) ? true : /^[nNfF]$/.test(t) ? false : null;
  }
  const text = unpadded(cell);
  return text.length === 0 ? null : decode(text);
}

/** A text value that is not valid in the encoding: the field and the 0-based record. */
export interface DbfTextFault {
  kind: 'invalid-dbf-text';
  field: string;
  record: number;
}

/**
 * The rows of a table: for each record an object holding the named fields, in the order of `names`. The caller has
 * already checked the names against the header. A value that cannot be decoded is reported (every one, once)
 * and the rows are not returned.
 */
export function readDbfRows(
  bytes: Uint8Array,
  header: DbfHeader,
  encoding: DbfEncoding,
  names: readonly string[],
): Result<Record<string, unknown>[], DbfTextFault> {
  const decode = decoderFor(encoding);
  const wanted = names.map((name) => header.fields.find((f) => f.name === name)!);
  const rows: Record<string, unknown>[] = [];
  const faults: DbfTextFault[] = [];
  for (let record = 0; record < header.records; record++) {
    const base = header.headerLength + record * header.recordLength;
    // no prototype: a field named __proto__ is data, never the object's prototype
    const row = Object.create(null) as Record<string, unknown>;
    for (const field of wanted) {
      const cell = bytes.subarray(base + field.offset, base + field.offset + field.length);
      try {
        row[field.name] = valueOf(field, cell, decode);
      } catch {
        faults.push({ kind: 'invalid-dbf-text', field: field.name, record });
      }
    }
    rows.push(row);
  }
  return faults.length > 0 ? { ok: false, errors: faults } : { ok: true, value: rows };
}
