// The scheduler of the lifecycle service (spec 008 FR-239, plan 17.1): it wakes the service at an instant. It is the ONLY
// server file that uses timers (a scan pins that); the service sees it as the interface below, so tests drive a fake one
// from the fake clock. A wake-up decides nothing: the service re-reads the stored match and the clock and performs the
// step only if it is due (an early or late wake-up is harmless).

import type { Clock } from '../clock';

/** Names one armed wake-up, for `cancel`. */
export type SchedulerHandle = number;

export interface Scheduler {
  /** Arms `run` to be called once at `instant` (whole ms on the clock of the service); an instant already past runs it as soon as possible. */
  at(instant: number, run: () => void): SchedulerHandle;
  /** Disarms a wake-up that has not run; a handle that already ran or never existed is ignored. */
  cancel(handle: SchedulerHandle): void;
}

/** The longest delay a timer takes (a 32-bit signed number of ms, about 24.8 days); a longer wait is a wake-up that finds nothing due and re-arms. */
export const MAX_TIMER_MS = 2 ** 31 - 1;

export interface RealScheduler extends Scheduler {
  /** Disarms every wake-up (server shutdown, end of a test). */
  close(): void;
}

/** The real scheduler: one `setTimeout` per armed instant, measured against `clock`. */
export function createScheduler(clock: Clock): RealScheduler {
  let next = 1;
  const timers = new Map<SchedulerHandle, ReturnType<typeof setTimeout>>();
  return {
    at(instant, run) {
      const handle = next++;
      const delay = Math.min(MAX_TIMER_MS, Math.max(0, instant - clock.now()));
      timers.set(
        handle,
        setTimeout(() => {
          timers.delete(handle);
          run();
        }, delay),
      );
      return handle;
    },
    cancel(handle) {
      const timer = timers.get(handle);
      if (timer === undefined) return;
      clearTimeout(timer);
      timers.delete(handle);
    },
    close() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
