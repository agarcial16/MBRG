// A browser, a clock and a service of captures without Chrome (spec 038 tests). Nothing runs by itself: timers fire when the test says.
import type { CaptureJob } from '../../src/core/capture';
import type { BrowserDriver, BrowserSession, CaptureService, Shot } from '../../src/io/capture';

export interface FakeTimers {
  readonly after: (ms: number, fn: () => void) => () => void;
  /** Fires every pending timer set with at most `ms` (a test moves time in whole steps). */
  fireUpTo(ms: number): void;
  pending(): number[];
}

export function fakeTimers(): FakeTimers {
  const timers = new Map<number, { ms: number; fn: () => void }>();
  let id = 0;
  return {
    after(ms, fn) {
      const mine = (id += 1);
      timers.set(mine, { ms, fn });
      return () => timers.delete(mine);
    },
    fireUpTo(ms) {
      for (const [key, timer] of [...timers]) {
        if (timer.ms <= ms) {
          timers.delete(key);
          timer.fn();
        }
      }
    },
    pending: () => [...timers.values()].map((t) => t.ms),
  };
}

/** What a shot does: a PNG of this many bytes, a failure, or never ends. */
export type ShotBehaviour = { readonly bytes: number } | 'fail' | 'hang';

export interface FakeDriver extends BrowserDriver {
  readonly launches: number;
  readonly closes: number;
  readonly shots: Shot[];
  /** The most shots that ran at the same time. */
  readonly peak: number;
  /** Decides each shot (by its order); the default is a small image. */
  behave: (shot: Shot, n: number) => ShotBehaviour;
  /** While set, `launch` waits for it. */
  gate: Promise<void> | undefined;
  failLaunch: boolean;
}

export function fakeDriver(): FakeDriver {
  let running = 0;
  const state = { launches: 0, closes: 0, peak: 0, shots: [] as Shot[] };
  const driver: FakeDriver = {
    get launches() {
      return state.launches;
    },
    get closes() {
      return state.closes;
    },
    get peak() {
      return state.peak;
    },
    shots: state.shots,
    behave: () => ({ bytes: 100 }),
    gate: undefined,
    failLaunch: false,
    async launch(): Promise<BrowserSession> {
      if (driver.failLaunch) throw new Error('no browser');
      if (driver.gate !== undefined) await driver.gate;
      state.launches += 1;
      return {
        async shoot(shot) {
          running += 1;
          state.peak = Math.max(state.peak, running);
          state.shots.push(shot);
          const how = driver.behave(shot, state.shots.length);
          try {
            await Promise.resolve();
            if (how === 'fail') throw new Error('page error');
            if (how === 'hang') return await new Promise<Uint8Array>(() => undefined);
            return new Uint8Array(how.bytes);
          } finally {
            running -= 1;
          }
        },
        async close() {
          state.closes += 1;
        },
      };
    },
  };
  return driver;
}

/** A service that answers from a table, for the flows of the follower and the handler. */
export interface FakeService extends CaptureService {
  readonly requests: CaptureJob[];
  readonly revealed: { matchId: string; round: number }[];
  /** What the next requests give: an image of this size, or nothing; `hold` keeps every request waiting until `release`. */
  mode: 'image' | 'none';
  hold: boolean;
  release(): void;
}

export function fakeService(): FakeService {
  const waiting: (() => void)[] = [];
  const service: FakeService = {
    requests: [],
    revealed: [],
    mode: 'image',
    hold: false,
    release: () => waiting.splice(0).forEach((go) => go()),
    reveal: (matchId, round) => void service.revealed.push({ matchId, round }),
    async request(job) {
      service.requests.push(job);
      if (service.hold) await new Promise<void>((resolve) => waiting.push(resolve));
      return service.mode === 'image' ? new Uint8Array([137, 80, 78, 71, job.round]) : undefined;
    },
    async close() {},
  };
  return service;
}
