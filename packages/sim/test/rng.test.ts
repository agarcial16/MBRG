import { describe, expect, it } from 'vitest';
import { pickIndex, roundRng } from '../src/rng';

const take = (seed: number, round: number, n: number): number[] => {
  const rng = roundRng(seed, round);
  return Array.from({ length: n }, () => rng());
};

describe('rng', () => {
  it('FR-52 same (seed, round) gives the same sequence', () => {
    expect(take(42, 3, 50)).toStrictEqual(take(42, 3, 50));
  });

  it('FR-52 different rounds and different seeds differ', () => {
    expect(take(42, 1, 8)).not.toStrictEqual(take(42, 2, 8));
    expect(take(1, 1, 8)).not.toStrictEqual(take(2, 1, 8));
  });

  it('FR-52 outputs are uint32', () => {
    for (const x of take(4294967295, 7, 1000)) {
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('FR-36 pickIndex(rng, 1) is 0 without needing luck', () => {
    const rng = roundRng(0, 1);
    for (let i = 0; i < 20; i++) expect(pickIndex(rng, 1)).toBe(0);
  });

  it('FR-35 pickIndex is always in range', () => {
    const rng = roundRng(7, 2);
    for (const n of [2, 3, 5, 7, 10, 500, 0x80000001]) {
      for (let i = 0; i < 200; i++) {
        const k = pickIndex(rng, n);
        expect(Number.isInteger(k)).toBe(true);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(n);
      }
    }
  });

  it('FR-35 pickIndex rejects draws above the unbiased limit', () => {
    // n = 3: limit = 2^32 - 1; only the draw 0xffffffff is rejected.
    const draws = [0xffffffff, 4];
    const rng = () => draws.shift() as number;
    expect(pickIndex(rng, 3)).toBe(1);
    expect(draws).toHaveLength(0);
  });

  it('FR-35 pickIndex is roughly uniform', () => {
    const rng = roundRng(5, 5);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) counts[pickIndex(rng, 3)]! += 1;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(600);
  });

  it('NFR-2 first 8 outputs of roundRng(0, 1) match the golden file', async () => {
    await expect(JSON.stringify(take(0, 1, 8), null, 2) + '\n').toMatchFileSnapshot(
      './golden/sfc32-seed0.json',
    );
  });
});
