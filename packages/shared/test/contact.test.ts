import { describe, expect, it } from 'vitest';
import { contactPairs } from '../src/contact';
import { image } from './helpers/package-fixtures';

const L = { A: 1, B: 2, C: 3, D: 4, E: 5, U: 900 };
const INVALID = { ok: false, errors: [{ kind: 'invalid-image' }] };

function pairsOf(rows: string[]) {
  const im = image(rows, L);
  return contactPairs(im.width, im.height, im.pixels);
}

describe('FR-108 contact function', () => {
  it('FR-108 quadripoint AB/CD gives exactly A-B, A-C, B-D, C-D', () => {
    expect(pairsOf(['AB', 'CD'])).toStrictEqual({
      ok: true,
      value: [
        [1, 2],
        [1, 3],
        [2, 4],
        [3, 4],
      ],
    });
  });

  it('FR-108 touching through background gives no contact', () => {
    expect(pairsOf(['A.B'])).toStrictEqual({ ok: true, value: [] });
  });

  it('FR-108 corner-only touching gives no contact', () => {
    expect(pairsOf(['A.', '.B'])).toStrictEqual({ ok: true, value: [] });
  });

  it('FR-108 a single 4-adjacent pair is contact', () => {
    expect(pairsOf(['AB'])).toStrictEqual({ ok: true, value: [[1, 2]] });
    expect(pairsOf(['A', 'B'])).toStrictEqual({ ok: true, value: [[1, 2]] });
  });

  it('FR-108 contacts are the union over several pieces of an entry', () => {
    expect(pairsOf(['AB.CA', '.....', 'D..E.'])).toStrictEqual({
      ok: true,
      value: [
        [1, 2],
        [1, 3],
      ],
    });
  });

  it('FR-108 same-value neighbours and background make no pair', () => {
    expect(pairsOf(['AA', 'AA'])).toStrictEqual({ ok: true, value: [] });
    expect(pairsOf(['..', '..'])).toStrictEqual({ ok: true, value: [] });
  });

  it('FR-108 ids that belong to no map are still paired', () => {
    expect(pairsOf(['UA'])).toStrictEqual({ ok: true, value: [[1, 900]] });
  });

  it('FR-108 a plain list and a Uint32Array give equal results', () => {
    const im = image(['ABC', 'CAB', 'BCA'], L);
    const plain = contactPairs(im.width, im.height, im.pixels);
    const typed = contactPairs(im.width, im.height, Uint32Array.from(im.pixels));
    expect(typed).toStrictEqual(plain);
    expect(plain.ok).toBe(true);
  });

  it('FR-108 output is sorted by a then b with a < b, each pair once', () => {
    const im = image(['EDCBA', 'ABCDE'], L);
    const r = contactPairs(im.width, im.height, im.pixels);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const [a, b] of r.value) expect(a).toBeLessThan(b);
    const sorted = [...r.value].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    expect(r.value).toStrictEqual(sorted);
    expect(new Set(r.value.map((p) => p.join())).size).toBe(r.value.length);
  });

  it('FR-108 large ids sort exactly (no key overflow)', () => {
    expect(contactPairs(3, 1, [16777215, 16777214, 1])).toStrictEqual({
      ok: true,
      value: [
        [1, 16777214],
        [16777214, 16777215],
      ],
    });
  });
});

describe('FR-110 invalid-image condition through the contact function', () => {
  const ok = [1, 2, 3, 4];
  const cases: Array<[string, unknown, unknown, unknown]> = [
    ['W x H mismatch (too few)', 2, 2, [1, 2, 3]],
    ['W x H mismatch (too many)', 2, 2, [1, 2, 3, 4, 5]],
    ['value 16,777,216', 2, 2, [1, 2, 3, 16777216]],
    ['value -1', 2, 2, [1, 2, 3, -1]],
    ['value 1.5', 2, 2, [1, 2, 3, 1.5]],
    ['value -0', 2, 2, [1, 2, 3, -0]],
    ['value NaN', 2, 2, [1, 2, 3, NaN]],
    ['value Infinity', 2, 2, [1, 2, 3, Infinity]],
    ['value "1"', 2, 2, [1, 2, 3, '1']],
    ['value null', 2, 2, [1, 2, 3, null]],
    ['value BigInt', 2, 2, [1, 2, 3, 1n]],
    ['sparse hole', 2, 2, [1, 2, , 4]],
    ['W given as "2"', '2', 2, ok],
    ['H given as "2"', 2, '2', ok],
    ['plain object pixels', 2, 2, { 0: 1, 1: 2, 2: 3, 3: 4, length: 4 }],
    ['W = 0', 0, 2, []],
    ['H = 0', 2, 0, []],
    ['W = 1.5', 1.5, 2, ok],
    ['W = NaN', NaN, 2, ok],
    ['W negative', -2, -2, ok],
    ['null pixels', 2, 2, null],
    ['DataView pixels', 2, 2, new DataView(new ArrayBuffer(4))],
    ['BigInt64Array pixels', 2, 2, new BigInt64Array(4)],
    ['text pixels', 2, 2, '1234'],
  ];
  it.each(cases)('FR-110 %s -> invalid-image', (_n, w, h, p) => {
    expect(contactPairs(w, h, p)).toStrictEqual(INVALID);
  });

  it('FR-110 accepts a Float64Array holding valid integers and value 0', () => {
    expect(contactPairs(2, 2, Float64Array.from([0, 1, 2, 0]))).toStrictEqual({
      ok: true,
      value: [],
    });
  });

  it('FR-110 accepts the maximum value 16,777,215', () => {
    expect(contactPairs(2, 1, [0, 16777215])).toStrictEqual({ ok: true, value: [] });
  });
});
