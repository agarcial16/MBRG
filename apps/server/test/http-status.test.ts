import { ERROR_ORDER, errorReply, rateLimited } from '@mbrg/protocol';
import type { ErrorKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { STATUS_OF_KIND, SUCCESS_STATUS, UNEXPECTED_REPLY, UNEXPECTED_STATUS, errorHeaders, statusOf } from '../src/http/status';

// The status table of plan 18.4 (decision C1, M3a T6): one HTTP status per error kind of FR-301, the success statuses,
// and the extra headers of three kinds. The table is pinned literally here, independent of the source.

const PINNED: Readonly<Record<ErrorKind, number>> = {
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
  'name-taken': 409,
  'match-full': 409,
  'match-started': 409,
  'match-expired': 409,
  'step-mismatch': 409,
  'round-not-applied': 404,
  'stale-cursor': 409,
  'prediction-closed': 409,
  'forced-absorber': 409,
  'invalid-choice': 422,
  unavailable: 503,
};

describe('http status table', () => {
  it('FR-301 (status table) every kind of ERROR_ORDER has exactly the status of plan 18.4', () => {
    expect(ERROR_ORDER).toHaveLength(27);
    expect(Object.keys(PINNED).sort()).toStrictEqual([...ERROR_ORDER].sort());
    for (const kind of ERROR_ORDER) expect(statusOf(kind), kind).toBe(PINNED[kind]);
    expect(Object.keys(STATUS_OF_KIND).sort()).toStrictEqual([...ERROR_ORDER].sort());
  });

  it('FR-301 (status table) the forced-absorber refusal is a 409 like prediction-closed, never a 422', () => {
    expect(statusOf('forced-absorber')).toBe(409);
    expect(statusOf('forced-absorber')).toBe(statusOf('prediction-closed'));
    expect(errorHeaders(errorReply('forced-absorber'))).toStrictEqual({});
  });

  it('FR-301 (status table) the lobby refusals are 409 like match-finished and carry no extra header', () => {
    for (const kind of ['name-taken', 'match-full', 'match-started', 'match-expired'] as const) {
      expect(statusOf(kind)).toBe(409);
      expect(statusOf(kind)).toBe(statusOf('match-finished'));
      expect(errorHeaders(errorReply(kind))).toStrictEqual({});
    }
  });

  it('FR-301 (status table) forbidden is always 403, never 401: one kind, one status', () => {
    expect(statusOf('forbidden')).toBe(403);
    expect(Object.values(STATUS_OF_KIND)).not.toContain(401);
  });

  it('FR-301 (status table) an unexpected exception is 500 with the body kind `unavailable`: no new kind', () => {
    expect(UNEXPECTED_STATUS).toBe(500);
    expect(UNEXPECTED_REPLY).toStrictEqual({ kind: 'unavailable' });
    expect(Object.values(STATUS_OF_KIND)).not.toContain(500);
  });

  it('FR-301 (status table) the success statuses: creation 201, replies 200, preflight 204', () => {
    expect(SUCCESS_STATUS).toStrictEqual({ created: 201, ok: 200, preflight: 204 });
  });

  it('FR-301 (status table) a kind outside the list is a programming error', () => {
    expect(() => statusOf('internal-error' as ErrorKind)).toThrow(RangeError);
    expect(() => statusOf('toString' as ErrorKind)).toThrow(RangeError);
  });

  it('FR-301 (status table) rate-limited carries Retry-After with its whole seconds', () => {
    expect(errorHeaders(rateLimited(41.2))).toStrictEqual({ 'retry-after': '42' });
    expect(errorHeaders(rateLimited(0))).toStrictEqual({ 'retry-after': '1' });
    expect(() => errorHeaders({ kind: 'rate-limited' })).toThrow(RangeError);
  });

  it('FR-301 (status table) method-not-allowed carries Allow with the methods of the path', () => {
    expect(errorHeaders(errorReply('method-not-allowed'), ['GET', 'POST', 'OPTIONS'])).toStrictEqual({ allow: 'GET, POST, OPTIONS' });
    expect(errorHeaders(errorReply('method-not-allowed'), ['GET', 'OPTIONS'])).toStrictEqual({ allow: 'GET, OPTIONS' });
    expect(() => errorHeaders(errorReply('method-not-allowed'))).toThrow(RangeError);
    expect(() => errorHeaders(errorReply('method-not-allowed'), [])).toThrow(RangeError);
  });

  it('FR-301 (status table) too-large closes the connection; every other kind has no extra header', () => {
    expect(errorHeaders(errorReply('too-large'))).toStrictEqual({ connection: 'close' });
    for (const kind of ERROR_ORDER) {
      if (kind === 'rate-limited' || kind === 'method-not-allowed' || kind === 'too-large') continue;
      expect(errorHeaders(errorReply(kind), ['GET']), kind).toStrictEqual({});
    }
  });
});
