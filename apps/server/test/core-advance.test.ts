import { describe, expect, it } from 'vitest';
import type { Timing } from '@mbrg/protocol';
import { decideAdvance } from '../src/core/advance';
import type { AdvanceDecision } from '../src/core/advance';
import { haltMatch } from '../src/core/steps';
import { anchorsFrom, effectiveInstant } from '../src/core/time';
import { publicOf } from '../src/core/view';
import { coreDriver } from './helpers/core-driver';
import type { Driver } from './helpers/core-driver';
import type { StepKind } from '@mbrg/protocol';

const CLOCK: Timing = { i: 100, l1: 30, l2: 20 };
const L1 = 30_000;
const L2 = 20_000;
const T0 = 1_700_000_000_000;
const KINDS: readonly StepKind[] = ['phase-1-close', 'phase-2-close', 'application'];

/** An advance the way the shell would run it: effective instant from the clock, stored row looked up in the step rows. */
function advance(d: Driver, round: number, step: StepKind, matchSecret?: string): AdvanceDecision {
  const effective = effectiveInstant(d.clock.now(), d.view.lastStepMs);
  const stored = d.steps.find((s) => s.round === round && s.kind === step);
  const decision = decideAdvance(d.view, { round, step, effective, reportedTime: effective, ...(stored === undefined ? {} : { stored }), ...(matchSecret === undefined ? {} : { matchSecret }) }, d.deps);
  if (decision.ok) d.take(decision.outcome);
  return decision;
}
/** The next step of the driver's match, as an advance names it. */
const nextNamed = (d: Driver): { round: number; step: StepKind } => ({
  round: d.view.appliedRounds + 1,
  step: d.view.stage === 'phase-1' ? 'phase-1-close' : d.view.stage === 'phase-2' ? 'phase-2-close' : 'application',
});
const advanceNext = (d: Driver): AdvanceDecision => {
  const { round, step } = nextNamed(d);
  return advance(d, round, step);
};
function okOf(decision: AdvanceDecision) {
  if (!decision.ok) throw new Error(`rejected: ${JSON.stringify(decision.error)}`);
  return decision;
}

describe('manual advance (FR-244)', () => {
  it('FR-244 (a) an advance naming the phase-1 close performs it now with cause manual and shifts C2 and A from that instant', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.advance(10_000); // a moment before C1 = t0 + 50 s
    const t = d.clock.now();
    const result = okOf(advance(d, 1, 'phase-1-close'));
    expect(result.reply.result).toBe('performed');
    expect(result.reply.step).toStrictEqual({ round: 1, kind: 'phase-1-close', instant: t, cause: 'manual' });
    expect(d.steps).toStrictEqual([{ round: 1, kind: 'phase-1-close', instant: t, cause: 'manual' }]);
    expect(d.view.stage).toBe('phase-2');
    expect(d.view.anchors).toStrictEqual({ t0: T0, c1: T0 + 50_000, c2: t + L1, a: t + L1 + L2 });
    expect(result.reply.match).toStrictEqual(publicOf(d.view, t));
    expect(result.reply.match.schedule).toStrictEqual({ c1: T0 + 50_000, c2: t + L1, a: t + L1 + L2 });
  });

  it('FR-244 after a manual close the clock does not close phase 1 again at the old C1', () => {
    const d = coreDriver({ timing: { i: 100, l1: 60, l2: 20 }, start: T0 }); // C1 = t0 + 20 s
    d.clock.advance(5_000);
    okOf(advance(d, 1, 'phase-1-close')); // C2 = t0 + 65 s
    d.clock.set(T0 + 20_000); // the old C1
    expect(d.tick()).toBeNull();
    expect(d.steps).toHaveLength(1);
  });

  it('FR-244 (b) D22 an advance in phase 2 performs only the phase-2 close: stage locked, A = t + L2, no application', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.advance(10_000);
    okOf(advance(d, 1, 'phase-1-close'));
    d.clock.advance(5_000);
    const t = d.clock.now();
    const result = okOf(advance(d, 1, 'phase-2-close'));
    expect(result.outcome.steps).toStrictEqual([{ round: 1, kind: 'phase-2-close', instant: t, cause: 'manual' }]);
    expect(d.view.stage).toBe('locked');
    expect(d.view.appliedRounds).toBe(0);
    expect(d.view.anchors?.a).toBe(t + L2);
    expect(d.applied).toHaveLength(0);
    expect(result.reply.step.kind).toBe('phase-2-close');
  });

  it('FR-244 (b) the locked wait is preserved: the application is not due before t + L2 and then comes on time from the clock', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    okOf(advance(d, 1, 'phase-1-close'));
    d.clock.advance(1_000);
    const t = d.clock.now();
    okOf(advance(d, 1, 'phase-2-close'));
    d.clock.set(t + L2 - 1);
    expect(d.tick()).toBeNull();
    d.clock.set(t + L2);
    const out = d.tick();
    expect(out?.steps).toStrictEqual([{ round: 1, kind: 'application', instant: t + L2, cause: 'clock' }]);
    expect(d.view.stage).toBe('phase-1');
  });

  it('FR-244 (b) with L2 = 0 the application falls due at t and follows the phase-2 close in the same decision', () => {
    const d = coreDriver({ timing: { i: 100, l1: 30, l2: 0 }, start: T0 });
    okOf(advance(d, 1, 'phase-1-close'));
    d.clock.advance(2_000);
    const t = d.clock.now();
    const result = okOf(advance(d, 1, 'phase-2-close'));
    expect(result.outcome.steps).toStrictEqual([
      { round: 1, kind: 'phase-2-close', instant: t, cause: 'manual' },
      { round: 1, kind: 'application', instant: t, cause: 'clock' },
    ]);
    expect(result.reply.step).toStrictEqual({ round: 1, kind: 'phase-2-close', instant: t, cause: 'manual' });
    expect(d.view.stage).toBe('phase-1');
    expect(d.view.appliedRounds).toBe(1);
    expect(result.reply.match.appliedRounds).toBe(1);
  });

  it('FR-244 (c) an advance in locked performs the application and anchors round k + 1 at t0 = t', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    okOf(advance(d, 1, 'phase-1-close'));
    okOf(advance(d, 1, 'phase-2-close'));
    d.clock.advance(3_000);
    const t = d.clock.now();
    const result = okOf(advance(d, 1, 'application'));
    expect(result.reply.step).toStrictEqual({ round: 1, kind: 'application', instant: t, cause: 'manual' });
    expect(d.view.stage).toBe('phase-1');
    expect(d.view.appliedRounds).toBe(1);
    expect(d.view.anchors).toStrictEqual(anchorsFrom(t, CLOCK));
    expect(d.view.anchors?.t0).toBe(t);
  });

  it('FR-244 timing manual: one step per advance, three advances per round, no anchors, nothing happens by itself', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    for (let round = 1; round <= 2; round++) {
      for (const [i, kind] of KINDS.entries()) {
        const result = okOf(advance(d, round, kind));
        expect(result.outcome.steps).toHaveLength(1);
        expect(result.reply.step.cause).toBe('manual');
        expect(d.view.anchors).toBeNull();
        expect(d.view.appliedRounds).toBe(i === 2 ? round : round - 1);
      }
      d.clock.advance(1_000_000_000);
      expect(d.tick()).toBeNull();
    }
    expect(d.steps).toHaveLength(6);
  });

  it('FR-244 an advance names the step by round and kind: the last advance of the last round finishes the match and the reply carries the secret only when given', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const total = d.view.totalRounds;
    for (let round = 1; round <= total; round++) {
      for (const kind of KINDS.slice(0, 2)) okOf(advance(d, round, kind));
      if (round < total) okOf(advance(d, round, 'application'));
    }
    const last = okOf(advance(d, total, 'application', 'ab'.repeat(32)));
    expect(d.view.stage).toBe('finished');
    expect(last.reply.match.stage).toBe('finished');
    expect(last.reply.match.matchSecret).toBe('ab'.repeat(32));
    expect(last.reply.match.winner).toBe(d.view.winner);
    expect(d.view.anchors).toBeNull();
  });

  it('FR-244 the effective instant never goes below the last step: the advance is stored at max(clock, last step)', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.advance(20_000);
    okOf(advance(d, 1, 'phase-1-close'));
    const first = d.view.lastStepMs;
    d.clock.set(first - 3_600_000);
    const result = okOf(advance(d, 1, 'phase-2-close'));
    expect(result.reply.step.instant).toBe(first);
  });
});

describe('advance decision (FR-295)', () => {
  it('FR-295 (b) an advance naming the next step is performed and replies performed with the step and the public data after it', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const result = okOf(advance(d, 1, 'phase-1-close'));
    expect(result.reply.result).toBe('performed');
    expect(result.reply.step).toStrictEqual(d.steps[0]);
    expect(result.reply.match.stage).toBe('phase-2');
    expect(result.reply.match.victim?.round).toBe(1);
    expect(result.reply.match.reportedTime).toBe(result.reply.step.instant);
  });

  it('FR-295 (b) an advance naming an already performed step performs nothing and replies already-performed with the stored row and the current data', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    okOf(advance(d, 1, 'phase-1-close'));
    d.clock.advance(5_000);
    const before = d.view;
    const seedCalls = d.seedCalls.length;
    const again = okOf(advance(d, 1, 'phase-1-close'));
    expect(again.reply.result).toBe('already-performed');
    expect(again.reply.step).toStrictEqual(d.steps[0]);
    expect(again.outcome).toStrictEqual({ view: before, steps: [], events: [] });
    expect(d.view).toBe(before);
    expect(d.steps).toHaveLength(1);
    expect(d.seedCalls).toHaveLength(seedCalls);
    expect(again.reply.match).toStrictEqual(publicOf(before, again.reply.match.reportedTime));
  });

  it('FR-295 (c) two advances naming the same step give one step and one already-performed', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const first = okOf(advance(d, 1, 'phase-1-close'));
    const second = okOf(advance(d, 1, 'phase-1-close'));
    expect([first.reply.result, second.reply.result]).toStrictEqual(['performed', 'already-performed']);
    expect(d.steps).toHaveLength(1);
    expect(d.events.filter((e) => e.type === 'victim-revealed')).toHaveLength(1);
  });

  it('FR-295 (c) an advance that loses a race with the clock performs nothing: it gets the clock row as already-performed', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.set(T0 + 50_000); // C1
    expect(d.tick()?.steps[0]?.cause).toBe('clock');
    const lost = okOf(advance(d, 1, 'phase-1-close'));
    expect(lost.reply.result).toBe('already-performed');
    expect(lost.reply.step).toStrictEqual({ round: 1, kind: 'phase-1-close', instant: T0 + 50_000, cause: 'clock' });
    expect(d.steps).toHaveLength(1);
  });

  it('FR-295 (b) a step of an earlier round is already performed too: its own stored row comes back', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    for (const kind of KINDS) okOf(advance(d, 1, kind));
    const old = okOf(advance(d, 1, 'phase-2-close'));
    expect(old.reply.result).toBe('already-performed');
    expect(old.reply.step).toStrictEqual(d.steps[1]);
    expect(old.reply.match.appliedRounds).toBe(1);
  });

  it('FR-295 (b) an advance naming any other step gets step-mismatch with the current stage and N', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const ahead = advance(d, 1, 'application');
    expect(ahead).toStrictEqual({ ok: false, error: { kind: 'step-mismatch', stage: 'phase-1', appliedRounds: 0 } });
    expect(advance(d, 1, 'phase-2-close')).toStrictEqual({ ok: false, error: { kind: 'step-mismatch', stage: 'phase-1', appliedRounds: 0 } });
    expect(advance(d, 2, 'phase-1-close')).toStrictEqual({ ok: false, error: { kind: 'step-mismatch', stage: 'phase-1', appliedRounds: 0 } });
    expect(advance(d, d.view.totalRounds + 1, 'phase-1-close')).toStrictEqual({ ok: false, error: { kind: 'step-mismatch', stage: 'phase-1', appliedRounds: 0 } });
    expect(advance(d, 0, 'phase-1-close')).toStrictEqual({ ok: false, error: { kind: 'step-mismatch', stage: 'phase-1', appliedRounds: 0 } });
    okOf(advance(d, 1, 'phase-1-close'));
    expect(advance(d, 1, 'application')).toStrictEqual({ ok: false, error: { kind: 'step-mismatch', stage: 'phase-2', appliedRounds: 0 } });
    expect(d.steps).toHaveLength(1);
  });

  it('FR-295 (b) a mismatch or an already-performed reply reads no round seed and changes nothing', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    okOf(advance(d, 1, 'phase-1-close'));
    const seeds = d.seedCalls.length;
    const view = d.view;
    advance(d, 1, 'application');
    advance(d, 1, 'phase-1-close');
    expect(d.seedCalls).toHaveLength(seeds);
    expect(d.view).toBe(view);
  });

  it('FR-295 (b) a finished or halted match replies match-finished or match-halted before any step check', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const halted = haltMatch(d.view, 'map-changed', T0);
    expect(decideAdvance(halted.view, { round: 1, step: 'phase-1-close', effective: T0, reportedTime: T0 }, d.deps)).toStrictEqual({ ok: false, error: { kind: 'match-halted' } });
    expect(decideAdvance(halted.view, { round: 9, step: 'application', effective: T0, reportedTime: T0 }, d.deps)).toStrictEqual({ ok: false, error: { kind: 'match-halted' } });
    const finished = { ...d.view, stage: 'finished' as const };
    expect(decideAdvance(finished, { round: 1, step: 'phase-1-close', effective: T0, reportedTime: T0 }, d.deps)).toStrictEqual({ ok: false, error: { kind: 'match-finished' } });
  });

  it('FR-295 (b) a performed step without its stored row is inconsistent stored data (RangeError), a given row must be the named step', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    okOf(advance(d, 1, 'phase-1-close'));
    const input = { round: 1, step: 'phase-1-close' as const, effective: T0, reportedTime: T0 };
    expect(() => decideAdvance(d.view, input, d.deps)).toThrow(RangeError);
    expect(() => decideAdvance(d.view, { ...input, stored: { round: 1, kind: 'phase-2-close', instant: T0, cause: 'manual' } }, d.deps)).toThrow(RangeError);
    expect(() => decideAdvance(d.view, { round: 1, step: 'phase-2-close', effective: T0, reportedTime: T0, stored: { round: 1, kind: 'phase-2-close', instant: T0, cause: 'manual' } }, d.deps)).toThrow(RangeError);
  });

  it('FR-295 (b) a clock step then an advance naming it, then an advance naming the next step, keep order: each step once', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.set(T0 + 50_000);
    d.tick();
    expect(okOf(advance(d, 1, 'phase-1-close')).reply.result).toBe('already-performed');
    expect(okOf(advance(d, 1, 'phase-2-close')).reply.result).toBe('performed');
    expect(d.steps.map((s) => s.kind)).toStrictEqual(['phase-1-close', 'phase-2-close']);
  });
});

describe('late steps (FR-248)', () => {
  it('FR-248 (a) (b) a phase-1 close overdue across C1, C2 and A is performed alone, late, at the effective instant, then full L1 and L2', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.set(T0 + 1_000_000); // a long downtime: C1, C2 and A are all behind
    const t = d.clock.now();
    const out = d.tick();
    expect(out?.steps).toStrictEqual([{ round: 1, kind: 'phase-1-close', instant: t, cause: 'late' }]);
    expect(d.view.stage).toBe('phase-2');
    expect(d.view.anchors).toStrictEqual({ t0: T0, c1: T0 + 50_000, c2: t + L1, a: t + L1 + L2 });
    // (c) never several in a row
    expect(d.tick()).toBeNull();
    expect(d.steps).toHaveLength(1);
  });

  it('FR-248 (a) (b) a phase-2 close overdue (also across A) is performed alone, late; the application follows L2 later', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.set(T0 + 50_000);
    d.tick();
    d.clock.set(T0 + 5_000_000); // across C2 and A
    const t = d.clock.now();
    const out = d.tick();
    expect(out?.steps).toStrictEqual([{ round: 1, kind: 'phase-2-close', instant: t, cause: 'late' }]);
    expect(d.view.stage).toBe('locked');
    expect(d.view.anchors?.a).toBe(t + L2);
    expect(d.tick()).toBeNull();
    expect(d.view.appliedRounds).toBe(0);
  });

  it('FR-248 (a) (b) an application overdue is performed late and anchors the next round at the effective instant', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.set(T0 + 50_000);
    d.tick();
    d.clock.set(T0 + 80_000);
    d.tick();
    d.clock.set(T0 + 9_000_000);
    const t = d.clock.now();
    const out = d.tick();
    expect(out?.steps).toStrictEqual([{ round: 1, kind: 'application', instant: t, cause: 'late' }]);
    expect(d.view.stage).toBe('phase-1');
    expect(d.view.anchors).toStrictEqual(anchorsFrom(t, CLOCK));
    expect(d.tick()).toBeNull();
  });

  it('FR-248 (b) (c) after a long downtime each following step comes on time, one per instant, with its full phase', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.set(T0 + 10_000_000);
    const t = d.clock.now();
    expect(d.tick()?.steps).toStrictEqual([{ round: 1, kind: 'phase-1-close', instant: t, cause: 'late' }]);
    d.clock.set(t + L1 - 1);
    expect(d.tick()).toBeNull();
    d.clock.set(t + L1);
    expect(d.tick()?.steps).toStrictEqual([{ round: 1, kind: 'phase-2-close', instant: t + L1, cause: 'clock' }]);
    d.clock.set(t + L1 + L2 - 1);
    expect(d.tick()).toBeNull();
    d.clock.set(t + L1 + L2);
    expect(d.tick()?.steps).toStrictEqual([{ round: 1, kind: 'application', instant: t + L1 + L2, cause: 'clock' }]);
  });

  it('FR-248 an on-time step keeps its scheduled instant and shifts nothing, up to the 1 s tolerance', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const before = d.view.anchors;
    d.clock.set(T0 + 50_000 + 1_000); // exactly 1 s after C1
    const out = d.tick();
    expect(out?.steps).toStrictEqual([{ round: 1, kind: 'phase-1-close', instant: T0 + 50_000, cause: 'clock' }]);
    expect(d.view.anchors).toStrictEqual(before);
  });

  it('FR-248 one millisecond past the tolerance the step is late: stored at the effective instant with shifted anchors', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.set(T0 + 50_000 + 1_001);
    const t = d.clock.now();
    const out = d.tick();
    expect(out?.steps).toStrictEqual([{ round: 1, kind: 'phase-1-close', instant: t, cause: 'late' }]);
    expect(d.view.anchors).toStrictEqual({ t0: T0, c1: T0 + 50_000, c2: t + L1, a: t + L1 + L2 });
  });

  it('FR-248 after a backward jump of the clock steps wait until the effective instant reaches their scheduled instant', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.set(T0 + 50_000);
    d.tick(); // phase-1 close at C1, C2 = T0 + 80 s
    d.clock.set(T0 - 3_600_000);
    expect(d.tick()).toBeNull();
    d.clock.set(T0 + 79_999);
    expect(d.tick()).toBeNull();
    d.clock.set(T0 + 80_000);
    expect(d.tick()?.steps[0]).toStrictEqual({ round: 1, kind: 'phase-2-close', instant: T0 + 80_000, cause: 'clock' });
  });

  it('FR-248 a late step followed by an advance naming it gives already-performed with the late row', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.set(T0 + 1_000_000);
    d.tick();
    const again = okOf(advance(d, 1, 'phase-1-close'));
    expect(again.reply.result).toBe('already-performed');
    expect(again.reply.step.cause).toBe('late');
  });
});

describe('advance that halts (FR-295)', () => {
  it('FR-295 (b) an advance whose step halts the match replies match-halted and hands over the halted view to store', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    d.deps = { ...d.deps, map: { not: 'a map' } };
    const effective = effectiveInstant(d.clock.now(), d.view.lastStepMs);
    const decision = decideAdvance(d.view, { round: 1, step: 'phase-1-close', effective, reportedTime: effective }, d.deps);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toStrictEqual({ kind: 'match-halted' });
    expect(decision.outcome?.view.stage).toBe('halted');
    expect(decision.outcome?.view.haltReason).toBe('map-changed');
    expect(decision.outcome?.steps).toStrictEqual([]);
  });
});
