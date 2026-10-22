// The memo decision of a client request id (spec 008 FR-282 (b) to (e)). Pure: the stored entry and the clock reading
// are parameters; the store (M2b) keeps the entries and the HTTP layer (M3a) reads the id from the body.

import type { ErrorKind, ErrorReply } from '@mbrg/protocol';
import { errorReply } from '@mbrg/protocol';

/** Retention of a memoised reply, counted from its first use (FR-282 (a)): 24 hours in ms. */
export const MEMO_RETENTION_MS = 24 * 60 * 60 * 1000;

/** The replies that are never memoised, so that the request may be retried with the same id (FR-282 (d)). */
export const NON_MEMOISABLE_KINDS = [
  'rate-limited',
  'unknown-path',
  'method-not-allowed',
  'too-large',
  'invalid-request',
  'invalid-player-id',
  'forbidden',
  'unavailable',
] as const satisfies readonly ErrorKind[];

/**
 * The scope of an id (FR-282 (a)): the DIGEST of the credential (PD12: 64 lowercase hexadecimal characters, built by the
 * service) and the match; `match: null` is the scope of creations. A credential or host token is never part of a key
 * (FR-300 (digests), NFR-54).
 */
export interface MemoScope {
  readonly credentialDigest: string;
  readonly match: string | null;
}

const DIGEST = /^[0-9a-f]{64}$/;

/**
 * The store key of (scope, request id): an unambiguous encoding, whatever characters the parts hold. A scope whose
 * credential is not a digest is a RangeError (a credential as text must never reach a store key).
 */
export const memoKey = (scope: MemoScope, requestId: string): string => {
  if (!DIGEST.test(scope.credentialDigest)) throw new RangeError('the memo scope holds a credential digest (64 lowercase hexadecimal characters)');
  return JSON.stringify([scope.credentialDigest, scope.match, requestId]);
};

/** A stored first use: its canonical content (`canonicalBody`), its reply or error as given, and its first-use instant. */
export interface MemoEntry<R> {
  readonly content: string;
  readonly reply: R;
  readonly createdMs: number;
}

export type MemoDecision<R> =
  | { readonly decision: 'new' }
  | { readonly decision: 'replay'; readonly reply: R }
  | { readonly decision: 'request-id-reused'; readonly error: ErrorReply };

/**
 * FR-282: no entry, or an entry older than the retention (more than 24 h), is a new id (e); within the retention the same
 * content replays the stored reply (b), also after a cutoff, and a different content is `request-id-reused` (c).
 * `now` is the effective instant of the request.
 */
export function decideMemo<R>(stored: MemoEntry<R> | undefined, input: { readonly content: string; readonly now: number }): MemoDecision<R> {
  if (stored === undefined || input.now - stored.createdMs > MEMO_RETENTION_MS) return { decision: 'new' };
  if (stored.content === input.content) return { decision: 'replay', reply: stored.reply };
  return { decision: 'request-id-reused', error: errorReply('request-id-reused') };
}

/** Whether the outcome of a first use is stored in the memo (FR-282 (d)): every success and every error but the listed kinds. */
export function isMemoisable(outcome: { readonly ok: true } | { readonly ok: false; readonly error: ErrorReply }): boolean {
  if (outcome.ok) return true;
  return !(NON_MEMOISABLE_KINDS as readonly ErrorKind[]).includes(outcome.error.kind);
}
