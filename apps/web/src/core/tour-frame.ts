// One frame of a reveal tour (spec 009, plan 4.5): what is lit, the dim, the label factors, the camera,
// the marker and the edge indicator. Pure: a function of the tour, the elapsed time, the drawing area, the
// image, the start camera and whether the user took the camera (FR-354). It never says which faction is the
// result (FR-353).
import { mapToScreen } from './camera';
import type { Camera, ImageSize, Viewport } from './camera';
import { instantLabels } from './label-frame';
import type { AnyLabelDraw, RoundLabels } from './label-frame';
import { dimAt } from './tour';
import type { Tour } from './tour';
import { cameraAt } from './tour-camera';
import type { Box } from './tour-camera';
import { TOUR_PARAMS } from './tour-params';

/** A circle around a tiny highlight, in CSS pixels (FR-329). */
export interface Marker {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** The tip of the edge triangle in CSS pixels and the angle (radians) it points along (FR-333). */
export interface Indicator {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface TourFrame {
  /** Faction indices drawn as without a tour; none outside a tour. */
  readonly lit: readonly number[];
  readonly dim: number;
  /** Opacity factors of the labels: lit faction labels, and every other label and leader line. */
  readonly factors: { readonly lit: 1; readonly other: number };
  /** The tour camera at t; absent when the user took the camera. */
  readonly camera?: Camera;
  readonly marker?: Marker;
  readonly indicator?: Indicator;
  /** True from the last stop on. */
  readonly resultShown: boolean;
  readonly ended: boolean;
}

/** The drawing context of a frame. When the user took the camera, `current` is the camera on screen. */
export type TourView = { readonly area: Viewport; readonly image: ImageSize; readonly start: Camera } & (
  | { readonly taken: false }
  | { readonly taken: true; readonly current: Camera }
);

/** The stop shown at t: the last one whose start instant is not after t (the first before the start). */
function highlightAt(tour: Tour, t: number): number {
  let i = 0;
  while (i + 1 < tour.at.length && tour.at[i + 1]! <= t) i++;
  return tour.stops[i]!;
}

/** Marker and indicator of the highlight at the camera the frame is drawn with. */
function overlayFor(box: Box, cam: Camera, area: Viewport): { marker?: Marker; indicator?: Indicator } {
  const a = mapToScreen(cam, { x: box.x0, y: box.y0 }, area);
  const b = mapToScreen(cam, { x: box.x1, y: box.y1 }, area);
  const w = b.sx - a.sx;
  const h = b.sy - a.sy;
  const cx = (a.sx + b.sx) / 2;
  const cy = (a.sy + b.sy) / 2;
  const out: { marker?: Marker; indicator?: Indicator } = {};
  if (w < TOUR_PARAMS.tinyPx && h < TOUR_PARAMS.tinyPx) {
    out.marker = { x: cx, y: cy, r: TOUR_PARAMS.markerBasePx + Math.hypot(w, h) / 2 };
  }
  const outside = b.sx <= 0 || a.sx >= area.width || b.sy <= 0 || a.sy >= area.height;
  if (outside) {
    const dx = cx - area.width / 2;
    const dy = cy - area.height / 2;
    const inset = TOUR_PARAMS.indicatorPx;
    const sx = dx === 0 ? Infinity : (area.width / 2 - inset) / Math.abs(dx);
    const sy = dy === 0 ? Infinity : (area.height / 2 - inset) / Math.abs(dy);
    const s = Math.min(sx, sy);
    out.indicator = { x: area.width / 2 + dx * s, y: area.height / 2 + dy * s, angle: Math.atan2(dy, dx) };
  }
  return out;
}

/** The frame at elapsed time t. From the end instant on it is the final state (no dim, nothing lit). */
export function tourFrame(tour: Tour, t: number, view: TourView): TourFrame {
  const camera = view.taken ? undefined : cameraAt(tour, t, view.area, view.image, view.start);
  const cameraPart = camera === undefined ? {} : { camera };
  const resultShown = t >= tour.at[tour.at.length - 1]!;
  if (t >= tour.end) {
    return { lit: [], dim: 0, factors: { lit: 1, other: 1 }, ...cameraPart, resultShown: true, ended: true };
  }
  const dim = dimAt(tour, t);
  const highlight = highlightAt(tour, t);
  const lit = tour.victim === undefined ? [highlight] : [tour.victim, highlight];
  const box = tour.boxes.get(highlight);
  const shown = view.taken ? view.current : camera!;
  const overlay = box === undefined ? {} : overlayFor(box, shown, view.area);
  return {
    lit,
    dim,
    factors: { lit: 1, other: 1 - dim / TOUR_PARAMS.dimMax },
    ...cameraPart,
    ...overlay,
    resultShown,
    ended: false,
  };
}

/**
 * The label draws of a round during a tour: the order and content of `instantLabels`, with the faction
 * labels of lit factions at factor 1 and every other faction label, every territory label and its leader
 * line at the `other` factor (FR-327; the territory labels inside a lit faction are faded too).
 */
export function tourLabelDraws(round: RoundLabels, lit: readonly number[], other: number): AnyLabelDraw[] {
  const out: AnyLabelDraw[] = [];
  const faded = (d: AnyLabelDraw): AnyLabelDraw => (other === 1 ? d : { ...d, factor: other });
  for (const l of [...round.factions].sort((a, b) => a.faction - b.faction)) {
    const d = instantLabels({ factions: [l], territories: [] })[0];
    if (d !== undefined) out.push(lit.includes(l.faction) ? d : faded(d));
  }
  for (const l of [...round.territories].sort((a, b) => a.entry - b.entry)) {
    const d = instantLabels({ factions: [], territories: [l] })[0];
    if (d !== undefined) out.push(faded(d));
  }
  return out;
}
