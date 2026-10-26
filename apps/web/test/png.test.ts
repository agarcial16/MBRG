import { describe, expect, it } from 'vitest';
import { checkIdImage, decodePixel } from '@mbrg/shared';
import { decodeIdPng } from '../src/core/png';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, devPngBytes } from './helpers/dev-map';
import { ascii, chunk, concat, ihdr, makePng, pngFrom, scanlines, SIGNATURE, zlib } from './helpers/png-builder';

const INVALID = { ok: false, errors: [{ kind: 'invalid-png' }] };

/** Values that stress every byte of the three channels (boundaries of FR-106). */
const BOUNDARY = [0, 1, 255, 256, 65535, 65536, 16777215, 0x010203, 0xfffffe, 0x80ff01, 0x7f0080, 12345678];

/** Deterministic pseudo-random values 0..16,777,215 (test-local generator, no ambient randomness). */
function pseudoValues(count: number, seed: number): number[] {
  let s = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out.push(s >>> 8);
  }
  return out;
}

async function decode(bytes: Uint8Array) {
  return decodeIdPng(bytes, inflateStream);
}

describe('FR-134 exact decoding', () => {
  it('FR-134 decodes boundary values exactly over all three channels', async () => {
    const png = await makePng({ width: BOUNDARY.length, height: 1, values: BOUNDARY });
    const r = await decode(png);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.width).toBe(BOUNDARY.length);
    expect(r.value.height).toBe(1);
    expect(r.value.values).toBeInstanceOf(Uint32Array);
    expect(Array.from(r.value.values)).toStrictEqual(BOUNDARY);
  });

  it('FR-134 every value agrees with the 003a decode function of the stored channels', async () => {
    const values = pseudoValues(64, 7);
    const r = await decode(await makePng({ width: 8, height: 8, values }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    values.forEach((v, i) => {
      const d = decodePixel((v >> 16) & 255, (v >> 8) & 255, v & 255);
      expect(d.ok && d.value).toBe(v);
      expect(r.value.values[i]).toBe(v);
    });
  });

  for (const type of [0, 1, 2, 3, 4]) {
    it(`FR-134 row filter type ${type} unfilters exactly on every row`, async () => {
      const width = 9;
      const height = 6;
      const values = [...BOUNDARY, ...pseudoValues(width * height - BOUNDARY.length, 100 + type)];
      const r = await decode(await makePng({ width, height, values, filters: [type] }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(Array.from(r.value.values)).toStrictEqual(values);
    });
  }

  it('FR-134 a mix of all five filter types in one image decodes exactly', async () => {
    const width = 11;
    const height = 10;
    const values = pseudoValues(width * height, 99);
    const r = await decode(await makePng({ width, height, values, filters: [4, 0, 3, 1, 2] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.from(r.value.values)).toStrictEqual(values);
  });

  it('FR-134 Paeth ties pick left, then up, then upper-left, as the PNG rule says', async () => {
    // Red channel of the pixel at row 1, column 1 is predicted from left, up and upper-left.
    const tie = (left: number, up: number, upLeft: number, current: number): number[] => [upLeft << 16, up << 16, left << 16, current << 16];
    for (const [left, up, upLeft] of [
      [40, 10, 20], // pa == pc < pb: left
      [10, 40, 20], // pb == pc < pa: up
      [30, 30, 30], // all equal
      [10, 30, 20], // pc smallest: upper-left
    ] as const) {
      const values = tie(left, up, upLeft, 77);
      const r = await decode(await makePng({ width: 2, height: 2, values, filters: [0, 4] }));
      expect(r.ok && Array.from(r.value.values), `${left},${up},${upLeft}`).toStrictEqual(values);
    }
  });

  it('FR-134 an image made of several IDAT chunks decodes the same', async () => {
    const values = pseudoValues(30 * 20, 5);
    const r = await decode(await makePng({ width: 30, height: 20, values, filters: [4, 1, 2], idatCount: 5 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.from(r.value.values)).toStrictEqual(values);
  });

  it('FR-134 a one by one image and a very wide image decode', async () => {
    const one = await decode(await makePng({ width: 1, height: 1, values: [0xabcdef] }));
    expect(one.ok && Array.from(one.value.values)).toStrictEqual([0xabcdef]);
    const wide = pseudoValues(500, 3);
    const w = await decode(await makePng({ width: 500, height: 1, values: wide, filters: [4] }));
    expect(w.ok && Array.from(w.value.values)).toStrictEqual(wide);
  });

  it('FR-134 the committed dev map PNG decodes to 2048 x 2048 and passes the 003a id image check', async () => {
    const r = await decode(devPngBytes());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.width).toBe(2048);
    expect(r.value.height).toBe(2048);
    expect(r.value.values.length).toBe(2048 * 2048);
    const checked = checkIdImage(DEV_MAP, r.value.width, r.value.height, r.value.values);
    expect(checked.ok).toBe(true);
  });
});

describe('FR-134 rejected files (invalid-png)', () => {
  const values = [1, 2, 3, 4];
  const good = (extra: Partial<Parameters<typeof makePng>[0]> = {}) => makePng({ width: 2, height: 2, values, ...extra });

  for (const type of ['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'cICP', 'tIME', 'tEXt', 'zTXt', 'iTXt', 'bKGD', 'pHYs', 'sBIT', 'eXIf']) {
    it(`FR-134 a ${type} chunk between IHDR and IDAT is rejected`, async () => {
      expect(await decode(await good({ before: [chunk(type, Uint8Array.from([1, 2, 3, 4, 5, 6]))] }))).toStrictEqual(INVALID);
    });
  }

  it('FR-134 an unknown or ancillary chunk after the data is rejected', async () => {
    const data = await zlib(scanlines(values, 2, 2, [0]));
    const png = pngFrom([ihdr({ width: 2, height: 2 }), chunk('IDAT', data), chunk('tEXt', ascii('a\0b')), chunk('IEND', new Uint8Array(0))]);
    expect(await decode(png)).toStrictEqual(INVALID);
  });

  it('FR-134 bit depth other than 8 is rejected', async () => {
    for (const depth of [1, 2, 4, 16]) {
      const data = await zlib(scanlines(values, 2, 2, [0]));
      const png = pngFrom([ihdr({ width: 2, height: 2, depth }), chunk('IDAT', data), chunk('IEND', new Uint8Array(0))]);
      expect(await decode(png), `depth ${depth}`).toStrictEqual(INVALID);
    }
  });

  it('FR-134 a colour type other than RGB truecolour is rejected', async () => {
    for (const colorType of [0, 3, 4, 6]) {
      const data = await zlib(scanlines(values, 2, 2, [0]));
      const png = pngFrom([ihdr({ width: 2, height: 2, colorType }), chunk('IDAT', data), chunk('IEND', new Uint8Array(0))]);
      expect(await decode(png), `colour type ${colorType}`).toStrictEqual(INVALID);
    }
  });

  it('FR-134 interlacing, and a compression or filter method other than 0, are rejected', async () => {
    const data = await zlib(scanlines(values, 2, 2, [0]));
    for (const o of [{ interlace: 1 }, { compression: 1 }, { filter: 1 }]) {
      const png = pngFrom([ihdr({ width: 2, height: 2, ...o }), chunk('IDAT', data), chunk('IEND', new Uint8Array(0))]);
      expect(await decode(png), JSON.stringify(o)).toStrictEqual(INVALID);
    }
  });

  it('FR-134 a width or a height of 0 is rejected', async () => {
    const data = await zlib(new Uint8Array(0));
    for (const [width, height] of [
      [0, 2],
      [2, 0],
      [0, 0],
    ] as const) {
      const png = pngFrom([ihdr({ width, height }), chunk('IDAT', data), chunk('IEND', new Uint8Array(0))]);
      expect(await decode(png), `${width}x${height}`).toStrictEqual(INVALID);
    }
  });

  it('FR-134 a wrong signature is rejected', async () => {
    const png = (await good()).slice();
    png[1] = 0x51;
    expect(await decode(png)).toStrictEqual(INVALID);
    expect(await decode(new Uint8Array(0))).toStrictEqual(INVALID);
    expect(await decode(SIGNATURE.slice())).toStrictEqual(INVALID);
  });

  it('FR-134 a CRC mismatch in IHDR, IDAT or IEND is rejected', async () => {
    const png = await good();
    // chunk starts: signature 8, IHDR 25 bytes, IDAT (12 + n), IEND 12
    const ihdrCrc = 8 + 25 - 1;
    const idatDataStart = 8 + 25 + 8;
    const iendCrc = png.length - 1;
    for (const at of [ihdrCrc, idatDataStart, iendCrc]) {
      const bad = png.slice();
      bad[at] = bad[at]! ^ 1;
      expect(await decode(bad), `byte ${at}`).toStrictEqual(INVALID);
    }
  });

  it('FR-134 a truncated file is rejected at every cut point', async () => {
    const png = await good();
    for (let cut = 0; cut < png.length; cut++) {
      expect(await decode(png.slice(0, cut)), `cut ${cut}`).toStrictEqual(INVALID);
    }
  });

  it('FR-134 any byte after IEND is rejected', async () => {
    const png = await good();
    expect(await decode(concat([png, Uint8Array.from([0])]))).toStrictEqual(INVALID);
    expect(await decode(concat([png, chunk('IEND', new Uint8Array(0))]))).toStrictEqual(INVALID);
  });

  it('FR-134 a missing IDAT, a missing IEND, a repeated IHDR and an IHDR that is not first are rejected', async () => {
    const data = await zlib(scanlines(values, 2, 2, [0]));
    const header = ihdr({ width: 2, height: 2 });
    const end = chunk('IEND', new Uint8Array(0));
    const idat = chunk('IDAT', data);
    expect(await decode(pngFrom([header, end]))).toStrictEqual(INVALID);
    expect(await decode(pngFrom([header, idat]))).toStrictEqual(INVALID);
    expect(await decode(pngFrom([header, header, idat, end]))).toStrictEqual(INVALID);
    expect(await decode(pngFrom([idat, header, end]))).toStrictEqual(INVALID);
    expect(await decode(pngFrom([header, idat, header, end]))).toStrictEqual(INVALID);
  });

  it('FR-134 an IEND chunk that carries data is rejected', async () => {
    const data = await zlib(scanlines(values, 2, 2, [0]));
    const png = pngFrom([ihdr({ width: 2, height: 2 }), chunk('IDAT', data), chunk('IEND', Uint8Array.from([0]))]);
    expect(await decode(png)).toStrictEqual(INVALID);
  });

  it('FR-134 IDAT chunks that are not consecutive are rejected', async () => {
    const data = await zlib(scanlines(values, 2, 2, [0]));
    const half = Math.floor(data.length / 2);
    const png = pngFrom([
      ihdr({ width: 2, height: 2 }),
      chunk('IDAT', data.slice(0, half)),
      chunk('tEXt', ascii('k\0v')),
      chunk('IDAT', data.slice(half)),
      chunk('IEND', new Uint8Array(0)),
    ]);
    expect(await decode(png)).toStrictEqual(INVALID);
  });

  it('FR-134 an unknown row filter type is rejected', async () => {
    expect(await decode(await good({ filters: [5] }))).toStrictEqual(INVALID);
    expect(await decode(await good({ filters: [0, 255] }))).toStrictEqual(INVALID);
  });

  it('FR-134 decompressed data of the wrong length is rejected', async () => {
    const lines = scanlines(values, 2, 2, [0]);
    for (const bytes of [lines.slice(0, lines.length - 1), concat([lines, Uint8Array.from([0])]), new Uint8Array(0)]) {
      const png = pngFrom([ihdr({ width: 2, height: 2 }), chunk('IDAT', await zlib(bytes)), chunk('IEND', new Uint8Array(0))]);
      expect(await decode(png), `length ${bytes.length}`).toStrictEqual(INVALID);
    }
  });

  it('FR-134 a decompression failure is rejected, not thrown', async () => {
    const png = pngFrom([ihdr({ width: 2, height: 2 }), chunk('IDAT', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), chunk('IEND', new Uint8Array(0))]);
    expect(await decode(png)).toStrictEqual(INVALID);
    const throwing = await decodeIdPng(await good(), () => Promise.reject(new Error('no')));
    expect(throwing).toStrictEqual(INVALID);
  });

  it('FR-134 chunk and header checks run before any pixel decoding', async () => {
    let calls = 0;
    const counting = (z: Uint8Array): Promise<Uint8Array> => {
      calls++;
      return inflateStream(z);
    };
    const bad = [
      await good({ before: [chunk('gAMA', Uint8Array.from([0, 0, 0, 1]))] }),
      concat([await good(), Uint8Array.from([0])]),
      pngFrom([ihdr({ width: 2, height: 2, depth: 16 }), chunk('IDAT', await zlib(scanlines(values, 2, 2, [0]))), chunk('IEND', new Uint8Array(0))]),
    ];
    for (const png of bad) expect(await decodeIdPng(png, counting)).toStrictEqual(INVALID);
    expect(calls).toBe(0);
    expect((await decodeIdPng(await good(), counting)).ok).toBe(true);
    expect(calls).toBe(1);
  });

  it('FR-134 a rejected file returns no pixel values', async () => {
    const r = await decode(await good({ filters: [5] }));
    expect(r.ok).toBe(false);
    expect(Object.keys(r)).toStrictEqual(['ok', 'errors']);
  });
});
