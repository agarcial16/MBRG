import { inflateSync } from 'node:zlib';
import { decodePixel, encodePixel } from '@mbrg/shared';
import type { Result } from '@mbrg/shared';
import { crc32 } from './crc32';
import type { PngError } from './types';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function fail(): { ok: false; errors: PngError[] } {
  return { ok: false, errors: [{ kind: 'invalid-png' }] };
}

function typeOf(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * FR-105: the pre-decode check. Accepts only: signature, IHDR (8-bit RGB truecolour, no
 * interlace, width and height >= 1), one or more consecutive IDAT, IEND, nothing after it;
 * every chunk CRC matches; the IDAT data inflates to exactly height * (1 + 3 * width) bytes
 * whose row filter bytes are 0..4. Any other file is invalid-png. Pure: bytes in, result out.
 */
export function checkPngFile(bytes: Uint8Array): Result<{ width: number; height: number }, PngError> {
  if (bytes.length < 8) return fail();
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let at = 8;
  let index = 0;
  let width = 0;
  let height = 0;
  let sawIdat = false;
  let idatClosed = false;
  let sawIend = false;
  const idat: Uint8Array[] = [];

  while (at < bytes.length) {
    if (sawIend) return fail(); // data after IEND
    if (at + 12 > bytes.length) return fail();
    const length = view.getUint32(at);
    if (length > bytes.length - at - 12) return fail();
    const type = typeOf(bytes, at + 4);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== view.getUint32(at + 8 + length)) return fail();

    if (index === 0) {
      if (type !== 'IHDR' || length !== 13) return fail();
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (width < 1 || height < 1) return fail();
      // bit depth 8, colour type 2 (RGB), compression 0, filter method 0, interlace 0
      if (data[8] !== 8 || data[9] !== 2 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return fail();
    } else if (type === 'IDAT') {
      if (idatClosed) return fail(); // not consecutive
      sawIdat = true;
      idat.push(data);
    } else if (type === 'IEND') {
      if (!sawIdat || length !== 0) return fail();
      sawIend = true;
    } else {
      return fail(); // IHDR again, or any chunk outside the allow-list
    }
    if (index > 0 && type !== 'IDAT' && sawIdat) idatClosed = true;
    index++;
    at += 12 + length;
  }
  if (!sawIend) return fail();

  const rowLength = 1 + 3 * width;
  const expected = height * rowLength;
  let raw: Uint8Array;
  try {
    raw = inflateSync(concat(idat), { maxOutputLength: expected + 1 });
  } catch {
    return fail();
  }
  if (raw.length !== expected) return fail();
  for (let row = 0; row < height; row++) if (raw[row * rowLength]! > 4) return fail();
  return { ok: true, value: { width, height } };
}

/** Pixel values (FR-106 domain) -> raw RGB bytes, three per value. */
export function toRgb(values: ArrayLike<number>): Uint8Array {
  const rgb = new Uint8Array(3 * values.length);
  for (let i = 0; i < values.length; i++) {
    const c = encodePixel(values[i]);
    if (!c.ok) throw new RangeError('pixel value outside 0..16777215');
    rgb[3 * i] = c.value[0];
    rgb[3 * i + 1] = c.value[1];
    rgb[3 * i + 2] = c.value[2];
  }
  return rgb;
}

/** Raw RGB bytes -> pixel values (R * 65,536 + G * 256 + B). */
export function fromRgb(rgb: Uint8Array): Uint32Array {
  const values = new Uint32Array(rgb.length / 3);
  for (let i = 0; i < values.length; i++) {
    const v = decodePixel(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]);
    if (!v.ok) throw new RangeError('channel outside 0..255');
    values[i] = v.value;
  }
  return values;
}
