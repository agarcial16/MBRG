import { describe, expect, it } from 'vitest';
import { decodePixel, encodePixel } from '../src/pixel-codec';

const INVALID = { ok: false, errors: [{ kind: 'invalid-image' }] };

const PAIRS: [number, [number, number, number]][] = [
  [0, [0, 0, 0]],
  [1, [0, 0, 1]],
  [255, [0, 0, 255]],
  [256, [0, 1, 0]],
  [65535, [0, 255, 255]],
  [65536, [1, 0, 0]],
  [16777215, [255, 255, 255]],
];

describe('FR-106 pixel codec', () => {
  it.each(PAIRS)('FR-106 encodes %i to its channels', (v, rgb) => {
    expect(encodePixel(v)).toStrictEqual({ ok: true, value: rgb });
  });

  it.each(PAIRS)('FR-106 decodes the channels of %i', (v, rgb) => {
    expect(decodePixel(rgb[0], rgb[1], rgb[2])).toStrictEqual({ ok: true, value: v });
  });

  it('FR-106 decode(encode(v)) = v for 0..1023, boundaries and powers of two', () => {
    const values = new Set<number>();
    for (let v = 0; v <= 1023; v++) values.add(v);
    for (let p = 0; p <= 23; p++) values.add(2 ** p);
    values.add(16777215).add(16777214).add(65535).add(65536);
    for (const v of values) {
      const e = encodePixel(v);
      expect(e.ok).toBe(true);
      if (!e.ok) return;
      expect(decodePixel(e.value[0], e.value[1], e.value[2])).toStrictEqual({ ok: true, value: v });
    }
  });

  it('FR-106 encode(decode(r, g, b)) = (r, g, b) for 216 triples', () => {
    const cs = [0, 1, 127, 128, 254, 255];
    let n = 0;
    for (const r of cs)
      for (const g of cs)
        for (const b of cs) {
          const d = decodePixel(r, g, b);
          expect(d.ok).toBe(true);
          if (!d.ok) return;
          expect(encodePixel(d.value)).toStrictEqual({ ok: true, value: [r, g, b] });
          n++;
        }
    expect(n).toBe(216);
  });

  it.each([
    ['16,777,216', 16777216],
    ['-1', -1],
    ['1.5', 1.5],
    ['-0', -0],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['string "1"', '1'],
    ['null', null],
    ['undefined', undefined],
    ['BigInt', 1n],
  ])('FR-106 encode reports invalid-image for %s, never clamping or wrapping', (_n, v) => {
    expect(encodePixel(v)).toStrictEqual(INVALID);
  });

  it.each([
    ['256', [256, 0, 0]],
    ['-1', [0, -1, 0]],
    ['1.5', [0, 0, 1.5]],
    ['NaN', [NaN, 0, 0]],
    ['string "0"', [0, '0', 0]],
    ['-0 red', [-0, 0, 0]],
    ['-0 green', [0, -0, 0]],
    ['-0 blue', [0, 0, -0]],
    ['null', [0, 0, null]],
    ['BigInt', [0n, 0, 0]],
    ['Infinity', [0, Infinity, 0]],
  ])('FR-106 decode reports invalid-image for channel %s, never clamping or wrapping', (_n, c) => {
    expect(decodePixel(c[0], c[1], c[2])).toStrictEqual(INVALID);
  });
});
