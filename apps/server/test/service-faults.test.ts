import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorReply } from '@mbrg/protocol';
import type { MatchEvent, StepKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { CoreMatch } from '../src/core/view';
import { credentialDigest } from '../src/service/ids';
import { RETRY_MS, isStorageFailure } from '../src/service/matches';
import type { AdvanceOutcome, SubmitOutcome } from '../src/service/matches';
import { InjectedFault, withFaults } from '../src/store/faults';
import type { FaultPlan } from '../src/store/faults';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import { openStore } from '../src/store/sqlite';
import { SECRETS } from './helpers/core-timelines';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Storage failures through the lifecycle service (M2b' T3'): FR-292 (unavailable): a command whose storage transaction
// fails replies `unavailable`, reports nothing as accepted or performed and leaves the database as it was (the rollback
// also undoes a partial write); FR-292 (retry): a failed clock step is retried 3 s later and then follows the late rule of
// FR-248 when it is overdue. Failures are injected through the fault seam (`store/faults.ts`); programming errors (a
// RangeError, a refused write) are not storage failures and are never answered `unavailable`. One failing match never
// stops the others (isolation in `tick()` and in the timer callbacks). Fake clock and scheduler, in-memory SQLite.

const S = 1000;
const C1 = START_MS + 80 * S;
const C2 = START_MS + 110 * S;
const UNAVAILABLE = { ok: false, error: errorReply('unavailable') };
const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' };
const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const OPEN_STORE = fileURLToPath(new URL('./fixtures/open-store.ts', import.meta.url));

interface Started {
  readonly h: Harness;
  readonly id: string;
  readonly published: MatchEvent[];
}

/** A service over an in-memory store wrapped by the fault seam; the creation is transaction 1. */
function start(plan: FaultPlan, options: { timing?: unknown; scheduler?: boolean; store?: Store } = {}): Started {
  const store = withFaults(options.store ?? openStore(':memory:'), plan);
  const h = serviceHarness({ store, secret: SECRETS['ascending-00-1f'], scheduler: options.scheduler ?? false });
  const published: MatchEvent[] = [];
  h.service.subscribe((_, events) => published.push(...events));
  const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: options.timing ?? { ...CLOCK_TIMING } }) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return { h, id: out.reply.matchId, published };
}

const view = (m: Started): CoreMatch => m.h.store.getMatch(m.id)!.match;
const rows = (m: Started, id: string = m.id): [number, string, number, string][] => m.h.store.steps(id).map((s) => [s.round, s.kind, s.instant, s.cause]);
const living = (m: Started): number[] => [...new Set(view(m).state.owners.map(([, f]) => f))].sort((a, b) => a - b);
const submit = (m: Started, body: Record<string, unknown>): SubmitOutcome => m.h.service.submit({ client: WEB, matchId: m.id, body });
const advance = (m: Started, round: number, step: StepKind, extra: Record<string, unknown> = {}): AdvanceOutcome =>
  m.h.service.advance({ credential: OPERATOR, matchId: m.id, body: { round, step, ...extra } });
const submissionScope = (m: Started) => ({ credentialDigest: credentialDigest(WEB.credential), match: m.id });

describe('FR-292 (unavailable) storage failures of commands', () => {
  it('FR-292 (unavailable) a submission whose transaction fails replies unavailable, stores and memoises nothing, and the same request id is accepted afterwards', () => {
    const m = start({ failTransaction: 2 });
    const [a] = living(m);
    const body = { kind: 'victim', round: 1, faction: a, playerId: 'p1', requestId: 'r-1' };
    expect(submit(m, body)).toStrictEqual(UNAVAILABLE);
    expect(m.h.store.predictionsOf(m.id, 'web:p1')).toStrictEqual([]);
    expect(m.h.store.memoGet(submissionScope(m), 'r-1')).toBeUndefined();
    const again = submit(m, body);
    expect(again).toStrictEqual({ ok: true, reply: { kind: 'victim', round: 1, choice: a, version: 1 } });
    m.h.close();
  });

  it('FR-292 (unavailable) a submission whose memo write fails after the prediction write replies unavailable, and the partial write is rolled back', () => {
    // Transaction 2 is the submission: its first write (the prediction) runs, its second (the memo) fails.
    const m = start({ failWrite: { transaction: 2, afterWrites: 1 } });
    const [a] = living(m);
    expect(submit(m, { kind: 'victim', round: 1, faction: a, playerId: 'p1', requestId: 'r-1' })).toStrictEqual(UNAVAILABLE);
    expect(m.h.store.predictionsOf(m.id, 'web:p1')).toStrictEqual([]);
    expect(m.h.store.memoGet(submissionScope(m), 'r-1')).toBeUndefined();
    m.h.close();
  });

  it('FR-292 (unavailable) an advance whose event write fails after the match and step writes replies unavailable, performs and publishes nothing, and keeps the wake-up', () => {
    const m = start({ failWrite: { transaction: 2, afterWrites: 2 } }, { scheduler: true });
    const events = m.h.store.eventsAfter(m.id, 0);
    const before = view(m);
    m.h.clock.set(START_MS + 5 * S);
    expect(advance(m, 1, 'phase-1-close')).toStrictEqual(UNAVAILABLE);
    expect(rows(m)).toStrictEqual([]);
    expect(m.h.store.eventsAfter(m.id, 0)).toStrictEqual(events);
    expect(view(m)).toStrictEqual(before);
    expect(m.published.map((e) => e.type)).toStrictEqual(['schedule']);
    expect(m.h.scheduler!.pending()).toStrictEqual([C1]);
    // Nothing was reported as performed, so the same advance performs the step now.
    const out = advance(m, 1, 'phase-1-close');
    expect(out.ok && out.reply.result).toBe('performed');
    expect(rows(m)).toStrictEqual([[1, 'phase-1-close', START_MS + 5 * S, 'manual']]);
    m.h.close();
  });

  it('FR-292 (unavailable) a creation whose transaction fails replies unavailable and creates no match; the same request id creates it afterwards', () => {
    const store = withFaults(openStore(':memory:'), { failTransaction: 1 });
    const h = serviceHarness({ store });
    expect(h.service.create({ credential: OPERATOR, body: creationBody('c-1') })).toStrictEqual(UNAVAILABLE);
    expect(h.store.runningCount()).toBe(0);
    const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1') });
    expect(out.ok).toBe(true);
    expect(h.store.runningCount()).toBe(1);
    h.close();
  });

  it('FR-292 (unavailable) once an abort has closed the connection, every command replies unavailable instead of throwing', () => {
    const m = start({ abortTransaction: 2 });
    const [a] = living(m);
    expect(submit(m, { kind: 'victim', round: 1, faction: a, playerId: 'p1' })).toStrictEqual(UNAVAILABLE);
    expect(advance(m, 1, 'phase-1-close')).toStrictEqual(UNAVAILABLE);
    expect(m.h.service.create({ credential: OPERATOR, body: creationBody('c-2') })).toStrictEqual(UNAVAILABLE);
    expect(m.h.service.ownPredictions({ namespace: 'web', playerId: 'p1', matchId: m.id })).toStrictEqual(UNAVAILABLE);
    const report = m.h.service.tick();
    expect(report.performed).toStrictEqual([]);
    m.h.close();
  });

  it('FR-292 (unavailable) only storage failures are unavailable: a RangeError, a TypeError, a refused write or a schema error is a programming error', () => {
    expect(isStorageFailure(new StoreError('store-failure', 'x'))).toBe(true);
    expect(isStorageFailure(new StoreError('database-locked', 'x'))).toBe(true);
    expect(isStorageFailure(new InjectedFault('fail', 3))).toBe(true);
    expect(isStorageFailure(new InjectedFault('write', 3))).toBe(true);
    expect(isStorageFailure(new StoreError('invalid-write', 'x'))).toBe(false);
    expect(isStorageFailure(new StoreError('unknown-schema-version', 'x'))).toBe(false);
    expect(isStorageFailure(new RangeError('inconsistent stored data'))).toBe(false);
    expect(isStorageFailure(new TypeError('x'))).toBe(false);
    expect(isStorageFailure(new Error('boom'))).toBe(false);
    expect(isStorageFailure('store-failure')).toBe(false);
    // The SQLite adapter turns an error of the closed connection into a storage failure, in a transaction and in a read.
    const store = openStore(':memory:');
    store.close();
    const codeOf = (action: () => unknown): string => {
      try {
        action();
      } catch (error) {
        return error instanceof StoreError ? error.code : 'other';
      }
      return 'no error';
    };
    expect(codeOf(() => store.transaction(() => 1))).toBe('store-failure');
    expect(codeOf(() => store.getMatch('x'))).toBe('store-failure');
  });

  it('FR-292 (unavailable) a programming error inside a command is rethrown and rolls back, never replied as unavailable', () => {
    const base = openStore(':memory:');
    let failing = false;
    const store: Store = {
      ...base,
      appendEvents(matchId, events) {
        if (failing) throw new RangeError('inconsistent stored data: planted');
        base.appendEvents(matchId, events);
      },
    };
    const m = start({}, { store, timing: 'manual' });
    failing = true;
    expect(() => advance(m, 1, 'phase-1-close')).toThrow(RangeError);
    expect(rows(m)).toStrictEqual([]);
    m.h.close();
  });
});

describe('FR-292 (retry) a failed clock step', () => {
  it('FR-292 (retry) FR-248 (retry) a clock step whose transaction fails is retried 3 s later and, overdue then, is performed late with shifted anchors', () => {
    expect(RETRY_MS).toBe(3000);
    // Transaction 2 is the step of the C1 wake-up.
    const m = start({ failTransaction: 2 }, { scheduler: true });
    const s = m.h.scheduler!;
    s.runTo(C1);
    expect(rows(m)).toStrictEqual([]);
    expect(m.published.map((e) => e.type)).toStrictEqual(['schedule']);
    expect(view(m).stage).toBe('phase-1');
    expect(s.pending()).toStrictEqual([C1 + 3 * S]);
    s.runTo(C1 + 3 * S);
    const t = C1 + 3 * S;
    expect(rows(m)).toStrictEqual([[1, 'phase-1-close', t, 'late']]);
    expect(view(m).anchors).toMatchObject({ c1: C1, c2: t + 30 * S, a: t + 40 * S });
    expect(s.pending()).toStrictEqual([t + 30 * S]);
    m.h.close();
  });

  it('FR-292 (retry) a retry that fails again is armed 3 s after that failure, and so on until the step is stored', () => {
    const m = start({ failTransaction: [2, 3] }, { scheduler: true });
    const s = m.h.scheduler!;
    s.runTo(C1);
    expect(s.pending()).toStrictEqual([C1 + 3 * S]);
    s.runTo(C1 + 3 * S);
    expect(rows(m)).toStrictEqual([]);
    expect(s.pending()).toStrictEqual([C1 + 6 * S]);
    s.runTo(C1 + 6 * S);
    expect(rows(m)).toStrictEqual([[1, 'phase-1-close', C1 + 6 * S, 'late']]);
    m.h.close();
  });

  it('FR-292 (retry) FR-248 (retry) a retry that runs within the tolerance of the scheduled instant is on time: stored at its scheduled instant with cause clock, anchors kept', () => {
    const m = start({ failTransaction: 2 }, { scheduler: true });
    const s = m.h.scheduler!;
    s.runTo(C1);
    expect(s.pending()).toStrictEqual([C1 + 3 * S]);
    // The retry wake-up fires early (a timer that fires early), 800 ms after the scheduled instant.
    m.h.clock.set(C1 + 800);
    expect(s.fireAll()).toBe(1);
    expect(rows(m)).toStrictEqual([[1, 'phase-1-close', C1, 'clock']]);
    expect(view(m).anchors).toMatchObject({ c1: C1, c2: C2 });
    expect(s.pending()).toStrictEqual([C2]);
    m.h.close();
  });

  it('FR-292 (retry) tick() reports a failed step as unavailable, performs and publishes nothing for it, and arms its retry in place of the earlier wake-up', () => {
    // Transaction 2 is the purge of the tick, 3 its step.
    const m = start({ failTransaction: 3 }, { scheduler: true });
    m.h.clock.set(C1);
    const report = m.h.service.tick();
    expect(report.performed).toStrictEqual([]);
    expect(report.failed).toStrictEqual([{ matchId: m.id, kind: 'unavailable' }]);
    expect(m.published.map((e) => e.type)).toStrictEqual(['schedule']);
    expect(m.h.scheduler!.pending()).toStrictEqual([C1 + 3 * S]);
    m.h.close();
  });
});

/** A store whose `getMatch` throws for one match while `failing` holds (a corrupt row or a programming error). */
function brokenFor(base: Store, error: () => Error): { store: Store; breakMatch: (id: string | undefined) => void } {
  let broken: string | undefined;
  return {
    store: {
      ...base,
      getMatch(matchId) {
        if (matchId === broken) throw error();
        return base.getMatch(matchId);
      },
    },
    breakMatch: (id) => (broken = id),
  };
}

describe('isolation between matches', () => {
  for (const [label, error, kind] of [
    ['a RangeError', () => new RangeError('inconsistent stored data: planted'), 'error'],
    ['a store failure', () => new StoreError('store-failure', 'the stored data is inconsistent: planted'), 'unavailable'],
  ] as const) {
    it(`FR-239 (timer) a match whose stored data throws ${label} does not stop tick() for the others: they step, it is reported and re-armed`, () => {
      const b = brokenFor(openStore(':memory:'), error);
      const m = start({}, { store: b.store, scheduler: true });
      const second = m.h.service.create({ credential: OPERATOR, body: creationBody('c-2') });
      if (!second.ok) throw new Error('creation failed');
      b.breakMatch(m.id);
      m.h.clock.set(C1);
      const report = m.h.service.tick();
      expect(report.failed).toStrictEqual([{ matchId: m.id, kind }]);
      expect(report.performed.map((p) => [p.matchId, p.steps.map((s) => s.kind)])).toStrictEqual([[second.reply.matchId, ['phase-1-close']]]);
      expect(m.h.scheduler!.pending()).toStrictEqual([C1 + 3 * S, C2]);
      b.breakMatch(undefined);
      m.h.close();
    });
  }

  it('FR-239 (timer) a timer callback that throws is caught, the match is re-armed 3 s later, and the other matches still step', () => {
    const b = brokenFor(openStore(':memory:'), () => new RangeError('inconsistent stored data: planted'));
    const m = start({}, { store: b.store, scheduler: true });
    const second = m.h.service.create({ credential: OPERATOR, body: creationBody('c-2') });
    if (!second.ok) throw new Error('creation failed');
    b.breakMatch(m.id);
    const s = m.h.scheduler!;
    expect(() => s.runTo(C1)).not.toThrow();
    expect(rows(m, second.reply.matchId)).toStrictEqual([[1, 'phase-1-close', C1, 'clock']]);
    expect(s.pending()).toStrictEqual([C1 + 3 * S, C2]);
    b.breakMatch(undefined);
    s.runTo(C1 + 3 * S);
    expect(rows(m)).toStrictEqual([[1, 'phase-1-close', C1 + 3 * S, 'late']]);
    m.h.close();
  });
});

describe('arming and publication', () => {
  it('FR-239 (timer) the next wake-up is armed before the events are published: a subscriber that advances inside its callback leaves only its own wake-up', () => {
    const m = start({}, { scheduler: true });
    let advanced = false;
    m.h.service.subscribe((_, events) => {
      if (advanced || !events.some((e) => e.type === 'victim-revealed')) return;
      advanced = true;
      const out = advance(m, 1, 'phase-2-close');
      if (!out.ok) throw new Error('advance refused');
    });
    m.h.scheduler!.runTo(C1);
    expect(rows(m)).toStrictEqual([
      [1, 'phase-1-close', C1, 'clock'],
      [1, 'phase-2-close', C1, 'manual'],
    ]);
    // After the manual phase-2 close at C1, A = C1 + L2; no stale wake-up at C2 is left.
    expect(m.h.scheduler!.pending()).toStrictEqual([C1 + 10 * S]);
    m.h.close();
  });
});

describe('the lock across processes', () => {
  it('FR-291 (child process) a second process cannot open a database file held by a running store, and can once it is closed', () => {
    withTempDir((dir) => {
      const file = join(dir, 'held.sqlite');
      const run = (): string => {
        const r = spawnSync(process.execPath, ['--import', 'tsx', OPEN_STORE, file], { cwd: SERVER_DIR, encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL' });
        if (r.error) throw r.error;
        return r.stdout.trim();
      };
      const held = openStore(file);
      try {
        expect(run()).toBe('database-locked');
        // The refused child did not disturb the holder.
        expect(held.transaction(() => 7)).toBe(7);
      } finally {
        held.close();
      }
      expect(run()).toBe('opened');
    });
  }, 30_000);
});
