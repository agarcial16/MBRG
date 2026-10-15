// Own PNG decoder for the id image (FR-134, plan decision P4). Pure: the inflate step is injected.
// The file must be exactly what the builder writes (003b FR-105): 8-bit RGB, no alpha, no palette,
// non-interlaced, made only of IHDR, consecutive IDAT chunks and IEND. Chunk and header checks run
// before any pixel is decoded. No colour management and no premultiplication exist on this path.
import { decodePixel } from '@mbrg/shared';
import type { Result } from '@mbrg/shared';

/** Viewer-internal error kind (English identifier, listed in the language test). */
export interface InvalidPng {
  kind: 'invalid-png';
}

export interface DecodedImage {
  width: number;
  height: number;
  /** Row-major 24-bit values, as decoded by the 003a FR-106 decode function. */
  values: Uint32Array;
}

/** Inflates a zlib stream (the PNG compression method 0). May reject on corrupt data. */
export type Inflate = (zlib: Uint8Array) => Promise<Uint8Array>;

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_DIMENSION = 0x7fffffff;
/** Raw scanline data larger than this cannot be held in one typed array. */
const MAX_RAW_BYTES = 0x7fffffff;

const fail = (): { ok: false; errors: InvalidPng[] } => ({ ok: false, errors: [{ kind: 'invalid-png' }] });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

const typeAt = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);

interface Layout {
  width: number;
  height: number;
  idat: Uint8Array[];
}

/** Chunk walk and header checks (no pixel work). Undefined when the file is not acceptable. */
function readLayout(bytes: Uint8Array): Layout | undefined {
  if (bytes.length < 8) return undefined;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return undefined;

  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  let seenHeader = false;
  for (;;) {
    if (pos + 12 > bytes.length) return undefined;
    const length = u32(bytes, pos);
    const end = pos + 12 + length;
    if (length > MAX_DIMENSION || end > bytes.length) return undefined;
    const type = typeAt(bytes, pos + 4);
    if (crc32(bytes, pos + 4, pos + 8 + length) !== u32(bytes, pos + 8 + length)) return undefined;
    const data = pos + 8;

    if (!seenHeader) {
      if (type !== 'IHDR' || length !== 13) return undefined;
      width = u32(bytes, data);
      height = u32(bytes, data + 4);
      if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) return undefined;
      // depth 8, colour type 2 (RGB), compression 0, filter method 0, no interlacing
      if (bytes[data + 8] !== 8 || bytes[data + 9] !== 2 || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || bytes[data + 12] !== 0) {
        return undefined;
      }
      seenHeader = true;
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(data, data + length));
    } else if (type === 'IEND') {
      // Exactly one IEND, empty, last, and at least one IDAT before it.
      if (length !== 0 || idat.length === 0 || end !== bytes.length) return undefined;
      return { width, height, idat };
    } else {
      return undefined; // any other chunk, including a repeated IHDR or a gap between IDAT chunks
    }
    pos = end;
  }
}

function joinParts(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Undoes the row filters in place (PNG filter types 0 to 4, 3 bytes per pixel). Undefined on an unknown type. */
function unfilter(lines: Uint8Array, width: number, height: number): Uint8Array | undefined {
  const stride = width * 3;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const type = lines[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    if (type > 4) return undefined;
    for (let x = 0; x < stride; x++) {
      const value = lines[src + x]!;
      const left = x >= 3 ? raw[row + x - 3]! : 0;
      const up = y > 0 ? raw[prev + x]! : 0;
      let add = 0;
      if (type === 1) add = left;
      else if (type === 2) add = up;
      else if (type === 3) add = (left + up) >> 1;
      else if (type === 4) {
        const upLeft = y > 0 && x >= 3 ? raw[prev + x - 3]! : 0;
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      raw[row + x] = (value + add) & 255;
    }
  }
  return raw;
}

/**
 * Decodes the id image PNG to its 24-bit values. Any file outside the 003b FR-105 format or malformed
 * is `invalid-png` with no values. `inflate` is injected (a browser or Node `DecompressionStream`).
 */
export async function decodeIdPng(bytes: Uint8Array, inflate: Inflate): Promise<Result<DecodedImage, InvalidPng>> {
  const layout = readLayout(bytes);
  if (layout === undefined) return fail();
  const { width, height } = layout;
  const expected = height * (1 + 3 * width);
  if (!Number.isSafeInteger(expected) || expected > MAX_RAW_BYTES) return fail();

  let lines: Uint8Array;
  try {
    lines = await inflate(joinParts(layout.idat));
  } catch {
    return fail();
  }
  if (lines.length !== expected) return fail();

  const raw = unfilter(lines, width, height);
  if (raw === undefined) return fail();

  const values = new Uint32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    const d = decodePixel(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]);
    if (!d.ok) return fail();
    values[i] = d.value;
  }
  return { ok: true, value: { width, height, values } };
}
