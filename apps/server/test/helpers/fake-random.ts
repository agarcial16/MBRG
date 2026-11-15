import type { RandomBytes } from '../../src/secret';

/** A deterministic byte source for tests (xorshift32 over a seed); never used by production code. */
export function fakeRandom(seed: number): RandomBytes {
  let s = seed >>> 0 || 1;
  return (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      out[i] = s & 0xff;
    }
    return out;
  };
}
