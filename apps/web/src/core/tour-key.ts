// Animation key, hash and stream of the reveal tours (spec 009 D8, plan 4.1). Pure and public-data only:
// the key text is built from the match id (or the word `debug`) and the round, never from a secret.

export type TourKind = 'victim' | 'absorber';

/**
 * The text hashed to sigma. `scope` is the match id in a live match and `debug` in the debug scene:
 * `<scope>:<k>` for the victim tour and `<scope>:<k>:absorber` for the absorber tour (k in decimal).
 */
export function keyText(scope: string, k: number, kind: TourKind): string {
  if (!Number.isInteger(k) || k < 0) throw new RangeError('round must be a non-negative integer');
  return `${scope}:${String(k)}${kind === 'absorber' ? ':absorber' : ''}`;
}

/** FNV-1a, 32 bits, over the bytes of an ASCII text. A non-ASCII character is a RangeError. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const b = text.charCodeAt(i);
    if (b > 0x7f) throw new RangeError('the animation key is ASCII only');
    h = Math.imul(h ^ b, 0x01000193) >>> 0;
  }
  return h;
}

/** A stream of uint32 values: mulberry32, unrelated to the engine's own generator. */
export type TourStream = () => number;

export function tourStream(sigma: number): TourStream {
  let a = sigma >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** floor(next / 2^32 * m): an index in 0..m-1, exact in doubles for m below 2^21. */
export function pick(stream: TourStream, m: number): number {
  if (!Number.isInteger(m) || m < 1 || m >= 0x200000) throw new RangeError('pick needs an integer from 1 to 2^21 - 1');
  return Math.floor((stream() * m) / 0x100000000);
}
