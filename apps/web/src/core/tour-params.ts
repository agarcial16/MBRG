// Parameters of the reveal tours (spec 009). Pure data: every number of the spec in one place.
// Values are the planner proposals P3, P4, P6, P7, P10, P12, P17, confirmed with the review screenshots.

/** Timing of one kind of tour, in whole milliseconds. */
export interface TourTiming {
  /** H: number of stops (the victim tour uses `pairStops` instead when only two factions are alive). */
  readonly stops: number;
  /** dmin and dmax: the first and the last dwell of the quadratic slow-down. */
  readonly dwellMin: number;
  readonly dwellMax: number;
  /** Dhold: how long the last stop stays fully dark around it. */
  readonly hold: number;
  /** Dfade: duration of the fade in and of the fade out of the dim. */
  readonly fade: number;
}

export interface TourParams {
  readonly victim: TourTiming & { readonly pairStops: number };
  readonly absorber: TourTiming;
  /** Still tour of the reduced-motion preference: one stop, no camera, hold and fades only. */
  readonly still: { readonly hold: number; readonly fade: number };
  /** delta max: the largest fraction by which the rest of the map is darkened (35 % brightness). */
  readonly dimMax: number;
  /** Camera easings, in milliseconds. */
  readonly cameraIn: number;
  readonly cameraOut: number;
  readonly cameraAbsorber: number;
  /** Framing: the share of the drawing area the box fills, and the cap in multiples of the fit scale. */
  readonly framingShare: number;
  readonly framingMaxFit: number;
  /** Tiny faction: box smaller than this many CSS pixels in both sides; marker and indicator sizes. */
  readonly tinyPx: number;
  readonly markerBasePx: number;
  readonly markerWidthPx: number;
  readonly indicatorPx: number;
  /** Dlate: oldest reveal that still plays; margin kept before the next cutoff; smallest scale. */
  readonly lateMs: number;
  readonly marginMs: number;
  readonly minScale: number;
}

export const TOUR_PARAMS: TourParams = {
  victim: { stops: 12, pairStops: 6, dwellMin: 120, dwellMax: 700, hold: 1500, fade: 300 },
  absorber: { stops: 6, dwellMin: 120, dwellMax: 500, hold: 800, fade: 300 },
  still: { hold: 1500, fade: 300 },
  dimMax: 0.65,
  cameraIn: 800,
  cameraOut: 1200,
  cameraAbsorber: 800,
  framingShare: 0.5,
  framingMaxFit: 4,
  tinyPx: 24,
  markerBasePx: 16,
  markerWidthPx: 2,
  indicatorPx: 12,
  lateMs: 5000,
  marginMs: 1000,
  minScale: 0.5,
};
