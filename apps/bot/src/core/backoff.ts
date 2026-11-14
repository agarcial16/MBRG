// The wait before the next reconnection of an event stream (spec 012 FR-460): doubling from one second to a cap of thirty.
// No chance and no clock: the same attempt number always gives the same wait.

export const BACKOFF_FIRST_MS = 1000;
export const BACKOFF_CAP_MS = 30_000;

/** The wait in ms before attempt number `attempt` (1 is the first retry after a drop). */
export function backoffMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(BACKOFF_CAP_MS, BACKOFF_FIRST_MS * 2 ** Math.min(n - 1, 20));
}
