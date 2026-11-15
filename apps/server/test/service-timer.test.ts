import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchEvent } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { MEMO_RETENTION_MS } from '../src/core/memo';
import type { CoreMatch } from '../src/core/view';
import { credentialDigest } from '../src/service/ids';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import type { MatchService } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import { SECRETS } from './helpers/core-timelines';
import { DEV_DIR } from './helpers/digests';
import { fakeScheduler } from './helpers/fake-scheduler';
import type { FakeScheduler } from './helpers/fake-scheduler';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody, serviceHarness, withTempDir, writeMapPackage } from './helpers/service-harness';
import type { Harness, HarnessOptions } from './helpers/service-harness';

// The timer loop of the lifecycle service (M2b' T3'): `start()` checks the map of every stored running match (FR-250)
// and halts the ones whose package changed, performs at most one overdue step per match as a late step at the effective
// instant (FR-248 start-up detection), arms the scheduler for every running match (FR-239 timer) and arms the memo purge
// at the retention boundary (FR-238 purge timer); `close()` cancels every wake-up and closes the store. The scheduler is
// the fake one, driven by the fake clock; a second service over the same store stands for a server started on stored
// matches (the restart with a file database and its recovery checks are T4').

const S = 1000;
const C1 = START_MS + 80 * S;
const C2 = START_MS + 110 * S;
const A = START_MS + 120 * S;
const PURGE_AT = START_MS + MEMO_RETENTION_MS + 1;
const DEV_MAP_JSON = readFileSync(join(DEV_DIR, 'map.json'), 'utf8');

interface Booted {
  readonly service: MatchService;
  readonly scheduler: FakeScheduler;
  readonly published: MatchEvent[];
}

/** A second service over the store and clock of `h`, with its own fake scheduler, as a started server would build it. */
function boot(h: Harness): Booted {
  const scheduler = fakeScheduler(h.clock);
  const service = createMatchService({ store: h.store, clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings, scheduler });
  const published: MatchEvent[] = [];
  service.subscribe((_, events) => published.push(...events));
  return { service, scheduler, published };
}

/** A harness with no scheduler (the "earlier process") and one created match. */
function created(options: HarnessOptions & { timing?: unknown; requestId?: string } = {}): { h: Harness; id: string } {
  const h = serviceHarness({ secret: SECRETS['ascending-00-1f'], ...options });
  const out = h.service.create({ credential: OPERATOR, body: creationBody(options.requestId ?? 'c-1', { timing: options.timing ?? { ...CLOCK_TIMING } }) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return { h, id: out.reply.matchId };
}

const createIn = (h: Harness, requestId: string, extra: Record<string, unknown> = {}): string => {
  const out = h.service.create({ credential: OPERATOR, body: creationBody(requestId, extra) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return out.reply.matchId;
};
const rows = (h: Harness, id: string): [number, string, number, string][] => h.store.steps(id).map((s) => [s.round, s.kind, s.instant, s.cause]);
const view = (h: Harness, id: string): CoreMatch => h.store.getMatch(id)!.match;

describe('start() arms the stored matches', () => {
  it('FR-239 (timer) start() arms every stored running clock match at its next instant and the memo purge, and nothing for a manual match', () => {
    const { h, id } = created();
    h.clock.set(START_MS + 5 * S);
    const second = createIn(h, 'c-2');
    const manual = createIn(h, 'c-3', { timing: 'manual' });
    const b = boot(h);
    expect(b.scheduler.pending()).toStrictEqual([]);
    const report = b.service.start();
    expect(report.performed).toStrictEqual([]);
    expect(report.halted).toStrictEqual([]);
    expect(report.failed).toStrictEqual([]);
    expect(b.scheduler.pending()).toStrictEqual([C1, C1 + 5 * S, PURGE_AT]);
    // The wake-ups alone run both clock matches; the manual one never steps.
    b.scheduler.runTo(C1 + 5 * S);
    expect(rows(h, id)).toStrictEqual([[1, 'phase-1-close', C1, 'clock']]);
    expect(rows(h, second)).toStrictEqual([[1, 'phase-1-close', C1 + 5 * S, 'clock']]);
    expect(rows(h, manual)).toStrictEqual([]);
    b.service.close();
  });

  it('FR-239 (timer) a finished match is not armed at start (a halted one: see the map check of start())', () => {
    const { h, id } = created({ timing: 'manual' });
    const op = (round: number, step: string) => h.service.advance({ credential: OPERATOR, matchId: id, body: { round, step } });
    for (let k = 1; k <= 4; k++) for (const step of ['phase-1-close', 'phase-2-close', 'application']) expect(op(k, step).ok).toBe(true);
    expect(view(h, id).stage).toBe('finished');
    const b = boot(h);
    b.service.start();
    // Only the purge of the creation memo is armed.
    expect(b.scheduler.pending()).toStrictEqual([PURGE_AT]);
    b.service.close();
  });

  it('FR-239 (timer) close() cancels every wake-up and closes the store', () => {
    const { h } = created();
    const b = boot(h);
    b.service.start();
    expect(b.scheduler.pending()).toHaveLength(2);
    b.service.close();
    expect(b.scheduler.pending()).toStrictEqual([]);
    expect(() => h.store.getMatch('x')).toThrow();
  });
});

describe('FR-248 (start-up) overdue steps at start', () => {
  it('FR-248 (start-up) FR-244 (start-up) after a downtime that passed several steps, start() performs one late step per match at the effective instant and shifts the anchors', () => {
    const { h, id } = created();
    const t = START_MS + 500 * S; // past C1, C2 and A of round 1, and later rounds' instants
    h.clock.set(t);
    const b = boot(h);
    const report = b.service.start();
    expect(report.performed.map((p) => [p.matchId, p.steps.map((s) => [s.kind, s.instant, s.cause])])).toStrictEqual([[id, [['phase-1-close', t, 'late']]]]);
    expect(rows(h, id)).toStrictEqual([[1, 'phase-1-close', t, 'late']]);
    expect(view(h, id).anchors).toMatchObject({ c1: C1, c2: t + 30 * S, a: t + 40 * S });
    expect(b.published.filter((e) => e.type === 'victim-revealed')).toHaveLength(1);
    expect(b.scheduler.pending()).toStrictEqual([t + 30 * S, PURGE_AT]);
    // From there the round goes on on time: a full phase 2 and the locked wait are kept.
    b.scheduler.runTo(t + 40 * S);
    expect(rows(h, id)).toStrictEqual([
      [1, 'phase-1-close', t, 'late'],
      [1, 'phase-2-close', t + 30 * S, 'clock'],
      [1, 'application', t + 40 * S, 'clock'],
    ]);
    b.service.close();
  });

  it('FR-248 (start-up) a start within the tolerance of the next instant performs the step on time, and a start before it performs nothing', () => {
    const early = created();
    early.h.clock.set(C1 - 1);
    const e = boot(early.h);
    expect(e.service.start().performed).toStrictEqual([]);
    expect(e.scheduler.pending()).toStrictEqual([C1, PURGE_AT]);
    e.service.close();

    const onTime = created();
    onTime.h.clock.set(C1 + 700);
    const o = boot(onTime.h);
    o.service.start();
    expect(rows(onTime.h, onTime.id)).toStrictEqual([[1, 'phase-1-close', C1, 'clock']]);
    expect(o.scheduler.pending()).toStrictEqual([C2, PURGE_AT]);
    o.service.close();
  });
});

describe('FR-250 (at start) the map check of start()', () => {
  it('FR-250 (at start) start() halts a running match whose package changed with map-changed, stored and published, although no step is due, and arms the others', () => {
    withTempDir((dir) => {
      const changed = writeMapPackage(dir, 'changed', DEV_MAP_JSON);
      const kept = writeMapPackage(dir, 'kept', DEV_MAP_JSON);
      const { h, id } = created({ folders: { dev: changed, other: kept } });
      const other = createIn(h, 'c-2', { mapId: 'other' });
      // The package listed under `dev` now has another digest (map.json still validates).
      appendFileSync(join(changed, 'map.json'), '\n');
      h.clock.set(START_MS + 5 * S);
      const b = boot(h);
      const report = b.service.start();
      expect(report.halted).toStrictEqual([id]);
      expect(report.performed).toStrictEqual([]);
      expect(view(h, id)).toMatchObject({ stage: 'halted', haltReason: 'map-changed', anchors: null });
      expect(rows(h, id)).toStrictEqual([]);
      expect(b.published).toStrictEqual([{ type: 'match-halted', seq: 2, round: 1, reason: 'map-changed', reportedTime: START_MS + 5 * S }]);
      expect(h.store.eventsAfter(id, 1)).toStrictEqual(b.published);
      expect(view(h, other).stage).toBe('phase-1');
      expect(b.scheduler.pending()).toStrictEqual([C1, PURGE_AT]);
      b.service.close();
    });
  });
});

describe('FR-238 (purge timer) the memo purge from a timer', () => {
  it('FR-238 (purge timer) the purge runs from a timer at the retention boundary without a tick, and is re-armed for the next oldest entry', () => {
    const { h, id } = created({ timing: 'manual' });
    const b = boot(h);
    b.service.start();
    h.clock.set(START_MS + 7 * S);
    const living = [...new Set(view(h, id).state.owners.map(([, f]) => f))];
    const out = b.service.submit({ client: { credential: 'client-credential-web-0123456789ab', namespace: 'web' }, matchId: id, body: { kind: 'victim', round: 1, faction: living[0], playerId: 'p1', requestId: 'r-1' } });
    expect(out.ok).toBe(true);
    const creation = { credentialDigest: credentialDigest(OPERATOR), match: null };
    const submission = { credentialDigest: credentialDigest('client-credential-web-0123456789ab'), match: id };
    expect(b.scheduler.pending()).toStrictEqual([PURGE_AT]);
    b.scheduler.runTo(PURGE_AT - 1);
    expect(h.store.memoGet(creation, 'c-1')).toBeDefined();
    b.scheduler.runTo(PURGE_AT);
    expect(h.store.memoGet(creation, 'c-1')).toBeUndefined();
    expect(h.store.memoGet(submission, 'r-1')).toBeDefined();
    expect(b.scheduler.pending()).toStrictEqual([PURGE_AT + 7 * S]);
    b.scheduler.runTo(PURGE_AT + 7 * S);
    expect(h.store.memoGet(submission, 'r-1')).toBeUndefined();
    expect(b.scheduler.pending()).toStrictEqual([]);
    b.service.close();
  });

  it('FR-238 (purge timer) start() purges what expired while stopped, and a memo stored after start() with no purge armed arms one at its boundary', () => {
    const { h } = created({ timing: 'manual' });
    h.clock.set(PURGE_AT + 9 * S);
    const b = boot(h);
    expect(b.service.start().purged).toBe(1);
    expect(b.scheduler.pending()).toStrictEqual([]);
    const out = b.service.create({ credential: OPERATOR, body: creationBody('c-2', { timing: 'manual' }) });
    expect(out.ok).toBe(true);
    expect(b.scheduler.pending()).toStrictEqual([PURGE_AT + 9 * S + MEMO_RETENTION_MS + 1]);
    b.service.close();
  });
});

describe('clock jumps and the wake-ups', () => {
  it('FR-248 (timer) a forward clock jump past several steps makes the next wake-up perform one late step at the effective instant and shift the anchors', () => {
    const { h, id } = created({ scheduler: true });
    const s = h.scheduler!;
    const t = C1 + 300 * S;
    h.clock.set(t);
    expect(s.fireDue()).toBe(1);
    expect(rows(h, id)).toStrictEqual([[1, 'phase-1-close', t, 'late']]);
    expect(view(h, id).anchors).toMatchObject({ c2: t + 30 * S, a: t + 40 * S });
    expect(s.pending()).toStrictEqual([t + 30 * S]);
    h.close();
  });

  it('FR-249 (shell) after a backward clock jump a wake-up performs nothing and the step waits until the effective instant reaches its scheduled instant', () => {
    const { h, id } = created({ scheduler: true });
    const s = h.scheduler!;
    s.runTo(C1);
    expect(s.pending()).toStrictEqual([C2]);
    h.clock.set(C1 - 60 * S);
    expect(s.fireAll()).toBe(1);
    expect(rows(h, id)).toStrictEqual([[1, 'phase-1-close', C1, 'clock']]);
    expect(s.pending()).toStrictEqual([C2]);
    h.clock.set(C2 - 1);
    expect(s.fireAll()).toBe(1);
    expect(rows(h, id)).toHaveLength(1);
    s.runTo(C2);
    expect(rows(h, id)).toStrictEqual([
      [1, 'phase-1-close', C1, 'clock'],
      [1, 'phase-2-close', C2, 'clock'],
    ]);
    expect(s.pending()).toStrictEqual([A]);
    h.close();
  });
});

describe('FR-388 the wake-up after a forced reveal', () => {
  // Non-round constants: I = 47, L1 = 13, L2 = 7; the secret all-a5 forces round 3 (rounds 1 and 2 have two candidates).
  const T47 = { i: 47, l1: 13, l2: 7 } as const;
  const A5 = SECRETS['all-a5'];
  const nextAt = (h: Harness, id: string): number => {
    const v = view(h, id);
    return v.anchors![v.stage === 'phase-1' ? 'c1' : v.stage === 'phase-2' ? 'c2' : 'a'];
  };
  /** Runs the wake-ups of whole rounds up to the reveal of round 3; returns the instant C1 of that round. */
  const toForcedReveal = (h: Harness, id: string): number => {
    const s = h.scheduler!;
    while (view(h, id).appliedRounds < 2) s.runTo(nextAt(h, id));
    const c1 = nextAt(h, id);
    s.runTo(c1);
    return c1;
  };

  it('FR-388 the wake-up is re-armed from the stored view at the shortened C2, then at the shortened A, and the next round at the 008 anchors of that application', () => {
    const { h, id } = created({ scheduler: true, secret: A5, timing: T47 });
    const s = h.scheduler!;
    const c1 = toForcedReveal(h, id);
    expect(view(h, id).victim!.forced).toBe(true);
    expect(view(h, id).anchors).toMatchObject({ c1, c2: c1 + 5 * S, a: c1 + 12 * S });
    expect(s.pending()).toStrictEqual([c1 + 5 * S]); // not the 008 C2 = c1 + 13 s
    s.runTo(c1 + 5 * S - 1);
    expect(rows(h, id).at(-1)).toStrictEqual([3, 'phase-1-close', c1, 'clock']);
    s.runTo(c1 + 5 * S);
    expect(rows(h, id).at(-1)).toStrictEqual([3, 'phase-2-close', c1 + 5 * S, 'clock']);
    expect(s.pending()).toStrictEqual([c1 + 12 * S]);
    s.runTo(c1 + 12 * S);
    expect(rows(h, id).at(-1)).toStrictEqual([3, 'application', c1 + 12 * S, 'clock']);
    const next = c1 + 12 * S;
    expect(view(h, id).anchors).toStrictEqual({ t0: next, c1: next + 27 * S, c2: next + 40 * S, a: next + 47 * S });
    expect(s.pending()).toStrictEqual([next + 27 * S]);
    h.close();
  });

  it('FR-388 the setting reaches the wake-up: F = 9 arms the shortened C2 at 9 s, F = 13 and F = 20 arm the 008 C2', () => {
    for (const [f, span, total] of [[9, 9, 16], [13, 13, 20], [20, 13, 20]] as const) {
      const { h, id } = created({ scheduler: true, secret: A5, timing: T47, forcedPhaseSeconds: f });
      const c1 = toForcedReveal(h, id);
      expect(view(h, id).victim!.forced, `F = ${f}`).toBe(true);
      expect(h.scheduler!.pending(), `F = ${f}`).toStrictEqual([c1 + span * S]);
      expect(view(h, id).anchors!.a, `F = ${f}`).toBe(c1 + total * S);
      h.close();
    }
  });

  it('FR-388 a round that is not forced keeps the 008 wake-up at C1 + L1 whatever F is', () => {
    const { h, id } = created({ scheduler: true, secret: A5, timing: T47, forcedPhaseSeconds: 1 });
    h.scheduler!.runTo(nextAt(h, id)); // round 1: two candidates
    const v = view(h, id);
    expect(v.victim!.forced).toBeUndefined();
    expect(h.scheduler!.pending()).toStrictEqual([v.anchors!.c1 + 13 * S]);
    h.close();
  });

  it('FR-388 the shortened anchors are published with the reveal and the schedule event, and are the ones the public data show', () => {
    const { h, id } = created({ scheduler: true, secret: A5, timing: T47 });
    const c1 = toForcedReveal(h, id);
    const pub = h.service.publicMatch(id)!;
    expect(pub.schedule).toStrictEqual({ c1, c2: c1 + 5 * S, a: c1 + 12 * S });
    expect(pub.victim).toMatchObject({ forced: true, c2: c1 + 5 * S, a: c1 + 12 * S });
    const events = h.store.eventsAfter(id, 0);
    expect(events.find((e) => e.type === 'victim-revealed' && e.round === 3)).toMatchObject({ c2: c1 + 5 * S, a: c1 + 12 * S });
    expect(events.at(-1)).toMatchObject({ type: 'schedule', stage: 'phase-2', schedule: { c1, c2: c1 + 5 * S, a: c1 + 12 * S } });
    h.close();
  });

  it('FR-388 a manual advance of a forced phase-1 close shortens phase 2 from the instant of the advance and arms the wake-up there', () => {
    const { h, id } = created({ scheduler: true, secret: A5, timing: T47 });
    const s = h.scheduler!;
    while (view(h, id).appliedRounds < 2) s.runTo(nextAt(h, id));
    const at = view(h, id).anchors!.c1 - 9 * S;
    h.clock.set(at);
    const out = h.service.advance({ credential: OPERATOR, matchId: id, body: { round: 3, step: 'phase-1-close' } });
    expect(out.ok).toBe(true);
    expect(rows(h, id).at(-1)).toStrictEqual([3, 'phase-1-close', at, 'manual']);
    expect(view(h, id).anchors).toMatchObject({ c2: at + 5 * S, a: at + 12 * S });
    expect(s.pending()).toStrictEqual([at + 5 * S]);
    h.close();
  });

  it('FR-388 a restart (new store and service on the file) recovers the shortened anchors, re-arms the wake-up there, and a start past it performs a late phase-2 close', () =>
    withTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const first = serviceHarness({ secret: A5, scheduler: true, store: openStore(file) });
      const out = first.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: { ...T47 } }) });
      if (!out.ok) throw new Error('creation failed');
      const id = out.reply.matchId;
      const c1 = toForcedReveal(first, id);
      const stored = view(first, id).anchors;
      expect(stored).toMatchObject({ c2: c1 + 5 * S, a: c1 + 12 * S });
      first.service.close();

      const restartAt = (instant: number) => {
        const store = openStore(file);
        const scheduler = fakeScheduler(first.clock);
        first.clock.set(instant);
        const service = createMatchService({ store, clock: first.clock, maps: createMapCatalog(first.settings.maps), settings: first.settings, scheduler });
        const report = service.start();
        return { store, scheduler, service, report };
      };
      // Restart inside the shortened phase 2: the stored anchors are the shortened ones and the wake-up is armed at the new C2.
      const second = restartAt(c1 + 2 * S);
      expect(second.store.getMatch(id)!.match.anchors).toStrictEqual(stored);
      expect(second.report.performed).toStrictEqual([]);
      expect(second.scheduler.pending()[0]).toBe(c1 + 5 * S);
      second.service.close();
      // Restart past the shortened C2 (but before the 008 C2 = C1 + 13 s): the phase-2 close is overdue and runs late at the start instant.
      const t = c1 + 8 * S;
      const third = restartAt(t);
      expect(third.report.performed.map((p) => [p.matchId, p.steps.map((s) => [s.kind, s.instant, s.cause])])).toStrictEqual([[id, [['phase-2-close', t, 'late']]]]);
      expect(third.store.getMatch(id)!.match.stage).toBe('locked');
      // A late phase-2 close keeps the 008 rule: A = the instant + L2.
      expect(third.store.getMatch(id)!.match.anchors).toMatchObject({ a: t + 7 * S });
      third.service.close();
    }));
});
