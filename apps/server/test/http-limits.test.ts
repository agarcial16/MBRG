import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/service/settings';
import type { Limits } from '../src/service/settings';
import { SWEEP_EVERY, WINDOW_MS, createGauge, createLimiter, limitKeys, playerKey, streamKeys } from '../src/http/limits';
import type { LimitKey } from '../src/http/limits';

// The sliding-window limiter of plan 18.6 (M3a T6), driven with explicit instants (no clock): FR-299 (c) counts only
// accepted requests of the last 60,000 ms, (d) keeps its state in memory only and follows the last minute of traffic,
// (e) answers a refusal with the largest wait over the exceeded limits, in whole seconds, at least 1.

const T0 = 1_700_000_123_457;
const key = (name: string, limit: number): LimitKey => ({ key: name, limit });

/** Admits `count` requests under `keys` at `at`, each one expected to pass. */
const fill = (limiter: ReturnType<typeof createLimiter>, keys: readonly LimitKey[], count: number, at: (i: number) => number) => {
  for (let i = 0; i < count; i += 1) expect(limiter.admit(keys, at(i)).ok, `request ${i}`).toBe(true);
};

describe('http limiter', () => {
  it('FR-299 (c) the window is 60,000 ms and a full sweep runs every 1,000 admissions', () => {
    expect(WINDOW_MS).toBe(60_000);
    expect(SWEEP_EVERY).toBe(1_000);
  });

  it('FR-299 (c) `limit` requests are admitted and the next one is refused with the wait to the oldest instant', () => {
    const limiter = createLimiter();
    const k = [key('credential:a', 7)];
    fill(limiter, k, 7, (i) => T0 + i * 1_013);
    const refused = limiter.admit(k, T0 + 20_500);
    // ceil((T0 + 60,000 - (T0 + 20,500)) / 1000) = ceil(39.5) = 40
    expect(refused).toStrictEqual({ ok: false, retryAfter: 40 });
  });

  it('FR-299 (c) exactly 60,000 ms after the oldest instant the request is admitted again, 1 ms earlier it is not', () => {
    const limiter = createLimiter();
    const k = [key('credential:a', 3)];
    fill(limiter, k, 3, (i) => T0 + i * 7_919);
    expect(limiter.admit(k, T0 + 59_999)).toStrictEqual({ ok: false, retryAfter: 1 });
    expect(limiter.admit(k, T0 + 60_000).ok).toBe(true);
    // Now the instants are T0 + 7,919, T0 + 15,838 and T0 + 60,000: the next opening is at T0 + 67,919.
    expect(limiter.admit(k, T0 + 60_001)).toStrictEqual({ ok: false, retryAfter: 8 });
    expect(limiter.admit(k, T0 + 67_918)).toStrictEqual({ ok: false, retryAfter: 1 });
    expect(limiter.admit(k, T0 + 67_919).ok).toBe(true);
  });

  it('FR-299 (e) the wait is a whole number of seconds rounded up and at least 1', () => {
    const limiter = createLimiter();
    const k = [key('address:203.0.113.9', 1)];
    fill(limiter, k, 1, () => T0);
    expect(limiter.admit(k, T0)).toStrictEqual({ ok: false, retryAfter: 60 });
    expect(limiter.admit(k, T0 + 1)).toStrictEqual({ ok: false, retryAfter: 60 });
    expect(limiter.admit(k, T0 + 999)).toStrictEqual({ ok: false, retryAfter: 60 });
    expect(limiter.admit(k, T0 + 1_000)).toStrictEqual({ ok: false, retryAfter: 59 });
    expect(limiter.admit(k, T0 + 59_001)).toStrictEqual({ ok: false, retryAfter: 1 });
  });

  it('FR-299 (c) refused requests are not counted: they never delay the next opening', () => {
    const limiter = createLimiter();
    const k = [key('credential:a', 2)];
    fill(limiter, k, 2, (i) => T0 + i);
    for (let i = 0; i < 50; i += 1) expect(limiter.admit(k, T0 + 30_000 + i).ok).toBe(false);
    expect(limiter.count('credential:a', T0 + 30_100)).toBe(2);
    expect(limiter.admit(k, T0 + 60_000).ok).toBe(true);
    expect(limiter.admit(k, T0 + 60_001).ok).toBe(true);
  });

  it('FR-299 (e) with several exceeded keys the wait is the largest, and nothing is recorded under any key', () => {
    const limiter = createLimiter();
    const a = key('credential:a', 2);
    const b = key('player:m\u0000web:p', 1);
    const free = key('free', 100);
    fill(limiter, [a], 2, (i) => T0 + i * 1_000); // a opens at T0 + 60,000
    fill(limiter, [b], 1, () => T0 + 25_000); // b opens at T0 + 85,000
    const now = T0 + 30_000;
    expect(limiter.admit([a, b, free], now)).toStrictEqual({ ok: false, retryAfter: 55 });
    expect(limiter.admit([b, a, free], now)).toStrictEqual({ ok: false, retryAfter: 55 });
    expect(limiter.admit([free, a], now)).toStrictEqual({ ok: false, retryAfter: 30 });
    expect(limiter.count('free', now)).toBe(0);
    expect(limiter.count('credential:a', now)).toBe(2);
    expect(limiter.count('player:m\u0000web:p', now)).toBe(1);
  });

  it('FR-299 (c) an admitted request is recorded under every one of its keys', () => {
    const limiter = createLimiter();
    const k = [key('x', 5), key('y', 5)];
    fill(limiter, k, 3, (i) => T0 + i);
    expect(limiter.count('x', T0 + 10)).toBe(3);
    expect(limiter.count('y', T0 + 10)).toBe(3);
  });

  it('FR-299 (c) ticket.cancel() removes the instants it recorded and only those; a second cancel does nothing', () => {
    const limiter = createLimiter();
    const k = [key('x', 3), key('y', 9)];
    fill(limiter, [key('x', 3)], 1, () => T0);
    const admitted = limiter.admit(k, T0 + 5);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    fill(limiter, [key('x', 3)], 1, () => T0 + 9);
    expect(limiter.count('x', T0 + 10)).toBe(3);
    expect(limiter.admit(k, T0 + 10).ok).toBe(false);
    admitted.ticket.cancel();
    expect(limiter.count('x', T0 + 10)).toBe(2);
    expect(limiter.count('y', T0 + 10)).toBe(0);
    admitted.ticket.cancel();
    expect(limiter.count('x', T0 + 10)).toBe(2);
    expect(limiter.admit(k, T0 + 10).ok).toBe(true);
  });

  it('FR-299 (c) a request over the per-player limit cancels its credential ticket: it is counted nowhere', () => {
    const limiter = createLimiter();
    const credential = [key('command:c', 10)];
    const player = [key('player:m\u0000web:p', 2)];
    for (let i = 0; i < 2; i += 1) {
      const first = limiter.admit(credential, T0 + i);
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.ticket.extend(player, T0 + i)).toStrictEqual({ ok: true });
    }
    const third = limiter.admit(credential, T0 + 40_000);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(limiter.count('command:c', T0 + 40_000)).toBe(3);
    // the player key opens at T0 + 60,000: ceil(20,000 / 1000) = 20
    expect(third.ticket.extend(player, T0 + 40_000)).toStrictEqual({ ok: false, retryAfter: 20 });
    expect(limiter.count('command:c', T0 + 40_000)).toBe(2);
    expect(limiter.count('player:m\u0000web:p', T0 + 40_000)).toBe(2);
    // the cancelled ticket is spent: cancelling again changes nothing
    third.ticket.cancel();
    expect(limiter.count('command:c', T0 + 40_000)).toBe(2);
  });

  it('FR-299 (c) an extended ticket cancels the instants of both phases', () => {
    const limiter = createLimiter();
    const admitted = limiter.admit([key('a', 5)], T0);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.ticket.extend([key('b', 5)], T0 + 3)).toStrictEqual({ ok: true });
    admitted.ticket.cancel();
    expect(limiter.count('a', T0 + 3)).toBe(0);
    expect(limiter.count('b', T0 + 3)).toBe(0);
  });

  it('FR-299 (a) the keys of two client credentials, two player ids and two addresses are independent', () => {
    const limiter = createLimiter();
    for (const [left, right] of [
      ['read:digest-a', 'read:digest-b'],
      [playerKey('m1', 'web:p1'), playerKey('m1', 'web:p2')],
      [playerKey('m3', 'web:p9'), playerKey('m4', 'web:p9')],
      ['address:192.0.2.1', 'address:192.0.2.2'],
    ] as const) {
      fill(limiter, [key(left, 2)], 2, (i) => T0 + i);
      expect(limiter.admit([key(left, 2)], T0 + 5).ok, left).toBe(false);
      expect(limiter.admit([key(right, 2)], T0 + 5).ok, right).toBe(true);
    }
  });

  it('FR-299 (d) after a quiet minute the sweep leaves no key', () => {
    const limiter = createLimiter();
    for (let i = 0; i < 37; i += 1) fill(limiter, [key(`address:198.51.100.${i}`, 5)], 1, () => T0 + i);
    expect(limiter.keyCount()).toBe(37);
    limiter.sweep(T0 + 36 + 59_999);
    expect(limiter.keyCount()).toBe(1);
    limiter.sweep(T0 + 36 + 60_000);
    expect(limiter.keyCount()).toBe(0);
  });

  it('FR-299 (d) a key with no instants is deleted at its next prune (a cancelled ticket leaves no key behind)', () => {
    const limiter = createLimiter();
    const admitted = limiter.admit([key('only', 5)], T0);
    expect(limiter.keyCount()).toBe(1);
    if (admitted.ok) admitted.ticket.cancel();
    expect(limiter.keyCount()).toBe(0);
    fill(limiter, [key('later', 5)], 1, () => T0);
    expect(limiter.count('later', T0 + 60_000)).toBe(0);
    expect(limiter.keyCount()).toBe(0);
  });

  it('FR-299 (d) every 1,000 admissions a full sweep forgets the keys of more than a minute ago', () => {
    const limiter = createLimiter();
    for (let i = 0; i < 20; i += 1) fill(limiter, [key(`old:${i}`, 5)], 1, () => T0);
    const later = T0 + 61_000;
    // 20 admissions so far; 979 more on one key keep the old keys (999 in all) ...
    fill(limiter, [key('busy', 1_000_000)], 979, () => later);
    expect(limiter.keyCount()).toBe(21);
    // ... and the 1,000th admission sweeps them.
    fill(limiter, [key('busy', 1_000_000)], 1, () => later);
    expect(limiter.keyCount()).toBe(1);
  });

  it('FR-299 (c) instants out of order (a clock moved back) are still counted and pruned by their own age', () => {
    const limiter = createLimiter();
    const k = [key('x', 3)];
    fill(limiter, k, 1, () => T0 + 10_000);
    fill(limiter, k, 1, () => T0);
    fill(limiter, k, 1, () => T0 + 5_000);
    expect(limiter.admit(k, T0 + 20_000)).toStrictEqual({ ok: false, retryAfter: 40 });
    expect(limiter.admit(k, T0 + 60_000).ok).toBe(true);
    expect(limiter.count('x', T0 + 60_000)).toBe(3);
  });

  it('FR-299 (a) the keys of a request follow its credential and class, and anonymous requests the address', () => {
    const limits: Limits = { commands: 11, reads: 13, submissions: 17, advances: 19, anonymous: 23, streams: 29, anonymousStreams: 31 };
    const digest = 'ab'.repeat(32);
    expect(limitKeys({ role: 'operator', digest }, 'command', '192.0.2.7', limits)).toStrictEqual([{ key: `command:${digest}`, limit: 11 }]);
    expect(limitKeys({ role: 'client', digest, namespace: 'web' }, 'read', '192.0.2.7', limits)).toStrictEqual([{ key: `read:${digest}`, limit: 13 }]);
    expect(limitKeys({ role: 'host', digest }, 'command', '192.0.2.7', limits)).toStrictEqual([{ key: `advance:${digest}`, limit: 19 }]);
    expect(limitKeys({ role: 'anonymous' }, 'read', '192.0.2.7', limits)).toStrictEqual([{ key: 'address:192.0.2.7', limit: 23 }]);
    expect(limitKeys({ role: 'anonymous' }, 'command', '192.0.2.7', limits)).toStrictEqual([{ key: 'address:192.0.2.7', limit: 23 }]);
    // An unverified token creates no key of its own: it is counted under the address (PD16).
    expect(limitKeys({ role: 'candidate', digest }, 'command', '192.0.2.7', limits)).toStrictEqual([{ key: 'address:192.0.2.7', limit: 23 }]);
    expect(playerKey('m1', 'web:p1')).not.toBe(playerKey('m1w', 'eb:p1'));
    expect(DEFAULT_LIMITS.submissions).toBe(30);
  });

  it('FR-299 (c) a key list that is empty or a limit that is not a whole number >= 1 is a programming error', () => {
    const limiter = createLimiter();
    expect(() => limiter.admit([], T0)).toThrow(RangeError);
    expect(() => limiter.admit([key('x', 0)], T0)).toThrow(RangeError);
    expect(() => limiter.admit([key('x', 1.5)], T0)).toThrow(RangeError);
    expect(() => limiter.admit([key('x', 1)], Number.NaN)).toThrow(RangeError);
  });
});

describe('http open-stream gauge', () => {
  it('FR-299 (stream limits) `open` is admitted while every key is under its limit and refused when any key holds its limit', () => {
    const gauge = createGauge();
    const a = [key('streams:a', 2)];
    const first = gauge.open(a);
    const second = gauge.open(a);
    expect([first.ok, second.ok]).toStrictEqual([true, true]);
    expect(gauge.count('streams:a')).toBe(2);
    expect(gauge.open(a)).toStrictEqual({ ok: false });
    // Two keys: the full one refuses although the other has room.
    expect(gauge.open([key('streams:b', 5), key('streams:a', 2)])).toStrictEqual({ ok: false });
    expect(gauge.count('streams:b')).toBe(0);
  });

  it('FR-299 (stream limits) a lease counts under every key it was opened with', () => {
    const gauge = createGauge();
    const keys = [key('streams:a', 3), key('streams-address:x', 3)];
    const lease = gauge.open(keys);
    expect(lease.ok).toBe(true);
    expect([gauge.count('streams:a'), gauge.count('streams-address:x')]).toStrictEqual([1, 1]);
    gauge.open([key('streams:a', 3)]);
    expect([gauge.count('streams:a'), gauge.count('streams-address:x')]).toStrictEqual([2, 1]);
  });

  it('FR-299 (stream limits) `release` gives the room back and a second call changes nothing', () => {
    const gauge = createGauge();
    const k = [key('streams:a', 2)];
    const one = gauge.open(k);
    const two = gauge.open(k);
    if (!one.ok || !two.ok) throw new Error('expected two leases');
    one.lease.release();
    expect(gauge.count('streams:a')).toBe(1);
    one.lease.release();
    one.lease.release();
    expect(gauge.count('streams:a')).toBe(1);
    expect(gauge.open(k).ok).toBe(true);
    expect(gauge.open(k)).toStrictEqual({ ok: false });
    two.lease.release();
    expect(gauge.count('streams:a')).toBe(1);
  });

  it('FR-299 (stream limits) a refused open records nothing under any key', () => {
    const gauge = createGauge();
    const full = gauge.open([key('streams:a', 1)]);
    expect(full.ok).toBe(true);
    expect(gauge.open([key('streams-address:x', 4), key('streams:a', 1)])).toStrictEqual({ ok: false });
    expect(gauge.count('streams-address:x')).toBe(0);
    expect(gauge.count('streams:a')).toBe(1);
    expect(gauge.keyCount()).toBe(1);
  });

  it('FR-299 (stream limits) a gauge with no open lease holds no key', () => {
    const gauge = createGauge();
    expect(gauge.keyCount()).toBe(0);
    const a = gauge.open([key('streams:a', 4), key('streams-address:x', 4)]);
    const b = gauge.open([key('streams:a', 4)]);
    if (!a.ok || !b.ok) throw new Error('expected leases');
    expect(gauge.keyCount()).toBe(2);
    a.lease.release();
    expect(gauge.keyCount()).toBe(1);
    b.lease.release();
    expect(gauge.keyCount()).toBe(0);
    expect(gauge.count('streams:a')).toBe(0);
  });

  it('FR-299 (stream limits) a key list that is empty or a limit that is not a whole number >= 1 is a programming error', () => {
    const gauge = createGauge();
    expect(() => gauge.open([])).toThrow(RangeError);
    expect(() => gauge.open([key('x', 0)])).toThrow(RangeError);
    expect(() => gauge.open([key('x', 2.5)])).toThrow(RangeError);
  });

  it('FR-299 (stream limits) the keys of a stream: operator and client by credential digest, every other role by address', () => {
    const limits: Limits = { commands: 11, reads: 13, submissions: 17, advances: 19, anonymous: 23, streams: 29, anonymousStreams: 31 };
    const digest = 'cd'.repeat(32);
    expect(streamKeys({ role: 'operator', digest }, '192.0.2.7', limits)).toStrictEqual([{ key: `streams:${digest}`, limit: 29 }]);
    expect(streamKeys({ role: 'client', digest, namespace: 'web' }, '192.0.2.7', limits)).toStrictEqual([{ key: `streams:${digest}`, limit: 29 }]);
    expect(streamKeys({ role: 'anonymous' }, '192.0.2.7', limits)).toStrictEqual([{ key: 'streams-address:192.0.2.7', limit: 31 }]);
    // A candidate and a host token are anonymous on the stream route: no key of their own (PD16).
    expect(streamKeys({ role: 'candidate', digest }, '192.0.2.7', limits)).toStrictEqual([{ key: 'streams-address:192.0.2.7', limit: 31 }]);
    expect(streamKeys({ role: 'host', digest }, '192.0.2.7', limits)).toStrictEqual([{ key: 'streams-address:192.0.2.7', limit: 31 }]);
    // The same address shares the anonymous gauge; the same credential shares the credential gauge.
    expect(streamKeys({ role: 'operator', digest }, '192.0.2.7', limits)).toStrictEqual(streamKeys({ role: 'operator', digest }, '198.51.100.1', limits));
    expect(DEFAULT_LIMITS.streams).toBe(50);
    expect(DEFAULT_LIMITS.anonymousStreams).toBe(5);
  });
});
