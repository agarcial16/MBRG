import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTour } from '../src/core/tour';
import type { Tour } from '../src/core/tour';
import {
  completeTourRun,
  motionChangedTourRun,
  startTourRun,
  tourRunAt,
  type TourRun,
} from '../src/core/tour-playback';

// Two factions: 6 stops, tau_H = 1,687, D = 3,487 (plan 4.3). Absorber tour: tau_H = 1,311, D = 2,411.
const victimTour = (): Tour => buildTour({ kind: 'victim', result: 2, set: [1, 2], sigma: 5 });
const absorberTour = (): Tour => buildTour({ kind: 'absorber', result: 2, victim: 9, set: [1, 2], sigma: 5 });
const HANDLING = 4000.25;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tour playback', () => {
  it('the hand-derived figures of the tours hold', () => {
    expect(victimTour().at[victimTour().at.length - 1]).toBe(1687);
    expect(victimTour().end).toBe(3487);
    expect(absorberTour().at[absorberTour().at.length - 1]).toBe(1311);
    expect(absorberTour().end).toBe(2411);
  });

  it('FR-342 t = 0 at the handling reading, not at the first frame drawn', () => {
    const run = startTourRun(HANDLING, [victimTour()]);
    const at0 = tourRunAt(run, HANDLING);
    expect(at0).toMatchObject({ index: 0, t: 0, ended: false });
    // The first frame comes 250.5 ms later (a busy page): it draws t = 250.5, not 0.
    const late = tourRunAt(run, HANDLING + 250.5);
    expect(late).toMatchObject({ index: 0, t: 250.5, ended: false });
  });

  it('FR-342 a frame draws the t of its own reading, whatever frames came before (dropped frames)', () => {
    const run = startTourRun(HANDLING, [victimTour()]);
    const readings = [0, 16.5, 33, 1686.5, 2999.75];
    let current = run;
    for (const dt of readings) {
      const out = tourRunAt(current, HANDLING + dt);
      expect(out.t, String(dt)).toBe(dt);
      expect(tourRunAt(run, HANDLING + dt).t, `fresh ${String(dt)}`).toBe(dt);
      current = out.run;
    }
  });

  it('FR-342 a gap of 10 s gives the final state on the first frame with t at or above D, and ends the run', () => {
    const run = startTourRun(HANDLING, [victimTour()]);
    const before = tourRunAt(run, HANDLING + 3486);
    expect(before).toMatchObject({ index: 0, t: 3486, ended: false });
    expect(before.run.done).toBe(false);
    const at = tourRunAt(run, HANDLING + 3487);
    expect(at).toMatchObject({ index: 0, t: 3487, ended: true });
    const gap = tourRunAt(before.run, HANDLING + 10000);
    expect(gap.ended).toBe(true);
    expect(gap.t).toBeGreaterThanOrEqual(3487);
    expect(gap.run.done).toBe(true);
    // Later frames of a finished run end nothing again.
    expect(tourRunAt(gap.run, HANDLING + 10016).ended).toBe(false);
  });

  it('FR-342 a reading before the handling reading draws t = 0', () => {
    const run = startTourRun(HANDLING, [victimTour()]);
    expect(tourRunAt(run, HANDLING - 40).t).toBe(0);
  });

  it('FR-342 a sequence starts the second tour at the end instant of the first, not at its first frame', () => {
    const run = startTourRun(1000, [victimTour(), absorberTour()]);
    expect(tourRunAt(run, 4486)).toMatchObject({ index: 0, t: 3486, ended: false });
    expect(tourRunAt(run, 4487)).toMatchObject({ index: 1, t: 0, ended: false });
    // The first frame seen in the second tour comes 700 ms after its start: t = 700.
    const first = tourRunAt(tourRunAt(run, 4000).run, 4487 + 700);
    expect(first).toMatchObject({ index: 1, t: 700, ended: false });
    expect(tourRunAt(run, 4487 + 2410)).toMatchObject({ index: 1, t: 2410, ended: false });
    expect(tourRunAt(run, 4487 + 2411)).toMatchObject({ index: 1, t: 2411, ended: true });
  });

  it('FR-342 the starts follow the scaled ends of the tours, not the nominal ones', () => {
    const scaled = buildTour({ kind: 'victim', result: 2, set: [1, 2, 3, 4, 5], sigma: 8, budget: 2700 });
    expect(scaled.end).toBe(2694);
    const run = startTourRun(500, [scaled, absorberTour()]);
    expect(tourRunAt(run, 500 + 2693)).toMatchObject({ index: 0, t: 2693 });
    expect(tourRunAt(run, 500 + 2694)).toMatchObject({ index: 1, t: 0 });
  });

  it('FR-342 an absorber tour hands over the step at the reading of its end frame', () => {
    const run = startTourRun(1000, [absorberTour()], true);
    const before = tourRunAt(run, 1000 + 2410);
    expect(before.step).toBeUndefined();
    expect(before.ended).toBe(false);
    const exact = tourRunAt(run, 1000 + 2411);
    expect(exact.ended).toBe(true);
    expect(exact.step).toStrictEqual({ startMs: 3411 });
    // The end frame came 37.5 ms late: the step starts at that frame's reading.
    const late = tourRunAt(run, 1000 + 2411 + 37.5);
    expect(late.step).toStrictEqual({ startMs: 3448.5 });
    // Once only.
    expect(tourRunAt(late.run, 4000).step).toBeUndefined();
  });

  it('FR-342 a run with no step after it hands over nothing', () => {
    const run = startTourRun(1000, [victimTour()]);
    const end = tourRunAt(run, 1000 + 3487);
    expect(end.ended).toBe(true);
    expect(end.step).toBeUndefined();
  });

  it('FR-342 a sequence ends the step handover only after its last tour', () => {
    const run = startTourRun(1000, [victimTour(), absorberTour()], true);
    expect(tourRunAt(run, 1000 + 3487).step).toBeUndefined();
    expect(tourRunAt(run, 1000 + 3487 + 2411 + 5).step).toStrictEqual({ startMs: 1000 + 3487 + 2411 + 5 });
  });

  it('FR-342 a gap over both tours of a sequence ends the run at once with the step', () => {
    const run = startTourRun(1000, [victimTour(), absorberTour()], true);
    const out = tourRunAt(run, 60000);
    expect(out).toMatchObject({ index: 1, ended: true, step: { startMs: 60000 } });
    expect(out.results).toStrictEqual([0, 1]);
  });

  it('FR-342 the result hook fires once, on the first frame with t at or above tau_H', () => {
    let run = startTourRun(1000, [victimTour()]);
    const fired: number[][] = [];
    const frames = [0, 500, 1686, 1687, 1688, 2000, 3486];
    for (const dt of frames) {
      const out = tourRunAt(run, 1000 + dt);
      fired.push([...out.results]);
      run = out.run;
    }
    expect(fired).toStrictEqual([[], [], [], [0], [], [], []]);
    // The end frame fires nothing more.
    expect(tourRunAt(run, 1000 + 3487).results).toStrictEqual([]);
  });

  it('FR-342 a frame that jumps past tau_H fires the hook once', () => {
    const run = startTourRun(1000, [victimTour()]);
    const jump = tourRunAt(run, 1000 + 2500);
    expect(jump.results).toStrictEqual([0]);
    expect(tourRunAt(jump.run, 1000 + 2516).results).toStrictEqual([]);
  });

  it('FR-342 the hook of each tour of a sequence fires on its own tau_H, in order', () => {
    let run = startTourRun(0, [victimTour(), absorberTour()]);
    const seen: Array<[number, number[]]> = [];
    for (const reading of [100, 1687, 1700, 3487, 3487 + 1310, 3487 + 1311, 3487 + 1400]) {
      const out = tourRunAt(run, reading);
      if (out.results.length > 0) seen.push([reading, [...out.results]]);
      run = out.run;
    }
    expect(seen).toStrictEqual([
      [1687, [0]],
      [3487 + 1311, [1]],
    ]);
  });

  it('FR-342 a still tour (tau_H = 0) fires its hook on the first frame', () => {
    const still = buildTour({ kind: 'victim', result: 2, set: [1, 2, 3], sigma: 3, still: true });
    const out = tourRunAt(startTourRun(70, [still]), 70);
    expect(out.results).toStrictEqual([0]);
    expect(out.t).toBe(0);
  });

  it('FR-342 complete gives the final state and the step at once, firing the hooks not fired yet', () => {
    const run = startTourRun(1000, [victimTour(), absorberTour()], true);
    const mid = tourRunAt(run, 1000 + 500);
    const done = completeTourRun(mid.run, 1999.5);
    expect(done).toMatchObject({ index: 1, t: 2411, ended: true, step: { startMs: 1999.5 } });
    expect(done.results).toStrictEqual([0, 1]);
    expect(done.run.done).toBe(true);
    // Completing twice, or reading a frame later, does nothing more.
    const again = completeTourRun(done.run, 2100);
    expect(again.ended).toBe(false);
    expect(again.step).toBeUndefined();
    expect(again.results).toStrictEqual([]);
    expect(tourRunAt(done.run, 2200).step).toBeUndefined();
  });

  it('FR-342 complete after a hook already fired fires only the others', () => {
    const run = startTourRun(0, [victimTour(), absorberTour()]);
    const past = tourRunAt(run, 2000);
    expect(past.results).toStrictEqual([0]);
    expect(completeTourRun(past.run, 2001).results).toStrictEqual([1]);
  });

  it('FR-344 a change of the reduced-motion preference completes the run at once', () => {
    const run = startTourRun(1000, [absorberTour()], true);
    const out = motionChangedTourRun(run, 1500);
    expect(out).toMatchObject({ index: 0, t: 2411, ended: true, step: { startMs: 1500 } });
    expect(out.results).toStrictEqual([0]);
    expect(out.run.done).toBe(true);
    expect(motionChangedTourRun(out.run, 1600).ended).toBe(false);
    const alone = motionChangedTourRun(startTourRun(1000, [victimTour()]), 1100);
    expect(alone.ended).toBe(true);
    expect(alone.step).toBeUndefined();
  });

  it('FR-342 the inputs are not modified', () => {
    const tours = [victimTour(), absorberTour()];
    const snapshot = JSON.stringify(tours);
    const run: TourRun = startTourRun(1000, tours, true);
    const runSnapshot = JSON.stringify(run);
    Object.freeze(tours);
    Object.freeze(run);
    for (const reading of [1000, 2000, 5000, 9000]) tourRunAt(run, reading);
    completeTourRun(run, 3000);
    motionChangedTourRun(run, 3100);
    expect(JSON.stringify(tours)).toBe(snapshot);
    expect(JSON.stringify(run)).toBe(runSnapshot);
  });

  it('FR-342 the driver reads no clock', () => {
    const boom = (): number => {
      throw new Error('clock read');
    };
    vi.spyOn(Date, 'now').mockImplementation(boom);
    vi.spyOn(performance, 'now').mockImplementation(boom);
    const run = startTourRun(1000, [victimTour(), absorberTour()], true);
    expect(() => {
      tourRunAt(run, 2000);
      completeTourRun(run, 2100);
      motionChangedTourRun(run, 2200);
    }).not.toThrow();
  });

  it('FR-342 a run needs at least one tour', () => {
    expect(() => startTourRun(0, [])).toThrow(RangeError);
  });
});
