import type { Clock } from '../../src/clock';

/** A test clock: `advance` moves forward, `set` may move backwards. */
export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}

export function fakeClock(start = 0): FakeClock {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
    set(ms) {
      current = ms;
    },
  };
}
