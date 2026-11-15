import type { Scheduler, SchedulerHandle } from '../../src/service/scheduler';
import type { FakeClock } from './fake-clock';

/** A scheduler driven by the fake clock: nothing fires until the test moves the clock through `runTo` or `fireDue`. */
export interface FakeScheduler extends Scheduler {
  /** The instants still armed, ascending. */
  pending(): number[];
  /** Fires, in instant order, every armed callback whose instant is at or below the clock reading; returns how many. */
  fireDue(): number;
  /** Fires every armed callback now, whatever its instant (a timer that fires early); returns how many. */
  fireAll(): number;
  /** Moves the clock to `ms`, stopping at every armed instant on the way (each callback sees its own instant), then sets `ms`. */
  runTo(ms: number): number;
}

const LIMIT = 10_000;

export function fakeScheduler(clock: FakeClock): FakeScheduler {
  let next = 1;
  const armed = new Map<SchedulerHandle, { instant: number; run: () => void }>();
  const earliest = (): [SchedulerHandle, { instant: number; run: () => void }] | undefined => {
    let best: [SchedulerHandle, { instant: number; run: () => void }] | undefined;
    for (const entry of armed) if (best === undefined || entry[1].instant < best[1].instant) best = entry;
    return best;
  };
  const fire = (handle: SchedulerHandle): void => {
    const entry = armed.get(handle);
    if (entry === undefined) return;
    armed.delete(handle);
    entry.run();
  };
  return {
    at(instant, run) {
      const handle = next++;
      armed.set(handle, { instant, run });
      return handle;
    },
    cancel(handle) {
      armed.delete(handle);
    },
    pending: () => [...armed.values()].map((e) => e.instant).sort((a, b) => a - b),
    fireDue() {
      let fired = 0;
      for (let guard = 0; guard < LIMIT; guard++) {
        const best = earliest();
        if (best === undefined || best[1].instant > clock.now()) return fired;
        fire(best[0]);
        fired += 1;
      }
      throw new Error('the fake scheduler fired too many callbacks (a callback re-arms itself at a due instant)');
    },
    fireAll() {
      const handles = [...armed.keys()];
      handles.forEach(fire);
      return handles.length;
    },
    runTo(ms) {
      let fired = 0;
      for (let guard = 0; guard < LIMIT; guard++) {
        const best = earliest();
        if (best === undefined || best[1].instant > ms) break;
        if (best[1].instant > clock.now()) clock.set(best[1].instant);
        fire(best[0]);
        fired += 1;
      }
      clock.set(ms);
      return fired + this.fireDue();
    },
  };
}
