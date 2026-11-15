import { describe, expect, it } from 'vitest';
import { RETRY_DELAYS_MS, WATCHDOG_MS, classifyReply, retryAfterMs, retryDelay } from '../src/core/live-retry';

describe('FR-307 the retry schedule', () => {
  it('FR-307 the waits after consecutive failures are 1, 2, 4, 8, 16, 30 and 30 seconds', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 40].map((n) => retryDelay(n))).toStrictEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
    expect(RETRY_DELAYS_MS).toStrictEqual([1000, 2000, 4000, 8000, 16000, 30000]);
  });

  it('FR-307 a Retry-After larger than the schedule wins, a smaller one does not', () => {
    expect(retryDelay(1, 7000)).toBe(7000);
    expect(retryDelay(3, 2000)).toBe(4000);
    expect(retryDelay(7, 90_000)).toBe(90_000);
    expect(retryDelay(2, undefined)).toBe(2000);
  });

  it('FR-307 the watchdog is 45,000 ms', () => {
    expect(WATCHDOG_MS).toBe(45_000);
  });
});

describe('FR-307 the reply classification', () => {
  it('FR-307 a 200 is ok, a 404 unknown-match is fatal, other replies are retried', () => {
    expect(classifyReply(200)).toBe('ok');
    expect(classifyReply(404, 'unknown-match')).toBe('unknown-match');
    expect(classifyReply(404)).toBe('retry');
    expect(classifyReply(404, 'unknown-round')).toBe('retry');
    expect(classifyReply(429, 'rate-limited')).toBe('retry');
    expect(classifyReply(503)).toBe('retry');
    expect(classifyReply(500, 'unknown-match')).toBe('retry');
    expect(classifyReply(400)).toBe('retry');
  });

  it('FR-307 Retry-After is read as whole seconds only', () => {
    expect(retryAfterMs('3')).toBe(3000);
    expect(retryAfterMs(' 12 ')).toBe(12_000);
    expect(retryAfterMs('0')).toBe(0);
    for (const bad of ['-1', '1.5', 'soon', '', 'Wed, 21 Oct 2026 07:28:00 GMT', '1e3', null, undefined]) {
      expect(retryAfterMs(bad), String(bad)).toBeUndefined();
    }
  });
});
