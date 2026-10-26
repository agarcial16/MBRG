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
