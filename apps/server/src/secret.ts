// Match secret, commitment and per-round seeds (spec 008 FR-252, plan section 5).
//
// Published verification rule, fixed once and never changed for stored matches:
//   secret      = 32 random bytes from the platform CSPRNG
//   commitment  = SHA-256 of the raw secret, 64 lowercase hex characters
//   message(k)  = the ASCII text `mbrg/round-seed/v1/<k>` (k in plain decimal, 1..2^31-1)
//   round seed  = first 4 bytes of HMAC-SHA-256(key = raw secret, message(k)), big-endian, unsigned
//
// This module imports only `node:crypto`: no clock, no `Math.random`, no logging. The secret leaves it
// only as the returned bytes of `newSecret` and, at the end of a match, through `secretHex` (FR-259).

import { createHash, createHmac } from 'node:crypto';

export const SECRET_BYTES = 32;
export const MAX_ROUND = 2 ** 31 - 1;
const MESSAGE_PREFIX = 'mbrg/round-seed/v1/';

/** A source of random bytes: `length` bytes in, that many bytes out. Production uses the platform CSPRNG. */
export type RandomBytes = (length: number) => Uint8Array;

const isBytes = (value: unknown): value is Uint8Array => Object.prototype.toString.call(value) === '[object Uint8Array]';

const platformRandom: RandomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));

const checkSecret = (secret: unknown): Uint8Array => {
  if (!isBytes(secret) || secret.length !== SECRET_BYTES) throw new RangeError(`the match secret must be ${SECRET_BYTES} bytes`);
  return secret;
};

/**
 * Draws a match secret: exactly 32 bytes, copied from one call of the source.
 * The `random` parameter is a TEST-ONLY seam (FR-260): production code never passes it, so the
 * platform CSPRNG is the only source there; no setting, variable or request can reach it.
 */
export const newSecret = (random: RandomBytes = platformRandom): Uint8Array => drawBytes(SECRET_BYTES, random);

/**
 * Draws exactly `length` bytes with ONE call of the source (the only way the server obtains random bytes, FR-314):
 * the result is a private copy. The service uses it for the match id and the host token (FR-236), one call each.
 */
export function drawBytes(length: number, random: RandomBytes = platformRandom): Uint8Array {
  const drawn: unknown = random(length);
  if (!isBytes(drawn) || drawn.length !== length) throw new RangeError(`the random source must return ${length} bytes`);
  return Uint8Array.from(drawn);
}

/** SHA-256 of the raw secret as 64 lowercase hexadecimal characters (published at creation). */
export const commitment = (secret: Uint8Array): string => createHash('sha256').update(checkSecret(secret)).digest('hex');

/** HMAC-SHA-256 through `node:crypto`; the primitive of the round seeds (RFC 4231 checked in tests). */
export const hmacSha256 = (key: Uint8Array, message: Uint8Array): Uint8Array => Uint8Array.from(createHmac('sha256', key).update(message).digest());

/** The ASCII message naming round k; k must be a whole number from 1 to 2^31 - 1. */
export const roundMessage = (k: number): Uint8Array => {
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > MAX_ROUND) throw new RangeError('the round must be a whole number from 1 to 2147483647');
  return Uint8Array.from(Buffer.from(`${MESSAGE_PREFIX}${String(k)}`, 'ascii'));
};

/** Round seed s_k: the first 4 bytes of the HMAC read as an unsigned 32-bit big-endian integer. */
export const roundSeed = (secret: Uint8Array, k: number): number => {
  const mac = hmacSha256(checkSecret(secret), roundMessage(k));
  return new DataView(mac.buffer, mac.byteOffset, mac.byteLength).getUint32(0, false);
};

/** The reveal path (FR-259): the secret as 64 lowercase hexadecimal characters, only after the last round. */
export const secretHex = (secret: Uint8Array): string => Buffer.from(checkSecret(secret)).toString('hex');
