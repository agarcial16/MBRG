import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Store } from '../../src/store/store';
import { openStore } from '../../src/store/sqlite';
import { createMapCatalog } from '../../src/service/maps';
import { createMatchService } from '../../src/service/matches';
import type { MatchService, ServiceOptions, TestSeedSource } from '../../src/service/matches';
import type { Settings } from '../../src/service/settings';
import { fakeClock } from './fake-clock';
import type { FakeClock } from './fake-clock';
import { fakeRandom } from './fake-random';
import { fakeScheduler } from './fake-scheduler';
import type { FakeScheduler } from './fake-scheduler';
import { DEV_DIR } from './digests';

/** The operator credential of the tests: plain text, only ever compared through its digest. */
export const OPERATOR = 'operator-credential-test-0123456789';
export const START_MS = 1_700_000_000_000;
export const CLOCK_TIMING = { i: 120, l1: 30, l2: 10 } as const;

/** The creation body of the tests (dev map, a clock), with a client request id. */
export const creationBody = (requestId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  mapId: 'dev',
  timing: { ...CLOCK_TIMING },
  requestId,
  ...extra,
});

export interface HarnessOptions {
  /** Map id -> package folder; defaults to `{ dev: maps/dev }`. */
  readonly folders?: Readonly<Record<string, string>>;
  readonly limit?: number;
  /** Seed of the fake random source (default 1). */
  readonly seed?: number;
  readonly start?: number;
  readonly testSeedSource?: TestSeedSource;
  /** Use this (already opened) store instead of a fresh in-memory one. */
  readonly store?: Store;
  readonly operator?: string;
  /** The forced-absorber phase span F in seconds (default 5, the setting default). */
  readonly forcedPhaseSeconds?: number;
  /** The match secret of the first creation (the first 32-byte draw); every other draw comes from the fake random source. */
  readonly secret?: Uint8Array;
  /** Build a fake scheduler on the fake clock and give it to the service. */
  readonly scheduler?: boolean;
  /** The service's `onFailure` option (clock steps that failed, with their original cause). */
  readonly onFailure?: ServiceOptions['onFailure'];
}

export interface Draw {
  readonly length: number;
  readonly bytes: Uint8Array;
}

export interface Harness {
  readonly store: Store;
  readonly service: MatchService;
  readonly clock: FakeClock;
  readonly scheduler: FakeScheduler | undefined;
  readonly settings: Settings;
  /** Every call of the random source, in order. */
  readonly draws: Draw[];
  close(): void;
}

/** The service over an in-memory store, the fake clock and a recording fake random source. */
export function serviceHarness(options: HarnessOptions = {}): Harness {
  const folders = options.folders ?? { dev: DEV_DIR.replace(/[\\/]$/, '') };
  const settings: Settings = { operatorCredential: options.operator ?? OPERATOR, maps: folders, runningMatchLimit: options.limit ?? 20, databasePath: ':memory:', forcedPhaseSeconds: options.forcedPhaseSeconds ?? 5 };
  const clock = fakeClock(options.start ?? START_MS);
  const source = fakeRandom(options.seed ?? 1);
  const draws: Draw[] = [];
  const store = options.store ?? openStore(':memory:');
  const scheduler = options.scheduler === true ? fakeScheduler(clock) : undefined;
  let secretUsed = options.secret === undefined;
  const service = createMatchService({
    store,
    clock,
    maps: createMapCatalog(folders),
    settings,
    random: (length) => {
      const bytes = source(length);
      if (!secretUsed && length === 32) {
        secretUsed = true;
        bytes.set(options.secret!);
      }
      draws.push({ length, bytes: Uint8Array.from(bytes) });
      return bytes;
    },
    ...(options.testSeedSource === undefined ? {} : { testSeedSource: options.testSeedSource }),
    ...(scheduler === undefined ? {} : { scheduler }),
    ...(options.onFailure === undefined ? {} : { onFailure: options.onFailure }),
  });
  return { store, service, clock, scheduler, settings, draws, close: () => store.close() };
}

/** Runs `body` with a unique temporary directory, removed afterwards. */
export const withTempDir = <T>(body: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-service-'));
  try {
    return body(dir);
  } finally {
    // Retries: on Windows a file just closed can stay locked for a moment (EBUSY / EPERM).
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

/** A map package folder `dir/<name>` with the given map.json text and the dev map's ids.png and presentation.json. */
export function writeMapPackage(dir: string, name: string, mapJson: string): string {
  const folder = join(dir, name);
  mkdirSync(folder);
  writeFileSync(join(folder, 'map.json'), mapJson);
  for (const file of ['ids.png', 'presentation.json']) copyFileSync(join(DEV_DIR, file), join(folder, file));
  return folder;
}
