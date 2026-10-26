/**
 * Independent references for the tour tests (spec 009): the stream in 64-bit BigInt arithmetic and the
 * stops drawn from the end into a reversed list, none of it shared with the code under test.
 */
const M32 = 0xffffffffn;

export function referenceStream(sigma: number): () => number {
  let a = BigInt(sigma);
  return () => {
    a = (a + 0x6d2b79f5n) & M32;
    let t = ((a ^ (a >> 15n)) * (a | 1n)) & M32;
    t = t ^ ((t + (((t ^ (t >> 7n)) * (t | 61n)) & M32)) & M32);
    return Number((t ^ (t >> 14n)) & M32);
  };
}

/**
 * The stops of a tour, read backwards from the result: each new stop differs from the stop after it and avoids
 * every stop already drawn except the result (which is the last stop, not drawn); when that leaves nothing, only
 * the stop after it is avoided.
 */
export function referenceStops(kind: 'victim' | 'absorber', result: number, set: readonly number[], sigma: number): number[] {
  const sorted = Array.from(new Set(set)).sort((x, y) => x - y);
  const count = kind === 'absorber' ? 6 : sorted.length >= 3 ? 12 : 6;
  const next = referenceStream(sigma);
  const placed = [result];
  while (placed.length < count) {
    const after = placed[placed.length - 1]!;
    const drawn = placed.slice(1);
    let pool = sorted.filter((f) => f !== after && !drawn.includes(f));
    if (pool.length === 0) pool = sorted.filter((f) => f !== after);
    placed.push(pool[Number((BigInt(next()) * BigInt(pool.length)) >> 32n)]!);
  }
  return placed.reverse();
}
