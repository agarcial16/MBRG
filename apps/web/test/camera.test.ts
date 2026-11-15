import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  WHEEL_BASE,
  clampCamera,
  fitScale,
  initialCamera,
  mapToScreen,
  panTo,
  resizeCamera,
  screenToMap,
  wheelSteps,
  zoomAt,
  type Camera,
} from '../src/core/camera';
import cameraSource from '../src/core/camera.ts?raw';
import { codeOnly } from './helpers/scan';

const IMAGE = { w: 2048, h: 2048 };
const VP = { width: 1920, height: 1080 };
const FIT = 1080 / 2048;

/** Screen distance in px between where a map point is drawn and where the pointer is. */
function screenError(cam: Camera, m: { x: number; y: number }, p: { sx: number; sy: number }, vp = VP): number {
  const s = mapToScreen(cam, m, vp);
  return Math.hypot(s.sx - p.sx, s.sy - p.sy);
}

describe('FR-144 initial view', () => {
  it('FR-144 the fit scale shows the whole 2048 x 2048 image in a 1920 x 1080 area', () => {
    expect(fitScale(IMAGE, VP)).toBe(FIT);
  });

  it('FR-144 the initial camera is centred on the image at the fit scale', () => {
    expect(initialCamera(IMAGE, VP)).toStrictEqual({ x: 1024, y: 1024, scale: FIT });
  });

  it('FR-144 the whole image is inside the drawing area and centred at the initial camera', () => {
    const cam = initialCamera(IMAGE, VP);
    const topLeft = mapToScreen(cam, { x: 0, y: 0 }, VP);
    const bottomRight = mapToScreen(cam, { x: 2048, y: 2048 }, VP);
    expect(topLeft.sx).toBeGreaterThanOrEqual(0);
    expect(topLeft.sy).toBeCloseTo(0, 9);
    expect(bottomRight.sx).toBeLessThanOrEqual(1920);
    expect(bottomRight.sy).toBeCloseTo(1080, 9);
    expect((topLeft.sx + bottomRight.sx) / 2).toBeCloseTo(960, 9);
  });

  it('FR-144 a portrait area fits by its width', () => {
    expect(fitScale(IMAGE, { width: 800, height: 1000 })).toBe(800 / 2048);
  });

  it('FR-144 a tiny 200 x 150 area keeps a valid fit view without error', () => {
    const cam = initialCamera(IMAGE, { width: 200, height: 150 });
    expect(cam).toStrictEqual({ x: 1024, y: 1024, scale: 150 / 2048 });
  });

  it('FR-144 a map smaller than the area is limited to scale 32 (both limits equal)', () => {
    const tiny = { w: 10, h: 10 };
    expect(initialCamera(tiny, VP).scale).toBe(MAX_SCALE);
    expect(clampCamera({ x: 5, y: 5, scale: 1 }, tiny, VP).scale).toBe(MAX_SCALE);
  });
});

describe('FR-145 drag', () => {
  const start: Camera = { x: 1000, y: 900, scale: 8 };

  it('FR-145 the map point grabbed at the start stays under the pointer within 1 px', () => {
    const grab = { sx: 500, sy: 300 };
    const m0 = screenToMap(start, grab, VP);
    for (const p of [
      { sx: 620, sy: 380 },
      { sx: 100, sy: 1000 },
      { sx: 1900, sy: 20 },
      { sx: 500, sy: 300 },
    ]) {
      const cam = panTo(start, m0, p, IMAGE, VP);
      expect(cam.scale).toBe(start.scale);
      expect(screenError(cam, m0, p)).toBeLessThanOrEqual(1);
    }
  });

  it('FR-145 dragging by zero keeps the camera', () => {
    const grab = { sx: 321, sy: 654 };
    const m0 = screenToMap(start, grab, VP);
    const cam = panTo(start, m0, grab, IMAGE, VP);
    expect(cam.x).toBeCloseTo(start.x, 9);
    expect(cam.y).toBeCloseTo(start.y, 9);
  });

  it('FR-145 FR-147 a drag that would leave the image stops at the clamp (the clamp wins over 1 px)', () => {
    const m0 = screenToMap(start, { sx: 960, sy: 540 }, VP);
    const cam = panTo(start, m0, { sx: -50000, sy: 50000 }, IMAGE, VP);
    expect(cam.x).toBe(2048);
    expect(cam.y).toBe(0);
  });
});

describe('FR-146 wheel zoom', () => {
  const cam: Camera = { x: 1024, y: 1024, scale: FIT };

  it('FR-146 one wheel step multiplies the scale by the fixed factor 1.2', () => {
    expect(WHEEL_BASE).toBe(1.2);
    expect(zoomAt(cam, { sx: 960, sy: 540 }, 1, IMAGE, VP).scale).toBeCloseTo(FIT * 1.2, 12);
    expect(zoomAt({ ...cam, scale: 4 }, { sx: 960, sy: 540 }, -1, IMAGE, VP).scale).toBeCloseTo(4 / 1.2, 12);
    expect(zoomAt({ ...cam, scale: 4 }, { sx: 960, sy: 540 }, 3, IMAGE, VP).scale).toBeCloseTo(4 * 1.2 ** 3, 12);
  });

  it('FR-146 the map point under the pointer stays under it within 1 px, zooming in and out', () => {
    const base: Camera = { x: 900, y: 1100, scale: 3 };
    for (const p of [
      { sx: 700, sy: 400 },
      { sx: 1300, sy: 800 },
      { sx: 960, sy: 540 },
      { sx: 200, sy: 900 },
    ]) {
      for (const steps of [1, -1, 3, -3, 0.5, -0.25]) {
        const m = screenToMap(base, p, VP);
        const next = zoomAt(base, p, steps, IMAGE, VP);
        expect(screenError(next, m, p)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('FR-146 zooming about a pointer at the fit scale keeps the point under the pointer too', () => {
    const p = { sx: 700, sy: 400 };
    const m = screenToMap(cam, p, VP);
    const next = zoomAt(cam, p, 1, IMAGE, VP);
    expect(screenError(next, m, p)).toBeLessThanOrEqual(1);
  });

  it('FR-146 the scale never goes below the fit scale or above 32; a step beyond a limit stops at it', () => {
    const p = { sx: 960, sy: 540 };
    expect(zoomAt(cam, p, -5, IMAGE, VP).scale).toBe(FIT);
    expect(zoomAt({ ...cam, scale: 31 }, p, 5, IMAGE, VP).scale).toBe(32);
    expect(zoomAt({ ...cam, scale: 32 }, p, 1, IMAGE, VP).scale).toBe(32);
    let c = cam;
    for (let i = 0; i < 100; i++) c = zoomAt(c, p, 1, IMAGE, VP);
    expect(c.scale).toBe(32);
    for (let i = 0; i < 100; i++) c = zoomAt(c, p, -1, IMAGE, VP);
    expect(c.scale).toBe(FIT);
  });

  it('FR-146 wheel deltas become steps: 100 px is one step, lines count 33 px, pages 800 px', () => {
    expect(wheelSteps(-100, 0)).toBe(1);
    expect(wheelSteps(100, 0)).toBe(-1);
    expect(wheelSteps(-50, 0)).toBe(0.5);
    expect(wheelSteps(-3, 1)).toBeCloseTo(0.99, 12);
    expect(wheelSteps(-1, 2)).toBe(8);
    expect(wheelSteps(0, 0)).toBe(0);
  });
});

describe('FR-147 centre inside the image', () => {
  it('FR-147 clampCamera keeps the centre inside the image rectangle and the scale inside its limits', () => {
    expect(clampCamera({ x: -50, y: 3000, scale: 2 }, IMAGE, VP)).toStrictEqual({ x: 0, y: 2048, scale: 2 });
    expect(clampCamera({ x: 100, y: 200, scale: 2 }, IMAGE, VP)).toStrictEqual({ x: 100, y: 200, scale: 2 });
    expect(clampCamera({ x: 5, y: 5, scale: 0.01 }, IMAGE, VP).scale).toBe(FIT);
    expect(clampCamera({ x: 5, y: 5, scale: 99 }, IMAGE, VP).scale).toBe(32);
  });

  it('FR-147 every pan, zoom and resize leaves the centre inside the image', () => {
    const inside = (c: Camera) => c.x >= 0 && c.x <= 2048 && c.y >= 0 && c.y <= 2048;
    const cam: Camera = { x: 2040, y: 5, scale: 10 };
    const m0 = screenToMap(cam, { sx: 100, sy: 100 }, VP);
    expect(inside(panTo(cam, m0, { sx: 1900, sy: -3000 }, IMAGE, VP))).toBe(true);
    expect(inside(zoomAt(cam, { sx: 1900, sy: 20 }, -2, IMAGE, VP))).toBe(true);
    expect(inside(zoomAt(cam, { sx: 5, sy: 1070 }, 2, IMAGE, VP))).toBe(true);
    expect(inside(resizeCamera(cam, IMAGE, { width: 200, height: 150 }))).toBe(true);
  });
});

describe('FR-148 resize and reset', () => {
  it('FR-148 a resize keeps the centre and the scale when the scale is still at or above the new fit', () => {
    const cam: Camera = { x: 700, y: 1500, scale: 6 };
    expect(resizeCamera(cam, IMAGE, { width: 1000, height: 700 })).toStrictEqual(cam);
    expect(resizeCamera(cam, IMAGE, { width: 200, height: 150 })).toStrictEqual(cam);
  });

  it('FR-148 a resize raises the scale to the new fit scale when it is now below it', () => {
    const cam: Camera = { x: 700, y: 1500, scale: FIT };
    const bigger = resizeCamera(cam, IMAGE, { width: 4000, height: 3000 });
    expect(bigger).toStrictEqual({ x: 700, y: 1500, scale: 3000 / 2048 });
  });

  it('FR-148 reset returns the view of FR-144', () => {
    expect(initialCamera(IMAGE, { width: 1000, height: 700 })).toStrictEqual({ x: 1024, y: 1024, scale: 700 / 2048 });
    const dragged = zoomAt({ x: 100, y: 100, scale: 9 }, { sx: 10, sy: 10 }, 2, IMAGE, VP);
    expect(dragged).not.toStrictEqual(initialCamera(IMAGE, VP));
    expect(initialCamera(IMAGE, VP)).toStrictEqual({ x: 1024, y: 1024, scale: FIT });
  });

  it('FR-148 the map point at the centre of the area is the camera centre before and after a resize', () => {
    const cam: Camera = { x: 700, y: 1500, scale: 6 };
    const vp2 = { width: 1000, height: 700 };
    const centre = screenToMap(resizeCamera(cam, IMAGE, vp2), { sx: 500, sy: 350 }, vp2);
    expect(centre).toStrictEqual({ x: 700, y: 1500 });
  });
});

describe('FR-149 camera unchanged by a round change', () => {
  it('FR-149 the camera module knows nothing about rounds or seeds', () => {
    const code = codeOnly(cameraSource);
    expect(/\b(?:round|seed|record|sim)\b/i.test(code)).toBe(false);
  });
});

describe('FR-144 FR-145 FR-146 screen and map conversions', () => {
  it('FR-144 screenToMap and mapToScreen are inverse and screen centre is the camera centre', () => {
    const cam: Camera = { x: 321.5, y: 77.25, scale: 5.5 };
    expect(screenToMap(cam, { sx: 960, sy: 540 }, VP)).toStrictEqual({ x: 321.5, y: 77.25 });
    const p = { sx: 123.5, sy: 987.25 };
    const back = mapToScreen(cam, screenToMap(cam, p, VP), VP);
    expect(back.sx).toBeCloseTo(p.sx, 9);
    expect(back.sy).toBeCloseTo(p.sy, 9);
  });
});
