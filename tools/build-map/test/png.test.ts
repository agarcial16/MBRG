import { deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crc32 } from '../src/core/crc32';
import { checkPngFile, fromRgb, toRgb } from '../src/core/png-check';
import { pngCodec } from '../src/io/png-codec';
import {
  SIGNATURE,
  chunk,
  concat,
  filteredRows,
  gradientRgb,
  ihdr,
  rawRows,
  refCrc32,
  validPng,
} from './helpers/png-bytes';

const INVALID = { ok: false, errors: [{ kind: 'invalid-png' }] };
const W = 3;
const H = 3;
const RGB = gradientRgb(W, H);
const VALID = validPng({ width: W, height: H, rgb: RGB });
const VALUES = [0, 1, 255, 256, 65535, 65536, 16777215, 123456, 8421504];

afterEach(() => vi.restoreAllMocks());

/** Chunk types of a PNG, walking length/type/data/CRC (test-side walker). */
function chunkTypes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: string[] = [];
  let at = 8;
  while (at < bytes.length) {
    const len = view.getUint32(at);
    out.push(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
    at += 12 + len;
  }
  return out;
}

/** Splice `extra` just before the first chunk of type beforeType. */
function withChunk(png: Uint8Array, extra: Uint8Array, beforeType: string): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  while (at < png.length) {
    const len = view.getUint32(at);
    if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === beforeType) {
      return concat([png.subarray(0, at), extra, png.subarray(at)]);
    }
    at += 12 + len;
  }
  throw new Error('no such chunk');
}

function pngWith(parts: Uint8Array[]): Uint8Array {
  return concat([SIGNATURE, ...parts]);
}

const IDAT_OK = chunk('IDAT', deflateSync(rawRows(W, H, RGB)));
const IHDR_OK = ihdr({ width: W, height: H });

describe('FR-105 crc32 and pixel/channel conversion', () => {
  it('FR-105 crc32 matches the standard check value and the reference', () => {
    const bytes = Uint8Array.from(Array.from('123456789', (c) => c.charCodeAt(0)));
    expect(crc32(bytes)).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    const data = gradientRgb(17, 5);
    expect(crc32(data)).toBe(refCrc32(data));
  });

  it('NFR-23 toRgb and fromRgb are inverse and use the three channels of FR-106', () => {
    const rgb = toRgb(VALUES);
    expect(Array.from(rgb.subarray(0, 6))).toEqual([0, 0, 0, 0, 0, 1]);
    expect(Array.from(rgb.subarray(6, 12))).toEqual([0, 0, 255, 0, 1, 0]);
    expect(Array.from(rgb.subarray(12, 18))).toEqual([0, 255, 255, 1, 0, 0]);
    expect(Array.from(rgb.subarray(18, 21))).toEqual([255, 255, 255]);
    expect(Array.from(fromRgb(rgb))).toEqual(VALUES);
  });
});

describe('FR-105 and NFR-23 PNG codec round trip and written file', () => {
  it('NFR-23 round trip keeps values 1, 255, 256, 65535, 65536 and 16777215 across all three channels', () => {
    const bytes = pngCodec.encode(W, H, toRgb(VALUES));
    const back = pngCodec.decode(bytes);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.width).toBe(W);
    expect(back.value.height).toBe(H);
    expect(Array.from(fromRgb(back.value.rgb))).toEqual(VALUES);
  });

  it('FR-105 the written file has exactly IHDR, IDAT and IEND with RGB 8-bit non-interlaced fields', () => {
    const bytes = pngCodec.encode(W, H, toRgb(VALUES));
    const types = chunkTypes(bytes);
    expect(types[0]).toBe('IHDR');
    expect(types[types.length - 1]).toBe('IEND');
    expect(types.slice(1, -1).every((t) => t === 'IDAT')).toBe(true);
    expect(types.length).toBeGreaterThanOrEqual(3);
    expect(Array.from(bytes.subarray(0, 8))).toEqual(Array.from(SIGNATURE));
    const ihdrData = bytes.subarray(16, 29);
    const view = new DataView(ihdrData.buffer, ihdrData.byteOffset, 13);
    expect(view.getUint32(0)).toBe(W);
    expect(view.getUint32(4)).toBe(H);
    expect(Array.from(ihdrData.subarray(8))).toEqual([8, 2, 0, 0, 0]);
    expect(checkPngFile(bytes)).toStrictEqual({ ok: true, value: { width: W, height: H } });
  });

  it('FR-105 a larger image encodes to a valid file and decodes to the same values', () => {
    const n = 40 * 25;
    const values = Array.from({ length: n }, (_, i) => (i * 16769 + 5) % 16777216);
    const bytes = pngCodec.encode(40, 25, toRgb(values));
    expect(checkPngFile(bytes).ok).toBe(true);
    const back = pngCodec.decode(bytes);
    expect(back.ok && Array.from(fromRgb(back.value.rgb))).toEqual(values);
  });

  it('FR-105 encoding twice gives identical bytes', () => {
    const a = pngCodec.encode(W, H, toRgb(VALUES));
    const b = pngCodec.encode(W, H, toRgb(VALUES));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('FR-105 a valid file split into several consecutive IDAT chunks is accepted', () => {
    const z = deflateSync(rawRows(W, H, RGB));
    const png = pngWith([
      IHDR_OK,
      chunk('IDAT', z.subarray(0, 5)),
      chunk('IDAT', z.subarray(5)),
      chunk('IEND'),
    ]);
    expect(checkPngFile(png)).toStrictEqual({ ok: true, value: { width: W, height: H } });
  });
});

describe('FR-105 chunk allow-list: invalid-png', () => {
  const ANCILLARY = ['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'cICP', 'tIME', 'tEXt', 'zTXt', 'iTXt'];

  it.each(ANCILLARY)('FR-105 a planted %s chunk before IDAT is rejected', (name) => {
    const extra = chunk(name, new Uint8Array(name === 'PLTE' ? 3 : 4));
    expect(checkPngFile(withChunk(VALID, extra, 'IDAT'))).toStrictEqual(INVALID);
  });

  it.each(ANCILLARY)('FR-105 a planted %s chunk before IEND is rejected', (name) => {
    const extra = chunk(name, new Uint8Array(name === 'PLTE' ? 3 : 4));
    expect(checkPngFile(withChunk(VALID, extra, 'IEND'))).toStrictEqual(INVALID);
  });

  it('FR-105 an unknown chunk type is rejected', () => {
    expect(checkPngFile(withChunk(VALID, chunk('abCD', new Uint8Array(2)), 'IDAT'))).toStrictEqual(INVALID);
  });

  it('FR-105 non-consecutive IDAT chunks are rejected', () => {
    const z = deflateSync(rawRows(W, H, RGB));
    const png = pngWith([
      IHDR_OK,
      chunk('IDAT', z.subarray(0, 5)),
      chunk('tEXt', new Uint8Array(3)),
      chunk('IDAT', z.subarray(5)),
      chunk('IEND'),
    ]);
    expect(checkPngFile(png)).toStrictEqual(INVALID);
  });

  it('FR-105 chunk order and count violations are rejected', () => {
    expect(checkPngFile(pngWith([IHDR_OK, chunk('IEND')]))).toStrictEqual(INVALID);
    expect(checkPngFile(pngWith([IDAT_OK, IHDR_OK, chunk('IEND')]))).toStrictEqual(INVALID);
    expect(checkPngFile(pngWith([IHDR_OK, IHDR_OK, IDAT_OK, chunk('IEND')]))).toStrictEqual(INVALID);
    expect(checkPngFile(pngWith([IHDR_OK, IDAT_OK]))).toStrictEqual(INVALID);
    expect(checkPngFile(pngWith([IHDR_OK, IDAT_OK, chunk('IEND'), chunk('IEND')]))).toStrictEqual(INVALID);
    expect(checkPngFile(pngWith([IHDR_OK, IDAT_OK, chunk('IEND', new Uint8Array(1))]))).toStrictEqual(INVALID);
  });

  it('FR-105 data after IEND is rejected', () => {
    expect(checkPngFile(concat([VALID, Uint8Array.from([0])]))).toStrictEqual(INVALID);
    expect(checkPngFile(concat([VALID, chunk('IDAT', new Uint8Array(1))]))).toStrictEqual(INVALID);
  });
});

describe('FR-105 IHDR fields: invalid-png', () => {
  const bad = (o: Parameters<typeof ihdr>[0]) => checkPngFile(pngWith([ihdr(o), IDAT_OK, chunk('IEND')]));

  it('FR-105 bit depth 16 and others are rejected', () => {
    for (const depth of [1, 2, 4, 16]) expect(bad({ width: W, height: H, depth })).toStrictEqual(INVALID);
  });

  it('FR-105 colour types 0, 3, 4 and 6 are rejected', () => {
    for (const colorType of [0, 3, 4, 6]) expect(bad({ width: W, height: H, colorType })).toStrictEqual(INVALID);
  });

  it('FR-105 interlace 1 is rejected', () => {
    expect(bad({ width: W, height: H, interlace: 1 })).toStrictEqual(INVALID);
  });

  it('FR-105 unknown compression or filter method is rejected', () => {
    expect(bad({ width: W, height: H, compression: 1 })).toStrictEqual(INVALID);
    expect(bad({ width: W, height: H, filter: 1 })).toStrictEqual(INVALID);
  });

  it('FR-105 width 0 or height 0 is rejected', () => {
    const empty = deflateSync(new Uint8Array(0));
    for (const [w, h] of [
      [0, 3],
      [3, 0],
      [0, 0],
    ] as const) {
      expect(checkPngFile(pngWith([ihdr({ width: w, height: h }), chunk('IDAT', empty), chunk('IEND')]))).toStrictEqual(
        INVALID,
      );
    }
  });

  it('FR-105 an IHDR chunk of the wrong length is rejected', () => {
    const short = chunk('IHDR', new Uint8Array(12));
    expect(checkPngFile(pngWith([short, IDAT_OK, chunk('IEND')]))).toStrictEqual(INVALID);
  });

  it('FR-105 a huge declared size with little data is rejected without allocating it', () => {
    const big = ihdr({ width: 100000, height: 100000 });
    expect(checkPngFile(pngWith([big, IDAT_OK, chunk('IEND')]))).toStrictEqual(INVALID);
  });
});

describe('FR-105 malformed files: invalid-png', () => {
  it('FR-105 a wrong signature is rejected', () => {
    const bad = VALID.slice();
    bad[1] = 0x51;
    expect(checkPngFile(bad)).toStrictEqual(INVALID);
    expect(checkPngFile(new Uint8Array(0))).toStrictEqual(INVALID);
  });

  it('FR-105 a chunk CRC mismatch is rejected in IHDR, IDAT and IEND', () => {
    const view = new DataView(VALID.buffer, VALID.byteOffset, VALID.byteLength);
    let at = 8;
    let checked = 0;
    while (at < VALID.length) {
      const len = view.getUint32(at);
      const bad = VALID.slice();
      bad[at + 8 + len + 3] = bad[at + 8 + len + 3]! ^ 1; // last CRC byte of this chunk
      expect(checkPngFile(bad)).toStrictEqual(INVALID);
      at += 12 + len;
      checked++;
    }
    expect(checked).toBe(3);
  });

  it('FR-105 every truncation of a valid file is rejected', () => {
    for (let n = 0; n < VALID.length; n++) {
      expect(checkPngFile(VALID.subarray(0, n))).toStrictEqual(INVALID);
    }
  });

  it('FR-105 a chunk length beyond the file is rejected', () => {
    const bad = VALID.slice();
    bad[8] = 0x7f; // IHDR length becomes huge
    expect(checkPngFile(bad)).toStrictEqual(INVALID);
  });

  it('FR-105 data that fails to decompress is rejected', () => {
    const junk = Uint8Array.from({ length: 30 }, (_, i) => (i * 91 + 7) & 255);
    expect(checkPngFile(pngWith([IHDR_OK, chunk('IDAT', junk), chunk('IEND')]))).toStrictEqual(INVALID);
  });

  it('FR-105 decompressed data of the wrong length is rejected', () => {
    const raw = rawRows(W, H, RGB);
    const short = deflateSync(raw.subarray(0, raw.length - 1));
    const long = deflateSync(concat([raw, Uint8Array.from([0])]));
    for (const z of [short, long, deflateSync(new Uint8Array(0))]) {
      expect(checkPngFile(pngWith([IHDR_OK, chunk('IDAT', z), chunk('IEND')]))).toStrictEqual(INVALID);
    }
  });

  it('FR-105 an unknown row filter type is rejected on any row', () => {
    for (const row of [0, 1, 2]) {
      const raw = rawRows(W, H, RGB).slice();
      raw[row * (1 + 3 * W)] = 5;
      expect(checkPngFile(pngWith([IHDR_OK, chunk('IDAT', deflateSync(raw)), chunk('IEND')]))).toStrictEqual(INVALID);
    }
  });
});

describe('FR-105 the check runs before any pixel decoding', () => {
  const rejected: [string, Uint8Array][] = [
    ['palette chunk', withChunk(VALID, chunk('PLTE', new Uint8Array(3)), 'IDAT')],
    ['gAMA chunk', withChunk(VALID, chunk('gAMA', new Uint8Array(4)), 'IDAT')],
    ['16-bit', pngWith([ihdr({ width: W, height: H, depth: 16 }), IDAT_OK, chunk('IEND')])],
    ['RGBA', pngWith([ihdr({ width: W, height: H, colorType: 6 }), IDAT_OK, chunk('IEND')])],
    ['interlaced', pngWith([ihdr({ width: W, height: H, interlace: 1 }), IDAT_OK, chunk('IEND')])],
    ['bad signature', new Uint8Array(20)],
    ['truncated', VALID.subarray(0, VALID.length - 5)],
  ];

  it.each(rejected)('FR-105 pngjs is never called on a rejected file (%s)', (_name, bytes) => {
    const read = vi.spyOn(PNG.sync, 'read');
    const parse = vi.spyOn(PNG.prototype, 'parse');
    expect(pngCodec.decode(bytes)).toStrictEqual(INVALID);
    expect(read).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it('FR-105 pngjs is called once on an accepted file', () => {
    const read = vi.spyOn(PNG.sync, 'read');
    expect(pngCodec.decode(VALID).ok).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('FR-105 and NFR-23 row filters 1 to 4 decode to the stored values', () => {
  const w = 5;
  const h = 6;
  const rgb = gradientRgb(w, h);

  it.each([1, 2, 3, 4])('NFR-23 filter type %i on every row decodes to the original pixels', (type) => {
    const png = pngWith([
      ihdr({ width: w, height: h }),
      chunk('IDAT', deflateSync(filteredRows(w, h, rgb, [type]))),
      chunk('IEND'),
    ]);
    const back = pngCodec.decode(png);
    expect(back.ok).toBe(true);
    if (back.ok) expect(Array.from(back.value.rgb)).toEqual(Array.from(rgb));
  });

  it('NFR-23 mixed filter types 0 to 4 across rows decode to the original pixels', () => {
    const png = pngWith([
      ihdr({ width: w, height: h }),
      chunk('IDAT', deflateSync(filteredRows(w, h, rgb, [0, 1, 2, 3, 4, 2]))),
      chunk('IEND'),
    ]);
    const back = pngCodec.decode(png);
    expect(back.ok && Array.from(back.value.rgb)).toEqual(Array.from(rgb));
  });

  it('NFR-23 pixel values are not altered by gamma-like or alpha handling', () => {
    const values = [0x808080, 0x010203, 0xfffffe, 0x7f7f7f, 0x00ff00, 0xff0000];
    const back = pngCodec.decode(pngCodec.encode(3, 2, toRgb(values)));
    expect(back.ok && Array.from(fromRgb(back.value.rgb))).toEqual(values);
  });
});
