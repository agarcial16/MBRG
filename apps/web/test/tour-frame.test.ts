import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Camera } from '../src/core/camera';
import { drawable, instantLabels } from '../src/core/label-frame';
import type { AnyLabelDraw, RoundLabels } from '../src/core/label-frame';
import { LABEL_PARAMS } from '../src/core/label-params';
import { buildTour } from '../src/core/tour';
import type { Tour, TourSpec } from '../src/core/tour';
import { cameraAt } from '../src/core/tour-camera';
import type { Box } from '../src/core/tour-camera';
import { tourFrame, tourLabelDraws } from '../src/core/tour-frame';
import type { TourFrame, TourView } from '../src/core/tour-frame';

const IMAGE = { w: 400, h: 200 };
const AREA = { width: 500, height: 250 };
const START: Camera = { x: 60, y: 30, scale: 3 };
const BOXES = new Map<number, Box>([
  [5, { x0: 10, y0: 100, x1: 30, y1: 120 }],
  [7, { x0: 100, y0: 50, x1: 180, y1: 90 }],
  [8, { x0: 300, y0: 120, x1: 340, y1: 150 }],
  [9, { x0: 20, y0: 10, x1: 60, y1: 40 }],
]);
const SET = [5, 7, 8, 9];
const view: TourView = { area: AREA, image: IMAGE, start: START, taken: false };
const victimTour = (extra: Partial<TourSpec> = {}): Tour =>
  buildTour({ kind: 'victim', result: 7, set: SET, sigma: 1234567891, boxes: BOXES, ...extra });
const absorberTour = (): Tour =>
  buildTour({ kind: 'absorber', result: 8, set: [8, 9], victim: 7, sigma: 3000000019, boxes: BOXES });
// Two factions: H = 6, the last stop (the result 7) starts at 1,687 ms and the tour ends at 3,487 ms.
const pairTour = (box: Box): Tour => buildTour({ kind: 'victim', result: 7, set: [5, 7], sigma: 11, boxes: new Map([[7, box]]) });
const taken = (current: Camera): TourView => ({ area: AREA, image: IMAGE, start: START, taken: true, current });
/** The highlight read independently: the last stop whose start instant is not after t. */
const latestStop = (tour: Tour, t: number): number => {
  let i = 0;
  while (i + 1 < tour.at.length && tour.at[i + 1]! <= t) i++;
  return tour.stops[i]!;
};

afterEach(() => vi.restoreAllMocks());

describe('tour frame: highlight and lit set', () => {
  it('FR-328 the highlight is the latest stop at any t, with no crossfade', () => {
    const tour = victimTour();
    for (let t = 0; t < tour.end; t += 7) {
      const frame = tourFrame(tour, t, view);
      expect(frame.lit).toStrictEqual([latestStop(tour, t)]);
    }
    // A frame after three stops shows the third; one just before the fourth still shows the third.
    expect(tourFrame(tour, tour.at[2]! + 1, view).lit).toStrictEqual([tour.stops[2]]);
    expect(tourFrame(tour, tour.at[3]! - 1, view).lit).toStrictEqual([tour.stops[2]]);
    expect(tourFrame(tour, tour.at[3]!, view).lit).toStrictEqual([tour.stops[3]]);
    expect(tourFrame(tour, tour.at[11]!, view).lit).toStrictEqual([7]);
  });

  it('FR-328 a frame that skips several stops shows the latest one', () => {
    const tour = victimTour();
    expect(tourFrame(tour, tour.at[8]! + 3, view).lit).toStrictEqual([tour.stops[8]]);
    expect(tourFrame(tour, tour.at[11]! + 1000, view).lit).toStrictEqual([7]);
  });

  it('FR-327 the lit set of the victim tour is the highlight alone and that of the absorber tour adds the victim', () => {
    const victim = victimTour();
    const absorber = absorberTour();
    for (const t of [0, 90, 500, 1000, 3000, victim.end - 1]) {
      expect(tourFrame(victim, t, view).lit).toStrictEqual([latestStop(victim, t)]);
    }
    for (const t of [0, 130, 400, 900, absorber.end - 1]) {
      expect(tourFrame(absorber, t, view).lit).toStrictEqual([7, latestStop(absorber, t)]);
    }
    expect(tourFrame(absorber, absorber.end - 1, view).lit).toStrictEqual([7, 8]);
  });

  it('FR-347 the absorber tour keeps the victim and the highlighted candidate undimmed and the rest dark', () => {
    const tour = absorberTour();
    const frame = tourFrame(tour, tour.at[5]! + 300, view);
    expect(frame.lit).toStrictEqual([7, 8]);
    expect(frame.dim).toBe(0.65);
    expect(frame.factors).toStrictEqual({ lit: 1, other: 0 });
  });

  it('FR-328 the result flag turns on at the last stop', () => {
    const tour = victimTour();
    expect(tourFrame(tour, tour.at[11]! - 1, view).resultShown).toBe(false);
    expect(tourFrame(tour, tour.at[11]!, view).resultShown).toBe(true);
    expect(tourFrame(tour, tour.end + 5, view).resultShown).toBe(true);
  });
});

describe('tour frame: dim and label factors', () => {
  it('FR-327 the label factor of lit factions is 1 and that of the rest is 1 - dim / 0.65', () => {
    const tour = victimTour();
    expect(tourFrame(tour, 0, view).factors).toStrictEqual({ lit: 1, other: 1 });
    const half = tourFrame(tour, 150, view);
    expect(half.dim).toBeCloseTo(0.325, 12);
    expect(half.factors.lit).toBe(1);
    expect(half.factors.other).toBeCloseTo(0.5, 12);
    expect(tourFrame(tour, 299, view).factors.other).toBeCloseTo(1 - (1 - 3 / 300 ** 2 + 2 / 300 ** 3), 12);
    expect(tourFrame(tour, 300, view).factors).toStrictEqual({ lit: 1, other: 0 });
    expect(tourFrame(tour, 3600, view).factors).toStrictEqual({ lit: 1, other: 0 });
    expect(tourFrame(tour, tour.end - 1, view).factors.other).toBeGreaterThan(0.9999);
  });

  const round: RoundLabels = {
    factions: [
      { faction: 3, text: 'C', aspect: 2, box: { x0: 30, y0: 30, h: 4, w: 8 } },
      { faction: 1, text: 'A', aspect: 2, box: { x0: 4, y0: 4, h: 6, w: 12 } },
      { faction: 2, text: 'B', aspect: 2, box: undefined },
      { faction: 4, text: 'D', aspect: 2, box: { x0: 60, y0: 10, h: 5, w: 10 }, offLand: true, leader: { x1: 60, y1: 12, x2: 50, y2: 12 } },
    ],
    territories: [
      { entry: 9, text: 'nine', box: { x0: 40, y0: 40, h: 3, w: 9 } },
      { entry: 5, text: 'five', box: { x0: 8, y0: 8, h: 2, w: 6 } },
    ],
  };

  it('FR-327 the label draws keep the order and the content of the instant labels and equal them when other is 1', () => {
    expect(tourLabelDraws(round, [1], 1)).toStrictEqual(instantLabels(round));
    expect(tourLabelDraws(round, [], 1)).toStrictEqual(instantLabels(round));
    const both = tourLabelDraws(round, [1, 3], 0.4);
    expect(both).toHaveLength(instantLabels(round).length);
    expect(both.map((d) => d.text)).toStrictEqual(['A', 'C', 'D', 'five', 'nine']);
  });

  it('FR-327 lit faction labels keep factor 1; other faction labels, territory labels and leader lines get the other factor', () => {
    const draws = tourLabelDraws(round, [1, 3], 0.4);
    const byText = new Map<string, AnyLabelDraw>(draws.map((d) => [d.text, d]));
    expect(byText.get('A')!.factor).toBe(1);
    expect(byText.get('C')!.factor).toBe(1);
    expect(byText.get('D')!.factor).toBe(0.4);
    expect(byText.get('five')!.factor).toBe(0.4);
    expect(byText.get('nine')!.factor).toBe(0.4);
    const faded = byText.get('D')!;
    expect('leader' in faded ? faded.leader : undefined).toStrictEqual({ x1: 60, y1: 12, x2: 50, y2: 12 });
    // The territory labels inside a lit faction are faded too.
    expect(byText.get('five')!.factor).toBe(0.4);
  });

  it('FR-327 every label but the lit ones is hidden at full dark', () => {
    const draws = tourLabelDraws(round, [3], 0);
    // At scale 1.75 both roles have opacity 0.5, so only the factor decides.
    const hidden = draws.filter((d) => !drawable(d, 1.75, { ...LABEL_PARAMS, minPx: 1 }));
    expect(hidden.map((d) => d.text)).toStrictEqual(['A', 'D', 'five', 'nine']);
    expect(draws.filter((d) => d.factor === 1).map((d) => d.text)).toStrictEqual(['C']);
  });
});

describe('tour frame: marker and edge indicator', () => {
  // Two factions: the last stop (victim 7) starts at 1,687 ms.
  const T = 1687;

  it('FR-329 a faction is tiny below 24 CSS pixels in both sides only', () => {
    const tour = pairTour({ x0: 100, y0: 50, x1: 120, y1: 60 }); // 20 x 10 map units
    const at = (scale: number): TourFrame => tourFrame(tour, T, taken({ x: 110, y: 55, scale }));
    expect(at(1.15).marker).toBeDefined(); // 23 x 11.5
    expect(at(1.199).marker).toBeDefined(); // 23.98 x 11.995
    expect(at(1.2).marker).toBeUndefined(); // 24 x 12: the width is not below 24
    expect(at(2.5).marker).toBeUndefined();
    const tall = pairTour({ x0: 100, y0: 50, x1: 110, y1: 70 }); // 10 x 20
    expect(tourFrame(tall, T, taken({ x: 105, y: 60, scale: 1.2 })).marker).toBeUndefined(); // 12 x 24
    expect(tourFrame(tall, T, taken({ x: 105, y: 60, scale: 1.15 })).marker).toBeDefined(); // 11.5 x 23
  });

  it('FR-329 the marker is centred on the box with radius 16 plus half the on-screen diagonal', () => {
    const tour = pairTour({ x0: 100, y0: 50, x1: 120, y1: 60 });
    const marker = tourFrame(tour, T, taken({ x: 110, y: 55, scale: 1.15 })).marker!;
    expect(marker.x).toBeCloseTo(250, 9);
    expect(marker.y).toBeCloseTo(125, 9);
    // On screen 23 x 11.5: diagonal sqrt(661.25) = 25.7148, half 12.8574.
    expect(marker.r).toBeCloseTo(28.8574, 4);
    expect(marker.r).toBeCloseTo(16 + Math.hypot(23, 11.5) / 2, 9);
    // Off the camera centre: the marker follows the box.
    const moved = tourFrame(tour, T, taken({ x: 100, y: 50, scale: 1.15 })).marker!;
    expect(moved.x).toBeCloseTo(250 + 10 * 1.15, 9);
    expect(moved.y).toBeCloseTo(125 + 5 * 1.15, 9);
  });

  it('FR-329 the marker follows the highlight at the stop of the frame, not a later one', () => {
    const tour = buildTour({ kind: 'victim', result: 7, set: [5, 7], sigma: 11, boxes: new Map([[5, { x0: 300, y0: 100, x1: 304, y1: 104 }], [7, { x0: 100, y0: 50, x1: 104, y1: 54 }]]) });
    const cam = taken({ x: 200, y: 75, scale: 1 });
    const early = tourFrame(tour, 0, cam); // stop 1 is faction 5 (alternation, ends on 7)
    expect(tour.stops[0]).toBe(5);
    expect(early.marker!.x).toBeCloseTo(250 + (302 - 200), 9);
    const late = tourFrame(tour, T, cam);
    expect(late.marker!.x).toBeCloseTo(250 + (102 - 200), 9);
  });

  it('FR-333 an edge indicator is drawn only when the box is wholly outside the drawing area, tip on the inset rectangle', () => {
    const tour = pairTour({ x0: 10, y0: 100, x1: 30, y1: 120 });
    // Camera (300, 150) at scale 1: the box is at screen x -40..-20, y 75..95, left of the area.
    const left = tourFrame(tour, T, taken({ x: 300, y: 150, scale: 1 })).indicator!;
    // Direction (-280, -40) from the area centre (250, 125); the ray meets x = 12 first: s = 238 / 280 = 0.85.
    expect(left.x).toBeCloseTo(12, 9);
    expect(left.y).toBeCloseTo(91, 9);
    expect(left.angle).toBeCloseTo(-2.9996956, 6);
    const far = pairTour({ x0: 300, y0: 200, x1: 320, y1: 210 });
    // Camera (0, 0): the box is at screen x 550..570, y 325..335; direction (310, 205); the ray meets y = 238 first.
    const corner = tourFrame(far, T, taken({ x: 0, y: 0, scale: 1 })).indicator!;
    expect(corner.x).toBeCloseTo(250 + (310 * 113) / 205, 9);
    expect(corner.y).toBeCloseTo(238, 9);
    expect(corner.angle).toBeCloseTo(0.5842713, 6);
  });

  it('FR-333 no indicator when the box is partly or wholly visible', () => {
    const tour = pairTour({ x0: 10, y0: 100, x1: 30, y1: 120 });
    expect(tourFrame(tour, T, taken({ x: 270, y: 150, scale: 1 })).indicator).toBeUndefined(); // screen x -10..10: partly
    expect(tourFrame(tour, T, taken({ x: 20, y: 110, scale: 1 })).indicator).toBeUndefined(); // inside
  });

  it('FR-333 a taken camera gives no camera in the frame and the stops and the dim go on', () => {
    const tour = victimTour();
    const free = tourFrame(tour, 1000, view);
    const own = tourFrame(tour, 1000, taken({ x: 33, y: 44, scale: 2 }));
    expect(own.camera).toBeUndefined();
    expect(own.lit).toStrictEqual(free.lit);
    expect(own.dim).toBe(free.dim);
    expect(own.factors).toStrictEqual(free.factors);
  });

  it('FR-333 without a taken camera the frame carries the tour camera at t', () => {
    const tour = victimTour();
    for (const t of [0, 400, 900, 3549, 4200, 5000, 9000]) {
      expect(tourFrame(tour, t, view).camera).toStrictEqual(cameraAt(tour, t, AREA, IMAGE, START));
    }
  });
});

describe('tour frame: end and purity', () => {
  it('FR-328 at the end instant the frame is the final state: no dim, no lit, no marker, no indicator', () => {
    const tour = victimTour();
    for (const t of [tour.end, tour.end + 1, tour.end + 99999]) {
      const frame = tourFrame(tour, t, taken({ x: 300, y: 150, scale: 1 }));
      expect(frame).toStrictEqual({ lit: [], dim: 0, factors: { lit: 1, other: 1 }, resultShown: true, ended: true });
    }
    const last = tourFrame(tour, tour.end - 1, view);
    expect(last.ended).toBe(false);
    expect(last.lit).toStrictEqual([7]);
  });

  it('FR-334 the final frame of a free camera keeps the camera where the tour left it', () => {
    const tour = victimTour();
    const frame = tourFrame(tour, tour.end + 40, view);
    expect(frame.camera).toStrictEqual({ x: 140, y: 70, scale: 1.5 });
    expect(frame.lit).toStrictEqual([]);
  });

  it('FR-353 the frame type holds only the lit set, the dim, the label factors, the camera, the marker, the indicator and two flags', () => {
    expectTypeOf<keyof TourFrame>().toEqualTypeOf<'lit' | 'dim' | 'factors' | 'camera' | 'marker' | 'indicator' | 'resultShown' | 'ended'>();
    const tour = victimTour();
    for (const t of [0, 800, 3549, 5000]) {
      const keys = Object.keys(tourFrame(tour, t, view));
      for (const bad of ['result', 'sigma', 'seed', 'round', 'count', 'record', 'victim', 'stops']) expect(keys).not.toContain(bad);
    }
  });

  it('FR-354 a frame is a pure function of its inputs: the same inputs give the same frame with every clock and random source throwing', () => {
    const tour = victimTour();
    const before = [0, 123, 456, 3549, 4100, 5349, 7000].map((t) => tourFrame(tour, t, view));
    const boom = (): never => {
      throw new Error('ambient state read');
    };
    vi.spyOn(Math, 'random').mockImplementation(boom);
    vi.spyOn(Date, 'now').mockImplementation(boom);
    vi.spyOn(performance, 'now').mockImplementation(boom);
    const after = [0, 123, 456, 3549, 4100, 5349, 7000].map((t) => tourFrame(tour, t, view));
    expect(after).toStrictEqual(before);
    expect(tourLabelDraws({ factions: [], territories: [] }, [], 0.5)).toStrictEqual([]);
  });
});
