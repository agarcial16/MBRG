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

/** The stops of a tour, read backwards: each new stop avoids every stop already placed, else only the last. */
export function referenceStops(kind: 'victim' | 'absorber', result: number, set: readonly number[], sigma: number): number[] {
  const sorted = Array.from(new Set(set)).sort((x, y) => x - y);
  const count = kind === 'absorber' ? 6 : sorted.length >= 3 ? 12 : 6;
  const next = referenceStream(sigma);
  const placed = [result];
  while (placed.length < count) {
    let pool = sorted.filter((f) => !placed.includes(f));
    if (pool.length === 0) pool = sorted.filter((f) => f !== placed[placed.length - 1]);
    placed.push(pool[Number((BigInt(next()) * BigInt(pool.length)) >> 32n)]!);
  }
  return placed.reverse();
}
