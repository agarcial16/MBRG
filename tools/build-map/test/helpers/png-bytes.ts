import { deflateSync } from 'node:zlib';

/** Test-only PNG byte builders (independent of the builder's own CRC and check code). */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function refCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function u32(n: number): Uint8Array {
  return Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

export function chunk(type: string, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  const t = Uint8Array.from(Array.from(type, (c) => c.charCodeAt(0)));
  return concat([u32(data.length), t, data, u32(refCrc32(concat([t, data])))]);
}

export interface IhdrOptions {
  width: number;
  height: number;
  depth?: number;
  colorType?: number;
  compression?: number;
  filter?: number;
  interlace?: number;
}

export function ihdr(o: IhdrOptions): Uint8Array {
  return chunk(
    'IHDR',
    concat([
      u32(o.width),
      u32(o.height),
      Uint8Array.from([o.depth ?? 8, o.colorType ?? 2, o.compression ?? 0, o.filter ?? 0, o.interlace ?? 0]),
    ]),
  );
}

/** Raw scanlines: each row = filter byte + 3 bytes per pixel (filter 0 unless given). */
export function rawRows(width: number, height: number, rgb: Uint8Array, filterType = 0): Uint8Array {
  const rowLen = 3 * width;
  const out = new Uint8Array(height * (1 + rowLen));
  for (let y = 0; y < height; y++) {
    out[y * (1 + rowLen)] = filterType;
    out.set(rgb.subarray(y * rowLen, (y + 1) * rowLen), y * (1 + rowLen) + 1);
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Scanlines really filtered with the given type per row (0..4), so decoders must reverse them. */
export function filteredRows(width: number, height: number, rgb: Uint8Array, types: number[]): Uint8Array {
  const rowLen = 3 * width;
  const out = new Uint8Array(height * (1 + rowLen));
  for (let y = 0; y < height; y++) {
    const type = types[y % types.length]!;
    out[y * (1 + rowLen)] = type;
    for (let i = 0; i < rowLen; i++) {
      const x = rgb[y * rowLen + i]!;
      const a = i >= 3 ? rgb[y * rowLen + i - 3]! : 0;
      const b = y > 0 ? rgb[(y - 1) * rowLen + i]! : 0;
      const c = y > 0 && i >= 3 ? rgb[(y - 1) * rowLen + i - 3]! : 0;
      let pred = 0;
      if (type === 1) pred = a;
      else if (type === 2) pred = b;
      else if (type === 3) pred = (a + b) >> 1;
      else if (type === 4) pred = paeth(a, b, c);
      out[y * (1 + rowLen) + 1 + i] = (x - pred) & 255;
    }
  }
  return out;
}

export interface PngOptions {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** A valid PNG: signature, IHDR, one IDAT, IEND. Pieces can be spliced by tests. */
export function validPng(o: PngOptions): Uint8Array {
  return concat([
    SIGNATURE,
    ihdr(o),
    chunk('IDAT', deflateSync(rawRows(o.width, o.height, o.rgb))),
    chunk('IEND'),
  ]);
}

export function gradientRgb(width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(3 * width * height);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37 + 11) & 255;
  return rgb;
}
