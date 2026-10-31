import { describe, expect, it } from 'vitest';
import type { Timing } from '@mbrg/protocol';
import { PUBLIC_MATCH_KEYS, encodePublicMatch } from '@mbrg/protocol';
import {
  TOLERANCE_MS,
  anchorsAfterStep,
  anchorsFrom,
  dueStep,
  effectiveInstant,
  forcedAnchors,
  isOnTime,
  lastStepAfter,
  reportedTime,
  wholeMs,
} from '../src/core/time';
import { CORE_MATCH_KEYS, publicOf } from '../src/core/view';
import type { CoreMatch } from '../src/core/view';
import { fakeClock } from './helpers/fake-clock';
import { fakeRandom } from './helpers/fake-random';

const HOST: Timing = { i: 3600, l1: 600, l2: 300 };
const SHORT: Timing = { i: 3, l1: 1, l2: 0 };
const T0 = 1_700_000_000_000;

describe('schedule anchors', () => {
  it('FR-239 anchors come from t0 and (I, L1, L2) in integer ms', () => {
    expect(anchorsFrom(T0, HOST)).toStrictEqual({ t0: T0, c1: T0 + 2_700_000, c2: T0 + 3_300_000, a: T0 + 3_600_000 });
    expect(anchorsFrom(T0, { i: 90, l1: 20, l2: 10 })).toStrictEqual({ t0: T0, c1: T0 + 60_000, c2: T0 + 80_000, a: T0 + 90_000 });
  });

  it('FR-239 the shortest host settings I = 3, L1 = 1, L2 = 0 give C2 = A', () => {
    expect(anchorsFrom(T0, SHORT)).toStrictEqual({ t0: T0, c1: T0 + 2000, c2: T0 + 3000, a: T0 + 3000 });
  });

  it('FR-239 A is always t0 + 1000 I and C1 <= C2 <= A for valid settings', () => {
    for (const t of [{ i: 3, l1: 1, l2: 1 }, { i: 7, l1: 3, l2: 4 }, { i: 2_592_000, l1: 1, l2: 2_591_999 }]) {
      const a = anchorsFrom(T0, t)!;
      expect(a.a).toBe(T0 + 1000 * t.i);
      expect(a.c1).toBeLessThanOrEqual(a.c2);
      expect(a.c2).toBeLessThanOrEqual(a.a);
      expect(a.c2 - a.c1).toBe(1000 * t.l1);
      expect(a.a - a.c2).toBe(1000 * t.l2);
    }
  });

  it('FR-239 timing manual has no anchors and no step is ever due', () => {
    expect(anchorsFrom(T0, 'manual')).toBeNull();
    expect(anchorsAfterStep(null, 'phase-1-close', T0, 'manual', 'manual')).toBeNull();
    expect(dueStep('phase-1', null, T0 * 2)).toBeNull();
  });

  it('FR-239 an on-time clock step keeps the anchors; an application anchors the next round at its instant', () => {
    const a = anchorsFrom(T0, HOST)!;
    expect(anchorsAfterStep(a, 'phase-1-close', a.c1, 'clock', HOST)).toStrictEqual(a);
    expect(anchorsAfterStep(a, 'phase-2-close', a.c2, 'clock', HOST)).toStrictEqual(a);
    expect(anchorsAfterStep(a, 'application', a.a, 'clock', HOST)).toStrictEqual(anchorsFrom(a.a, HOST));
  });

  it('FR-239 a manual or late step shifts the anchors from its instant', () => {
    const a = anchorsFrom(T0, HOST)!;
    const t = a.c1 - 5000;
    expect(anchorsAfterStep(a, 'phase-1-close', t, 'manual', HOST)).toStrictEqual({ ...a, c2: t + 600_000, a: t + 900_000 });
    const t2 = a.c2 + 123_456;
    expect(anchorsAfterStep(a, 'phase-2-close', t2, 'late', HOST)).toStrictEqual({ ...a, a: t2 + 300_000 });
    const t3 = a.a + 9999;
    expect(anchorsAfterStep(a, 'application', t3, 'late', HOST)).toStrictEqual(anchorsFrom(t3, HOST));
  });

  it('FR-239 with L2 = 0 a phase-2 close at t makes the application due at t', () => {
    const a = anchorsFrom(T0, SHORT)!;
    expect(anchorsAfterStep(a, 'phase-2-close', T0 + 2500, 'manual', SHORT)!.a).toBe(T0 + 2500);
  });
});

describe('the shortened phase 2 after a forced reveal', () => {
  // Non-round constants: I = 47, L1 = 13, L2 = 7 (C1 = +27 s, C2 = +40 s, A = +47 s).
  const T: Timing = { i: 47, l1: 13, l2: 7 };
  const base = anchorsFrom(T0, T)!;

  it('FR-388 phase 2 lasts min(L1, F) and A moves earlier by the time saved: F = 5 and F = 9 below L1 = 13 (on-time clock step)', () => {
    expect(forcedAnchors(base, T, 5, base.c1, 'clock')).toStrictEqual({ t0: T0, c1: base.c1, c2: base.c1 + 5000, a: base.c1 + 5000 + 7000 });
    expect(forcedAnchors(base, T, 9, base.c1, 'clock')).toStrictEqual({ t0: T0, c1: base.c1, c2: base.c1 + 9000, a: base.c1 + 9000 + 7000 });
    // A = the 008 A minus the time saved (13 - F); locked keeps L2.
    expect(forcedAnchors(base, T, 5, base.c1, 'clock')!.a).toBe(base.a - 8000);
    expect(forcedAnchors(base, T, 9, base.c1, 'clock')!.a).toBe(base.a - 4000);
  });

  it('FR-388 F equal to L1 and F above L1 change nothing: the anchors are the 008 anchors', () => {
    for (const f of [13, 14, 20, 3600]) expect(forcedAnchors(base, T, f, base.c1, 'clock'), `F = ${f}`).toStrictEqual(base);
    // One second under L1 shortens by exactly one second.
    expect(forcedAnchors(base, T, 12, base.c1, 'clock')).toStrictEqual({ ...base, c2: base.c2 - 1000, a: base.a - 1000 });
  });

  it('FR-388 a late or manual phase-1 close shifts from its instant and shortens phase 2 the same way', () => {
    const late = base.c1 + 4321;
    expect(forcedAnchors(base, T, 5, late, 'late')).toStrictEqual({ ...base, c2: late + 5000, a: late + 5000 + 7000 });
    expect(forcedAnchors(base, T, 5, late, 'late')).toStrictEqual({ ...anchorsAfterStep(base, 'phase-1-close', late, 'late', T)!, c2: late + 5000, a: late + 12_000 });
    const early = base.c1 - 9000;
    expect(forcedAnchors(base, T, 9, early, 'manual')).toStrictEqual({ ...base, c2: early + 9000, a: early + 16_000 });
    // F at or above L1: exactly the 008 shift.
    expect(forcedAnchors(base, T, 13, early, 'manual')).toStrictEqual(anchorsAfterStep(base, 'phase-1-close', early, 'manual', T));
    expect(forcedAnchors(base, T, 99, late, 'late')).toStrictEqual(anchorsAfterStep(base, 'phase-1-close', late, 'late', T));
  });

  it('FR-388 with L2 = 0 the shortened C2 equals the shortened A', () => {
    const t: Timing = { i: 20, l1: 13, l2: 0 };
    const a = anchorsFrom(T0, t)!;
    const out = forcedAnchors(a, t, 5, a.c1, 'clock')!;
    expect(out.c2).toBe(a.c1 + 5000);
    expect(out.a).toBe(out.c2);
    expect(out.a).toBe(a.a - 8000);
  });

  it('FR-388 under manual timing, or without anchors, nothing is shortened (no anchors)', () => {
    expect(forcedAnchors(null, 'manual', 5, T0, 'manual')).toBeNull();
    expect(forcedAnchors(base, 'manual', 5, T0, 'manual')).toBeNull();
    expect(forcedAnchors(null, T, 5, T0, 'manual')).toBeNull();
  });

  it('FR-388 the input anchors are not changed and the result is a new object', () => {
    const frozen = Object.freeze({ ...base });
    const out = forcedAnchors(frozen, T, 5, frozen.c1, 'clock')!;
    expect(out).not.toBe(frozen);
    expect(frozen).toStrictEqual(base);
  });

  it('FR-388 the shortened phase 2 closes exactly at the new C2 and the application at the new A (dueStep)', () => {
    const f = forcedAnchors(base, T, 5, base.c1, 'clock')!;
    expect(dueStep('phase-2', f, f.c2 - 1)).toBeNull();
    expect(dueStep('phase-2', f, f.c2)).toMatchObject({ kind: 'phase-2-close', scheduled: f.c2, instant: f.c2, cause: 'clock' });
    expect(dueStep('locked', f, f.a - 1)).toBeNull();
    expect(dueStep('locked', f, f.a)).toMatchObject({ kind: 'application', scheduled: f.a, instant: f.a, cause: 'clock' });
    // The next round is anchored at the application instant, exactly as in 008.
    expect(anchorsAfterStep(f, 'application', f.a, 'clock', T)).toStrictEqual(anchorsFrom(f.a, T));
  });
});

describe('effective instant and reported time', () => {
  it('FR-249 the effective instant is the clock reading, never below the last step instant', () => {
    expect(effectiveInstant(5000, 3000)).toBe(5000);
    expect(effectiveInstant(2999, 3000)).toBe(3000);
    expect(effectiveInstant(3000, 3000)).toBe(3000);
    expect(effectiveInstant(0, 3000)).toBe(3000);
  });

  it('FR-249 instants are whole milliseconds and a non-finite reading is rejected', () => {
    expect(wholeMs(1234.9)).toBe(1234);
    expect(effectiveInstant(5000.7, 3000)).toBe(5000);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(() => wholeMs(bad)).toThrow(RangeError);
    expect(() => wholeMs('5' as unknown as number)).toThrow(RangeError);
  });

  it('FR-249 a backward clock jump leaves the effective instant at the last step instant; steps wait', () => {
    const clock = fakeClock(T0);
    const anchors = anchorsFrom(T0, HOST)!;
    const last = T0 + 2_700_000;
    clock.set(T0 + 2_700_000 + 4_000_000); // far forward
    expect(effectiveInstant(clock.now(), last)).toBe(T0 + 6_700_000);
    clock.set(T0 - 3_600_000); // one hour before the creation
    expect(effectiveInstant(clock.now(), last)).toBe(last);
    // At the last step instant the next step (C2, later than last) is not due: it waits for the clock to catch up.
    expect(dueStep('phase-2', anchors, effectiveInstant(clock.now(), last))).toBeNull();
    clock.set(anchors.c2 - 1);
    expect(dueStep('phase-2', anchors, effectiveInstant(clock.now(), last))).toBeNull();
    clock.set(anchors.c2);
    expect(dueStep('phase-2', anchors, effectiveInstant(clock.now(), last))?.kind).toBe('phase-2-close');
  });

  it('FR-302 reported time never decreases under a clock set backwards', () => {
    const clock = fakeClock(10_000);
    const lastStep = 8000;
    let sent = 0;
    const seen: number[] = [];
    for (const reading of [10_000, 12_000, 11_000, 3000, 12_500, 0, 13_000]) {
      clock.set(reading);
      sent = reportedTime(effectiveInstant(clock.now(), lastStep), sent);
      seen.push(sent);
    }
    expect(seen).toStrictEqual([10_000, 12_000, 12_000, 12_000, 12_500, 12_500, 13_000]);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  });

  it('FR-302 reported time is never below a step instant already stored, so ages are not negative', () => {
    const clock = fakeClock(1000);
    const steps = [9000, 9500, 20_000];
    let last = 0;
    let sent = 0;
    for (const s of steps) {
      last = lastStepAfter(last, s);
      clock.set(2000); // the clock is behind every step
      sent = reportedTime(effectiveInstant(clock.now(), last), sent);
      expect(sent).toBeGreaterThanOrEqual(s);
    }
  });

  it('FR-302 the reported time carries the memory of the largest value sent, even above the effective instant', () => {
    expect(reportedTime(5000, 7000)).toBe(7000);
    expect(reportedTime(8000, 7000)).toBe(8000);
    expect(reportedTime(7000, 7000)).toBe(7000);
  });

  it('FR-302 the core view maps onto the public view and carries the reported time', () => {
    const view = fixtureView();
    const pub = publicOf(view, 123_456);
    expect(pub.reportedTime).toBe(123_456);
    expect(pub.schedule).toStrictEqual({ c1: view.anchors!.c1, c2: view.anchors!.c2, a: view.anchors!.a });
    expect(() => encodePublicMatch(pub)).not.toThrow();
    // Equal inputs, equal bytes; the manual timing has no schedule.
    expect(encodePublicMatch(publicOf({ ...view, timing: 'manual', anchors: null }, 5))).not.toContain('schedule');
  });
});

describe('due steps and tolerance', () => {
  const anchors = anchorsFrom(T0, HOST)!;

  it('FR-239 dueStep returns nothing before the scheduled instant and the step at or after it', () => {
    expect(dueStep('phase-1', anchors, anchors.c1 - 1)).toBeNull();
    expect(dueStep('phase-1', anchors, anchors.c1)).toStrictEqual({ kind: 'phase-1-close', scheduled: anchors.c1, instant: anchors.c1, cause: 'clock' });
    expect(dueStep('phase-2', anchors, anchors.c2 - 1)).toBeNull();
    expect(dueStep('phase-2', anchors, anchors.c2)?.kind).toBe('phase-2-close');
    expect(dueStep('locked', anchors, anchors.a - 1)).toBeNull();
    expect(dueStep('locked', anchors, anchors.a)?.kind).toBe('application');
  });

  it('FR-239 a finished or halted match has no due step', () => {
    for (const stage of ['finished', 'halted'] as const) expect(dueStep(stage, anchors, anchors.a + 10_000_000)).toBeNull();
  });

  it('NFR-50 a step performed at +1000 ms is on time and at +1001 ms is overdue (late, stored at the effective instant)', () => {
    expect(TOLERANCE_MS).toBe(1000);
    expect(isOnTime(anchors.c1, anchors.c1 + 1000)).toBe(true);
    expect(isOnTime(anchors.c1, anchors.c1 + 1001)).toBe(false);
    expect(dueStep('phase-1', anchors, anchors.c1 + 1000)).toStrictEqual({ kind: 'phase-1-close', scheduled: anchors.c1, instant: anchors.c1, cause: 'clock' });
    expect(dueStep('phase-1', anchors, anchors.c1 + 1001)).toStrictEqual({ kind: 'phase-1-close', scheduled: anchors.c1, instant: anchors.c1 + 1001, cause: 'late' });
  });

  it('NFR-50 with the fake clock a poll every 1000 ms performs a step never earlier and at most 1000 ms after its instant', () => {
    for (const offset of [0, 1, 250, 999]) {
      const clock = fakeClock(T0 + offset);
      const a = anchorsFrom(T0, SHORT)!;
      let performedAt: number | null = null;
      for (let i = 0; i < 10 && performedAt === null; i++) {
        const due = dueStep('phase-1', a, effectiveInstant(clock.now(), T0));
        if (due !== null) performedAt = clock.now();
        else clock.advance(1000);
      }
      expect(performedAt).not.toBeNull();
      expect(performedAt! - a.c1).toBeGreaterThanOrEqual(0);
      expect(performedAt! - a.c1).toBeLessThanOrEqual(TOLERANCE_MS);
    }
  });

  it('NFR-50 host settings with windows shorter than the tolerance behave within it', () => {
    const a = anchorsFrom(T0, SHORT)!; // phase 2 lasts 1000 ms, the locked wait 0 ms
    expect(a.a - a.c2).toBe(0);
    expect(dueStep('phase-2', a, a.c2)).toMatchObject({ kind: 'phase-2-close', cause: 'clock' });
    // After the phase-2 close the application is already due at the same instant.
    const after = anchorsAfterStep(a, 'phase-2-close', a.c2, 'clock', SHORT)!;
    expect(dueStep('locked', after, a.c2)).toMatchObject({ kind: 'application', instant: a.c2, cause: 'clock' });
  });

  it('FR-239 one step at a time: an overdue match yields only the next step, never several', () => {
    const far = anchors.a + 99_999_999;
    expect(dueStep('phase-1', anchors, far)).toMatchObject({ kind: 'phase-1-close', cause: 'late', instant: far });
  });
});

describe('last step instant', () => {
  it('FR-249 the last step instant only changes through a step row and never decreases', () => {
    const view = fixtureView();
    const frozen = JSON.stringify(view);
    // Pure reads over the view (time rules, public mapping) leave it untouched.
    effectiveInstant(view.lastStepMs + 5000, view.lastStepMs);
    reportedTime(view.lastStepMs + 5000, 0);
    dueStep(view.stage, view.anchors, view.lastStepMs + 10_000_000);
    publicOf(view, 1);
    expect(JSON.stringify(view)).toBe(frozen);
    expect(lastStepAfter(view.lastStepMs, view.lastStepMs + 7)).toBe(view.lastStepMs + 7);
    expect(lastStepAfter(view.lastStepMs, view.lastStepMs)).toBe(view.lastStepMs);
    expect(() => lastStepAfter(view.lastStepMs, view.lastStepMs - 1)).toThrow(RangeError);
  });
});

describe('core view', () => {
  it('FR-302 the core view holds no absorber, no seed, no secret and no pending-state field', () => {
    const forbidden = /absorber|seed|secret|pending|future|next/i;
    for (const key of CORE_MATCH_KEYS) expect(key, key).not.toMatch(forbidden);
    // The view maps onto PublicMatch: every key except the core-only ones is a public key.
    const coreOnly = new Set(['createdAt', 'lastStepMs', 'anchors']);
    for (const key of CORE_MATCH_KEYS) if (!coreOnly.has(key)) expect(PUBLIC_MATCH_KEYS as readonly string[], key).toContain(key);
    // A view built at runtime has exactly these keys at most.
    for (const key of Object.keys(fixtureView())) expect(CORE_MATCH_KEYS as readonly string[], key).toContain(key);
  });

  it('the player count is part of the pinned core keys, the view stays free of secret-looking keys, and a built view has no count', () => {
    expect(CORE_MATCH_KEYS).toContain('playerCount');
    expect(PUBLIC_MATCH_KEYS as readonly string[]).toContain('playerCount');
    expect('playerCount' in fixtureView()).toBe(false);
  });

  it('publicOf writes the player count of a lobby and of an expired lobby (0 when unset) and of a running match once it has players', () => {
    const view = fixtureView();
    expect('playerCount' in publicOf(view, 1)).toBe(false);
    expect('playerCount' in publicOf({ ...view, playerCount: 0 }, 1)).toBe(false);
    expect(publicOf({ ...view, playerCount: 3 }, 1).playerCount).toBe(3);
    expect(publicOf({ ...view, stage: 'finished', anchors: null, winner: 3, playerCount: 1 }, 1).playerCount).toBe(1);
    for (const stage of ['lobby', 'expired'] as const) {
      expect(publicOf({ ...view, stage, anchors: null }, 1).playerCount, stage).toBe(0);
      expect(publicOf({ ...view, stage, anchors: null, playerCount: 5 }, 1).playerCount, stage).toBe(5);
    }
  });

  it('FR-302 publicOf never lets a secret through before the match is finished', () => {
    const view = fixtureView();
    expect(publicOf(view, 1, 'ab'.repeat(32)).matchSecret).toBeUndefined();
    const done: CoreMatch = { ...view, stage: 'finished', anchors: null, winner: 3 };
    const hex = 'ab'.repeat(32);
    expect(publicOf(done, 1, hex)).toMatchObject({ winner: 3, matchSecret: hex });
    expect(publicOf(done, 1).matchSecret).toBeUndefined();
  });
});

describe('injectable clock and fake sources', () => {
  it('FR-314 the fake clock reads, advances and may be set backwards', () => {
    const c = fakeClock(100);
    expect(c.now()).toBe(100);
    c.advance(50);
    expect(c.now()).toBe(150);
    c.set(10);
    expect(c.now()).toBe(10);
  });

  it('FR-314 the fake random source is deterministic per seed and returns the requested length', () => {
    const a = fakeRandom(7)(32);
    const b = fakeRandom(7)(32);
    const c = fakeRandom(8)(32);
    expect(a).toHaveLength(32);
    expect(Array.from(a)).toStrictEqual(Array.from(b));
    expect(Array.from(a)).not.toStrictEqual(Array.from(c));
  });

  it('FR-314 the system clock reads whole milliseconds near the host time', async () => {
    const { systemClock } = await import('../src/clock');
    const before = Date.now();
    const reading = systemClock.now();
    expect(Number.isInteger(reading)).toBe(true);
    expect(reading).toBeGreaterThanOrEqual(before);
    expect(reading).toBeLessThanOrEqual(Date.now());
  });
});

function fixtureView(): CoreMatch {
  return {
    matchId: 'm1',
    mapId: 'dev',
    mapDigest: 'a'.repeat(64),
    totalRounds: 3,
    timing: HOST,
    commitment: 'b'.repeat(64),
    stage: 'phase-1',
    appliedRounds: 0,
    state: { mode: 'classic', round: 0, owners: [[1, 1], [2, 2], [3, 3], [4, 4]] },
    stateDigest: 'c'.repeat(64),
    lastSeq: 1,
    createdAt: T0,
    lastStepMs: T0,
    anchors: anchorsFrom(T0, HOST),
  };
}
