import { createHash } from 'node:crypto';
import type { MapData } from '@mbrg/shared';
import type { MatchEvent, Timing } from '@mbrg/protocol';
import { createMatch } from '../../src/core/create';
import { effectiveInstant, reportedTime } from '../../src/core/time';
import { performStep, runDue } from '../../src/core/steps';
import type { Applied, StepDeps, StepOutcome } from '../../src/core/steps';
import type { CoreMatch, StepCause, StepRow } from '../../src/core/view';
import { roundSeed } from '../../src/secret';
import { fakeClock } from './fake-clock';
import type { FakeClock } from './fake-clock';
import { devMap } from './digests';

export const SECRET_00_1F = Uint8Array.from({ length: 32 }, (_, i) => i);

/** SHA-256 hex of an ASCII text (the platform hash, injected into the core as `sha256`). */
export const sha256 = (text: string): string => createHash('sha256').update(text, 'ascii').digest('hex');

export interface DriverOptions {
  map?: unknown;
  timing?: Timing;
  /** Round seeds; defaults to the HMAC seeds of the secret 0x00..0x1f. */
  seedOf?: (k: number) => number;
  start?: number;
}

/** Keeps a core view in memory, with a fake clock, the stored rows and events, and a log of every seed request. */
export interface Driver {
  view: CoreMatch;
  readonly clock: FakeClock;
  readonly map: unknown;
  readonly steps: StepRow[];
  readonly events: MatchEvent[];
  readonly applied: Applied[];
  readonly seedCalls: number[];
  deps: StepDeps;
  /** Performs `kind` now (effective instant of the clock and the last step), as a manual step by default. */
  run(kind: StepRow['kind'], cause?: StepCause): StepOutcome;
  /** Runs the one due step at the clock reading, if any. */
  tick(): StepOutcome | null;
  /** Records an outcome the way the shell would store it. */
  take(outcome: StepOutcome): StepOutcome;
}

export function coreDriver(options: DriverOptions = {}): Driver {
  const map = options.map ?? devMap();
  const timing = options.timing ?? 'manual';
  const clock = fakeClock(options.start ?? 1_700_000_000_000);
  const seedCalls: number[] = [];
  const base = options.seedOf ?? ((k: number) => roundSeed(SECRET_00_1F, k));
  const deps: StepDeps = {
    map,
    sha256,
    seedOf: (k) => {
      seedCalls.push(k);
      return base(k);
    },
  };
  const created = createMatch(
    { matchId: 'm-test', mapId: 'dev', mapDigest: 'd'.repeat(64), timing, commitment: 'c'.repeat(64), now: clock.now() },
    { map, sha256 },
  );
  if (!created.ok) throw new Error(`creation failed: ${JSON.stringify(created.errors)}`);
  const driver: Driver = {
    view: created.view,
    clock,
    map,
    steps: [],
    events: [],
    applied: [],
    seedCalls,
    deps,
    take(outcome) {
      driver.view = outcome.view;
      driver.steps.push(...outcome.steps);
      driver.events.push(...outcome.events);
      if (outcome.applied !== undefined) driver.applied.push(outcome.applied);
      return outcome;
    },
    run(kind, cause = 'manual') {
      const effective = effectiveInstant(clock.now(), driver.view.lastStepMs);
      return driver.take(performStep(driver.view, { kind, instant: effective, cause, reportedTime: reportedTime(effective, 0) }, driver.deps));
    },
    tick() {
      const effective = effectiveInstant(clock.now(), driver.view.lastStepMs);
      const out = runDue(driver.view, effective, reportedTime(effective, 0), driver.deps);
      return out === null ? null : driver.take(out);
    },
  };
  return driver;
}
