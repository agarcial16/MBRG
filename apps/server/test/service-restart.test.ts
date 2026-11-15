import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchEvent, PublicMatch } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { CoreMatch } from '../src/core/view';
import { createMapCatalog } from '../src/service/maps';
import { RETRY_MS, createMatchService } from '../src/service/matches';
import type { MatchService, StartReport } from '../src/service/matches';
import { withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { withRawDb } from './helpers/db-scan';
import { DEV_DIR } from './helpers/digests';
import { SCENARIOS, SECRETS } from './helpers/core-timelines';
import { fakeScheduler } from './helpers/fake-scheduler';
import type { FakeScheduler } from './helpers/fake-scheduler';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody, serviceHarness, withTempDir, writeMapPackage } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';
import { runServiceScenario } from './helpers/service-timelines';

// Restart recovery of the lifecycle service (M2b' T4', FR-294, FR-249 across restarts, FR-315 restart after every step).
// A restart is a new store and a new service on the same database FILE (in a unique temporary directory), then
// `service.start()`: per stored running match the map check (FR-250), then the late rule (FR-248: at most one overdue step,
// late, at the effective instant), then the arming of its next wake-up (FR-239). Everything else comes from the stored
// rows: stage, round, anchors, last step instant, victim fields (rebuilt from the stored victim-revealed event), events
// with their numbers. The reported time a restarted process sends starts from the largest reported time of the stored
// events (plan section 13, M2b' T4'), so it never decreases across a restart either.

const S = 1000;
const C1 = START_MS + 80 * S;
const C2 = START_MS + 110 * S;
const DEV_MAP_JSON = readFileSync(join(DEV_DIR, 'map.json'), 'utf8');

/** Every store a test opened: closed before its temporary directory is removed, also when an assertion failed. */
const openStores: Store[] = [];
const opened = (store: Store): Store => (openStores.push(store), store);
const inTempDir = (body: (dir: string) => void): void =>
  withTempDir((dir) => {
    try {
      body(dir);
    } finally {
      for (const store of openStores.splice(0)) store.close();
    }
  });

interface Server {
  readonly store: Store;
  readonly service: MatchService;
  readonly scheduler: FakeScheduler;
  readonly published: MatchEvent[];
  readonly report: StartReport;
}

/** A server started on the database file: a new store, a new service with a fake scheduler, then `start()`. */
function startServer(h: Harness, file: string): Server {
  const store = opened(openStore(file));
  const scheduler = fakeScheduler(h.clock);
  const service = createMatchService({ store, clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings, scheduler });
  const published: MatchEvent[] = [];
  service.subscribe((_, events) => published.push(...events));
  return { store, service, scheduler, published, report: service.start() };
}

/** The first server of a test: a harness on the database file (no scheduler) with one created clock match. */
function firstServer(file: string, options: { timing?: unknown; folders?: Record<string, string>; mapId?: string } = {}): { h: Harness; id: string } {
  const h = serviceHarness({ store: opened(openStore(file)), secret: SECRETS['ascending-00-1f'], ...(options.folders === undefined ? {} : { folders: options.folders }) });
  const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: options.timing ?? { ...CLOCK_TIMING }, ...(options.mapId === undefined ? {} : { mapId: options.mapId }) }) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return { h, id: out.reply.matchId };
}

const rowsOf = (store: Store, id: string): [number, string, number, string][] => store.steps(id).map((s) => [s.round, s.kind, s.instant, s.cause]);
const viewOf = (store: Store, id: string): CoreMatch => store.getMatch(id)!.match;
const advance = (service: MatchService, id: string, round: number, step: string) => service.advance({ credential: OPERATOR, matchId: id, body: { round, step } });
const reportedTimes = (events: readonly MatchEvent[]): number[] => events.flatMap((e) => ('reportedTime' in e ? [e.reportedTime] : []));
const nonDecreasing = (values: readonly number[]): boolean => values.every((v, i) => i === 0 || v >= values[i - 1]!);

describe('FR-294 restart after every step', () => {
  for (const s of SCENARIOS) {
    it(`FR-294 FR-315 (restart after every step) ${s.name}: with a database file and predictions, a restart after every action and every tick performed by start() give the states, records, events, step rows, predictions and public data of the uninterrupted run`, () => {
      const run = (restarts: 'none' | 'after-every-action' | 'ticks-by-start') =>
        withTempDir((dir) => runServiceScenario(s, { file: join(dir, 'matches.sqlite'), restarts, predict: true }));
      const straight = run('none');
      // Predictions were really stored (and some replaced), so "the same predictions" is not vacuous.
      expect(straight.final.predictions.length, 'stored predictions').toBeGreaterThan(4);
      expect(straight.final.steps).toHaveLength(12);
      for (const restarts of ['after-every-action', 'ticks-by-start'] as const) {
        const got = run(restarts);
        const ticks = s.actions.filter((a) => a.act === 'tick').length;
        expect(got.starts.length, restarts).toBe(restarts === 'after-every-action' ? s.actions.length : ticks);
        expect(got.summaries, restarts).toStrictEqual(straight.summaries);
        expect(got.final, restarts).toStrictEqual(straight.final);
        // Never a stored step again, never one skipped: every step exactly once, in order (3 per round, T = 4).
        expect(got.final.steps.map((r) => [r.round, r.kind]), restarts).toStrictEqual(
          [1, 2, 3, 4].flatMap((k) => ['phase-1-close', 'phase-2-close', 'application'].map((kind) => [k, kind])),
        );
      }
      // A start right after an action finds nothing due: it performs nothing, halts nothing, fails nothing.
      const after = run('after-every-action');
      for (const report of after.starts) expect(report).toMatchObject({ performed: [], halted: [], failed: [] });
    });
  }
});

describe('FR-294 resuming at the stored stage, round and anchors', () => {
  it('FR-294 a restarted match resumes at its stored stage, round and anchors (shifted by a manual advance, not its creation anchors) and arms its next wake-up there', () => {
    inTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const { h, id } = firstServer(file);
      // Round 1: a manual phase-1 close at 10 s shifts C2 to 40 s and A to 50 s (creation anchors: 110 s and 120 s).
      h.clock.set(START_MS + 10 * S);
      expect(advance(h.service, id, 1, 'phase-1-close').ok).toBe(true);
      h.service.close();

      h.clock.set(START_MS + 20 * S);
      const second = startServer(h, file);
      expect(second.report).toMatchObject({ performed: [], halted: [], failed: [] });
      expect(viewOf(second.store, id)).toMatchObject({ stage: 'phase-2', appliedRounds: 0, anchors: { c1: C1, c2: START_MS + 40 * S, a: START_MS + 50 * S } });
      expect(second.scheduler.pending()[0]).toBe(START_MS + 40 * S);
      expect(second.service.publicMatch(id)!.schedule).toStrictEqual({ c1: C1, c2: START_MS + 40 * S, a: START_MS + 50 * S });
      second.scheduler.runTo(START_MS + 40 * S);
      expect(rowsOf(second.store, id)).toStrictEqual([
        [1, 'phase-1-close', START_MS + 10 * S, 'manual'],
        [1, 'phase-2-close', START_MS + 40 * S, 'clock'],
      ]);
      second.service.close();

      // Restarted in locked: the application at the stored A (50 s), then round 2 anchored at it (C1 = 130 s).
      const third = startServer(h, file);
      expect(viewOf(third.store, id).stage).toBe('locked');
      expect(third.scheduler.pending()[0]).toBe(START_MS + 50 * S);
      third.scheduler.runTo(START_MS + 50 * S);
      expect(viewOf(third.store, id)).toMatchObject({ stage: 'phase-1', appliedRounds: 1, anchors: { t0: START_MS + 50 * S, c1: START_MS + 130 * S } });
      expect(third.scheduler.pending()[0]).toBe(START_MS + 130 * S);
      third.service.close();
    });
  });

  it('FR-288 (data) FR-294 a match restarted in phase-2 and in locked serves the same victim fields as before the stop (rebuilt from the stored victim-revealed event)', () => {
    inTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const { h, id } = firstServer(file, { timing: 'manual' });
      h.clock.set(START_MS + 7 * S);
      expect(advance(h.service, id, 1, 'phase-1-close').ok).toBe(true);
      const inPhase2: PublicMatch = h.service.publicMatch(id)!;
      expect(inPhase2.victim).toBeDefined();
      h.service.close();

      const second = startServer(h, file);
      expect(second.service.publicMatch(id)).toStrictEqual(inPhase2);
      h.clock.set(START_MS + 9 * S);
      expect(advance(second.service, id, 1, 'phase-2-close').ok).toBe(true);
      const inLocked = second.service.publicMatch(id)!;
      expect(inLocked.victim).toStrictEqual(inPhase2.victim);
      second.service.close();

      const third = startServer(h, file);
      expect(third.service.publicMatch(id)).toStrictEqual(inLocked);
      third.service.close();
    });
  });

  it('FR-294 the recovery order at start: the map check halts a changed match before any late step, an overdue match performs one late step, and only then is it armed at its shifted anchor', () => {
    inTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const changed = writeMapPackage(dir, 'changed', DEV_MAP_JSON);
      const { h, id } = firstServer(file, { folders: { dev: changed, other: DEV_DIR.replace(/[\\/]$/, '') } });
      const created = h.service.create({ credential: OPERATOR, body: creationBody('c-2', { mapId: 'other' }) });
      if (!created.ok) throw new Error('creation failed');
      const other = created.reply.matchId;
      h.service.close();

      // Down from 0 s to 500 s: both matches are past C1, C2 and A of round 1; the package of `dev` changed meanwhile.
      appendFileSync(join(changed, 'map.json'), '\n');
      const t = START_MS + 500 * S;
      h.clock.set(t);
      const server = startServer(h, file);
      expect(server.report.halted).toStrictEqual([id]);
      expect(viewOf(server.store, id)).toMatchObject({ stage: 'halted', haltReason: 'map-changed' });
      expect(rowsOf(server.store, id)).toStrictEqual([]);
      expect(server.store.eventsAfter(id, 1).map((e) => e.type)).toStrictEqual(['match-halted']);
      expect(server.report.performed).toStrictEqual([{ matchId: other, steps: [{ round: 1, kind: 'phase-1-close', instant: t, cause: 'late' }] }]);
      expect(rowsOf(server.store, other)).toStrictEqual([[1, 'phase-1-close', t, 'late']]);
      // Armed after the late step, at the shifted C2; nothing for the halted match. The fake-random secret of the second match forces its
      // round 1 (spec 011 FR-388), so phase 2 lasts F = 5 s instead of L1.
      expect(server.scheduler.pending()).toStrictEqual([t + 5 * S, START_MS + 24 * 3_600 * S + 1]);
      expect(server.published.map((e) => e.type)).toStrictEqual(['match-halted', 'phase-closed', 'victim-revealed', 'results', 'schedule']);
      server.service.close();
    });
  });
});

describe('FR-294 FR-292 (retry) a start whose enumeration of the running matches fails', () => {
  /** A server started on the file through a store wrapper (the fault seam, or a planted programming error). */
  function startWrapped(h: Harness, file: string, wrap: (store: Store) => Store): Server {
    const store = wrap(opened(openStore(file)));
    const scheduler = fakeScheduler(h.clock);
    const service = createMatchService({ store, clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings, scheduler });
    const published: MatchEvent[] = [];
    service.subscribe((_, events) => published.push(...events));
    return { store, service, scheduler, published, report: service.start() };
  }

  it('FR-294 FR-292 (retry) a storage failure of the enumeration at start arms one retry of the whole start check 3 s later, repeated until it succeeds; then the map check halts a changed match, an overdue match performs one late step and is armed', () => {
    inTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const changed = writeMapPackage(dir, 'changed', DEV_MAP_JSON);
      const { h, id } = firstServer(file, { folders: { dev: changed, other: DEV_DIR.replace(/[\\/]$/, '') } });
      const created = h.service.create({ credential: OPERATOR, body: creationBody('c-2', { mapId: 'other' }) });
      if (!created.ok) throw new Error('creation failed');
      const other = created.reply.matchId;
      h.service.close();

      appendFileSync(join(changed, 'map.json'), '\n');
      const t = START_MS + 500 * S;
      h.clock.set(t);
      // The first two enumerations fail (a transient lock): the start check is retried at t + 3 s and t + 6 s.
      const server = startWrapped(h, file, (store) => withFaults(store, { failRunningIds: [1, 2] }));
      expect(server.report).toStrictEqual({ purged: 0, performed: [], failed: [], halted: [], retry: { kind: 'unavailable', at: t + RETRY_MS } });
      // Nothing was checked, stepped or armed: only the retry of the start check.
      expect(server.scheduler.pending()).toStrictEqual([t + RETRY_MS]);
      expect(viewOf(server.store, id).stage).toBe('phase-1');
      expect(rowsOf(server.store, other)).toStrictEqual([]);
      expect(server.published).toStrictEqual([]);

      expect(server.scheduler.runTo(t + RETRY_MS)).toBe(1);
      expect(server.scheduler.pending()).toStrictEqual([t + 2 * RETRY_MS]);
      expect(server.published).toStrictEqual([]);

      const at = t + 2 * RETRY_MS;
      server.scheduler.runTo(at);
      expect(viewOf(server.store, id)).toMatchObject({ stage: 'halted', haltReason: 'map-changed' });
      expect(rowsOf(server.store, id)).toStrictEqual([]);
      expect(rowsOf(server.store, other)).toStrictEqual([[1, 'phase-1-close', at, 'late']]);
      expect(server.scheduler.pending()).toStrictEqual([at + 5 * S, START_MS + 24 * 3_600 * S + 1]);
      expect(server.published.map((e) => e.type)).toStrictEqual(['match-halted', 'phase-closed', 'victim-revealed', 'results', 'schedule']);
      server.service.close();
    });
  });

  it('FR-294 FR-292 (retry) close() cancels a pending retry of the start check', () => {
    inTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const { h } = firstServer(file);
      h.service.close();
      const server = startWrapped(h, file, (store) => withFaults(store, { failRunningIds: [1] }));
      expect(server.scheduler.pending()).toStrictEqual([START_MS + RETRY_MS]);
      server.service.close();
      expect(server.scheduler.pending()).toStrictEqual([]);
    });
  });

  it('FR-294 FR-292 (retry) a programming error of the enumeration at start is not a storage failure: start() rethrows it and arms no retry', () => {
    inTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const { h } = firstServer(file);
      h.service.close();
      const planted = new TypeError('planted programming error');
      const store = opened(openStore(file));
      const scheduler = fakeScheduler(h.clock);
      const broken: Store = { ...withFaults(store, {}), runningMatchIds: () => { throw planted; } };
      const service = createMatchService({ store: broken, clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings, scheduler });
      expect(() => service.start()).toThrow(planted);
      expect(scheduler.pending()).toStrictEqual([]);
      service.close();
    });
  });
});

describe('FR-294 events across a restart', () => {
  it('FR-294 events stored before a stop and never sent are read back after a restart with their original numbers, and the next decision continues the numbering', () => {
    inTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const { h, id } = firstServer(file, { timing: 'manual' });
      h.clock.set(START_MS + 3 * S);
      expect(advance(h.service, id, 1, 'phase-1-close').ok).toBe(true);
      expect(advance(h.service, id, 1, 'phase-2-close').ok).toBe(true);
      // No subscriber ever saw these events: the server stopped before sending them.
      const before = h.store.eventsAfter(id, 0);
      expect(before.map((e) => e.seq)).toStrictEqual(before.map((_, i) => i + 1));
      h.service.close();

      const server = startServer(h, file);
      expect(server.store.eventsAfter(id, 0)).toStrictEqual(before);
      expect(server.store.eventsAfter(id, 2).map((e) => e.seq)).toStrictEqual(before.slice(2).map((e) => e.seq));
      expect(server.service.publicMatch(id)!.lastSeq).toBe(before.length);
      h.clock.set(START_MS + 4 * S);
      expect(advance(server.service, id, 1, 'application').ok).toBe(true);
      expect(server.published[0]!.seq).toBe(before.length + 1);
      expect(server.published.map((e) => e.seq)).toStrictEqual(server.published.map((_, i) => before.length + 1 + i));
      expect(server.store.eventsAfter(id, 0).map((e) => e.seq)).toStrictEqual(Array.from({ length: before.length + server.published.length }, (_, i) => i + 1));
      server.service.close();
    });
  });
});

describe('FR-249 (across restarts) time across a restart', () => {
  it('FR-249 (across restarts) after a restart with the clock set back, step instants never decrease, the effective instant is the stored last step instant, and the reported time never falls below the reported times of the stored events', () => {
    inTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const { h, id } = firstServer(file);
      // An on-time phase-1 close performed 700 ms after C1: stored at C1, its events report C1 + 700.
      h.clock.set(C1 + 700);
      expect(h.service.tick().performed).toHaveLength(1);
      expect(rowsOf(h.store, id)).toStrictEqual([[1, 'phase-1-close', C1, 'clock']]);
      const sent = Math.max(...reportedTimes(h.store.eventsAfter(id, 0)));
      expect(sent).toBe(C1 + 700);
      h.service.close();

      // The server restarts with the clock one hour behind.
      h.clock.set(C1 - 3_600 * S);
      const server = startServer(h, file);
      expect(server.report).toMatchObject({ performed: [], halted: [], failed: [] });
      expect(server.scheduler.pending()[0]).toBe(C2);
      expect(server.service.publicMatch(id)!.reportedTime).toBe(C1 + 700);
      // A manual step now is stored at the last step instant (C1), never at the earlier clock reading.
      const out = advance(server.service, id, 1, 'phase-2-close');
      expect(out.ok && out.reply.step).toStrictEqual({ round: 1, kind: 'phase-2-close', instant: C1, cause: 'manual' });
      expect(out.ok && out.reply.match.reportedTime).toBe(C1 + 700);
      const events = server.store.eventsAfter(id, 0);
      expect(nonDecreasing(reportedTimes(events))).toBe(true);
      expect(Math.min(...reportedTimes(server.published))).toBeGreaterThanOrEqual(sent);
      expect(nonDecreasing(server.store.steps(id).map((r) => r.instant))).toBe(true);
      expect(viewOf(server.store, id).lastStepMs).toBe(C1);
      server.service.close();

      // A second restart, still behind: the reported time stays at the largest stored one.
      const again = startServer(h, file);
      expect(again.service.publicMatch(id)!.reportedTime).toBe(Math.max(...reportedTimes(again.store.eventsAfter(id, 0))));
      expect(again.service.publicMatch(id)!.reportedTime).toBeGreaterThanOrEqual(C1 + 700);
      again.service.close();
    });
  });
});

describe('FR-294 (robustness) inconsistent stored anchors', () => {
  it('FR-294 (robustness) a running clock match with a NULL anchor column (corruption only) neither throws at start nor blocks the other stored matches: it is read with no anchors, performs no step and is not armed', () => {
    inTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const { h, id } = firstServer(file);
      const created = h.service.create({ credential: OPERATOR, body: creationBody('c-2') });
      if (!created.ok) throw new Error('creation failed');
      const other = created.reply.matchId;
      h.service.close();
      withRawDb(file, (db) => db.prepare('UPDATE matches SET c2_ms = NULL WHERE id = ?').run(id));

      h.clock.set(C1);
      const server = startServer(h, file);
      expect(server.report.failed).toStrictEqual([]);
      expect(server.report.performed).toStrictEqual([{ matchId: other, steps: [{ round: 1, kind: 'phase-1-close', instant: C1, cause: 'clock' }] }]);
      expect(viewOf(server.store, id)).toMatchObject({ stage: 'phase-1', anchors: null });
      expect(rowsOf(server.store, id)).toStrictEqual([]);
      // The second match (fake-random secret) has a forced round 1: its phase 2 lasts F = 5 s (spec 011 FR-388).
      expect(server.scheduler.pending()).toStrictEqual([C1 + 5 * S, START_MS + 24 * 3_600 * S + 1]);
      server.scheduler.runTo(C1 + 5 * S);
      expect(rowsOf(server.store, id)).toStrictEqual([]);
      expect(rowsOf(server.store, other)).toHaveLength(2);
      server.service.close();
    });
  });
});
