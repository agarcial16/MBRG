import { describe, expect, it } from 'vitest';
import { roundRng } from '../../../packages/sim/src/rng';
import { fnv1a32, keyText, pick, tourStream } from '../src/core/tour-key';
import { referenceStream } from './helpers/tour-reference';

describe('tour key', () => {
  it('FR-318 the hash gives the published FNV-1a 32-bit vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('FR-318 the hash equals an independent BigInt formula on a key text', () => {
    let h = 0x811c9dc5n;
    for (const ch of 'Zk3_-q9XtB7:41:absorber') h = ((h ^ BigInt(ch.charCodeAt(0))) * 0x01000193n) & 0xffffffffn;
    expect(fnv1a32('Zk3_-q9XtB7:41:absorber')).toBe(Number(h));
  });

  it('FR-318 the key texts are the live and debug forms of the victim and absorber tours', () => {
    expect(keyText('Zk3_-q9XtB7', 41, 'victim')).toBe('Zk3_-q9XtB7:41');
    expect(keyText('Zk3_-q9XtB7', 41, 'absorber')).toBe('Zk3_-q9XtB7:41:absorber');
    expect(keyText('debug', 7, 'victim')).toBe('debug:7');
    expect(keyText('debug', 7, 'absorber')).toBe('debug:7:absorber');
    expect(keyText('debug', 0, 'victim')).toBe('debug:0');
    expect(() => keyText('debug', -1, 'victim')).toThrow(RangeError);
    expect(() => keyText('debug', 1.5, 'victim')).toThrow(RangeError);
  });

  it('FR-318 sigma differs between the two tours and between rounds, and is the same for the same text', () => {
    const a = fnv1a32(keyText('Zk3_-q9XtB7', 41, 'victim'));
    const b = fnv1a32(keyText('Zk3_-q9XtB7', 41, 'absorber'));
    const c = fnv1a32(keyText('Zk3_-q9XtB7', 42, 'victim'));
    expect(new Set([a, b, c]).size).toBe(3);
    expect(fnv1a32(keyText('Zk3_-q9XtB7', 41, 'victim'))).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
  });

  it('FR-318 a non-ASCII text is refused', () => {
    expect(() => fnv1a32('partida-ñ:1')).toThrow(RangeError);
    expect(() => fnv1a32('\u0080')).toThrow(RangeError);
    expect(fnv1a32('\u007f')).toBe(Math.imul(0x811c9dc5 ^ 0x7f, 0x01000193) >>> 0);
  });

  it('FR-318 the stream gives the pinned first outputs of two non-round sigma', () => {
    const one = tourStream(1234567891);
    expect([one(), one(), one()]).toStrictEqual([3636499547, 1508175419, 1551842560]);
    const two = tourStream(3000000019);
    expect([two(), two(), two()]).toStrictEqual([1217475384, 2846416043, 1376070933]);
  });

  it('FR-318 the stream equals the independent BigInt formula over 200 outputs', () => {
    for (const sigma of [1234567891, 3000000019, 0, 4294967295]) {
      const got = tourStream(sigma);
      const want = referenceStream(sigma);
      for (let i = 0; i < 200; i++) expect(got()).toBe(want());
    }
  });

  it('FR-318 the stream is unrelated to the engine stream of the same 32-bit input', () => {
    for (const input of [1234567891, 3000000019, 77]) {
      const ours = tourStream(input);
      const engine = roundRng(input, 5);
      const a = [ours(), ours(), ours(), ours()];
      const b = [engine(), engine(), engine(), engine()];
      expect(a).not.toStrictEqual(b);
      expect(a.filter((v, i) => v === b[i])).toStrictEqual([]);
    }
  });

  it('FR-322 pick reaches 0 and m - 1, stays in range and gives 0 for m = 1', () => {
    const stream = tourStream(987654323);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const v = pick(stream, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect([...seen].sort()).toStrictEqual([0, 1, 2, 3, 4, 5, 6]);
    for (let i = 0; i < 20; i++) expect(pick(stream, 1)).toBe(0);
  });

  it('FR-322 pick floors next over 2^32 times m at the exact boundary', () => {
    // floor(2^32 / 7) = 613566756: times 7 is 4294967292, just below 2^32, so index 0; one more gives 1.
    expect(pick(() => 613566756, 7)).toBe(0);
    expect(pick(() => 613566757, 7)).toBe(1);
    expect(pick(() => 0, 7)).toBe(0);
    expect(pick(() => 4294967295, 7)).toBe(6);
    expect(pick(() => 4294967295, 1)).toBe(0);
  });

  it('FR-322 pick refuses a size that is not an integer from 1 to 2^21 - 1', () => {
    const stream = tourStream(5);
    for (const m of [0, -3, 2.5, 0x200000]) expect(() => pick(stream, m)).toThrow(RangeError);
  });
});
