// Seeded PRNG (FR-52). sfc32 with integer-only arithmetic: bit-identical on any JS engine.

/** Returns a uint32 on every call. */
export type Rng = () => number;

export function sfc32(a: number, b: number, c: number, d: number): Rng {
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  return () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
}

/** Independent stream for one round: depends only on (seed, round). Seed is a uint32. */
export function roundRng(seed: number, round: number): Rng {
  const rng = sfc32(0x9e3779b9, seed, round, 1);
  for (let i = 0; i < 15; i++) rng();
  return rng;
}

/** Exactly uniform integer in [0, n) by rejection sampling on uint32. n in 1..2^32. */
export function pickIndex(rng: Rng, n: number): number {
  const limit = 0x100000000 - (0x100000000 % n);
  let x = rng();
  while (x >= limit) x = rng();
  return x % n;
}
