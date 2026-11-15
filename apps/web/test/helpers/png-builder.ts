/**
 * Synthetic PNG files for the decoder tests. Written independently of `src/core/png.ts`: its own CRC,
 * its own forward row filters and its own chunk writer, so a mistake in the decoder cannot cancel out.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function u32(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

/** A well-formed chunk: length, type, data, CRC of type + data. */
export function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([ascii(type), data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
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
    concat([u32(o.width), u32(o.height), Uint8Array.from([o.depth ?? 8, o.colorType ?? 2, o.compression ?? 0, o.filter ?? 0, o.interlace ?? 0])]),
  );
}

/** zlib stream of the bytes (the PNG compression method), made by the platform. */
export async function zlib(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Raw scanlines (filter byte + filtered bytes) of 24-bit values. `filters[y]` is the filter type of
 * row y (0 none, 1 sub, 2 up, 3 average, 4 paeth); any other number is written as is.
 */
export function scanlines(values: ArrayLike<number>, width: number, height: number, filters: number[]): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array(width * height * 3);
  for (let i = 0; i < values.length; i++) {
    raw[i * 3] = (values[i]! >> 16) & 255;
    raw[i * 3 + 1] = (values[i]! >> 8) & 255;
    raw[i * 3 + 2] = values[i]! & 255;
  }
  const out = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const type = filters[y % filters.length]!;
    out[y * (stride + 1)] = type;
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * stride + x]!;
      const left = x >= 3 ? raw[y * stride + x - 3]! : 0;
      const up = y > 0 ? raw[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= 3 ? raw[(y - 1) * stride + x - 3]! : 0;
      let predicted = 0;
      if (type === 1) predicted = left;
      else if (type === 2) predicted = up;
      else if (type === 3) predicted = Math.floor((left + up) / 2);
      else if (type === 4) predicted = paeth(left, up, upLeft);
      out[y * (stride + 1) + 1 + x] = (cur - predicted) & 255;
    }
  }
  return out;
}

export interface PngOptions {
  width: number;
  height: number;
  values: ArrayLike<number>;
  /** Filter type per row, cycled. Default: all 0. */
  filters?: number[];
  /** Split the compressed data into this many IDAT chunks. Default 1. */
  idatCount?: number;
  /** Chunks written between IHDR and the first IDAT. */
  before?: Uint8Array[];
}

/** A valid PNG (8-bit RGB, no alpha, non-interlaced) of the given values. */
export async function makePng(o: PngOptions): Promise<Uint8Array> {
  const data = await zlib(scanlines(o.values, o.width, o.height, o.filters ?? [0]));
  const count = Math.max(1, o.idatCount ?? 1);
  const size = Math.ceil(data.length / count);
  const idats: Uint8Array[] = [];
  for (let i = 0; i < count; i++) idats.push(chunk('IDAT', data.slice(i * size, (i + 1) * size)));
  return concat([SIGNATURE, ihdr({ width: o.width, height: o.height }), ...(o.before ?? []), ...idats, chunk('IEND', new Uint8Array(0))]);
}

/** Assembles a PNG from ready-made chunks, to build malformed files. */
export function pngFrom(chunks: Uint8Array[]): Uint8Array {
  return concat([SIGNATURE, ...chunks]);
}
