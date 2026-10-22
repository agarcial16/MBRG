// The one-line shell adapter of PD6: binds the pure core's `seedOf(k)` to the match secret (FR-252).
// The core never imports secret.ts; it only ever receives this function.

import { roundSeed } from './secret';

/** `seedOf(k)` = the round seed s_k of the match secret (the HMAC rule of secret.ts). */
export const seedOfSecret =
  (secret: Uint8Array) =>
  (k: number): number =>
    roundSeed(secret, k);
