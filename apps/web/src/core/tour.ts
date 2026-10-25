// The reveal tour (spec 009): stops, timing and camera legs. Pure; this part holds the stops and the timing.
import { smoothstep } from './lines';
import { TOUR_PARAMS } from './tour-params';
import type { TourTiming } from './tour-params';
import { pick, tourStream } from './tour-key';
import type { TourKind } from './tour-key';
import type { Box } from './tour-camera';

/**
 * What the stops depend on, and nothing else (FR-317): the kind, the result the tour ends on, the factions
 * it visits and sigma. No absorber, record, state or round data can be passed.
 */
export interface StopsInput {
  readonly kind: TourKind;
  readonly result: number;
  readonly set: readonly number[];
  readonly sigma: number;
}

/** H: 12 stops for a victim tour with 3 or more participants, 6 with two, 6 for an absorber tour. */
export function stopCount(kind: TourKind, setSize: number): number {
  if (setSize < 2) throw new RangeError('a tour needs at least two factions');
  if (kind === 'absorber') return TOUR_PARAMS.absorber.stops;
  return setSize >= 3 ? TOUR_PARAMS.victim.stops : TOUR_PARAMS.victim.pairStops;
}

/**
 * The stops s_1 ... s_H, drawn backwards from s_H = result with the stream of sigma. The set is sorted
 * ascending first, so the input order does not matter. For i = H-1 down to 1, s_i is drawn from the set
 * minus s_{i+1} ... s_H, or from the set minus s_{i+1} when that is empty.
 */
export function drawStops(input: StopsInput): number[] {
  const set = [...new Set(input.set)].sort((a, b) => a - b);
  if (!set.includes(input.result)) throw new RangeError('the result must belong to the set');
  const count = stopCount(input.kind, set.length);
  const stream = tourStream(input.sigma);
  const stops = new Array<number>(count);
  stops[count - 1] = input.result;
  for (let i = count - 2; i >= 0; i--) {
    const used = new Set(stops.slice(i + 1));
    let eligible = set.filter((f) => !used.has(f));
    if (eligible.length === 0) {
      // Everyone was shown: repeat, never the same faction twice in a row and, if possible, never the result.
      eligible = set.filter((f) => f !== stops[i + 1] && f !== input.result);
      if (eligible.length === 0) eligible = set.filter((f) => f !== stops[i + 1]);
    }
    stops[i] = eligible[pick(stream, eligible.length)]!;
  }
  return stops;
}

/** What a tour is built from. `budget` is the time the tour may last (already decided by the caller). */
export interface TourSpec extends StopsInput {
  /** Scales every duration so the tour lasts at most this many ms; needs budget / D >= 0.5 (FR-336). */
  readonly budget?: number;
  /** The reduced-motion still tour: one stop, the result, hold and fades only (FR-343). */
  readonly still?: true;
  /** The victim of an absorber tour: its framing is part of the camera leg (FR-348). */
  readonly victim?: number;
  /** Framing box of every faction the camera may frame (the victim and the set); absent = no camera legs. */
  readonly boxes?: ReadonlyMap<number, Box>;
}

/** One easing of the camera: from instant `from`, over `duration` ms, to the overview or to the framing of factions. */
export interface Leg {
  readonly from: number;
  readonly duration: number;
  readonly to: 'overview' | readonly number[];
}

/** A tour in whole milliseconds from its start: stop i is highlighted from `at[i]`; the last stop is the result. */
export interface Tour {
  readonly kind: TourKind;
  readonly stops: readonly number[];
  readonly at: readonly number[];
  readonly hold: number;
  readonly fade: number;
  /** D: the instant the tour ends, in ms. */
  readonly end: number;
  readonly legs: readonly Leg[];
  readonly boxes: ReadonlyMap<number, Box>;
  /** The victim an absorber tour keeps undimmed (absent for a victim tour). */
  readonly victim?: number;
}

/** d_i for 1 <= i <= H - 1: dmin + floor((dmax - dmin) (i - 1)^2 / (H - 2)^2), in integers (no float error). */
function dwellOf(i: number, count: number, timing: TourTiming): number {
  return timing.dwellMin + Math.floor(((timing.dwellMax - timing.dwellMin) * (i - 1) ** 2) / (count - 2) ** 2);
}

/** The camera legs (FR-331, FR-332, FR-348); every duration is scaled like the rest of the tour. */
function legsOf(spec: TourSpec, lastStop: number, scale: (x: number) => number): Leg[] {
  if (spec.kind === 'victim') {
    return [
      { from: 0, duration: scale(TOUR_PARAMS.cameraIn), to: 'overview' },
      { from: lastStop, duration: scale(TOUR_PARAMS.cameraOut), to: [spec.result] },
    ];
  }
  if (spec.victim === undefined) return [];
  const candidates = [...new Set(spec.set)].sort((a, b) => a - b);
  return [{ from: 0, duration: scale(TOUR_PARAMS.cameraAbsorber), to: [spec.victim, ...candidates] }];
}

/** Builds the stops, the instants, the hold, the fade and D, scaled by the budget when it is below D. */
export function buildTour(spec: TourSpec): Tour {
  const timing = spec.kind === 'absorber' ? TOUR_PARAMS.absorber : TOUR_PARAMS.victim;
  let stops: number[];
  let dwells: number[] = [];
  let hold: number;
  let fade: number;
  if (spec.still === true) {
    stops = [spec.result];
    hold = TOUR_PARAMS.still.hold;
    fade = TOUR_PARAMS.still.fade;
  } else {
    stops = drawStops(spec);
    dwells = Array.from({ length: stops.length - 1 }, (_, k) => dwellOf(k + 1, stops.length, timing));
    hold = timing.hold;
    fade = timing.fade;
  }
  const nominal = dwells.reduce((sum, d) => sum + d, 0) + hold + fade;
  const budget = spec.budget;
  let scale = (x: number): number => x;
  if (budget !== undefined) {
    if (!(budget * 2 >= nominal)) throw new RangeError('a budget below half of the tour is skipped, not scaled');
    if (budget < nominal) {
      scale = (x: number): number => Math.floor((x * budget) / nominal);
      dwells = dwells.map(scale);
      hold = scale(hold);
      fade = scale(fade);
    }
  }
  const at = [0];
  for (const d of dwells) at.push(at[at.length - 1]! + d);
  const lastStop = at[at.length - 1]!;
  return {
    kind: spec.kind,
    stops,
    at,
    hold,
    fade,
    end: lastStop + hold + fade,
    legs: spec.still === true || spec.boxes === undefined ? [] : legsOf(spec, lastStop, scale),
    boxes: spec.boxes ?? new Map(),
    ...(spec.kind === 'absorber' && spec.victim !== undefined ? { victim: spec.victim } : {}),
  };
}

/** delta(t): rises over the fade from 0, holds until the last stop plus the hold, fades out, and is 0 from D. */
export function dimAt(tour: Tour, t: number): number {
  if (t >= tour.end) return 0;
  const holdEnd = tour.at[tour.at.length - 1]! + tour.hold;
  if (t < holdEnd) return TOUR_PARAMS.dimMax * smoothstep(0, tour.fade, t);
  return TOUR_PARAMS.dimMax * (1 - smoothstep(0, tour.fade, t - holdEnd));
}
