import { describe, expect, it } from 'vitest';
import type { Camera } from '../src/core/camera';
import { buildTour } from '../src/core/tour';
import type { Tour } from '../src/core/tour';
import { cameraAt, framing, overview } from '../src/core/tour-camera';
import type { Box } from '../src/core/tour-camera';
import { tourFrame } from '../src/core/tour-frame';
import {
  beginSession,
  completeSession,
  frozenStart,
  freezeSession,
  motionChangedSession,
  paintSession,
  planTours,
  sameStatus,
  takeCamera,
} from '../src/core/tour-session';
import type { BoxesOf, SessionView, TourRequest, TourSession } from '../src/core/tour-session';

// The session of tours in the map view (FR-333, FR-335, FR-339, FR-340, FR-342, FR-344 (shell)): a pure state machine, so
// the map view only applies what it answers. Hand-derived figures (plan 4.3): victim tour with 5 factions D = 5,349 and
// tau_H = 3,549; with 2 factions D = 3,487 and tau_H = 1,687; absorber tour D = 2,411 and tau_H = 1,311.

const IMAGE = { w: 400, h: 200 };
const AREA = { width: 500, height: 250 };
const BOXES = new Map<number, Box>([
  [5, { x0: 10, y0: 100, x1: 30, y1: 120 }],
  [7, { x0: 100, y0: 50, x1: 180, y1: 90 }],
  [8, { x0: 300, y0: 120, x1: 340, y1: 150 }],
  [9, { x0: 20, y0: 10, x1: 60, y1: 40 }],
  [11, { x0: 200, y0: 60, x1: 210, y1: 66 }],
]);
const boxesOf: BoxesOf = (factions) => new Map(factions.flatMap((f) => (BOXES.has(f) ? [[f, BOXES.get(f)!] as [number, Box]] : [])));
const view = (current: Camera = { x: 200, y: 100, scale: 1.25 }): SessionView => ({ area: AREA, image: IMAGE, current });
const CAMERA: Camera = { x: 60, y: 30, scale: 3 };
const T0 = 9000.5;

const victimRequest: TourRequest = { kind: 'victim', result: 7, set: [5, 7, 8, 9, 11], sigma: 1234567891 };
const absorberRequest: TourRequest = { kind: 'absorber', result: 8, set: [8, 9], victim: 7, sigma: 3000000019 };

const victim = (): Tour => planTours([victimRequest], false, boxesOf).tours[0]!;
const absorber = (): Tour => planTours([absorberRequest], false, boxesOf).tours[0]!;
const begun = (requests: TourRequest[], step: boolean, reduced = false): TourSession =>
  beginSession(planTours(requests, reduced, boxesOf), T0, { camera: CAMERA }, step);

describe('planTours: the view applies reduced motion and the budget to each request', () => {
  it('the nominal tours have the hand-derived durations and the framing boxes of their own factions', () => {
    const plan = planTours([victimRequest, absorberRequest], false, boxesOf);
    expect(plan.tours.map((t) => t.end)).toStrictEqual([5349, 2411]);
    expect(plan.tours.map((t) => t.at[t.at.length - 1])).toStrictEqual([3549, 1311]);
    expect(plan.stills).toStrictEqual([false, false]);
    expect([...plan.tours[0]!.boxes.keys()].sort((a, b) => a - b)).toStrictEqual([5, 7, 8, 9, 11]);
    // The absorber tour frames the victim and the candidates only.
    expect([...plan.tours[1]!.boxes.keys()].sort((a, b) => a - b)).toStrictEqual([7, 8, 9]);
    expect(plan.tours[0]!.legs).toHaveLength(2);
    // The absorber tour eases back to the overview at its end (FR-334).
    expect(plan.tours[1]!.legs).toHaveLength(2);
  });

  it('reduced motion: the victim tour becomes the still tour of 1,800 ms without camera legs, the absorber tour is dropped', () => {
    const plan = planTours([victimRequest, absorberRequest], true, boxesOf);
    expect(plan.tours).toHaveLength(1);
    expect(plan.stills).toStrictEqual([true]);
    expect(plan.tours[0]!.end).toBe(1800);
    expect(plan.tours[0]!.legs).toStrictEqual([]);
    expect(plan.tours[0]!.stops).toStrictEqual([7]);
  });

  it('a budget scales the tour (floor of each duration), and one below half of D drops it', () => {
    const scaled = planTours([{ ...victimRequest, budget: 4000 }], false, boxesOf);
    expect(scaled.tours[0]!.end).toBeLessThanOrEqual(4000);
    expect(scaled.tours[0]!.end).toBeGreaterThan(3900);
    expect(planTours([{ ...victimRequest, budget: 2674 }], false, boxesOf).tours).toStrictEqual([]);
    expect(planTours([{ ...victimRequest, budget: 2675 }], false, boxesOf).tours).toHaveLength(1);
    // The absorber tour of the chain is judged on its own budget.
    const chain = planTours([victimRequest, { ...absorberRequest, budget: 1000 }], false, boxesOf);
    expect(chain.tours.map((t) => t.kind)).toStrictEqual(['victim']);
  });

  it('a session needs at least one tour', () => {
    expect(() => beginSession(planTours([absorberRequest], true, boxesOf), T0, { camera: CAMERA }, true)).toThrow(RangeError);
  });
});

describe('FR-342 (shell) paintSession takes t from the reading, counted from the handling reading', () => {
  it('t = 0 at the handling reading and the frame of a later reading draws that elapsed time', () => {
    const s = begun([victimRequest], false);
    const first = paintSession(s, T0, view());
    expect(first.frame).toStrictEqual(tourFrame(victim(), 0, { area: AREA, image: IMAGE, start: CAMERA, taken: false }));
    const late = paintSession(first.session!, T0 + 1000.25, view());
    expect(late.frame).toStrictEqual(tourFrame(victim(), 1000.25, { area: AREA, image: IMAGE, start: CAMERA, taken: false }));
  });

  it('the tour ends on the first frame at or past D: the final state, no session left, the end reported once', () => {
    let s: TourSession | undefined = begun([victimRequest], false);
    const ended: number[] = [];
    for (const dt of [0, 100, 3548.5, 3549, 5348.75, 5349, 5400]) {
      if (s === undefined) break;
      const out = paintSession(s, T0 + dt, view());
      if (out.ended) ended.push(dt);
      s = out.session;
    }
    expect(ended).toStrictEqual([5349]);
    expect(s).toBeUndefined();
    const last = paintSession(begun([victimRequest], false), T0 + 6000, view());
    expect(last.frame).toMatchObject({ lit: [], dim: 0, ended: true });
    expect(last.session).toBeUndefined();
  });

  it('the result hook fires on the first frame at or past tau_H, once', () => {
    let s: TourSession | undefined = begun([victimRequest], false);
    const fired: [number, readonly number[]][] = [];
    for (const dt of [0, 3548.5, 3549, 4000, 5000]) {
      const out = paintSession(s!, T0 + dt, view());
      fired.push([dt, out.results]);
      s = out.session;
    }
    expect(fired).toStrictEqual([[0, []], [3548.5, []], [3549, [0]], [4000, []], [5000, []]]);
  });

  it('the status tells the tour on screen, whether its result shows and whether the run ended', () => {
    const s = begun([victimRequest, absorberRequest], true);
    const a = paintSession(s, T0 + 100, view());
    expect(a.status).toStrictEqual({ index: 0, tour: 'victim', still: false, resultShown: false, ended: false, runEnded: false });
    const b = paintSession(a.session!, T0 + 3600, view());
    expect(b.status).toMatchObject({ tour: 'victim', resultShown: true, ended: false, runEnded: false });
    const c = paintSession(b.session!, T0 + 5349 + 100, view());
    expect(c.status).toMatchObject({ index: 1, tour: 'absorber', resultShown: false, runEnded: false });
    const d = paintSession(c.session!, T0 + 5349 + 2411, view());
    expect(d.status).toMatchObject({ tour: 'absorber', resultShown: true, ended: true, runEnded: true });
    expect(sameStatus(a.status, { ...a.status })).toBe(true);
    expect(sameStatus(a.status, b.status)).toBe(false);
  });
});

describe('FR-340 (completeRunning) FR-345 the round step follows the last tour and nothing earlier', () => {
  it('the step is handed over only on the ending frame, with that frame as its start', () => {
    let s: TourSession | undefined = begun([victimRequest, absorberRequest], true);
    const steps: [number, number | undefined][] = [];
    for (const dt of [0, 2000, 5349, 5349 + 1311, 5349 + 2410.5, 5349 + 2411.25]) {
      const out = paintSession(s!, T0 + dt, view());
      steps.push([dt, out.step?.startMs]);
      s = out.session;
    }
    expect(steps.filter(([, start]) => start !== undefined)).toStrictEqual([[5349 + 2411.25, T0 + 5349 + 2411.25]]);
    expect(s).toBeUndefined();
  });

  it('the absorber tour starts at the end instant of the victim tour, from the camera the victim tour left', () => {
    const s = begun([victimRequest, absorberRequest], true);
    const out = paintSession(s, T0 + 5349, view());
    expect(out.status.index).toBe(1);
    const left = cameraAt(victim(), 5349, AREA, IMAGE, CAMERA);
    expect(left).toStrictEqual(framing(BOXES.get(7)!, IMAGE, AREA));
    expect(out.frame.camera).toStrictEqual(cameraAt(absorber(), 0, AREA, IMAGE, left));
  });

  it('no step is handed over when none follows the tours', () => {
    const out = paintSession(begun([victimRequest], false), T0 + 5349, view());
    expect(out.ended).toBe(true);
    expect(out.step).toBeUndefined();
  });
});

describe('NFR-58 (pure part) the round-k views are asked for on the second painted frame, once, and only when a step follows', () => {
  it('prepare is false on the first frame and true on the second', () => {
    const s = begun([absorberRequest], true);
    const first = paintSession(s, T0, view());
    expect(first.prepare).toBe(false);
    const second = paintSession(first.session!, T0 + 16.5, view());
    expect(second.prepare).toBe(true);
    const third = paintSession(second.session!, T0 + 33, view());
    expect(third.prepare).toBe(false);
  });

  it('with no step to follow nothing is ever asked for', () => {
    let s: TourSession | undefined = begun([victimRequest], false);
    for (const dt of [0, 16, 32, 5349]) {
      const out = paintSession(s!, T0 + dt, view());
      expect(out.prepare, String(dt)).toBe(false);
      s = out.session;
    }
  });

  it('a run that ends on its first frame still asks for the views (the step needs them)', () => {
    const out = paintSession(begun([absorberRequest], true), T0 + 9999, view());
    expect(out.ended).toBe(true);
    expect(out.prepare).toBe(true);
  });
});

describe('FR-333 (shell) the user takes the camera; the tour camera never does', () => {
  it('a painted frame carries the tour camera and leaves the camera untaken', () => {
    let s: TourSession | undefined = begun([victimRequest], false);
    for (const dt of [0, 500, 3000, 4000]) {
      const out = paintSession(s!, T0 + dt, view());
      expect(out.frame.camera, String(dt)).toBeDefined();
      expect(out.session!.taken, String(dt)).toBe(false);
      s = out.session;
    }
  });

  it('after takeCamera no frame carries a camera, and stops, dim and marker go on from the camera on screen', () => {
    const user: Camera = { x: 20, y: 20, scale: 40 };
    const s = takeCamera(begun([victimRequest], false))!;
    expect(s.taken).toBe(true);
    for (const dt of [0, 1000, 3000, 4000, 5000]) {
      const out = paintSession(s, T0 + dt, view(user));
      expect(out.frame.camera, String(dt)).toBeUndefined();
      expect(out.frame).toStrictEqual(tourFrame(victim(), dt, { area: AREA, image: IMAGE, start: CAMERA, taken: true, current: user }));
    }
  });

  it('taking the camera of nothing is nothing', () => {
    expect(takeCamera(undefined)).toBeUndefined();
  });
});

describe('FR-339 FR-344 (shell) completing a tour: strict no-op when no tour runs', () => {
  it('completeSession of no session, and of a frozen session, is a strict no-op (it must not touch a plain round step)', () => {
    expect(completeSession(undefined, T0, view())).toBeUndefined();
    const frozen = freezeSession(victim(), false, 1000, { overview: true }, false);
    expect(completeSession(frozen, T0, view())).toBeUndefined();
    expect(motionChangedSession(undefined, T0, view())).toBeUndefined();
    expect(motionChangedSession(frozen, T0, view())).toBeUndefined();
  });

  it('completing a running session gives the final state of the last tour, every pending hook and the step at that reading', () => {
    const s = begun([victimRequest, absorberRequest], true);
    const first = paintSession(s, T0 + 10, view());
    const out = completeSession(first.session, T0 + 700.5, view())!;
    expect(out.ended).toBe(true);
    expect(out.results).toStrictEqual([0, 1]);
    expect(out.step).toStrictEqual({ startMs: T0 + 700.5 });
    expect(out.session).toBeUndefined();
    expect(out.frame).toMatchObject({ lit: [], dim: 0, ended: true });
    expect(out.status).toMatchObject({ tour: 'absorber', runEnded: true });
    expect(out.prepare).toBe(true);
    // The views were already asked for on the second frame: not again.
    const inAbsorber = paintSession(first.session!, T0 + 5349 + 10, view());
    const second = paintSession(inAbsorber.session!, T0 + 5349 + 26, view());
    expect(second.prepare).toBe(true);
    expect(completeSession(second.session, T0 + 5349 + 700.5, view())!.prepare).toBe(false);
  });

  it('a reduced-motion change completes the run the same way (FR-344 (shell))', () => {
    const s = begun([victimRequest], false);
    const out = motionChangedSession(s, T0 + 50, view())!;
    expect(out).toMatchObject({ ended: true, results: [0] });
    expect(out.step).toBeUndefined();
    expect(out.session).toBeUndefined();
  });
});

describe('FR-351 (frozen drawing) a frozen tour draws t with no clock', () => {
  it('the frame is the tour frame at t, whatever the reading, and the session stays', () => {
    const s = freezeSession(victim(), false, 1000, { overview: true }, false);
    const a = paintSession(s, 5, view());
    const b = paintSession(a.session!, 99999, view());
    const want = tourFrame(victim(), 1000, { area: AREA, image: IMAGE, start: overview(IMAGE, AREA), taken: false });
    expect(a.frame).toStrictEqual(want);
    expect(b.frame).toStrictEqual(want);
    expect(b.session).toBeDefined();
    expect(b.results).toStrictEqual([]);
    expect(b.ended).toBe(false);
    expect(b.step).toBeUndefined();
    expect(b.prepare).toBe(false);
  });

  it('with the address camera (taken) the frame carries no camera', () => {
    const s = freezeSession(victim(), false, 1000, { overview: true }, true);
    expect(paintSession(s, 0, view()).frame.camera).toBeUndefined();
  });

  it('the start camera of a frozen tour follows the scene: the overview for a victim tour, the victim framing for an absorber tour', () => {
    expect(frozenStart({ ...victimRequest }, boxesOf)).toStrictEqual({ overview: true });
    expect(frozenStart({ ...absorberRequest }, boxesOf)).toStrictEqual({ framed: BOXES.get(7) });
    // A victim without land has no framing: the overview.
    expect(frozenStart({ ...absorberRequest, victim: 99 }, boxesOf)).toStrictEqual({ overview: true });
    const s = freezeSession(absorber(), false, 0, frozenStart(absorberRequest, boxesOf), false);
    expect(paintSession(s, 0, view()).frame.camera).toStrictEqual(cameraAt(absorber(), 0, AREA, IMAGE, framing(BOXES.get(7)!, IMAGE, AREA)));
  });

  it('a resized area gives the frame of the same t for the new area (FR-335 (shell)), the start camera following the area', () => {
    const s = freezeSession(victim(), false, 700, { overview: true }, false);
    const bigger = { width: 800, height: 400 };
    const out = paintSession(s, 0, { area: bigger, image: IMAGE, current: CAMERA });
    expect(out.frame).toStrictEqual(tourFrame(victim(), 700, { area: bigger, image: IMAGE, start: overview(IMAGE, bigger), taken: false }));
  });
});

describe('the session over a still tour (reduced motion)', () => {
  it('the name of the still tour shows at once: its status says still, and the run ends at 1,800 ms', () => {
    const s = begun([victimRequest, absorberRequest], true, true);
    const a = paintSession(s, T0, view());
    expect(a.status).toMatchObject({ tour: 'victim', still: true });
    expect(a.frame.camera).toBeDefined();
    const end = paintSession(a.session!, T0 + 1800, view());
    expect(end).toMatchObject({ ended: true });
    expect(end.step).toStrictEqual({ startMs: T0 + 1800 });
  });
});

describe('NFR-58 (pure part) the round-k views are asked for during the LAST tour only', () => {
  /** The times (ms from the handling reading) at which `prepare` was true, painting every 16.5 ms to the end. */
  const prepareTimes = (requests: TourRequest[]): number[] => {
    let s: TourSession | undefined = begun(requests, true);
    const at: number[] = [];
    for (let dt = 0; s !== undefined && dt < 20000; dt += 16.5) {
      const out = paintSession(s, T0 + dt, view());
      if (out.prepare) at.push(dt);
      s = out.session;
    }
    return at;
  };

  it('victim then absorber: never during the victim tour (D 5,349), once on the second frame of the absorber tour', () => {
    const at = prepareTimes([victimRequest, absorberRequest]);
    expect(at).toHaveLength(1);
    // The absorber tour starts at 5,349: its first frame is the one at or after that instant, the second is the next one.
    expect(at[0]!).toBeGreaterThan(5349);
    expect(at[0]!).toBeLessThanOrEqual(5349 + 2 * 16.5);
  });

  it('victim then the step (no absorber tour): not during the victim tour, once on the ending frame', () => {
    const at = prepareTimes([victimRequest]);
    expect(at).toHaveLength(1);
    expect(at[0]!).toBeGreaterThanOrEqual(5349);
    expect(at[0]!).toBeLessThan(5349 + 16.5);
  });

  it('absorber alone: once, on its second frame', () => {
    const at = prepareTimes([absorberRequest]);
    expect(at).toStrictEqual([16.5]);
  });

  it('completing a chain during the victim tour still asks once (the step needs the views)', () => {
    const first = paintSession(begun([victimRequest, absorberRequest], true), T0 + 10, view());
    const second = paintSession(first.session!, T0 + 26, view());
    expect(second.prepare).toBe(false);
    expect(completeSession(second.session, T0 + 700, view())!.prepare).toBe(true);
  });
});

describe('FR-348 the ending frame carries the camera the tours left (the step then starts with the camera at the framing)', () => {
  it('FR-348 the ending frame of a run with a step has the framing of the last tour, also when it is painted long after the end', () => {
    for (const late of [0, 1, 5000]) {
      const out = paintSession(begun([victimRequest, absorberRequest], true), T0 + 5349 + 2411 + late, view());
      expect(out.ended).toBe(true);
      expect(out.step).toBeDefined();
      const left = cameraAt(victim(), 5349, AREA, IMAGE, CAMERA);
      expect(out.frame.camera).toStrictEqual(cameraAt(absorber(), 2411, AREA, IMAGE, left));
    }
  });

  it('FR-348 a completion (skip, request, dropped frames) also carries that camera', () => {
    const first = paintSession(begun([victimRequest, absorberRequest], true), T0 + 10, view());
    const out = completeSession(first.session, T0 + 700, view())!;
    const left = cameraAt(victim(), 5349, AREA, IMAGE, CAMERA);
    expect(out.frame.camera).toStrictEqual(cameraAt(absorber(), 2411, AREA, IMAGE, left));
  });
});
