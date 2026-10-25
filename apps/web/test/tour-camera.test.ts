import { describe, expect, it } from 'vitest';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import { clampCamera } from '../src/core/camera';
import type { Camera } from '../src/core/camera';
import { factionBoxes } from '../src/core/label-layout';
import { LABEL_PARAMS } from '../src/core/label-params';
import { decodeIdPng } from '../src/core/png';
import { buildPieceIndex } from '../src/core/regions';
import { sceneAt } from '../src/core/scene';
import { buildTour } from '../src/core/tour';
import type { TourSpec } from '../src/core/tour';
import { cameraAt, ease, framing, framingBoxOf, overview, unionBox } from '../src/core/tour-camera';
import type { Box } from '../src/core/tour-camera';
import { inflateStream } from '../src/ui/load';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';
import { gridOf, ownersOf } from './helpers/grids';

const KINDS = { 1: 'land', 2: 'land', 3: 'land', 4: 'land' } as const;

// A 40 x 20 map. Entry 1: a 9 x 9 block (columns 2..10, rows 3..11) of faction 1. Entry 2: a 2 x 2 island of
// faction 1 (columns 30..31, rows 15..16). Entry 3: a 6 x 4 block of faction 2 (columns 20..25, rows 5..8).
// Entry 4: a 2 x 2 island of faction 3 (columns 35..36, rows 2..3).
const grid = gridOf(
  40,
  20,
  (x, y) => {
    if (x >= 2 && x <= 10 && y >= 3 && y <= 11) return 1;
    if (x >= 30 && x <= 31 && y >= 15 && y <= 16) return 2;
    if (x >= 20 && x <= 25 && y >= 5 && y <= 8) return 3;
    if (x >= 35 && x <= 36 && y >= 2 && y <= 3) return 4;
    return 0;
  },
  KINDS,
);
const OWNERS = ownersOf({ 1: 1, 2: 1, 3: 2, 4: 3 }, 4);
const PARAMS = { ...LABEL_PARAMS, margin: 1, maxHeight: 20 };
const pieces = buildPieceIndex(grid);
// Faction 3 has no aspect, so it has no label entry: its framing box falls back to its land.
const labelled = factionBoxes(pieces, OWNERS, new Map([[1, 2], [2, 2]]), PARAMS);

const IMAGE = { w: 40, h: 20 };

describe('tour framing boxes', () => {
  it('FR-332 a faction with two regions uses its main region only', () => {
    expect(framingBoxOf(labelled, OWNERS, [1])).toStrictEqual({ x0: 2, y0: 3, x1: 11, y1: 12 });
    expect(framingBoxOf(labelled, OWNERS, [2])).toStrictEqual({ x0: 20, y0: 5, x1: 26, y1: 9 });
  });

  it('FR-332 a faction without a label entry falls back to the box of all its land', () => {
    expect(framingBoxOf(labelled, OWNERS, [3])).toStrictEqual({ x0: 35, y0: 2, x1: 37, y1: 4 });
    const noLabels = factionBoxes(pieces, OWNERS, new Map(), PARAMS);
    // Without any label the faction with two pieces uses both: columns 2..31, rows 3..16.
    expect(framingBoxOf(noLabels, OWNERS, [1])).toStrictEqual({ x0: 2, y0: 3, x1: 32, y1: 17 });
  });

  it('FR-332 the box of several factions is the union, and a faction with no land adds nothing', () => {
    expect(framingBoxOf(labelled, OWNERS, [1, 2])).toStrictEqual({ x0: 2, y0: 3, x1: 26, y1: 12 });
    expect(framingBoxOf(labelled, OWNERS, [2, 3, 1])).toStrictEqual({ x0: 2, y0: 2, x1: 37, y1: 12 });
    expect(framingBoxOf(labelled, OWNERS, [1, 9])).toStrictEqual({ x0: 2, y0: 3, x1: 11, y1: 12 });
    expect(framingBoxOf(labelled, OWNERS, [9])).toBeUndefined();
    expect(framingBoxOf(labelled, OWNERS, [])).toBeUndefined();
    expect(unionBox([])).toBeUndefined();
  });

  it('FR-332 on the dev map every living faction has a box inside the image that holds its main region', async () => {
    const png = await decodeIdPng(devPngBytes(), inflateStream);
    if (!png.ok) throw new Error('png');
    const index = buildEntryIndex(DEV_MAP, png.value.width, png.value.height, png.value.values);
    const factionIndex = factionIndexOf(DEV_MAP);
    const devPieces = buildPieceIndex(index);
    const aspects = new Map([...factionIndex.values()].map((f) => [f, 4] as [number, number]));
    const sim = { totalRounds, getState, getRounds, ownerOf };
    const scene = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 1, sim);
    if (!scene.ok) throw new Error('scene');
    const table = ownerTable(index, scene.value.owners, factionIndex);
    const boxes = factionBoxes(devPieces, table, aspects, LABEL_PARAMS);
    expect(boxes.labels.size).toBeGreaterThan(1);
    for (const f of boxes.labels.keys()) {
      const box = framingBoxOf(boxes, table, [f])!;
      expect(box.x0).toBeGreaterThanOrEqual(0);
      expect(box.y0).toBeGreaterThanOrEqual(0);
      expect(box.x1).toBeLessThanOrEqual(png.value.width);
      expect(box.y1).toBeLessThanOrEqual(png.value.height);
      expect(box.x1).toBeGreaterThan(box.x0);
      expect(box.y1).toBeGreaterThan(box.y0);
      // The box of all land (no label entry) holds the main-region box.
      const all = framingBoxOf({ ...boxes, labels: new Map() }, table, [f])!;
      expect(all.x0).toBeLessThanOrEqual(box.x0);
      expect(all.y0).toBeLessThanOrEqual(box.y0);
      expect(all.x1).toBeGreaterThanOrEqual(box.x1);
      expect(all.y1).toBeGreaterThanOrEqual(box.y1);
    }
  });
});

describe('tour framing and easing', () => {
  const small: Box = { x0: 20, y0: 5, x1: 26, y1: 9 }; // 6 x 4
  const medium: Box = { x0: 2, y0: 3, x1: 11, y1: 12 }; // 9 x 9
  const huge: Box = { x0: 0, y0: 0, x1: 40, y1: 20 };

  it('FR-332 the framing scale fills half of the area, between the fit scale and min(4 fit, L0)', () => {
    // Area 50 x 25: fit scale 1.25; 4 fit = 5 is above L0 = 1.5, so the range is [1.25, 1.5].
    const area = { width: 50, height: 25 };
    const c = framing(medium, IMAGE, area);
    expect(c.scale).toBeCloseTo(12.5 / 9, 12); // min(25 / 9, 12.5 / 9)
    expect(c.x).toBe(6.5);
    expect(c.y).toBe(7.5);
    // A small box would ask for 3.125 and is capped at L0, not at 4 fit.
    const s = framing(small, IMAGE, area);
    expect(s.scale).toBe(1.5);
    expect([s.x, s.y]).toStrictEqual([23, 7]);
    // A huge box asks for 0.625 and is raised to the fit scale.
    expect(framing(huge, IMAGE, area)).toStrictEqual({ x: 20, y: 10, scale: 1.25 });
  });

  it('FR-332 the cap is 4 fit when that is below L0, and the fit scale when the fit scale is above L0', () => {
    const tiny = { width: 12, height: 6 }; // fit 0.3, 4 fit = 1.2 < L0
    expect(framing({ x0: 35, y0: 2, x1: 37, y1: 4 }, IMAGE, tiny).scale).toBeCloseTo(1.2, 12);
    expect(framing(small, IMAGE, tiny).scale).toBeCloseTo(0.75, 12); // min(6 / 6, 3 / 4), inside the range
    const big = { width: 80, height: 40 }; // fit 2 > L0: the range collapses to the fit scale
    expect(framing(small, IMAGE, big).scale).toBe(2);
    expect(framing(medium, IMAGE, big).scale).toBe(2);
  });

  it('FR-332 the framing centre is clamped to the image', () => {
    const edge: Box = { x0: 38, y0: 18, x1: 40, y1: 20 };
    const c = framing(edge, IMAGE, { width: 50, height: 25 });
    expect(c.x).toBe(39);
    expect(c.y).toBe(19);
    expect(clampCamera(c, IMAGE, { width: 50, height: 25 })).toStrictEqual(c);
  });

  it('FR-331 the overview is the whole image at the fit scale, centred', () => {
    expect(overview(IMAGE, { width: 50, height: 25 })).toStrictEqual({ x: 20, y: 10, scale: 1.25 });
    expect(overview(IMAGE, { width: 100, height: 25 })).toStrictEqual({ x: 20, y: 10, scale: 1.25 });
  });

  it('FR-331 the easing moves the centre linearly and the scale geometrically with a smoothstep progress', () => {
    const a: Camera = { x: 10, y: 20, scale: 1 };
    const b: Camera = { x: 30, y: 60, scale: 4 };
    expect(ease(a, b, 1000, 0)).toStrictEqual(a);
    expect(ease(a, b, 1000, -50)).toStrictEqual(a);
    expect(ease(a, b, 1000, 1000)).toStrictEqual(b);
    expect(ease(a, b, 1000, 4000)).toStrictEqual(b);
    const mid = ease(a, b, 1000, 500);
    expect([mid.x, mid.y]).toStrictEqual([20, 40]);
    expect(mid.scale).toBeCloseTo(2, 12); // geometric, not 2.5
    // s = 250: progress 3 / 16 - 2 / 64 = 0.15625; scale 4^0.15625 = exp(0.15625 x ln 4).
    const q = ease(a, b, 1000, 250);
    expect(q.x).toBeCloseTo(13.125, 12);
    expect(q.y).toBeCloseTo(26.25, 12);
    expect(q.scale).toBeCloseTo(Math.exp(0.15625 * Math.log(4)), 12);
    expect(q.scale).toBeCloseTo(1.241857, 5);
  });

  it('FR-331 an easing between equal scales keeps the scale exactly', () => {
    const a: Camera = { x: 10, y: 20, scale: 1.37 };
    const b: Camera = { x: 30, y: 20, scale: 1.37 };
    for (const s of [0, 1, 333, 799, 800]) expect(ease(a, b, 800, s).scale).toBe(1.37);
  });
});

// Image 400 x 200 and area 500 x 250: fit 1.25 (so the range is [1.25, 1.5]), overview (200, 100, 1.25).
const BIG_IMAGE = { w: 400, h: 200 };
const AREA = { width: 500, height: 250 };
const VICTIM: Box = { x0: 100, y0: 50, x1: 180, y1: 90 }; // 80 x 40: asks 3.125, capped at 1.5, centre (140, 70)
const BOXES = new Map<number, Box>([
  [7, VICTIM],
  [8, { x0: 300, y0: 120, x1: 340, y1: 150 }],
  [9, { x0: 20, y0: 10, x1: 60, y1: 40 }],
  [5, { x0: 10, y0: 100, x1: 30, y1: 120 }],
]);
const SET = [5, 7, 8, 9];
const START: Camera = { x: 60, y: 30, scale: 3 };
const OVERVIEW: Camera = { x: 200, y: 100, scale: 1.25 };
const VICTIM_FRAMING: Camera = { x: 140, y: 70, scale: 1.5 };
const victimTour = (extra: Partial<TourSpec> = {}) =>
  buildTour({ kind: 'victim', result: 7, set: SET, sigma: 1234567891, boxes: BOXES, ...extra });
const absorberTour = (extra: Partial<TourSpec> = {}) =>
  buildTour({ kind: 'absorber', result: 8, set: [8, 9], victim: 7, sigma: 3000000019, boxes: BOXES, ...extra });

describe('tour camera legs', () => {
  it('FR-331 FR-332 the victim tour has an overview leg over 800 ms from 0 and a victim leg over 1,200 ms from the last stop', () => {
    const tour = victimTour();
    expect(tour.legs).toStrictEqual([
      { from: 0, duration: 800, to: 'overview' },
      { from: 3549, duration: 1200, to: [7] },
    ]);
  });

  it('FR-331 the camera eases from the start to the overview over 800 ms', () => {
    const tour = victimTour();
    expect(cameraAt(tour, 0, AREA, BIG_IMAGE, START)).toStrictEqual(START);
    const mid = cameraAt(tour, 400, AREA, BIG_IMAGE, START);
    expect([mid.x, mid.y]).toStrictEqual([130, 65]);
    expect(mid.scale).toBeCloseTo(Math.sqrt(3.75), 12);
    expect(cameraAt(tour, 800, AREA, BIG_IMAGE, START)).toStrictEqual(OVERVIEW);
    expect(cameraAt(tour, 2000, AREA, BIG_IMAGE, START)).toStrictEqual(OVERVIEW);
  });

  it('FR-331 a start that is already the overview needs no move', () => {
    const tour = victimTour();
    for (const t of [0, 100, 799, 800, 3548]) expect(cameraAt(tour, t, AREA, BIG_IMAGE, OVERVIEW)).toStrictEqual(OVERVIEW);
  });

  it('FR-332 the camera does not move toward the victim before its stop', () => {
    const tour = victimTour();
    expect(cameraAt(tour, 3548, AREA, BIG_IMAGE, START)).toStrictEqual(OVERVIEW);
    expect(cameraAt(tour, 3549, AREA, BIG_IMAGE, START)).toStrictEqual(OVERVIEW);
  });

  it('FR-332 the camera eases from the overview to the victim framing over 1,200 ms from the last stop', () => {
    const tour = victimTour();
    const mid = cameraAt(tour, 3549 + 600, AREA, BIG_IMAGE, START);
    expect([mid.x, mid.y]).toStrictEqual([170, 85]);
    expect(mid.scale).toBeCloseTo(Math.sqrt(1.875), 12);
    expect(cameraAt(tour, 3549 + 1200, AREA, BIG_IMAGE, START)).toStrictEqual(VICTIM_FRAMING);
  });

  it('FR-334 after the end the camera stays at the victim framing and never returns to the overview', () => {
    const tour = victimTour();
    for (const t of [tour.end - 1, tour.end, tour.end + 1, tour.end + 60000]) {
      expect(cameraAt(tour, t, AREA, BIG_IMAGE, START)).toStrictEqual(VICTIM_FRAMING);
    }
  });

  it('FR-331 FR-332 the legs of a scaled tour are floored with the same factor (budget 2,700 ms)', () => {
    const tour = victimTour({ budget: 2700 });
    expect(tour.legs).toStrictEqual([
      { from: 0, duration: 403, to: 'overview' },
      { from: 1786, duration: 605, to: [7] },
    ]);
    expect(tour.end).toBe(2694);
    expect(cameraAt(tour, 1786 + 605, AREA, BIG_IMAGE, START)).toStrictEqual(VICTIM_FRAMING);
  });

  it('FR-343 (still tour) has no camera leg and leaves the start camera as it is', () => {
    const tour = victimTour({ still: true });
    expect(tour.legs).toStrictEqual([]);
    for (const t of [0, 900, 1799, 5000]) expect(cameraAt(tour, t, AREA, BIG_IMAGE, START)).toStrictEqual(START);
  });

  it('FR-348 the absorber tour eases over 800 ms to the framing of the victim and all candidates', () => {
    const tour = absorberTour();
    expect(tour.legs).toStrictEqual([{ from: 0, duration: 800, to: [7, 8, 9] }]);
    // Union of the boxes of 7, 8 and 9: columns 20..340, rows 10..150, 320 x 140: asks 0.78, raised to the fit scale.
    const target = { x: 180, y: 80, scale: 1.25 };
    const from = VICTIM_FRAMING;
    expect(cameraAt(tour, 0, AREA, BIG_IMAGE, from)).toStrictEqual(from);
    const mid = cameraAt(tour, 400, AREA, BIG_IMAGE, from);
    expect([mid.x, mid.y]).toStrictEqual([160, 75]);
    expect(mid.scale).toBeCloseTo(Math.sqrt(1.875), 12);
    expect(cameraAt(tour, 800, AREA, BIG_IMAGE, from)).toStrictEqual(target);
    expect(cameraAt(tour, tour.end + 9999, AREA, BIG_IMAGE, from)).toStrictEqual(target);
  });

  it('FR-348 the absorber leg is floored with the factor of its tour (budget 1,500 ms)', () => {
    expect(absorberTour({ budget: 1500 }).legs).toStrictEqual([{ from: 0, duration: 497, to: [7, 8, 9] }]);
  });

  it('FR-335 after a resize the same elapsed time clamps the start to the new area and recomputes the targets', () => {
    const tour = victimTour();
    const wide = { width: 250, height: 125 }; // fit scale 0.625
    const mid = cameraAt(tour, 400, wide, BIG_IMAGE, START);
    expect([mid.x, mid.y]).toStrictEqual([130, 65]);
    expect(mid.scale).toBeCloseTo(Math.sqrt(3 * 0.625), 12);
    expect(cameraAt(tour, 800, wide, BIG_IMAGE, START)).toStrictEqual({ x: 200, y: 100, scale: 0.625 });
    // Victim framing for the new area: asks min(125 / 80, 62.5 / 40) = 1.5625, capped at 1.5.
    expect(cameraAt(tour, tour.end, wide, BIG_IMAGE, START)).toStrictEqual({ x: 140, y: 70, scale: 1.5 });
  });

  it('FR-335 a resize does not move the camera at the resize instant beyond the clamp of the start', () => {
    const tour = victimTour();
    const start: Camera = { x: 60, y: 30, scale: 1.3 };
    const larger = { width: 800, height: 400 }; // fit scale 2 raises the start scale
    const after = cameraAt(tour, 0, larger, BIG_IMAGE, start);
    expect(after).toStrictEqual(clampCamera(start, BIG_IMAGE, larger));
    expect(after).toStrictEqual({ x: 60, y: 30, scale: 2 });
    // Same area, same start: the camera at the instant before and at the instant is the same.
    expect(cameraAt(tour, 0, AREA, BIG_IMAGE, start)).toStrictEqual(start);
  });

  it('FR-335 the camera is continuous over time for a fixed area', () => {
    const tour = victimTour();
    let last = cameraAt(tour, 0, AREA, BIG_IMAGE, START);
    for (let t = 1; t <= tour.end + 50; t++) {
      const c = cameraAt(tour, t, AREA, BIG_IMAGE, START);
      expect(Math.abs(c.x - last.x)).toBeLessThan(2);
      expect(Math.abs(c.y - last.y)).toBeLessThan(2);
      expect(Math.abs(c.scale - last.scale)).toBeLessThan(0.02);
      last = c;
    }
  });

  it('FR-331 a tour with no box for the victim leaves the camera where the earlier legs put it', () => {
    const tour = buildTour({ kind: 'victim', result: 7, set: SET, sigma: 5, boxes: new Map() });
    expect(cameraAt(tour, 800, AREA, BIG_IMAGE, START)).toStrictEqual(OVERVIEW);
    expect(cameraAt(tour, 9000, AREA, BIG_IMAGE, START)).toStrictEqual(OVERVIEW);
  });
});
