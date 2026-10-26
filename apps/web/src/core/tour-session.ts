// The session of reveal tours in the map view (spec 009 FR-333, FR-335, FR-339 to FR-342, FR-344, FR-351; plan 8): a pure
// state machine over the tour core. The map view holds one session value, gives it the clock reading and the drawing
// area of each frame, and applies what it answers; nothing here reads a clock or touches the screen. A session is
// either a run (a clock reading starts it, t = 0 at the handling reading) or a frozen tour (a fixed t, no clock).
import type { Camera, ImageSize, Viewport } from './camera';
import { buildTour } from './tour';
import type { Tour, TourSpec } from './tour';
import { cameraAt, framing, overview } from './tour-camera';
import type { Box } from './tour-camera';
import { tourFrame } from './tour-frame';
import type { TourFrame, TourView } from './tour-frame';
import type { TourKind } from './tour-key';
import { viewChoice } from './tour-plan';
import { completeTourRun, motionChangedTourRun, startTourRun, tourRunAt } from './tour-playback';
import type { TourRun, TourTick } from './tour-playback';

/** What a caller asks the view to play: faction indices only (a victim tour has no absorber, FR-317). */
export interface TourRequest {
  readonly kind: TourKind;
  readonly result: number;
  readonly set: readonly number[];
  /** The victim of an absorber tour. */
  readonly victim?: number;
  readonly sigma: number;
  /** The raw time available (FR-336): the view decides scaling and skipping with it. */
  readonly budget?: number;
}

/** Framing box of every faction asked for that has land, from the label sets of the drawn round (PD6). */
export type BoxesOf = (factions: readonly number[]) => ReadonlyMap<number, Box>;

/** The tours the view plays for a list of requests, and whether each is a still tour. */
export interface TourPlan {
  readonly tours: readonly Tour[];
  readonly stills: readonly boolean[];
}

/**
 * The view's side of the decisions (PD3): reduced motion turns a victim tour into the still tour and drops an
 * absorber tour; a budget below half of D drops a tour (FR-336, FR-343, FR-350). The boxes are those of the drawn round.
 */
export function planTours(requests: readonly TourRequest[], reduced: boolean, boxesOf: BoxesOf): TourPlan {
  const tours: Tour[] = [];
  const stills: boolean[] = [];
  for (const r of requests) {
    const choice = viewChoice(r.kind, reduced, r.set.length, r.budget);
    if (!choice.play) continue;
    const framed = r.kind === 'absorber' && r.victim !== undefined ? [r.victim, ...r.set] : r.set;
    const spec: TourSpec = {
      kind: r.kind,
      result: r.result,
      set: r.set,
      sigma: r.sigma,
      ...(r.victim === undefined ? {} : { victim: r.victim }),
      ...(choice.budget === undefined ? {} : { budget: choice.budget }),
      ...(choice.still === true ? { still: true as const } : {}),
      boxes: boxesOf(framed),
    };
    tours.push(buildTour(spec));
    stills.push(choice.still === true);
  }
  return { tours, stills };
}

/**
 * Where the first tour's camera starts, always for the CURRENT area (so a resize needs no stored state): the camera
 * on screen when the tour began, the overview (a frozen victim tour: leg 1 is then a no-op), or the framing of a box
 * (a frozen absorber tour starts where a played victim tour would have left the camera).
 */
export type StartCamera = { readonly camera: Camera } | { readonly overview: true } | { readonly framed: Box };

/** The start camera of a frozen tour (plan 7): victim -> overview; absorber -> the victim's framing, else the overview. */
export function frozenStart(request: TourRequest, boxesOf: BoxesOf): StartCamera {
  if (request.kind === 'victim' || request.victim === undefined) return { overview: true };
  const box = boxesOf([request.victim]).get(request.victim);
  return box === undefined ? { overview: true } : { framed: box };
}

export interface TourSession {
  readonly tours: readonly Tour[];
  readonly stills: readonly boolean[];
  /** The clock run; absent for a frozen tour. */
  readonly run: TourRun | undefined;
  /** The fixed elapsed time of a frozen tour. */
  readonly frozenAt: number | undefined;
  readonly start: StartCamera;
  /** The user (or the address) took the camera: no frame carries a camera any more (FR-333). */
  readonly taken: boolean;
  /** A round step follows the last tour: the round-k views are asked for once, on the second frame (NFR-58). */
  readonly step: boolean;
  readonly painted: number;
  /** Frames painted of the LAST tour of the run (the round-k views are asked for on its second frame). */
  readonly lastTourPainted: number;
  readonly prepared: boolean;
}

/** What the view tells the session about the frame: the drawing area, the image and the camera on screen. */
export interface SessionView {
  readonly area: Viewport;
  readonly image: ImageSize;
  readonly current: Camera;
}

/** The tour on screen, as far as the panels need it; `runEnded` is true on the frame that ended the whole run. */
export interface TourStatus {
  readonly index: number;
  readonly tour: TourKind;
  readonly still: boolean;
  readonly resultShown: boolean;
  readonly ended: boolean;
  readonly runEnded: boolean;
}

export const sameStatus = (a: TourStatus, b: TourStatus): boolean =>
  a.index === b.index && a.tour === b.tour && a.still === b.still && a.resultShown === b.resultShown && a.ended === b.ended && a.runEnded === b.runEnded;

/** What one call answers: the frame to draw, what to keep, and the events of the frame. */
export interface SessionPaint {
  /** The session to keep; undefined once the run ended. */
  readonly session: TourSession | undefined;
  readonly frame: TourFrame;
  readonly status: TourStatus;
  /** Ask for the round-k views now (the second painted frame, once; or the ending frame if they are still missing). */
  readonly prepare: boolean;
  /** Indices of the tours whose result became visible on this frame, in order. */
  readonly results: readonly number[];
  readonly ended: boolean;
  /** Present on the ending frame when a round step follows: it starts at this reading. */
  readonly step?: { readonly startMs: number };
}

/** Starts a run at the handling reading (FR-342, D11). The plan must hold a tour. */
export function beginSession(plan: TourPlan, handlingMs: number, start: StartCamera, step: boolean): TourSession {
  const run = startTourRun(handlingMs, plan.tours, step);
  return { tours: plan.tours, stills: plan.stills, run, frozenAt: undefined, start, taken: false, step, painted: 0, lastTourPainted: 0, prepared: false };
}

/** A frozen tour of the debug scene (FR-351): `t` is fixed, no clock runs, `taken` is true when the address has a camera (D15). */
export function freezeSession(tour: Tour, still: boolean, t: number, start: StartCamera, taken: boolean): TourSession {
  return { tours: [tour], stills: [still], run: undefined, frozenAt: t, start, taken, step: false, painted: 0, lastTourPainted: 0, prepared: true };
}

/** The user took the camera (pan, zoom, reset): every easing of the tour stops (FR-333). Nothing running: nothing changes. */
export function takeCamera(session: TourSession | undefined): TourSession | undefined {
  return session === undefined ? undefined : { ...session, taken: true };
}

const startOf = (s: TourSession, index: number, view: SessionView): Camera => {
  if (index > 0) {
    const before = s.tours[index - 1]!;
    return cameraAt(before, before.end, view.area, view.image, startOf(s, index - 1, view));
  }
  const start = s.start;
  if ('camera' in start) return start.camera;
  if ('overview' in start) return overview(view.image, view.area);
  return framing(start.framed, view.image, view.area);
};

const frameOf = (s: TourSession, index: number, t: number, view: SessionView): TourFrame => {
  const base = { area: view.area, image: view.image, start: startOf(s, index, view) };
  const tv: TourView = s.taken ? { ...base, taken: true, current: view.current } : { ...base, taken: false };
  return tourFrame(s.tours[index]!, t, tv);
};

const statusOf = (s: TourSession, index: number, frame: TourFrame, runEnded: boolean): TourStatus => ({
  index,
  tour: s.tours[index]!.kind,
  still: s.stills[index]!,
  resultShown: frame.resultShown,
  ended: frame.ended,
  runEnded,
});

function answer(s: TourSession, tick: TourTick, view: SessionView, prepare: boolean): SessionPaint {
  const frame = frameOf(s, tick.index, tick.t, view);
  return {
    session: tick.ended
      ? undefined
      : { ...s, run: tick.run, painted: s.painted + 1, lastTourPainted: s.lastTourPainted + (tick.index === s.tours.length - 1 ? 1 : 0), prepared: s.prepared || prepare },
    frame,
    status: statusOf(s, tick.index, frame, tick.ended),
    prepare,
    results: tick.results,
    ended: tick.ended,
    ...(tick.step === undefined ? {} : { step: tick.step }),
  };
}

/** The frame at clock reading `nowMs` (a frozen session ignores it). */
export function paintSession(s: TourSession, nowMs: number, view: SessionView): SessionPaint {
  if (s.run === undefined) {
    const frame = frameOf(s, 0, s.frozenAt!, view);
    return { session: s, frame, status: statusOf(s, 0, frame, false), prepare: false, results: [], ended: false };
  }
  const tick = tourRunAt(s.run, nowMs);
  // Never during the victim tour (NFR-58, PD11): on the second frame of an ABSORBER tour that ends the run, else on the ending frame.
  const onAbsorber = s.tours[s.tours.length - 1]!.kind === 'absorber' && tick.index === s.tours.length - 1 && s.lastTourPainted >= 1;
  const prepare = s.step && !s.prepared && (onAbsorber || tick.ended);
  return answer(s, tick, view, prepare);
}

/**
 * Completes the running tours at once (a skip, a request, a halt, FR-339, FR-341): the final state, the hooks not fired and
 * the step from `nowMs`. No session, or a frozen one (nothing is running): a strict no-op, undefined, so the caller touches
 * nothing (it must not complete a plain 005 step).
 */
export function completeSession(s: TourSession | undefined, nowMs: number, view: SessionView): SessionPaint | undefined {
  if (s === undefined || s.run === undefined) return undefined;
  return answer(s, completeTourRun(s.run, nowMs), view, s.step && !s.prepared);
}

/** A change of the reduced-motion preference completes the run the same way (FR-344, 005 FR-184). */
export function motionChangedSession(s: TourSession | undefined, nowMs: number, view: SessionView): SessionPaint | undefined {
  if (s === undefined || s.run === undefined) return undefined;
  return answer(s, motionChangedTourRun(s.run, nowMs), view, s.step && !s.prepared);
}
