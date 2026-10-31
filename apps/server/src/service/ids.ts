// Identifiers, credential digests and hashes of the lifecycle service (spec 008 FR-236, FR-300, plan PD12).
// Random bytes come only through `secret.ts` (`drawBytes`, one call per value); this module never reads a random
// source or a clock itself (FR-314).

import { createHash, timingSafeEqual } from 'node:crypto';
import { drawBytes } from '../secret';
import type { RandomBytes } from '../secret';

/** 12 random bytes = 96 bits, written as 16 base64url characters (FR-236). */
export const MATCH_ID_BYTES = 12;
/** 32 random bytes = 256 bits, written as 43 base64url characters (FR-236). */
export const HOST_TOKEN_BYTES = 32;

/** 32 random bytes = 256 bits, written as 43 base64url characters: the token of a player who joins by name (spec 011 plan P9). */
export const PLAYER_TOKEN_BYTES = 32;
/** 9 random bytes, written as 12 base64url characters: the local part of `player:<local id>` (spec 011 plan P7). */
export const PLAYER_ID_BYTES = 9;

/** The credential character set (FR-297) holds the base64url alphabet; no padding is written. */
const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** A new match id: its own draw of 12 bytes, independent of the match secret (FR-236). */
export const newMatchId = (random?: RandomBytes): string => base64url(drawBytes(MATCH_ID_BYTES, random));

/** A new host token: its own draw of 32 bytes, independent of the secret and the match id (FR-236). */
export const newHostToken = (random?: RandomBytes): string => base64url(drawBytes(HOST_TOKEN_BYTES, random));

/** A new player token: its own draw of 32 bytes, independent of the secret, the match id, the host token and every other value. */
export const newPlayerToken = (random?: RandomBytes): string => base64url(drawBytes(PLAYER_TOKEN_BYTES, random));

/** A new local player id: its own draw of 9 bytes, independent of the token. */
export const newPlayerLocalId = (random?: RandomBytes): string => base64url(drawBytes(PLAYER_ID_BYTES, random));

/** The fixed prefix of every credential digest (PD12). */
export const CREDENTIAL_PREFIX = 'mbrg/credential/v1/';

const DIGEST = /^[0-9a-f]{64}$/;

/** `sha256('mbrg/credential/v1/' + text)` as 64 lowercase hexadecimal characters (FR-300, PD12): the only form a credential or host token is stored or keyed in. */
export const credentialDigest = (text: string): string => createHash('sha256').update(`${CREDENTIAL_PREFIX}${text}`, 'utf8').digest('hex');

/** Equality of two digests in time independent of their content (FR-300); a value that is not a digest never matches. */
export const sameDigest = (a: string, b: string): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string' || !DIGEST.test(a) || !DIGEST.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
};

/** SHA-256 of an ASCII text (the state text) as 64 lowercase hexadecimal characters: the `sha256` injected into the core. */
export const sha256Ascii = (text: string): string => createHash('sha256').update(text, 'ascii').digest('hex');

/** SHA-256 of bytes as 64 lowercase hexadecimal characters (the map digest, `mapDigestBytes`). */
export const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
