// The injectable clock (spec 008 FR-314): the ONLY server file that reads the system clock.
// Everything else receives time as a number from a `Clock`; tests pass `test/helpers/fake-clock`.

export interface Clock {
  /** The current reading in whole milliseconds since 1970-01-01T00:00:00Z. */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
