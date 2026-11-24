/**
 * Test-only writers of real-looking dBASE tables and polygon shapefiles with the quirks of real files:
 * several field types, padding with space or NUL, Windows-1252 and ISO-8859-1 bytes, and a null shape record.
 */
import type { Point } from './ne-fixture';

export type Enc = 'utf8' | 'cp1252' | 'latin1';

// The few non-ASCII characters the fixtures use, with their single-byte code in Windows-1252 and ISO-8859-1.
const SINGLE_BYTE: Record<string, { cp1252: number; latin1?: number }> = {
  'ñ': { cp1252: 0xf1, latin1: 0xf1 }, // n with tilde
  'é': { cp1252: 0xe9, latin1: 0xe9 }, // e with acute
  'ó': { cp1252: 0xf3, latin1: 0xf3 }, // o with acute
  'ç': { cp1252: 0xe7, latin1: 0xe7 }, // c with cedilla
  '€': { cp1252: 0x80 }, // euro sign, Windows-1252 only
};

/** The bytes of a text in one encoding; a character the encoding lacks throws (a fixture mistake). */
export function encodeText(text: string, enc: Enc): number[] {
  if (enc === 'utf8') return [...new TextEncoder().encode(text)];
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else {
      const mapped = SINGLE_BYTE[ch]?.[enc];
      if (mapped === undefined) throw new Error(`fixture: no ${enc} byte for ${ch}`);
      out.push(mapped);
    }
  }
  return out;
}

export interface FieldSpec {
  name: string;
  /** dBASE type letter: C text, N and F numbers, D date, L logical. */
  type: string;
  length: number;
  decimals?: number;
}

export interface DbfOptions {
  enc?: Enc;
  /** Padding byte of text cells: 0x20 (space) or 0x00 (NUL, the real Natural Earth files). */
  pad?: number;
}

/** A cell is a text (encoded and padded to the field length) or the exact bytes of the cell. */
export type Cell = string | Uint8Array;

/** A dBASE table; numeric and date cells are right-aligned with spaces, text cells padded with `pad`. */
export function dbfRaw(fields: readonly FieldSpec[], rows: readonly (readonly Cell[])[], options: DbfOptions = {}): Uint8Array {
  const enc = options.enc ?? 'utf8';
  const pad = options.pad ?? 0x20;
  const headerLength = 32 + 32 * fields.length + 1;
  const recordLength = 1 + fields.reduce((sum, f) => sum + f.length, 0);
  const out = new Uint8Array(headerLength + recordLength * rows.length + 1);
  const view = new DataView(out.buffer);
  out[0] = 3;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  fields.forEach((f, i) => {
    const at = 32 + 32 * i;
    out.set(new TextEncoder().encode(f.name).subarray(0, 10), at);
    out[at + 11] = f.type.charCodeAt(0);
    out[at + 16] = f.length;
    out[at + 17] = f.decimals ?? 0;
  });
  out[32 + 32 * fields.length] = 0x0d;
  rows.forEach((row, r) => {
    let at = headerLength + recordLength * r;
    out[at++] = 0x20;
    fields.forEach((f, i) => {
      const cell = row[i] ?? '';
      if (cell instanceof Uint8Array) {
        if (cell.length !== f.length) throw new Error(`fixture: raw cell of ${f.name} must be ${f.length} bytes`);
        out.set(cell, at);
      } else {
        const bytes = encodeText(cell, enc);
        if (bytes.length > f.length) throw new Error(`fixture: ${cell} does not fit in ${f.name}`);
        const right = f.type !== 'C';
        out.fill(right ? 0x20 : pad, at, at + f.length);
        out.set(bytes, right ? at + f.length - bytes.length : at);
      }
      at += f.length;
    });
  });
  out[out.length - 1] = 0x1a;
  return out;
}

/** The .shp of polygon records; a null entry is a null shape record (shape type 0). */
export function shpWithNulls(records: readonly (Point[][] | null)[]): Uint8Array {
  const contentBytes = records.map((rings) => (rings === null ? 4 : 44 + 4 * rings.length + 16 * rings.flat().length));
  const total = 100 + contentBytes.reduce((sum, n) => sum + 8 + n, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const all = records.flatMap((r) => r?.flat() ?? []);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  view.setInt32(0, 9994, false);
  view.setInt32(24, total / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 5, true);
  [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, i) => view.setFloat64(36 + 8 * i, v, true));
  let at = 100;
  records.forEach((rings, index) => {
    view.setInt32(at, index + 1, false);
    view.setInt32(at + 4, contentBytes[index]! / 2, false);
    at += 8;
    if (rings === null) {
      view.setInt32(at, 0, true);
      at += 4;
      return;
    }
    const points = rings.flat();
    view.setInt32(at, 5, true);
    [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ].forEach((v, i) => view.setFloat64(at + 4 + 8 * i, v, true));
    view.setInt32(at + 36, rings.length, true);
    view.setInt32(at + 40, points.length, true);
    let part = 0;
    rings.forEach((ring, i) => {
      view.setInt32(at + 44 + 4 * i, part, true);
      part += ring.length;
    });
    let p = at + 44 + 4 * rings.length;
    for (const [x, y] of points) {
      view.setFloat64(p, x, true);
      view.setFloat64(p + 8, y, true);
      p += 16;
    }
    at += contentBytes[index]! - 4 + 4;
  });
  return out;
}
