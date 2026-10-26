import { describe, expect, it } from 'vitest';

import { Rng } from '../src/rng.js';

describe('Rng', () => {
  it('produces the same sequence for the same seed and a different one otherwise', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const seqA = Array.from({ length: 100 }, () => a.nextUint32());
    const seqB = Array.from({ length: 100 }, () => b.nextUint32());
    const seqC = Array.from({ length: 100 }, () => c.nextUint32());
    expect(seqB).toEqual(seqA);
    expect(seqC).not.toEqual(seqA);
  });

  it('returns uint32 values and floats in [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const raw = rng.nextUint32();
      expect(Number.isInteger(raw)).toBe(true);
      expect(raw).toBeGreaterThanOrEqual(0);
      expect(raw).toBeLessThan(2 ** 32);
      const f = rng.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('int() stays in range and rejects invalid ranges', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) {
      const v = rng.int(3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(8);
    }
    expect(() => rng.int(5, 5)).toThrow();
    expect(() => rng.int(5, 4)).toThrow();
  });

  it('pick() throws on empty input', () => {
    expect(() => new Rng(1).pick([])).toThrow(/empty/);
  });

  it('weightedIndex() respects the weights', () => {
    const rng = new Rng(7);
    const counts = [0, 0];
    for (let i = 0; i < 2000; i++) {
      counts[rng.weightedIndex([1, 3])]++;
    }
    const ratio = counts[1] / counts[0];
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(4.5);
    expect(() => rng.weightedIndex([0, 0])).toThrow();
    expect(() => rng.weightedIndex([-1, 2])).toThrow();
  });

  it('snapshot() restores the exact continuation', () => {
    const rng = new Rng(5);
    rng.nextUint32();
    rng.nextUint32();
    const saved = rng.snapshot();
    const expected = [rng.nextUint32(), rng.nextUint32()];

    const restored = new Rng(saved);
    expect([restored.nextUint32(), restored.nextUint32()]).toEqual(expected);
  });

  it('rejects non-integer seeds', () => {
    expect(() => new Rng(1.5)).toThrow(/integer/);
  });
});
