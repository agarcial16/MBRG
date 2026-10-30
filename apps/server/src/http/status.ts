// The HTTP status of every reply (spec 008 FR-301, plan 18.4, decision C1). Pure: a table and two small functions.
// One status per error kind; `forbidden` is always 403 (never 401, so nothing about the header leaks); an unexpected
// exception is 500 with the body kind `unavailable` (the closed kind list of FR-301 gets no new kind).

import { ERROR_ORDER } from '@mbrg/protocol';
import type { ErrorKind, ErrorReply } from '@mbrg/protocol';

/** The status of each error kind (plan 18.4). */
export const STATUS_OF_KIND: Readonly<Record<ErrorKind, number>> = Object.freeze({
  'rate-limited': 429,
  'unknown-path': 404,
  'method-not-allowed': 405,
  'too-large': 413,
  'invalid-request': 400,
  'invalid-player-id': 400,
  forbidden: 403,
  'request-id-reused': 409,
  'unknown-match': 404,
  'unknown-map': 404,
  'map-validation': 422,
  'too-few-factions': 422,
  'invalid-timing': 422,
  'too-many-matches': 409,
  'match-halted': 409,
  'match-finished': 409,
  'step-mismatch': 409,
  'round-not-applied': 404,
  'stale-cursor': 409,
  'prediction-closed': 409,
  'forced-absorber': 409,
  'invalid-choice': 422,
  unavailable: 503,
});

/** Success: creation 201; advance, submission, reads and map files 200; a preflight 204. */
export const SUCCESS_STATUS = Object.freeze({ created: 201, ok: 200, preflight: 204 });

/** An exception the pipeline did not expect: 500 with the body `{"kind":"unavailable"}` (C1). */
export const UNEXPECTED_STATUS = 500;
export const UNEXPECTED_REPLY: ErrorReply = Object.freeze({ kind: 'unavailable' });

/** The status of an error kind; a text outside the kind list is a programming error. */
export function statusOf(kind: ErrorKind): number {
  if (!(ERROR_ORDER as readonly string[]).includes(kind)) throw new RangeError('not an error kind');
  return STATUS_OF_KIND[kind];
}

/**
 * The extra headers of an error reply: `Retry-After` (whole seconds) for `rate-limited`, `Allow` (the methods of the path,
 * given by the router) for `method-not-allowed`, `Connection: close` for `too-large` (the rest of the body is not read).
 */
export function errorHeaders(reply: ErrorReply, allow?: readonly string[]): Readonly<Record<string, string>> {
  switch (reply.kind) {
    case 'rate-limited': {
      const seconds = reply.retryAfter;
      if (seconds === undefined || !Number.isSafeInteger(seconds) || seconds < 1) throw new RangeError('rate-limited carries a whole wait >= 1');
      return { 'retry-after': String(seconds) };
    }
    case 'method-not-allowed':
      if (allow === undefined || allow.length === 0) throw new RangeError('method-not-allowed names the allowed methods');
      return { allow: allow.join(', ') };
    case 'too-large':
      return { connection: 'close' };
    default:
      return {};
  }
}
