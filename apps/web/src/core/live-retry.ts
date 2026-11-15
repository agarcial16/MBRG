// The connection policy of the live viewer (FR-307, FR-289 (d), (e) client): the retry schedule, the watchdog and the
// classification of a reply. Pure: the shell measures time and reads replies; this module only decides.

/** The wait after the first, second, ... consecutive failure; the last value repeats. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/** No byte for this long on an open stream is a drop: three heartbeats of 14,000 ms and a margin (H10). */
export const WATCHDOG_MS = 45_000;

/** The wait before the attempt that follows `failures` consecutive failures (at least 1): the larger of the schedule and `Retry-After`. */
export function retryDelay(failures: number, retryAfterMs = 0): number {
  const index = Math.min(Math.max(failures, 1), RETRY_DELAYS_MS.length) - 1;
  return Math.max(RETRY_DELAYS_MS[index] as number, retryAfterMs);
}

/** What a reply means for the policy: `ok`, a failure to retry by the schedule, or the fatal `unknown-match`. */
export type ReplyClass = 'ok' | 'retry' | 'unknown-match';

/** A 200 is ok, a 404 `unknown-match` is fatal, everything else (network faults aside) is retried: 429, 5xx, an unreadable reply. */
export function classifyReply(status: number, errorKind?: string): ReplyClass {
  if (status === 200) return 'ok';
  if (status === 404 && errorKind === 'unknown-match') return 'unknown-match';
  return 'retry';
}

/** `Retry-After` in whole seconds as milliseconds; an absent, negative, fractional or date value gives undefined. */
export function retryAfterMs(header: string | null | undefined): number | undefined {
  if (header === null || header === undefined || !/^\d{1,6}$/.test(header.trim())) return undefined;
  return Number(header.trim()) * 1000;
}
