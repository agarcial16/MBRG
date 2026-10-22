// NFR-50 real-clock measurement (spec 008, plan section 13; M2b' T3'). NOT part of `npm test` and not run in CI: run it by
// hand, alone, on the reference PC, from apps/server:
//
//   node --import tsx scripts/clock-accuracy.ts
//
// It runs the lifecycle service with the SYSTEM clock and the REAL scheduler (timers), an in-memory database and the dev
// map, timing I = 6, L1 = 2, L2 = 1, until 10 rounds are applied (the dev map has T = 4, so matches are created one after
// the other), and records for every step the delay from its scheduled instant to the moment it was stored and published.
// Target (NFR-50): no step before its instant, none more than 1,000 ms after it (every step stored with cause `clock`).
import { fileURLToPath } from 'node:url';
import type { MatchEvent } from '@mbrg/protocol';
import { systemClock } from '../src/clock';
import { TOLERANCE_MS } from '../src/core/time';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import { createScheduler } from '../src/service/scheduler';
import type { Settings } from '../src/service/settings';
import { installWarningFilter } from '../src/warnings';

installWarningFilter();
const { openStore } = await import('../src/store/sqlite');

const ROUNDS = 10;
const TIMING = { i: 6, l1: 2, l2: 1 } as const;
const OPERATOR = 'clock-accuracy-operator-credential';
const DEV = fileURLToPath(new URL('../../../maps/dev', import.meta.url));

const settings: Settings = { operatorCredential: OPERATOR, maps: { dev: DEV }, runningMatchLimit: 20, databasePath: ':memory:' };
const store = openStore(':memory:');
const scheduler = createScheduler(systemClock);
const service = createMatchService({ store, clock: systemClock, maps: createMapCatalog(settings.maps), settings, scheduler });
service.start();

interface Sample {
  readonly match: number;
  readonly round: number;
  readonly kind: string;
  readonly cause: string;
  /** Performed (stored and published) minus scheduled, in ms. */
  readonly delay: number;
}

const samples: Sample[] = [];
const seen = new Map<string, number>();
let matches = 0;
let applied = 0;
let failed: string | undefined;

/** The instant each step of the pending round is due at, read before the step (the stored anchors). */
const scheduledOf = new Map<string, { c1: number; c2: number; a: number }>();
const remember = (matchId: string): void => {
  const anchors = store.getMatch(matchId)?.match.anchors;
  if (anchors) scheduledOf.set(matchId, { c1: anchors.c1, c2: anchors.c2, a: anchors.a });
};

const create = (): void => {
  matches += 1;
  const out = service.create({ credential: OPERATOR, body: { mapId: 'dev', timing: { ...TIMING }, requestId: `m-${matches}` } });
  if (!out.ok) {
    failed = `creation failed: ${out.error.kind}`;
    return;
  }
  remember(out.reply.matchId);
};

const done = new Promise<void>((resolve) => {
  service.subscribe((matchId: string, events: readonly MatchEvent[]) => {
    const now = systemClock.now();
    const rows = store.steps(matchId);
    const from = seen.get(matchId) ?? 0;
    const due = scheduledOf.get(matchId);
    for (const row of rows.slice(from)) {
      const scheduled = due === undefined ? row.instant : row.kind === 'phase-1-close' ? due.c1 : row.kind === 'phase-2-close' ? due.c2 : due.a;
      samples.push({ match: matches, round: row.round, kind: row.kind, cause: row.cause, delay: now - scheduled });
      if (row.kind === 'application') applied += 1;
    }
    seen.set(matchId, rows.length);
    remember(matchId);
    if (events.some((e) => e.type === 'match-halted')) failed = 'a match halted';
    if (failed !== undefined || applied >= ROUNDS) return resolve();
    if (events.some((e) => e.type === 'match-finished')) create();
  });
});

const started = systemClock.now();
create();
await done;
service.close();
scheduler.close();

const delays = samples.map((s) => s.delay).sort((a, b) => a - b);
const pick = (q: number): number => delays[Math.min(delays.length - 1, Math.floor(q * delays.length))] ?? NaN;
const summary = {
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  timing: TIMING,
  matches,
  rounds: applied,
  steps: samples.length,
  earliestMs: delays[0],
  medianMs: pick(0.5),
  p95Ms: pick(0.95),
  worstMs: delays[delays.length - 1],
  meanMs: Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10,
  early: samples.filter((s) => s.delay < 0).length,
  beyondTolerance: samples.filter((s) => s.delay > TOLERANCE_MS).length,
  notClock: samples.filter((s) => s.cause !== 'clock').length,
  wallSeconds: Math.round((systemClock.now() - started) / 100) / 10,
  failed: failed ?? null,
};
console.log(JSON.stringify(summary, null, 2));
const ok = failed === undefined && summary.early === 0 && summary.beyondTolerance === 0 && summary.notClock === 0 && applied >= ROUNDS;
console.log(ok ? 'NFR-50 real clock: within the tolerance' : 'NFR-50 real clock: OUT of the tolerance');
process.exitCode = ok ? 0 : 1;
