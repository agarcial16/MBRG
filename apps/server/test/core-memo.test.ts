import { describe, expect, it } from 'vitest';
import { ERROR_ORDER, canonicalBody, errorReply } from '@mbrg/protocol';
import type { ErrorKind } from '@mbrg/protocol';
import { MEMO_RETENTION_MS, NON_MEMOISABLE_KINDS, decideMemo, isMemoisable, memoKey } from '../src/core/memo';
import type { MemoEntry } from '../src/core/memo';

// FR-282 (d)(e) at the core level: the pure memo decision. The shell (M2b) stores the entry and the HTTP layer
// (M3a) reads the request id; here only the decision exists. Parts (a)(b)(c) of the core decision are named in the titles.

const H24 = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;
const advance = { method: 'POST', path: '/matches/m1/advance' };
const content = (body: unknown): string => canonicalBody(advance.method, advance.path, body);
const entry = (body: unknown, reply: unknown = { kind: 'reply-1' }): MemoEntry<unknown> => ({ content: content(body), reply, createdMs: T0 });

describe('memo decision: replay, reuse, retention', () => {
  it('FR-282 (d)(e) no stored entry gives new', () => {
    expect(decideMemo(undefined, { content: content({ round: 1 }), now: T0 })).toStrictEqual({ decision: 'new' });
  });

  it('FR-282 (d)(e) same content within 24 h replays the stored reply, also long after a cutoff (part b)', () => {
    const stored = entry({ requestId: 'a', round: 1 }, { kind: 'victim', round: 1, choice: 3, version: 1 });
    const again = content({ round: 1, requestId: 'b-other-id' });
    expect(decideMemo(stored, { content: again, now: T0 + 1 })).toStrictEqual({ decision: 'replay', reply: { kind: 'victim', round: 1, choice: 3, version: 1 } });
    expect(decideMemo(stored, { content: again, now: T0 + H24 - 1 }).decision).toBe('replay');
  });

  it('FR-282 (d)(e) a stored error is replayed as the error (part b)', () => {
    const err = errorReply('prediction-closed');
    const stored = entry({ round: 1 }, { ok: false, error: err });
    expect(decideMemo(stored, { content: content({ round: 1 }), now: T0 + 5 })).toStrictEqual({ decision: 'replay', reply: { ok: false, error: err } });
  });

  it('FR-282 (d)(e) the same id with different content gives request-id-reused (part c), key order and request id aside', () => {
    const stored = entry({ round: 1, choice: 3 });
    const r = decideMemo(stored, { content: content({ round: 1, choice: 4 }), now: T0 + 10 });
    expect(r).toStrictEqual({ decision: 'request-id-reused', error: errorReply('request-id-reused') });
    expect(decideMemo(stored, { content: canonicalBody('POST', '/matches/m2/advance', { round: 1, choice: 3 }), now: T0 + 10 }).decision).toBe('request-id-reused');
    expect(decideMemo(stored, { content: canonicalBody('PUT', advance.path, { round: 1, choice: 3 }), now: T0 + 10 }).decision).toBe('request-id-reused');
    expect(decideMemo(stored, { content: content({ choice: 3, round: 1 }), now: T0 + 10 }).decision).toBe('replay');
  });

  it('FR-282 (d)(e) at exactly 24 h the entry still counts, at 24 h + 1 ms the id is new (part e), whatever the content', () => {
    const stored = entry({ round: 1 });
    expect(decideMemo(stored, { content: content({ round: 1 }), now: T0 + H24 }).decision).toBe('replay');
    expect(decideMemo(stored, { content: content({ round: 2 }), now: T0 + H24 }).decision).toBe('request-id-reused');
    expect(decideMemo(stored, { content: content({ round: 1 }), now: T0 + H24 + 1 })).toStrictEqual({ decision: 'new' });
    expect(decideMemo(stored, { content: content({ round: 2 }), now: T0 + H24 + 1 })).toStrictEqual({ decision: 'new' });
    expect(MEMO_RETENTION_MS).toBe(H24);
  });

  it('FR-282 (d)(e) a reading before the entry (backward clock) is within the retention', () => {
    expect(decideMemo(entry({ round: 1 }), { content: content({ round: 1 }), now: T0 - 3_600_000 }).decision).toBe('replay');
  });

  it('FR-282 (d)(e) the decision does not change its inputs and does not look at the reply', () => {
    const stored = entry({ round: 1 }, { nested: [1, 2] });
    const before = JSON.stringify(stored);
    decideMemo(stored, { content: content({ round: 1 }), now: T0 });
    expect(JSON.stringify(stored)).toBe(before);
  });
});

describe('memo key and memoisable replies', () => {
  it('FR-282 (d)(e) the key separates credential, match (or creation) and request id, whatever characters they hold', () => {
    const keys = [
      memoKey({ credential: 'c1', match: 'm1' }, 'r1'),
      memoKey({ credential: 'c1', match: 'm1' }, 'r2'),
      memoKey({ credential: 'c1', match: 'm2' }, 'r1'),
      memoKey({ credential: 'c2', match: 'm1' }, 'r1'),
      memoKey({ credential: 'c1', match: null }, 'r1'),
      memoKey({ credential: 'c1', match: 'creation' }, 'r1'),
      memoKey({ credential: 'c1|m1', match: 'x' }, 'r1'),
      memoKey({ credential: 'c1', match: 'm1|x' }, 'r1'),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(memoKey({ credential: 'c1', match: 'm1' }, 'r1')).toBe(memoKey({ credential: 'c1', match: 'm1' }, 'r1'));
  });

  it('FR-282 (d)(e) the eight kinds of letter (d) are not memoisable; every other error and every success is', () => {
    expect([...NON_MEMOISABLE_KINDS].sort()).toStrictEqual(
      ['rate-limited', 'unknown-path', 'method-not-allowed', 'too-large', 'invalid-request', 'invalid-player-id', 'forbidden', 'unavailable'].sort(),
    );
    for (const kind of ERROR_ORDER as readonly ErrorKind[]) {
      const expected = !NON_MEMOISABLE_KINDS.includes(kind as (typeof NON_MEMOISABLE_KINDS)[number]);
      expect(isMemoisable({ ok: false, error: errorReply(kind) }), kind).toBe(expected);
    }
    expect(isMemoisable({ ok: true })).toBe(true);
    expect(isMemoisable({ ok: false, error: errorReply('prediction-closed') })).toBe(true);
    expect(isMemoisable({ ok: false, error: errorReply('invalid-choice') })).toBe(true);
    expect(isMemoisable({ ok: false, error: errorReply('step-mismatch') })).toBe(true);
    expect(isMemoisable({ ok: false, error: errorReply('rate-limited') })).toBe(false);
    expect(isMemoisable({ ok: false, error: errorReply('unavailable') })).toBe(false);
  });
});
